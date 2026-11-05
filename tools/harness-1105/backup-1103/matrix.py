# python3 -I matrix.py [outdir] [pattern]: the fault matrix, one line per case, then the totals.
import json, re, glob, sys
d0 = sys.argv[1] if len(sys.argv) > 1 else 'out/matrix'
pat = sys.argv[2] if len(sys.argv) > 2 else ''
ok = bad = exc = 0
rows = []
for f in sorted(glob.glob(d0 + '/*.json')):
    if pat not in f:
        continue
    try:
        d = json.load(open(f))
    except Exception:
        print('EMPTY/BAD', f.split('/')[-1]); bad += 1; continue
    ok += 1
    errs = [e for e in d['errors'] if e.startswith('exception')]
    exc += len(errs)
    o = d.get('otherFeed', {})
    texts = ' / '.join(sorted(set(m for t in d['texts'] for m in re.findall(
        r'(Connecting to the live feed|No live data right now\. Reconnecting[^.]*\.|Quiet skies|Route not reported|Drawing[a-z ]*|Filling[a-z ]*|map tile[a-z ]*|unavailable)', t))))[:160]
    print(f"{d['case']:22} n={d['requests']:3} perMin={d['perMin']:5} gaps={d['firstGaps'][:5]} max={d['maxGap']} st={d['statuses']} "
          f"planes={d.get('planesShownDuringFault','-')} other={o.get('requests','-')}/{o.get('statuses','-')} firstOther={o.get('first','-')} "
          f"otherGaps={o.get('gaps','-')} rec={d['recoveredAfterSec']} errs={len(d['errors'])} | {texts}")
print(f'parsed {ok}, empty/bad {bad}, JS exceptions {exc}')
