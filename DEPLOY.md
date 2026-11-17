# 배포·관리

2026-11-06부터 Layer Studio는 GitHub Pages에서 운영합니다. ChatGPT 사이트(`layer-studio-geniee.yoojin3412.chatgpt.site`)는 더 이상 갱신하지 않습니다.

| 항목 | 위치 |
| --- | --- |
| 사이트 | https://yoojinchoii.github.io/layer-studio/ |
| 소스 저장소 (공개) | https://github.com/yoojinchoii/layer-studio |
| 자동 배포 기록 | https://github.com/yoojinchoii/layer-studio/actions |
| GPU 서버 (See-through, 선택) | Modal 앱 `layer-studio-see-through` · 소스 `../layer-studio-server/` |
| Spine 연결 프로그램 | `../spine-bridge/` · 배포용 압축 `dist/spine-bridge-mac.zip` |

## 배포하는 법

`main`에 올리면 GitHub Actions가 테스트(`npm test`) → 빌드(`npm run build`) → `dist/` 배포를 자동으로 합니다. 테스트가 실패하면 배포하지 않습니다. 보통 1분 안에 끝납니다.

```sh
npm test && npm run build      # 로컬 확인
git add -A && git commit -m "..." && git push
gh run watch -R yoojinchoii/layer-studio   # 배포 진행 보기
```

로컬 미리보기: `python3 -m http.server 5179 --directory dist` 후 http://localhost:5179

## 지켜야 할 것

- **경로는 상대 경로(`./`)로.** 사이트가 `/layer-studio/` 아래에 있어서 `/app.js`처럼 `/`로 시작하면 깨집니다.
- **AI Proxy 토큰은 사용자가 사이트에 직접 넣습니다.** 기본은 탭을 닫으면 지워지는 sessionStorage, '기억'을 켜야 localStorage. 저장소·코드에 토큰을 넣지 않습니다. 개발할 때는 localhost에서만 `?flareApi=http://127.0.0.1:포트`로 토큰을 서버 쪽에서 붙이는 중계를 쓸 수 있습니다.
- **비밀값은 저장소에 넣지 않습니다.** 서버 접속 키는 `../layer-studio-connection.json`(저장소 밖)과 Modal Secret에만 있습니다. 저장소는 공개입니다.
- **허용 주소.** 사이트 주소가 바뀌면 두 곳을 같이 고칩니다.
  - 서버: `../layer-studio-server/http_api.py`의 `PAGES_ORIGIN` → `../.venv/bin/modal deploy modal_app.py`
  - 연결 프로그램: `../spine-bridge/bridge.py`의 `SITE`, `ORIGINS` → 아래 방법으로 압축 다시 만들기
- **연결 프로그램 압축.** 웹앱을 바꾸면 `npm run build` 뒤 `python3 scripts/sync-bridge.py`로 `../spine-bridge/studio/`와 `dist/spine-bridge-mac.zip`을 함께 갱신해서 올립니다.

## 기록

| 날짜 | 내용 |
| --- | --- |
| 2026-11-17 | flare 엔진 추가(기본값): gpt-image-2.6-flare 부위 지도로 파츠 분리(경계는 색 영역), 가려진 부분 다시 그리기(색이 동떨어지면 버림). 웨이트 기반 메쉬 세분화로 굽힘 찌그러짐 28~47% 감소(`scripts/weight-bench.mjs`) |
| 2026-11-17 | 턱 위 얼굴 픽셀을 flare가 목·옷으로 칠해도 얼굴에 남김(눈이 목 레이어로 빠지던 문제), 얼굴·목 다시 그리기는 맨살만·6% 넘게 동떨어지면 버림. "파츠 펼친 PSD"(파츠를 겹치지 않게 한 장에 + 숨긴 조립본) 추가. 예제 버튼·버전 표시·옛 GPU 안내 제거. |
| 2026-11-17 | 정점 웨이트를 뼈별로 합친 뒤 0.5% 미만은 버리고 합을 정확히 1로 맞춤(소매 경계 정점에서 합이 1이 아니던 검사 경고). |
| 2026-11-17 | 가려진 자리: 접합선 선화·섞인 색·그림자는 덮는 파츠로 옮기고(이음선 없음), 연장 모양은 뒤 파츠 폭 그대로 둥근 끝 + 페이드아웃. 상의는 소매가 파고든 곳만 둥글게 메우고 어깨는 흐리게. 위 눈꺼풀 피부 띠(속눈썹 위, 평소엔 원본과 같음) + 대기·표정 모션에 눈 깜빡임. flare 다시 그리기: 선 그리지 말라는 지시, 동떨어진 픽셀은 하나씩 버림. |
| 2026-11-06 | 그림체 자동 판별(k90) — 페인팅·3D 렌더는 경계 선명도 기준으로 음영 영역 합치기, 얼굴 영역·턱 보정, 긴 치마는 하의 통째 |
| 2026-11-06 | 가려진 곳 채우기 확장(감싸인 자리 전체), 파츠 안 무늬 조각 정리, 팔짱은 양팔 한 장(`handwear`, 가슴 고정), 턱 관절 피부폭 보정 |
| 2026-11-06 | GitHub Pages로 이전. 절대 경로 → 상대 경로. 서버·연결 프로그램에 새 주소 허용 추가(옛 주소도 유지) |
| 2026-11-05 | 자체 알고리즘 엔진(`src/local-engine/`) 추가, 기본 엔진으로 지정 |
