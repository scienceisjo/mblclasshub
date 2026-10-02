# lib — 바깥에서 온 파일

## ezon-ble.js
이지메이커(EZ Maker) 무선 나노보드를 웹 블루투스로 잇는 SDK 입니다.
원본: https://ezon-ble-sdk.pages.dev/ezon-ble.iife.js

- 이 파일은 저희가 만든 것이 아니며 고치지 않았습니다. 받은 그대로입니다.
- 갱신이 필요하면 위 원본 주소에서 다시 받아 이 자리에 덮어쓰면 됩니다.
- `sensorkit.js` 가 이 파일을 먼저 찾고, 없으면 원본 주소에서 받아 옵니다.

## supabase-2.117.2.js
Supabase 자바스크립트 클라이언트(@supabase/supabase-js 2.117.2, MIT 라이선스)의 UMD 빌드입니다.
원본: npm 패키지 `@supabase/supabase-js` 의 `dist/umd/supabase.js`

- 학교망이 cdn.jsdelivr.net 을 막아도 실시간 모드가 멈추지 않도록 사이트 안에 사본을 둡니다.
- 판을 올릴 때는 새 판을 받아 파일 이름의 판 번호까지 바꾸고, index.html · teacher.html · present.html 의 `<script src>` 를 함께 고칩니다.
