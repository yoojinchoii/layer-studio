// 지도 기준 배정: 다리 좌우는 가까운 다리 뼈로, 지도가 못 정한 픽셀은 이웃을 따르고, 옷 장식·끊긴 물건 처리, 2~3등신 다리 관절.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_CLASSES, applyAiLabels } from './local-engine/ai-labels.js';
import { applyAiJoints } from './local-engine/skeleton.js';
const id = (k) => AI_CLASSES.find((c) => c.key === k).id;
const run = (w, h, ai, rig, old = 'topwear') => {
  const n = w * h, seg = { width: w, height: h, fg: new Uint8Array(n).fill(1), labels: Int32Array.from({ length: n }, (_, i) => i + 1), regions: Array.from({ length: n }, () => ({})) };
  const out = applyAiLabels(seg, rig, { partLabels: new Int32Array(n).fill(1), parts: [{ id: 1, name: old }] }, ai);
  return (x, y) => out.parts.find((p) => p.id === out.partLabels[y * w + x])?.name;
};

test('crossed legs go to the nearer leg chain when flare joints are trusted', () => {
  // 다리 뼈가 X자로 꼬였다: 화면 왼쪽 엉덩이(1,0)→발목(8,9), 오른쪽 엉덩이(8,0)→발목(1,9)
  const w = 10, h = 10, ai = new Uint8Array(w * h).fill(id('legwear'));
  const rig = { aiJoints: ['legs'], points: { hip_left: { x: 1, y: 0 }, knee_left: { x: 4.5, y: 4.5 }, ankle_left: { x: 8, y: 9 }, hip_right: { x: 8, y: 0 }, knee_right: { x: 4.5, y: 4.5 }, ankle_right: { x: 1, y: 9 } } };
  const name = run(w, h, ai, rig, 'legwear_r');
  assert.equal(name(8, 9), 'legwear_r'); // 화면 왼쪽 다리(_r)의 발목이 화면 오른쪽 아래
  assert.equal(name(1, 9), 'legwear_l');
});

test('pixels the map could not decide follow their nearest decided neighbour, not the algorithm guess', () => {
  const w = 6, h = 1, ai = Uint8Array.from([id('bottomwear'), id('bottomwear'), 0, 0, id('bottomwear'), id('bottomwear')]);
  const name = run(w, h, ai, { points: {} }, 'footwear_r');
  assert.equal(name(2, 0), 'bottomwear'); assert.equal(name(3, 0), 'bottomwear');
});

test('an accessory lying on the skirt joins the skirt; a held item split by the hand stays one prop', () => {
  // 0행: 치마 위 앞치마(기타). 위쪽 물건(기타) — 손 — 아래쪽 물건(기타)
  const w = 30, h = 30, ai = new Uint8Array(w * h).fill(id('bottomwear'));
  for (let y = 5; y < 15; y++) for (let x = 2; x < 6; x++) ai[y * w + x] = id('other'); // 앞치마 띠(치마로 둘러싸임)
  for (let y = 0; y < 30; y++) for (let x = 20; x < 30; x++) ai[y * w + x] = 0; // 배경 칸은 아래에서 채움
  for (let y = 0; y < 10; y++) for (let x = 24; x < 27; x++) ai[y * w + x] = id('other'); // 창날(위)
  for (let y = 10; y < 14; y++) for (let x = 23; x < 28; x++) ai[y * w + x] = id('arm'); // 손
  for (let y = 14; y < 28; y++) for (let x = 24; x < 27; x++) ai[y * w + x] = id('other'); // 자루(아래, 손에 닿음)
  const rig = { points: { wrist_right: { x: 25, y: 12 } }, ends: {} };
  const name = run(w, h, ai, rig, 'topwear');
  assert.equal(name(3, 8), 'bottomwear');
  assert.equal(name(25, 20), 'prop_l'); assert.equal(name(25, 3), 'prop_l');
});

