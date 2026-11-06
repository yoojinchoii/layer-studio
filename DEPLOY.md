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
- **비밀값은 저장소에 넣지 않습니다.** 서버 접속 키는 `../layer-studio-connection.json`(저장소 밖)과 Modal Secret에만 있습니다. 저장소는 공개입니다.
- **허용 주소.** 사이트 주소가 바뀌면 두 곳을 같이 고칩니다.
  - 서버: `../layer-studio-server/http_api.py`의 `PAGES_ORIGIN` → `../.venv/bin/modal deploy modal_app.py`
  - 연결 프로그램: `../spine-bridge/bridge.py`의 `SITE`, `ORIGINS` → 아래 방법으로 압축 다시 만들기
- **연결 프로그램 압축.** 웹앱을 바꾸면 `npm run build` 뒤 `python3 scripts/sync-bridge.py`로 `../spine-bridge/studio/`와 `dist/spine-bridge-mac.zip`을 함께 갱신해서 올립니다.

## 기록

| 날짜 | 내용 |
| --- | --- |
| 2026-11-06 | 가려진 곳 채우기 확장(감싸인 자리 전체), 파츠 안 무늬 조각 정리, 팔짱은 양팔 한 장(`handwear`, 가슴 고정), 턱 관절 피부폭 보정 |
| 2026-11-06 | GitHub Pages로 이전. 절대 경로 → 상대 경로. 서버·연결 프로그램에 새 주소 허용 추가(옛 주소도 유지) |
| 2026-11-05 | 자체 알고리즘 엔진(`src/local-engine/`) 추가, 기본 엔진으로 지정 |
