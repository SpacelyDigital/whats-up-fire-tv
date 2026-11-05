# python3 -I policy-compare.py <privacy-store.txt> <site privacy/index.html>: the policy's text, block
# by block, in the app and on the site page (headings, paragraphs, list items, in order). Prints
# the block counts, every block that differs, and the two sha256 of the normalised text.
import sys,re,html,hashlib,difflib
from html.parser import HTMLParser
txt=open(sys.argv[1],encoding='utf-8').read();page=open(sys.argv[2],encoding='utf-8').read()
norm=lambda s:re.sub(r'\s+',' ',s).strip()
app=[]
for l in txt.split('\n'):
    l=norm(l)
    if not l:continue
    l=re.sub(r'^#+\s*','',l);l=re.sub(r'^•\s*','',l)
    app.append(l)
class P(HTMLParser):
    BLOCK={'h1','h2','h3','h4','p','li','td','th','dt','dd'}
    def __init__(s):super().__init__(convert_charrefs=True);s.out=[];s.buf=None;s.depth=0;s.skip=0
    def handle_starttag(s,t,a):
        if t in('script','style','head','nav','footer'):s.skip+=1
        if t in s.BLOCK and not s.skip:
            if s.depth==0:s.buf=[]
            s.depth+=1
    def handle_endtag(s,t):
        if t in('script','style','head','nav','footer'):s.skip=max(0,s.skip-1)
        if t in s.BLOCK and s.depth and not s.skip:
            s.depth-=1
            if s.depth==0:
                b=norm(''.join(s.buf));s.buf=None
                if b:s.out.append(b)
    def handle_data(s,d):
        if s.buf is not None and not s.skip:s.buf.append(d)
p=P();p.feed(page);site=p.out
print('blocks: app',len(app),'site',len(site))
diff=[l for l in difflib.unified_diff(app,site,'app','site',lineterm='',n=0) if not l.startswith(('---','+++','@@'))]
print('differing block lines:',len(diff))
for l in diff[:24]:print('  ',l[:200])
for n,b in (('app',app),('site',site)):print(n,hashlib.sha256('\n'.join(b).encode()).hexdigest()[:16])
