# python3 -I audit.py <log.json>: the host audit of a logged session (lib.mjs state.log).
# Hosts and counts, HTTPS only, requests before consent and after Erase (from the steps), and
# for the position feeds: every api.adsb.lol request comes while adsb.fi is failing (its last
# reply before that request was a failure, with no good one since), and every lat/lon in a
# feed or time-zone URL sits on the 0.05 degree grid. Prints counts only, no coordinates.
import json, re, sys, collections
j = json.load(open(sys.argv[1]))
log = [e for e in j['log'] if e.get('kind') in ('bridge', 'direct')]
hosts = collections.Counter()
plain = 0
for e in log:
    m = re.match(r'(https?)://([^/?#]+)', e['url'])
    hosts[m.group(2) if m else '?'] += 1
    if not m or m.group(1) != 'https':
        plain += 1
print(len(hosts), 'hosts, non-HTTPS requests:', plain)
for h, c in hosts.most_common():
    print('  %-32s %d' % (h, c))
steps = j['steps']
print('steps:', '; '.join('%ss %s' % (t, l) for t, l in steps if re.search(r'consent|erase|adsb\.fi', l)))
# Feed order: adsb.fi replies (ok or failed) and adsb.lol requests, in time order.
feed = [e for e in log if e['svc'] in ('feed', 'backup')]
bad, last_fi = [], None
for e in feed:
    if e['svc'] == 'feed':
        last_fi = e
    elif last_fi is None or last_fi.get('status') == 200:
        bad.append(e['t'])
lol = [e for e in feed if e['svc'] == 'backup']
print('adsb.lol position requests:', len(lol), '| asked while adsb.fi was answering:', len(bad), bad[:5])
# Outage windows from the steps, and adsb.lol requests outside them (plus one adsb.fi check after).
grid_bad = 0
pts = collections.Counter()
for e in log:
    m = re.search(r'(?:lat/|latitude=)(-?\d+\.\d+)(?:/lon/|&longitude=)(-?\d+\.\d+)', e['url'])
    if not m:
        continue
    la, lo = m.group(1), m.group(2)
    on = all(len(v.split('.')[1]) == 2 and round(float(v) * 100) % 5 == 0 for v in (la, lo))
    if not on:
        grid_bad += 1
    pts[e['svc']] += 1
print('URLs with coordinates by service:', dict(pts), '| off the 0.05 grid:', grid_bad)
d = collections.Counter(re.search(r'/dist/(\d+)', e['url']).group(1) for e in lol)
fi = collections.Counter(re.search(r'/dist/(\d+)', e['url']).group(1) for e in feed if e['svc'] == 'feed')
print('adsb.lol distances (NM):', dict(d), '| adsb.fi distances:', dict(fi))
lol_t = [round(e['t']) for e in lol]
print('adsb.lol request times (s):', lol_t[:3], '...', lol_t[-3:])
print('errors:', j.get('errors', [])[:5])
