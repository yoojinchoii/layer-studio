# Layer Studio GPU 서버 연결 규격

현재 웹앱은 GPU 서버 없이 이미지/PSD 불러오기, 픽셀 레이어 표시·이름·순서·불투명도 조절, PSD/ZIP 다운로드를 지원합니다. AI 분리 결과를 흉내 내지 않습니다. 이 앱에는 서버 자격증명이나 타인의 Vision 서버 연결이 포함되지 않습니다.

## 서버가 준비되면

1. 본인 Modal 계정 등에서 See-through GPU 파이프라인을 호스팅합니다.
2. 아래 API를 구현하고, 웹앱의 정확한 origin에 CORS를 허용합니다. 프리플라이트 OPTIONS와 Content-Type 및 Authorization 헤더를 허용해야 합니다.
3. 화면의 ‘서버 연결’에 HTTPS 기본 URL을 입력합니다. 키는 메모리에만 유지하며 페이지를 닫으면 사라집니다.

GET /health 응답:

```json
{"service":"layer-studio","api_version":1}
```

POST /api/decompose/see-through?resolution=768&seed=42&split=true&layers=4

POST /api/decompose/qwen-layered?resolution=640&seed=42&split=false&layers=4

Content-Type: application/octet-stream. Body: 원본 PNG 바이트. 키 설정 시 Authorization: Bearer <key>. See-through는 layers를 무시하고 Qwen은 split을 무시합니다. 서버에서 모든 입력과 자원 한도를 독립적으로 검증해야 합니다.

응답 레이어는 앞에서 뒤 순서여야 합니다. x/y는 응답 캔버스 기준 좌측 상단입니다. 모델이 패딩/리사이즈를 했다면 반환 전에 원본 비율·좌표로 복구합니다. 원본과 동일한 캔버스 비율을 유지하세요.

```json
{"width":1024,"height":1024,"engine":"see-through","layers":[{"label":"front_hair","x":120,"y":30,"image_b64":"<PNG base64>"}]}
```

실패는 적절한 HTTP 상태와 `{"detail":"사용자가 읽을 수 있는 오류"}`로 반환합니다. 서버가 지원하지 않는 엔진은 400/404를 반환합니다.

## Modal 비동기 작업

오래 걸리는 작업은 POST에서 202와 `{"job_id":"...","status":"queued"}`를 반환합니다. 웹앱은 같은 키로 `GET /api/jobs/{job_id}`를 조회합니다. 실행 중에는 202, 완료 시 위 레이어 JSON과 200을 반환합니다. `DELETE /api/jobs/{job_id}`는 작업 취소를 요청합니다. 네트워크가 끊겨 취소 요청이 전달되지 않으면 서버에서 계속 실행될 수 있습니다.

health에 `"engines":["see-through"], "async_jobs":true`를 추가하면 지원 엔진만 선택하고 작업 취소를 사용할 수 있습니다. 기존 동기 응답도 지원합니다. 연결 파일은 `{"url":"https://...modal.run","token":"..."}` 형식이며 웹앱에서 불러온 뒤 연결 확인을 누릅니다. 키는 서버용 비밀이며 공개 소스나 배포 파일에 포함하면 안 됩니다.

## 파일 처리 한계

- 일반 RGB 픽셀 레이어용 PSD 도구입니다. 고급 혼합 모드·레이어 효과·마스크·조정 레이어를 편집 가능한 상태로 보존하지 않습니다. 원본 파일은 변경하지 않습니다.
- 그룹을 픽셀 레이어 목록으로 펼칩니다. 레이어 순서·이름·좌표·표시·불투명도를 보존합니다.
- 작업은 메모리에만 존재합니다. 종료 전 PSD로 저장해야 하며 ‘작업 내역 자동 저장’ 기능은 없습니다.
- ZIP에는 PNG, 합성 preview.png, 좌표 layers.json을 포함합니다. Spine 런타임용 skeleton.json이 아닙니다.
- AI 서버와 실제 모델 추론은 아직 배포·검증하지 않았습니다.

## 로컬 실행

`npm install` 후 `npm run build`, `python3 -m http.server 5173 --directory dist`를 실행합니다. 배포 대상은 dist입니다. PNG/PSD 처리는 사용자 브라우저에서 이루어집니다.


## 브라우저 후처리
AI 분리 성공 후 선택적으로 관절 편집 창을 엽니다. 이 단계는 서버 호출 없이 브라우저에서 실행됩니다.

- 18개 기본 관절: 골반·가슴·목·머리·머리카락, 좌우 어깨·팔꿈치·손목·고관절·무릎·발목 및 전체 기준.
- 관절 위치는 정면 전신 캐릭터 기준으로 추정합니다. 의미 이름을 찾지 못하면 캔버스 비율로 기본 배치하며 직접 수정할 수 있습니다.
- 점 드래그, 좌표 입력, 방향키, 부모 연결, 추가 관절(최대 64개), 되돌리기를 지원합니다.
- 팔·다리 자동 변형은 격자 메쉬와 위치 기반 웨이트입니다. 정밀 아나토미 추정, 인페인팅, IK는 포함하지 않습니다.
- `skeleton.json`: Spine 4.0.64 JSON, weighted meshes, idle 및 manual_pose 동작.
- `layer-studio-rig-v2` 편집 프로젝트 JSON: 원본 파츠 PNG·관절·파츠 연결·보정 강도·수동 포즈를 저장합니다. 페이지를 닫기 전에 다운로드해야 합니다.
- 예제는 기존 AI 분리 결과를 정적 파일로 사용하며 서버 실행 비용이 없습니다.

검증: node --test src/rig-core.test.js, 실제 Spine 4.0.64 import/export, 브라우저 드래그·포즈·저장/복원.

## 자동 연결
서버 주소 기본값은 소스에 포함되지만 실제 접속 키는 포함하지 않습니다. 사용자가 연결 파일을 불러오면 즉시 /health로 검증하고, 자동 연결 옵션이 켜진 경우 URL·키를 localStorage의 layer-studio.connection.v1에 저장합니다. 페이지 시작 및 인터넷 연결 복구 시 저장된 서버의 GET /health만 호출하며 GPU 작업은 자동 실행하지 않습니다. 인증 실패 시 저장 키를 삭제하고, 네트워크 실패 시 재시도를 위해 보관합니다. 연결 해제 또는 자동 연결 해제 시 해당 저장 키만 제거합니다. 다른 브라우저/기기에서는 한 번 다시 연결해야 합니다.
