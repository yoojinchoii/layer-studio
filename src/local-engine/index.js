// 자체 알고리즘 엔진 (서버·AI 모델 없음).
// 원화 RGBA → 분할 → 골격·관절 → 파츠 → 얼굴 세부·가려진 면 채우기 → 레이어 + 파츠 검사 기록.
// 결과 형식은 GPU 서버의 응답과 같아서 웹앱의 나머지(리깅·웨이트·모션·Spine 출력)를 그대로 쓴다.

import { segment } from './segment-core.js';
import { fitJoints, applyAiJoints } from './skeleton.js';
import { assignParts } from './parts.js';
import { buildLayers } from './layers.js';
import { applyAiLabels } from './ai-labels.js';
import { mergeFaceMap } from './face-map.js';

export const LOCAL_ENGINE_ID = 'local-algo';
export const LOCAL_WORK_SIZE = 1024;

const STAGE_LABELS = { analyze: '구조 분석', separate: '분리', complete: '복원', structure: '원본 검사', materials: '옷·신체 검사', rig: '리깅' };
// art-pipeline.js의 analysis.joints 키 (0–1000 정규화 좌표)
const JOINT_KEYS = {
  neck: 'neck', head: 'head', chest: 'chest', pelvis: 'pelvis',
  shoulder_R: 'arm_left', elbow_R: 'elbow_left', wrist_R: 'wrist_left',
  shoulder_L: 'arm_right', elbow_L: 'elbow_right', wrist_L: 'wrist_right',
  hip_R: 'hip_left', knee_R: 'knee_left', ankle_R: 'ankle_left',
  hip_L: 'hip_right', knee_L: 'knee_right', ankle_L: 'ankle_right',
};

function frameOf(rig, names, width, height, layers) {
  if (rig.frame === 'full') return 'full';
  if (names.has('arm_r') || names.has('arm_l')) return 'half';
  const face = layers.find((l) => l.name === 'face');
  return face && face.height / height > 0.2 ? 'bust' : 'half';
}

function stage(id, status, detail) {
  return { id, label: STAGE_LABELS[id], status, detail };
}

/** 자동 검사 기록. 규칙 검사일 뿐 품질 보증이 아니므로 하나라도 걸리면 사람 확인으로 넘긴다. */
export function buildReport({ rig, parts, built, width, height, frame }) {
  const issues = [];
  const names = new Set(built.layers.map((l) => l.name));
  const analyzeOk = rig.method === 'skeleton' && (rig.checks || []).every((c) => c.ok);
  // 관절 경고는 실제로 확인이 필요할 때만 보여준다(흉상에서 '팔 없음' 같은 정상 메모는 숨김).
  if (!analyzeOk) for (const w of rig.warnings || []) issues.push({ code: 'joints', message: w });

  const required = {
    full: ['front_hair', 'face', 'topwear', 'legwear_r', 'legwear_l'],
    half: ['front_hair', 'face', 'topwear', 'arm_r', 'arm_l'],
    bust: ['front_hair', 'face'],
  }[frame];
  const missingParts = required.filter((n) => !names.has(n));
  for (const n of missingParts) issues.push({ code: 'missing_part', part: n, message: `${n} 파츠를 찾지 못했습니다.` });

  const area = Object.fromEntries(parts.parts.map((p) => [p.name, p.area]));
  for (const base of ['arm', 'sleeve', 'legwear', 'footwear']) {
    const r = area[`${base}_r`];
    const l = area[`${base}_l`];
    // flare가 관절을 찍어 준 팔·다리는 포즈(한 팔을 들거나 다리를 꼼)로 크기가 다를 수 있어 좌우 대칭을 따지지 않는다.
    const posed = (rig.aiJoints || []).includes(base === 'legwear' || base === 'footwear' ? 'legs' : 'arm_left') && (base === 'legwear' || base === 'footwear' || (rig.aiJoints || []).includes('arm_right'));
    if (r && l && !posed && (r / l > 2 || l / r > 2)) issues.push({ code: 'asymmetric', part: base, message: `${base} 좌우 크기가 두 배 넘게 다릅니다 (${r}px / ${l}px).` });
  }
  const materialsOk = !missingParts.length && !issues.some((i) => i.code === 'asymmetric');

  const filled = built.layers.reduce((n, l) => n + l.filled, 0);
  const structureOk = built.recompositeError < 0.005;
  if (!structureOk) issues.push({ code: 'recomposite', message: `레이어를 다시 합치면 원본과 ${(built.recompositeError * 100).toFixed(2)}% 다릅니다.` });
  for (const n of built.notes) issues.push({ code: 'face', message: n });

  const stages = [
    stage('analyze', analyzeOk ? 'passed' : 'review', `골격 ${rig.method} · 구도 ${frame}${analyzeOk ? '' : ' · 관절 확인 필요'}`),
    stage('separate', built.layers.length >= 3 ? 'passed' : 'review', `${parts.ai ? `flare 부위 지도(덮은 비율 ${Math.round(parts.ai.coverage * 100)}%) + ` : ''}색 영역 ${parts.regionCount}개 → 파츠 ${parts.parts.length}개 → 레이어 ${built.layers.length}개`),
    stage('complete', 'passed', `가려진 곳 ${filled.toLocaleString()}px를 같은 파츠 색으로 보간 (모델 없음, 그림은 확인 필요)`),
    stage('structure', structureOk ? 'passed' : 'review', `재합성 오차 ${(built.recompositeError * 100).toFixed(3)}%`),
    stage('materials', materialsOk ? 'passed' : 'review', materialsOk ? `필수 파츠 ${required.length}개 · 좌우 균형 확인` : '파츠 이름·좌우 확인 필요'),
    stage('rig', 'pending', '리깅 동작 검사 대기'),
  ];
  const ok = stages.slice(0, 5).every((s) => s.status === 'passed');
  const joints = {};
  for (const [key, id] of Object.entries(JOINT_KEYS)) {
    const p = rig.points[id];
    if (!p) continue;
    joints[key] = [Math.round((p.x / (width - 1)) * 1000), Math.round((p.y / (height - 1)) * 1000)].map((v) => Math.max(0, Math.min(1000, v)));
  }
  return {
    version: 'art-pipeline-1',
    engine: parts.ai ? 'flare' : LOCAL_ENGINE_ID,
    status: ok ? 'art_passed' : 'needs_review',
    rig_allowed: ok,
    stages,
    issues: issues.slice(0, 30),
    analysis: { frame, joints },
  };
}

