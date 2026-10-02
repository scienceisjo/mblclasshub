# MBL 수업허브

중학교 과학 탐구 수업을 **참여코드 6자리** 하나로 굴리는 웹앱입니다. 예상 그래프 그리기 → 측정(센서 또는 손) → 데이터 실험실 분석 → 보고서 → 모둠 공유 → 전자칠판 발표 → 개념 확인 → 생기부 자료까지 한 차시를 한곳에서 합니다.

- 빌드 도구가 없는 **순수 HTML·JS** 입니다. 폴더를 그대로 GitHub Pages 같은 정적 호스팅에 올리면 됩니다.
- **간편 모드**는 서버 없이 동작합니다(수업 꾸러미 `.json` 을 나눠 주고 작업 파일 `.html` 을 걷습니다).
- **실시간 모드**는 학교마다 만든 Supabase 무료 프로젝트 하나를 씁니다.
- 교사용 자세한 안내는 [`manual.html`](manual.html), 소개는 [`about.html`](about.html) 에 있습니다.

## 화면

| 파일 | 화면 |
|---|---|
| `index.html` | 학생 화면 — 참여코드 입장, 코드 없이 시작(간편 모드), 데이터 입력·실험실·보고서·모둠 공유 |
| `inquiry.html` | 손으로 탐구 — 센서 없이 재고·계산하고·그래프를 직접 그리는 학생 화면(참여코드로 수업에 연결 가능) |
| `teacher.html` | 교사 화면 — 수업 만들기, 단계 전환, 모둠마다 다른 값 재기, 채점, 수업 꾸러미, 제출된 보고서 합치기 |
| `present.html` | 전자칠판 발표 화면 |
| `manual.html` · `about.html` | 사용 설명서 · 앱 소개 |
| `demo/` | 연수 시연용 예시 작업 파일과 수합 시트 CSV |

모든 화면 위에 같은 메뉴(학생 화면 · 손으로 탐구 · 교사 화면 · 사용 설명서 · 앱 소개)가 있습니다.

## 배포

