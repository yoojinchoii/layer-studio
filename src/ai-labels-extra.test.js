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
