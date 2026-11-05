import json,glob,collections,sys
d=sys.argv[1]
n=0;types=collections.Counter();runs=collections.defaultdict(set);heap=[];samples={}
for f in sorted(glob.glob(d+'/*.json')):
    try:j=json.load(open(f))
    except Exception:continue
    n+=1;h=j.get('heapMax');h is not None and heap.append(h)
    for x in j.get('findings',[]):
        k=x.split(' ')[0].rstrip(':');types[k]+=1;runs[k].add(f.split('/')[-1]);samples.setdefault(k,x[:220])
print('fuzz sessions',n,'unparsed',len(glob.glob(d+'/*.bad')),'heap max MB',max(heap) if heap else None)
for k,c in types.most_common():print(f'  {k}: {c} in {len(runs[k])} sessions | e.g. {samples[k]}')