1. **폴더 전체를 그대로** 올립니다(`lib/` · `assets/` · `sql/` · `demo/` 포함). 몇 개만 골라 올리면 빠진 기능이 조용히 사라집니다. 파일별 역할은 `manual.html#files` 에 있습니다.
2. 실시간 모드를 쓰려면 Supabase 프로젝트를 만들고 SQL Editor 에서 `schema.sql` 전체를 한 번 실행합니다(여러 번 실행해도 안전). 이미 설치한 학교는 `sql/2026-09-28_open_groups.sql` 도 한 번 실행합니다.
3. `config.js` 를 고칩니다 — 학교마다 고치는 파일은 이것 하나입니다.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` : Settings → API 의 Project URL 과 anon/public 키. **service_role 키는 절대 넣지 않습니다.**
   - `SCHOOL`, `TEACHER` : 선택. 교사 화면 안내와 about · manual · demo 의 머리·꼬리말에 나옵니다. 비워 두면 일반 문구가 나옵니다.
4. 교사 화면의 **[연결 확인]** 으로 확인합니다.

다른 학교의 `config.js` 를 그대로 쓰지 마세요. 학교 하나에 Supabase 프로젝트 하나가 원칙입니다.

## 캐시 꼬리 붙이기 — `bump_ver.py`

학생 기기가 옛 캐시로 열지 않도록, 배포 직전에 HTML 안의 `<script src="./파일.js?v=…">` 꼬리를 오늘 날짜시각으로 바꿉니다.

```
python bump_ver.py .
```

`./` 로 시작하는 같은 폴더의 스크립트만 바꿉니다(`lib/` 안 파일과 `demo/` 는 건드리지 않습니다).

## 실험 도감 자료 만들기

- 실험 도감은 `lab-data.js`(전역 `LAB`) 하나입니다. 브라우저 콘솔의 `LAB.meta.counts` 로 건수를 봅니다(2026-10 기준 76건 — 센서 50 · 센서 없이 26, 중1 22 · 중2 28 · 중3 26).
- **센서 없이 하는 실험**(`hd-*`, `da-*`)은 `tools/hand-exps/new_exps_*.json` 이 원본입니다. JSON 을 고친 뒤

  ```
  python tools/hand-exps/build.py
  ```

  를 돌리면 `lab-data.js` · `demo-data.js` · `hand-data.js` 의 「▣ 센서 없이 하는 실험」 구간이 통째로 다시 만들어집니다. 그 구간은 손으로 고치지 마세요(다시 돌리면 덮입니다). 이 스크립트는 `node` 가 필요합니다.
- 센서 실험의 「센서 없이 재는 법」은 `hand-data.js`(전역 `__LAB_HAND`)에 있습니다.
- `lab-part-*.js` · `vendor-steps-*.js` 는 옛 조각이라 `.gitignore` 로 뺐습니다.

## 설명서 화면 사진 넣기

`manual.html` 의 화면 사진은 `assets/shot-*.png` 입니다. 원본 캡처는 `docs/shots/` 에 있습니다.

| 파일 | 내용 | 설명서 자리 |
|---|---|---|
| `assets/shot-join.png` | 학생 첫 화면(참여코드 입력) | C. 모둠 입장 |
| `assets/shot-merge.png` | 교사 화면 — 제출된 보고서 합치기 | A. 간편 모드로 한 차시 |
| `assets/shot-classgraph.png` | 네 모둠 자료를 합친 반 전체 그래프 | C. 모둠마다 다른 값 재기 |

새 사진을 넣으려면

1. 가로로 넓게(1200px 이상) 찍어 `.png` 로 저장합니다. 지금 사진은 2560×1800 입니다 — 비율이 다르면 `manual.html` 의 `figure.shot img` 의 `aspect-ratio` 와 `<img width height>` 를 함께 맞춥니다(사진이 늦게 떠도 아래 글과 바로가기 위치가 밀리지 않게 하려는 것입니다).
2. `assets/shot-이름.png` 로 두고 `manual.html` 의 알맞은 자리에 `<figure class="shot"><img src="assets/shot-이름.png" width="2560" height="1800" alt="…" loading="lazy" /><figcaption>…</figcaption></figure>` 를 넣습니다.
3. 화면에 **실제 참여코드·관리코드·학생 이름**이 들어가지 않게, 연습용 수업에서 찍거나 가린 뒤 저장합니다. Supabase 화면은 **키 값이 보이지 않게** 가립니다.

아직 사진이 없는 자리(넣으면 좋은 것): 수업을 만든 직후의 참여코드·관리코드 화면, 모둠 비밀번호 [칠판에 크게 띄우기], 데이터 실험실 변환 전후, 전자칠판 발표 화면, Supabase SQL Editor 와 Settings → API, GitHub Settings → Pages.

## `lib/` — 바깥에서 가져온 파일

자세한 내용은 [`lib/README.md`](lib/README.md).

- `lib/supabase-2.117.2.js` — @supabase/supabase-js 2.117.2 UMD 빌드, **MIT 라이선스**. 학교망이 CDN 을 막아도 실시간 모드가 열리도록 사본을 둡니다. 판을 올릴 때는 파일 이름의 판 번호와 `index.html` · `teacher.html` · `present.html`(그리고 참여코드 연결을 쓰는 `inquiry.html`)의 `<script src>` 를 함께 고칩니다.
- `lib/ezon-ble.js` — 이지메이커 무선 나노보드 웹 블루투스 SDK. 받은 그대로이며 고치지 않았습니다. `sensorkit.js` 가 이것을 먼저 찾고, 없을 때만 원본 주소에서 받습니다.

글꼴(Pretendard · Jua)은 CDN 과 Google Fonts 에서 불러오며, 막히면 기기 글꼴로 보입니다.

## 쓰는 조건

학교 수업을 위해 만든 비상업 도구입니다. 다른 학교에서 자유롭게 쓰고 고쳐 쓰셔도 되며, 쓰실 때는 출처(MBL 수업허브와 처음 만든 사람)를 밝혀 주세요. 아직 정식 라이선스 파일은 없습니다. 만든 사람과 연락처, 실험 자료의 출처는 `manual.html#sources` 에 있습니다. `lib/` 의 파일은 각 원저작자의 조건을 따릅니다.
