# 자체 알고리즘 엔진 (서버·AI 모델 없음)

웹앱의 분리 엔진 `자체 알고리즘 · 서버·AI 없음`(기본값)이 쓰는 코드입니다. 원화 한 장을 브라우저 Web Worker에서 처리해 GPU 서버 응답과 같은 형식(이름 붙은 레이어 + 파츠 검사 기록)을 만들고, 이후 리깅·웨이트·모션·Spine 출력은 기존 웹앱 코드가 그대로 이어받습니다.

## 흐름

| 단계 | 파일 | 내용 |
| --- | --- | --- |
| 분할 | `segment-core.js` | 배경 제거 → 선화 추출 → 선 틈 메우기 → 색 영역 플러드필 |
| 관절 | `skeleton.js` | 구도 판별(전신/잘린 구도) → 중심축 골격 → 부위별 관절, 실패 부위만 비율로 대체, 상식 검사 |
| 파츠 | `parts.js` | 뼈까지 측지 거리 + 영역 투표 → `hair, face, neck, topwear, sleeve_r/l, arm_r/l, bottomwear, legwear_r/l, footwear_r/l` |
| 레이어 | `layers.js` | 얼굴 세부(`eyebrow, eyelash, irides, eyewhite, mouth, nose`) 분리, 가려진 곳 피라미드 보간 채우기, `back_hair` 생성, 재합성 검사 |
| 기록 | `index.js` | `art-pipeline-1` 검사 기록. 5개 규칙 검사를 모두 통과해야 자동 리깅, 아니면 사람 확인으로 |
| 스레드 | `worker.js` | 빌드 시 `dist/local-engine-worker.js` |

`_r` = 캐릭터 오른쪽 = 화면 왼쪽 (rig-core 규칙). 소매는 위팔 본에 rigid로 붙입니다(메쉬 굽힘 시 뒤집힘 방지).

## 확인 (2026-11-05)

- 샘플 전신·상반신·흉상: 웹앱에서 한 번 클릭 → 약 2초 → 6단계 검사 모두 통과, Spine 리그 ZIP 버튼 활성
- 같은 결과를 Spine 4.0.64 명령줄 가져오기로 `.spine` 프로젝트 변환 성공, Spine 렌더로 모션 10종 확인
  (`algo-prototype/results/spine-export/`)
- 크기 조절 방식 3종 × 구도 3종 모두 굽힘 검사 통과 (`audit-harness.mjs`)
- 페인팅·긴 치마·팔짱·비인간 원화는 자동 리깅하지 않고 "확인 필요"로 멈춤 (의도된 동작)

## 개발용 도구

```sh
# 브라우저 없이 리깅·굽힘 검사까지 (마지막 인자를 주면 Spine 파일도 씀)
node src/local-engine/audit-harness.mjs <RGBA raw> <width> <height> [출력 폴더]
```

시험 화면과 일괄 시험은 `../../../algo-prototype/` (같은 코드를 다시 내보냄).

## 한계

- 셀 채색·선화가 있는 정면 원화 기준. 페인팅·3D 렌더는 색 영역이 잘게 쪼개짐
- 가려진 곳은 같은 파츠 색을 번진 것이라 선·주름은 그리지 않음 (큰 회전에는 손 보정 필요)
- 팔짱·몸에 붙은 팔은 관절을 사람이 옮겨야 함
- 점프 동작의 가장 깊게 웅크린 프레임에서 반바지–허벅지 경계가 약간 흐려 보임