/**
 * 소매는 몸통(chest) → 위팔 메쉬로 붙인다. 어깨 쪽 끝은 몸통에 남고 소매 끝단은 위팔을 따라가서,
 * 팔을 들어도 소매가 어깨에서 떨어져 돌아 나가지 않는다(통째로 돌리면 소매 윗부분이 바깥으로 튀어나와
 * 밑의 상의 어깨가 드러났다). 소매가 있는 쪽 상의에는 팔 가중치를 주지 않는다(detachedSleeves).
 */
function bindingFor(name, rig) {
  const m = name.match(/^sleeve_([rl])$/);
  if (!m) return {};
  const bone = m[1] === 'r' ? 'arm_left' : 'arm_right';
  if (!rig.points[bone]) return {};
  return { art: { bone, mode: m[1] === 'r' ? 'sleeve_left' : 'sleeve_right', allowed_bones: ['chest', bone], role: 'sleeve' } };
}

/**
 * @param {Uint8ClampedArray} rgba 작업 해상도 RGBA
 * @returns {{width, height, frame, layers: Array<{label,x,y,width,height,data}>, pipeline, timings}}
 */
export function runLocalEngine(rgba, width, height, params = {}) {
  const t = [performance.now()];
  const seg = segment(rgba, width, height, { ...params, aiLabels: undefined });
  t.push(performance.now());
  // flare 관절(있으면)이 골격 분석보다 우선: 팔을 굽히거나 다리를 꼰 포즈도 제자리에 잡는다.
  const rig = applyAiJoints(fitJoints(seg.fg, width, height), params.aiJoints);
  t.push(performance.now());
  let parts = assignParts(seg, rig);
  // flare 부위 지도가 있으면 의미는 AI, 경계는 색 영역으로 다시 배정한다.
  // 얼굴 세부 지도(있으면)가 얼굴 상자 안의 머리카락·얼굴 경계를 먼저 고친다.
  const merged = params.aiLabels && params.aiFace ? mergeFaceMap(params.aiLabels, params.aiFace) : null;
  if (params.aiLabels) parts = applyAiLabels(seg, rig, parts, merged?.labels || params.aiLabels, { pin: merged?.pin });
  parts.regionCount = seg.regions.length;
  t.push(performance.now());
  const built = buildLayers(rgba, width, height, seg, rig, parts, { aiFace: params.aiFace });
  t.push(performance.now());
  const names = new Set(built.layers.map((l) => l.name));
  const frame = frameOf(rig, names, width, height, built.layers);
  const pipeline = buildReport({ rig, parts, built, width, height, frame });
  const ms = (a, b) => Math.round(t[b] - t[a]);
  return {
    width,
    height,
    frame,
    layers: built.layers.map((l) => ({ label: l.name, x: l.x, y: l.y, width: l.width, height: l.height, data: l.data, fillMask: l.fillMask, ...bindingFor(l.name, rig) })),
    pipeline,
    timings: { segment: ms(0, 1), skeleton: ms(1, 2), parts: ms(2, 3), layers: ms(3, 4) },
  };
}
