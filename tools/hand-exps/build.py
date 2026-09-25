# -*- coding: utf-8 -*-
#  새 실험(센서 없이 하는 실험) JSON → lab-data.js 표시 구간 · demo-data.js · hand-data.js
#  여러 번 돌려도 같은 결과가 나오도록 표시 구간을 통째로 바꿉니다.
#  ▣ 쓰는 법 — 이 폴더의 new_exps_*.json 을 고친 뒤  python tools/hand-exps/build.py  (레포 어디서 돌려도 됩니다)
#    JSON 한 건 = lab-data.js 실험 + hand(손으로 탐구 방법 → hand-data.js) + demo(예시 자료 CSV → demo-data.js)
#    lab-data.js · demo-data.js 의 「▣ 센서 없이 하는 실험」 표시 구간은 손으로 고치지 말고 JSON 을 고치세요(다시 돌리면 덮입니다).
import io, os, re, json, glob, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
os.chdir(REPO)

files = sorted(glob.glob(os.path.join(HERE, 'new_exps_*.json')))
exps = []
for f in files:
    exps += json.load(io.open(f, encoding='utf-8'))
ids = [e['id'] for e in exps]
assert len(ids) == len(set(ids)), '같은 id 가 둘 있습니다'

# ── 참조 자료(단원·성취기준) 읽기 ──
ref = json.loads(subprocess.check_output(['node', '-e', """
global.window=global; require('./hub.js'); require('./lab-data.js');
const L=window.LAB; process.stdout.write('@@JSON@@'+JSON.stringify({units:L.units.map(u=>[u.grade,u.title]), std:Object.keys(L.standards), ids:L.experiments.filter(e=>!e.kind).map(e=>e.id)}));
"""], stderr=subprocess.DEVNULL).decode('utf-8').split('@@JSON@@')[1])
UNITS = {(g, t) for g, t in ref['units']}
STD = set(ref['std'])
OLD = set(ref['ids'])

WHEN = re.compile(r'^(always|(r2Min|r2|slope|intercept|mean|range|delta|n)\s*(>=|<=|==|!=|>|<)\s*-?[0-9.]+)$')
errs = []
def err(id, m): errs.append(id + ': ' + m)
for e in exps:
    id = e['id']
    if id in OLD: err(id, '센서 실험 id 와 겹침')
    if e.get('kind') not in ('hand', 'data'): err(id, 'kind')
    if (e['grade'], e['unit']) not in UNITS: err(id, '단원 이름/학년 %r' % ((e['grade'], e['unit']),))
    for c in e['std']:
        if c not in STD: err(id, '성취기준 코드 ' + c)
    sp = e['dataSpec']; ns = len(sp['series'])
    for s in [sp['x']] + sp['series']:
        if re.search(r'[×÷/]', s['label']): err(id, '열 이름에 × ÷ / — 계산 열로 오인됨: ' + s['label'])
    head = e['demo'].split('\n')[0].split(',')
    want = [sp['x']['label']] + [s['label'] for s in sp['series']]
    if head != want: err(id, '예시 자료 머리글 %r ≠ %r' % (head, want))
    for line in e['demo'].split('\n')[1:]:
        cells = line.split(',')
        if len(cells) != len(want): err(id, '예시 자료 칸 수: ' + line)
    nd = 0
    def keyok(k):
        if k == 'x': return True
        m = re.match(r'^s(\d+)$', k)
        if m: return int(m.group(1)) < ns
        m = re.match(r'^d(\d+)$', k)
        if m: return int(m.group(1)) < nd
        return False
    for st in e['analysis']['steps']:
        k = st['kind']
        if k == 'derive':
            for kk in (st['a'], st['b']):
                if not keyok(kk): err(id, 'derive 열 %s' % kk)
            if st['op'] not in ('*', '/', '+', '-'): err(id, 'op')
            nd += 1
        elif k == 'stat':
            if not keyok(st['of']): err(id, 'stat of %s' % st['of'])
        elif k == 'fit':
            for kk in (st['x'], st['y']):
                if not keyok(kk): err(id, 'fit 열 %s' % kk)
        elif k == 'compare':
            for kk in st['of']:
                if not keyok(kk): err(id, 'compare 열 %s' % kk)
        elif k == 'plot':
            for kk in (st['x'], st['y']):
                if not keyok(kk): err(id, 'plot 열 %s' % kk)
        else: err(id, 'step kind ' + k)
    v = e['analysis']['verdict']
    for r in v:
        if not WHEN.match(r['when'].strip()): err(id, 'verdict when ' + r['when'])
    if v[-1]['when'] != 'always': err(id, '마지막 판정이 always 가 아님')
    h = e['hand']
    cols = [c['col'] for c in h.get('cols', [])]
    if h.get('ok') and cols != want: err(id, 'hand.cols %r ≠ %r' % (cols, want))
    a = (e.get('pool') or {}).get('assign')
    if a and not a.get('sets'): err(id, 'assign.sets 비어 있음')
if errs:
    print('\n'.join(errs)); sys.exit(1)

exps.sort(key=lambda e: (e['grade'], e['id']))
lab = [{k: v for k, v in e.items() if k not in ('hand', 'demo')} for e in exps]

# ── lab-data.js ──
A = '// ▣ 센서 없이 하는 실험 — 시작'
B = '// ▣ 센서 없이 하는 실험 — 끝'
s = io.open('lab-data.js', encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
i, j = s.index(A), s.index(B)
body = json.dumps(lab, ensure_ascii=False, indent=1).replace('\n', nl)
s = s[:i] + A + nl + "window.__LAB_PARTS['hand'] = " + body + ';' + nl + s[j:]
io.open('lab-data.js', 'w', encoding='utf-8', newline='').write(s)

# ── demo-data.js ──
DA = '  // ▣ 센서 없이 하는 실험 — 시작'
DB = '  // ▣ 센서 없이 하는 실험 — 끝'
d = io.open('demo-data.js', encoding='utf-8', newline='').read()
dn = '\r\n' if '\r\n' in d else '\n'
block = DA + dn + ''.join('  //  %s — %s%s  %s: %s,%s' % (e['id'], e['title'], dn, json.dumps(e['id']), json.dumps(e['demo'], ensure_ascii=False), dn) for e in exps) + DB + dn
if DA in d:
    d = d[:d.index(DA)] + block + d[d.index(DB) + len(DB) + len(dn):]
else:
    k = d.rstrip().rfind('};')
    d = d[:k] + block + d[k:]
io.open('demo-data.js', 'w', encoding='utf-8', newline='').write(d)

# ── hand-data.js ──
t = io.open('hand-data.js', encoding='utf-8').read()
p = t.index('window.__LAB_HAND = ')
hand = json.loads(t[p + len('window.__LAB_HAND = '):].rstrip().rstrip(';'))
for e in exps:
    hand[e['id']] = {k: v for k, v in e['hand'].items() if v not in (None, '', [])}
io.open('hand-data.js', 'w', encoding='utf-8', newline='\n').write(t[:p] + 'window.__LAB_HAND = ' + json.dumps(hand, ensure_ascii=False, indent=1) + ';\n')
print('새 실험 %d건을 넣었습니다: %s' % (len(exps), ' '.join(e['id'] for e in exps)))
