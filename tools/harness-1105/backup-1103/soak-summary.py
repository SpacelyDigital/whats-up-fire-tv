# python3 -I soak-summary.py <adsblol.jsonl> <soak.json>: what adsb.lol answered during a soak (counts,
# each refusal with its request number, minutes in and Retry-After, the gaps between requests and
# the pauses), and how long the screen had planes, "No live data", "Connecting" or quiet skies.
import json, sys, collections, datetime
L = [json.loads(l) for l in open(sys.argv[1])]
S = json.load(open(sys.argv[2]))
t = [datetime.datetime.fromisoformat(x['at'].replace('Z', '+00:00')) for x in L]
t0 = t[0] if t else None
print('adsb.lol position requests:', len(L), dict(collections.Counter(str(x['status']) for x in L)))
for i, x in enumerate(L):
    if x['status'] != 200:
        print(f"  #{x['n']} at +{(t[i]-t0).total_seconds()/60:.1f} min ({x['at'][11:19]} UTC): {x['status']}, Retry-After {x.get('headers',{}).get('retry-after','-')}, after {sum(1 for y in L[:i] if y['status']==200)} good answers")
gaps = [round((b - a).total_seconds(), 1) for a, b in zip(t, t[1:])]
print('gaps (s): min', min(gaps) if gaps else None, 'median', sorted(gaps)[len(gaps)//2] if gaps else None, 'max', max(gaps) if gaps else None)
print('  pauses over 30 s:', [(L[i]['at'][11:19], g) for i, g in enumerate(gaps) if g > 30])
hdr = collections.Counter(k for x in L for k in x.get('headers', {}))
print('response headers seen:', dict(hdr))
print('aircraft per answer: min', min((x['ac'] for x in L if isinstance(x.get('ac'), int)), default=None), 'max', max((x['ac'] for x in L if isinstance(x.get('ac'), int)), default=None))
ta = S['tally']; tot = sum(ta.values())
print('screen, seconds sampled:', tot, {k: f"{v} s ({100*v/tot:.0f}%)" for k, v in ta.items() if v})
print('screen changes:', [(c['t'], c['state']) for c in S['changes']][:30])
print('credit lines:', S['credits'])
print('adsb.fi attempts blocked in the browser:', S['adsbfiBlocked']['count'], '| page errors:', S['errors'][:3])