test('flare legs make a big-headed (chibi) character full body', () => {
  const rig = { frame: 'half', points: {}, missing: ['legs'] };
  const p = (x, y) => ({ x, y });
  applyAiJoints(rig, { neck: p(50, 40), hip_left: p(40, 70), knee_left: p(38, 85), ankle_left: p(36, 98), hip_right: p(60, 70), knee_right: p(62, 85), ankle_right: p(64, 98) });
  assert.equal(rig.frame, 'full'); assert.ok(rig.aiJoints.includes('legs')); assert.deepEqual(rig.points.ankle_left, p(36, 98));
});

test('legs that flare invents on the empty canvas below a half-body picture are ignored', () => {
  // 100×100 그림의 위 60%만 그림(상반신, 아래는 빈 바탕). flare가 빈 바탕에 무릎·발목을 찍었다.
  const w = 100, h = 100, fg = new Uint8Array(w * h);
  for (let y = 0; y < 60; y++) for (let x = 20; x < 80; x++) fg[y * w + x] = 1;
  const p = (x, y) => ({ x, y }), ai = { neck: p(50, 20), hip_left: p(42, 57), knee_left: p(38, 77), ankle_left: p(34, 97), hip_right: p(58, 57), knee_right: p(62, 77), ankle_right: p(66, 97) };
  const rig = { frame: 'cut', points: {}, missing: ['legs'] };
  applyAiJoints(rig, ai, { fg, width: w, height: h });
  assert.equal(rig.frame, 'cut'); assert.ok(!(rig.aiJoints || []).includes('legs')); assert.ok(!rig.points.ankle_left);
  // 다리가 실제로 그려져 있으면(2~3등신 전신) 그대로 전신
  for (let y = 60; y < 100; y++) for (let x = 30; x < 70; x++) fg[y * w + x] = 1;
  const full = { frame: 'cut', points: {}, missing: ['legs'] };
  applyAiJoints(full, ai, { fg, width: w, height: h });
  assert.equal(full.frame, 'full'); assert.ok(full.aiJoints.includes('legs'));
});

test('arm and neck joints from a generic stick figure that does not sit on the arms are not used', () => {
  // 부위 지도: 위 40%는 머리카락(1), 그 아래 가운데 상의(4), 양옆 소매(5)·팔(6)
  const w = 100, h = 100, labels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = y < 40 ? 1 : x < 20 ? (y < 55 ? 5 : 6) : x >= 80 ? (y < 55 ? 5 : 6) : 4;
  const p = (x, y) => ({ x, y });
  const rig = { frame: 'cut', points: { arm_left: p(15, 45), elbow_left: p(12, 65), wrist_left: p(10, 85) }, missing: [] };
  // 왼팔: 어깨가 머리카락 한가운데(머리 위) → 버림. 오른팔: 소매·팔 위 → 씀
  applyAiJoints(rig, { neck: p(50, 10), shoulder_left: p(30, 10), elbow_left: p(12, 60), wrist_left: p(10, 85), shoulder_right: p(85, 45), elbow_right: p(88, 65), wrist_right: p(90, 85) }, { labels, width: w, height: h });
  assert.deepEqual(rig.points.arm_left, p(15, 45));
  assert.deepEqual(rig.points.arm_right, p(85, 45));
  assert.ok(!rig.aiJoints.includes('arm_left') && rig.aiJoints.includes('arm_right') && rig.aiJoints.includes('neck'));
  assert.deepEqual(rig.aiRejected, ['arm_left']);
  // 두 팔 다 안 맞으면 목도 버린다
  const none = { frame: 'cut', points: { neck: p(50, 45) }, missing: [] };
  applyAiJoints(none, { neck: p(50, 10), shoulder_left: p(30, 10), elbow_left: p(30, 20), wrist_left: p(30, 30), shoulder_right: p(70, 10), elbow_right: p(70, 20), wrist_right: p(70, 30) }, { labels, width: w, height: h });
  assert.deepEqual(none.points.neck, p(50, 45)); assert.deepEqual(none.aiRejected, ['neck', 'arm_left', 'arm_right']);
});
