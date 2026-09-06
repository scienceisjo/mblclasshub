# -*- coding: utf-8 -*-
#  스크립트·스타일 주소에 ?v=날짜시각 을 붙여, 갱신한 앱이 옛 캐시로 열리지 않게 합니다.
#  배포 직전에 한 번 돌립니다.  python bump_ver.py <폴더>
import io, os, re, sys, datetime
sys.stdout.reconfigure(encoding='utf-8')
root = sys.argv[1]
ver = datetime.datetime.now().strftime('%Y%m%d%H%M')
LOCAL = re.compile(r'(<script\s+src=")(\./)([A-Za-z0-9_\-]+\.js)(\?v=[A-Za-z0-9._\-]+)?(")')
n_files = 0
for fn in os.listdir(root):
    if not fn.endswith('.html'): continue
    p = os.path.join(root, fn)
    s = io.open(p, encoding='utf-8').read()
    new = LOCAL.sub(lambda m: m.group(1) + m.group(2) + m.group(3) + '?v=' + ver + m.group(5), s)
    if new != s:
        io.open(p, 'w', encoding='utf-8').write(new)
        n_files += 1
        print('  %s · %d개' % (fn, len(LOCAL.findall(s))))
print('버전 %s · 파일 %d개' % (ver, n_files))
