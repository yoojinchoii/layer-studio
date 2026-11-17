import test from 'node:test';
import assert from 'node:assert/strict';
import { weightDistance, refinementPoints } from './weight-refine.js';
import { normalizeBound } from './rig-core.js';
import { AI_CLASSES, classifyMap, segmentationPrompt, applyAiLabels } from './local-engine/ai-labels.js';
import { flareSize, fitTransform, validToken, redrawTargets, MIN_REDRAW_PIXELS } from './flare-client.js';

test('weight distance is 0 for equal weights and 1 for disjoint bones', () => {
  assert.equal(weightDistance(new Map([['a', 1]]), new Map([['a', 1]])), 0);
  assert.equal(weightDistance(new Map([['a', 1]]), new Map([['b', 1]])), 1);
  assert.equal(weightDistance(new Map([['a', 0.5], ['b', 0.5]]), new Map([['a', 1]])), 0.5);
});

test('refinement splits only long edges that cross a weight change', () => {
  // 정사각형 두 삼각형: 왼쪽 변은 뼈 a, 오른쪽 변은 뼈 b → 가로 변과 대각선만 나뉜다.
  const points = [[0, 0], [100, 0], [0, 100], [100, 100]];
  const triangles = [0, 2, 1, 1, 2, 3];
  const weightAt = (x) => new Map([[x < 50 ? 'a' : 'b', 1]]);
  const pts = refinementPoints(points, triangles, weightAt, { minEdge: 6 });
  const keys = pts.map(([x, y]) => `${x},${y}`).sort();
  assert.deepEqual(keys, ['50,0', '50,100', '50,50'].sort());
  // 웨이트가 모두 같으면 아무것도 넣지 않는다(단단한 부분의 정점 수는 그대로)
  assert.equal(refinementPoints(points, triangles, () => new Map([['a', 1]]), { minEdge: 6 }).length, 0);
  // 짧은 변은 나누지 않는다
  assert.equal(refinementPoints(points, triangles, weightAt, { minEdge: 200 }).length, 0);
});

test('part map colors classify to their class, white and mixed edges stay unassigned', () => {
  const colors = [...AI_CLASSES.map((c) => [...c.color, 255]), [255, 255, 255, 255], [128, 64, 200, 255]];
  const ids = classifyMap(Uint8ClampedArray.from(colors.flat()), colors.length);
  assert.deepEqual([...ids].slice(0, AI_CLASSES.length), AI_CLASSES.map((c) => c.id));
  assert.equal(ids[AI_CLASSES.length], 0);
  const prompt = segmentationPrompt();
  for (const c of AI_CLASSES) assert.ok(prompt.includes(c.prompt));
});

test('AI labels relabel parts per color region, keep sides by joints and protect crossed arms', () => {
  // 4×2 그림: 왼쪽 두 열 = 영역 1, 오른쪽 두 열 = 영역 2. 알고리즘은 전부 topwear로 봤다.
  const w = 4, h = 2, n = w * h;
  const seg = { width: w, height: h, fg: new Uint8Array(n).fill(1), labels: Int32Array.from([1, 1, 2, 2, 1, 1, 2, 2]), regions: [{}, {}] };
  const rig = { width: w, height: h, points: { arm_left: { x: 0.5, y: 0 }, arm_right: { x: 3.5, y: 0 }, chest: { x: 2, y: 1 } } };
  const parts = { partLabels: new Int32Array(n).fill(1), parts: [{ id: 1, name: 'topwear' }] };
  const sleeve = AI_CLASSES.find((c) => c.key === 'sleeve').id, top = AI_CLASSES.find((c) => c.key === 'topwear').id;
  const ai = Uint8Array.from([sleeve, sleeve, top, sleeve, sleeve, sleeve, top, top]);
  const out = applyAiLabels(seg, rig, parts, ai);
  const name = (i) => out.parts.find((p) => p.id === out.partLabels[i]).name;
  // 영역 1은 전부 소매(화면 왼쪽 = 캐릭터 오른쪽 _r), 영역 2는 섞여 있어 픽셀별 판단
  assert.equal(name(0), 'sleeve_r'); assert.equal(name(5), 'sleeve_r');
  assert.equal(name(2), 'topwear'); assert.equal(name(3), 'sleeve_l');
  assert.ok(out.ai.coverage === 1);
  // 팔짱(handwear)으로 본 픽셀은 AI가 팔이라고 해도 그대로 둔다
  const crossed = applyAiLabels(seg, rig, { partLabels: new Int32Array(n).fill(1), parts: [{ id: 1, name: 'handwear' }] }, new Uint8Array(n).fill(AI_CLASSES.find((c) => c.key === 'arm').id));
  assert.deepEqual(crossed.parts.map((p) => p.name), ['handwear']);
  // 턱 위 얼굴(눈 등)은 AI가 목이라고 해도 얼굴로 남고, 턱 아래는 목으로 바뀐다
  const neck = AI_CLASSES.find((c) => c.key === 'neck').id;
  const face = applyAiLabels(seg, { ...rig, points: { ...rig.points, head: { x: 2, y: 1 } } }, { partLabels: new Int32Array(n).fill(1), parts: [{ id: 1, name: 'face' }] }, new Uint8Array(n).fill(neck));
  const faceName = (i) => face.parts.find((p) => p.id === face.partLabels[i]).name;
  assert.equal(faceName(0), 'face'); assert.equal(faceName(4), 'neck');
});

test('flare sizes follow the aspect ratio and the fit keeps the whole image inside', () => {
  assert.deepEqual(flareSize(1000, 1000), [1024, 1024]);
  assert.deepEqual(flareSize(600, 1000), [1024, 1536]);
  assert.deepEqual(flareSize(1000, 600), [1536, 1024]);
  const t = fitTransform(500, 1000, 1024, 1536);
  assert.ok(t.ox >= 0 && t.oy >= 0 && 500 * t.s <= 1024 + 1e-9 && 1000 * t.s <= 1536 + 1e-9);
});

test('tokens are validated and only meaningful hidden areas are redrawn', () => {
  assert.equal(validToken('short'), false);
  assert.equal(validToken('abc def ghi jkl mno pqr'), false);
  assert.equal(validToken('A'.repeat(40)), true);
  const mask = (k) => { const m = new Uint8Array(1000); m.fill(1, 0, k); return m; };
  const layers = [
    { label: 'topwear', fillMask: mask(MIN_REDRAW_PIXELS) },
    { label: 'arm_r', fillMask: mask(MIN_REDRAW_PIXELS - 1) },
    { label: 'eyewhite_r', fillMask: mask(900) },
    { label: 'legwear_l', fillMask: null },
  ];
  assert.deepEqual(redrawTargets(layers).map((l) => l.label), ['topwear']);
});

test('vertex weights always sum to exactly 1 after dropping tiny values', () => {
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  // 소매 경계: 팔 0.997, 몸통 0.003 → 몸통을 버리면 팔이 1이 되어야 한다
  const a = normalizeBound([['upper_arm_R', 0.997], ['torso', 0.003]], 'torso');
  assert.deepEqual([...a.keys()], ['upper_arm_R']); assert.equal(sum(a), 1);
  const b = normalizeBound([['torso', 0.4], ['torso', 0.2], ['neck', 0.2]], 'torso');
  assert.ok(Math.abs(sum(b) - 1) < 1e-12); assert.ok(Math.abs(b.get('torso') - 0.75) < 1e-12);
  assert.deepEqual([...normalizeBound([['x', NaN]], 'torso')], [['torso', 1]]);
});
