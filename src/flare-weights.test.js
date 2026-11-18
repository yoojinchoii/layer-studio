import test from 'node:test';
import assert from 'node:assert/strict';
import { weightDistance, refinementPoints } from './weight-refine.js';
import { normalizeBound } from './rig-core.js';
import { AI_CLASSES, classifyMap, segmentationPrompt, applyAiLabels } from './local-engine/ai-labels.js';
import { flareSize, fitTransform, validToken, redrawTargets, completionPlan, mergeCompletion, completionPrompt, backgroundFor, trimLimbRoot, eyelidPlan, buildEyelid, stripLashBand, tidyFaceRim, paintUnderLash, detectKeypoints, KEYPOINT_COLORS, keypointPrompt } from './flare-client.js';
import { facePartKind } from './face-rig.js';
import { applyAiJoints } from './local-engine/skeleton.js';

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

test('tokens are validated and only named body parts are completed', () => {
  assert.equal(validToken('short'), false);
  assert.equal(validToken('abc def ghi jkl mno pqr'), false);
  assert.equal(validToken('A'.repeat(40)), true);
  const d = new Uint8ClampedArray(4);
  const layers = [{ label: 'topwear', data: d }, { label: 'arm_r', data: d }, { label: 'mouth', data: d }, { label: 'legwear_l', data: null }];
  assert.deepEqual(redrawTargets(layers).map((l) => l.label), ['topwear', 'arm_r']);
});

// 20x10 캔버스: 앞 파츠(소매, x 10..19)가 뒤 파츠(팔, x 0..9 보임)를 덮는다.
const rect = (label, x, y, w, h, rgb, fill = null) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4); return { label, x, y, width: w, height: h, data, fillMask: fill }; };
test('completion plan opens only the covered pixels near the visible part', () => {
  const sleeve = rect('sleeve_r', 10, 0, 10, 10, [0, 128, 128]);
  // 팔 레이어는 알고리즘 채움(x 10..11)을 갖고 있지만, 계획은 원화에 보이는 픽셀만 본다.
  const fill = new Uint8Array(12 * 10); for (let y = 0; y < 10; y++) fill[y * 12 + 10] = fill[y * 12 + 11] = 1;
  const arm = rect('arm_r', 0, 0, 12, 10, [250, 210, 190], fill);
  const plan = completionPlan([sleeve, arm], arm, { reach: 0.3, pad: 0 });
  assert.equal(plan.w, 16); // 보이는 0..9 + 덮인 자리 6px(=20*0.3)
  assert.equal(plan.edit[0 * plan.w + 9], 0); assert.equal(plan.edit[0 * plan.w + 10], 1); assert.equal(plan.edit[0 * plan.w + 15], 1);
  assert.equal(plan.visible[0 * plan.w + 10], 0);
  assert.deepEqual(plan.covering, ['a sleeve']);
  assert.match(completionPrompt('arm_r', plan.covering), /hidden underneath/);
  assert.deepEqual(backgroundFor(plan).name, 'white');
});

test('merged completion keeps visible pixels, takes drawn ones, drops the background and loose islands', () => {
  const sleeve = rect('sleeve_r', 10, 0, 10, 10, [0, 128, 128]);
  const arm = rect('arm_r', 0, 0, 10, 10, [250, 210, 190]);
  const plan = completionPlan([sleeve, arm], arm, { reach: 0.5, pad: 0 });
  const out = new Uint8ClampedArray(plan.w * plan.h * 4).fill(255);
  for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) {
    const i = (y * plan.w + x) * 4;
    if (x < 14) out.set([240, 200, 180, 255], i); // 팔이 4px 이어짐
    if (x === 18 && y === 5) out.set([10, 10, 10, 255], i); // 떨어진 점은 버림
  }
  const m = mergeCompletion(plan, out, [255, 255, 255]);
  assert.equal(m.x, 0); assert.equal(m.width, 14);
  assert.deepEqual([...m.data.subarray(0, 4)], [250, 210, 190, 255]);
  assert.deepEqual([...m.data.subarray(12 * 4, 12 * 4 + 4)], [240, 200, 180, 255]);
  assert.equal(m.fillMask[12], 1); assert.equal(m.fillMask[0], 0);
  assert.equal(m.drawn, 40);
});

test('drawn arm pixels on the torso side of the shoulder are removed, visible ones stay', () => {
  // 세로 팔(10x20): 위 10줄은 flare가 그린 자리, 어깨 관절 (5,5) → 팔꿈치 (5,15)
  const fill = new Uint8Array(200); fill.fill(1, 0, 100);
  const arm = rect('arm_r', 0, 0, 10, 20, [250, 210, 190], fill);
  fill[0] = 0; // 원화에 보이던 픽셀은 남는다
  const n = trimLimbRoot(arm, { x: 5, y: 5 }, { x: 5, y: 15 }, 2);
  assert.ok(n >= 60);
  assert.equal(arm.data[3], 255);
  assert.equal(arm.data[(3 * 10 + 4) * 4 + 3], 0);
  assert.ok(arm.data[(9 * 10 + 4) * 4 + 3] > 150); // 관절 + 여유 뒤 3px은 흐리게
  assert.equal(arm.data[(12 * 10 + 4) * 4 + 3], 255);
  assert.match(completionPrompt('legwear_l', ['the shorts'], 'white', { plain: true }), /all-ages/);
  assert.deepEqual(redrawTargets([{ label: 'sleeve_r', data: new Uint8ClampedArray(4) }, { label: 'neck', data: new Uint8ClampedArray(4) }]).map((l) => l.label), ['neck']);
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

test('back hair is drawn whole behind the face with the front hair only as reference', () => {
  const hair = rect('front_hair', 0, 0, 20, 4, [120, 70, 40]);
  const face = rect('face', 5, 4, 10, 10, [250, 215, 195]);
  const back = rect('back_hair', 5, 4, 10, 8, [100, 60, 30], new Uint8Array(80).fill(1));
  const plan = completionPlan([hair, face, back], back, { pad: 0 });
  assert.ok(plan.whole);
  assert.equal(plan.visible.reduce((a, v) => a + v, 0), 0);
  assert.equal(plan.edit[(6 - plan.y0) * plan.w + (10 - plan.x0)], 1); // 얼굴 뒤
  assert.equal(plan.edit[0], 0); assert.equal(plan.color[3], 255); // 앞머리 모서리는 참고 그림
  assert.match(completionPrompt('back_hair', plan.covering), /behind the head/);
  const out = new Uint8ClampedArray(plan.w * plan.h * 4).fill(255);
  for (let i = 0; i < plan.w * plan.h; i++) if (plan.edit[i]) out.set([90, 55, 30, 255], i * 4);
  const m = mergeCompletion(plan, out, [255, 255, 255]);
  assert.ok(m && m.drawn >= 80);
  for (let i = 0; i < m.width * m.height; i++) if (m.data[i * 4 + 3]) assert.equal(m.fillMask[i], 1); // 앞머리 픽셀은 들어가지 않는다
});

test('legs open only the ankle inside the shoe, eyes only near the eye', () => {
  const shoe = rect('footwear_r', 0, 20, 10, 20, [90, 50, 30]);
  const leg = rect('legwear_r', 0, 0, 10, 20, [250, 210, 190]);
  const plan = completionPlan([shoe, leg], leg, { reach: 1, pad: 0 });
  const rowOpen = (gy) => plan.edit[(gy - plan.y0) * plan.w + 5] === 1;
  assert.ok(rowOpen(22)); assert.ok(!rowOpen(35));
  const lid = rect('face', 0, 0, 60, 60, [250, 215, 195]);
  const white = rect('eyewhite_r', 20, 20, 20, 20, [250, 250, 250]);
  const ep = completionPlan([lid, white], white, { reach: 1, pad: 0 });
  assert.ok(ep.w <= 20 + 2 * 8); // 눈 크기의 30%(최소 8px)까지, 예전 60%면 44
});

test('flare eyelid hides above the eye at rest and covers the whole opening after dropping S', () => {
  const white = rect('eyewhite_r', 20, 20, 10, 6, [250, 250, 250]);
  const face = rect('face', 0, 0, 60, 60, [240, 205, 185]);
  const plan = eyelidPlan([face, white], 'r');
  assert.equal(plan.S, 6); assert.equal(plan.minTop, 20);
  const skin = new Uint8ClampedArray(plan.crop.w * plan.crop.h * 4); for (let i = 0; i < skin.length; i += 4) skin.set([238, 200, 180, 255], i);
  const lid = buildEyelid(plan, skin, [240, 205, 185]);
  assert.equal(lid.label, 'eyelid_r'); assert.equal(lid.y, 14); assert.equal(lid.lidDrop, 6);
  assert.ok(lid.y + lid.height <= 20); // 평소엔 눈 뜬 자리(20~25) 위에 숨는다
  for (let x = 0; x < lid.width; x++) { let n = 0; for (let y = 0; y < lid.height; y++) if (lid.data[(y * lid.width + x) * 4 + 3]) n++; assert.equal(n, 6); }
  const eyeAgain = new Uint8ClampedArray(skin.length).fill(255);
  assert.equal(buildEyelid(plan, eyeAgain, [240, 205, 185]), null); // 눈을 그대로 그리면 버림
  assert.equal(facePartKind('eyelid_r'), 'lid_cover'); assert.equal(facePartKind('eyelash_r'), 'lids');
  const lash = rect('eyelash_r', 0, 0, 2, 2, [0, 0, 0], new Uint8Array([0, 1, 1, 0]));
  assert.equal(stripLashBand(lash), 2); assert.equal(lash.data[7], 0); assert.equal(lash.data[3], 255);
});

test('light face pixels around the eye hole are pulled to skin so no white ring shows when the eye closes', () => {
  const face = rect('face', 0, 0, 60, 60, [240, 205, 185]);
  const white = rect('eyewhite_r', 20, 20, 10, 6, [250, 250, 250]);
  face.data.set([250, 245, 240, 230], (19 * 60 + 24) * 4); // 구멍 바로 위 밝은 테두리
  face.data.set([250, 245, 240, 255], (10 * 60 + 24) * 4); // 멀리 있는 밝은 점은 그대로
  for (let y = 20; y < 26; y++) for (let x = 20; x < 30; x++) face.data[(y * 60 + x) * 4 + 3] = 0; // 눈 구멍
  const plan = eyelidPlan([face, white], 'r');
  assert.ok(tidyFaceRim(face, plan, [240, 205, 185]) >= 1);
  const i = (19 * 60 + 24) * 4; assert.ok(face.data[i + 1] < 220); assert.equal(face.data[i + 3], 255);
  assert.equal(face.data[(10 * 60 + 24) * 4 + 1], 245);
});

test('face pixels under the upper lash take the closed-eye drawing, the eye hole stays open', () => {
  const face = rect('face', 0, 0, 20, 20, [240, 205, 185]);
  face.data[(12 * 20 + 5) * 4 + 3] = 0; // 눈 구멍
  const lash = rect('eyelash_r', 2, 10, 8, 3, [20, 20, 20]);
  const plan = { crop: { x: 0, y: 0, w: 20, h: 20 } }, result = new Uint8ClampedArray(20 * 20 * 4).fill(200);
  assert.ok(paintUnderLash(face, lash, plan, result) > 23);
  assert.equal(face.data[(9 * 20 + 3) * 4], 200); // 속눈썹 둘레의 다른 색도 감은 눈 그림으로
  assert.equal(face.data[(10 * 20 + 3) * 4], 200); assert.equal(face.data[(12 * 20 + 5) * 4 + 3], 0); assert.equal(face.data[(5 * 20 + 3) * 4], 240);
});

test('flare keypoint dots are read by color, gray stick lines and white are ignored', () => {
  const w = 60, h = 40, d = new Uint8ClampedArray(w * h * 4).fill(255);
  const dot = (cx, cy, c, r = 2) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) d.set([...c, 255], (y * w + x) * 4); };
  for (let x = 0; x < w; x++) d.set([180, 180, 180, 255], (20 * w + x) * 4); // 회색 막대
  dot(10, 10, KEYPOINT_COLORS.shoulder_left); dot(40, 30, KEYPOINT_COLORS.knee_right); dot(30, 5, [10, 10, 10], 1); // 너무 작은 검은 점
  dot(50, 10, [240, 20, 20], 1); // 작은 빨간 점(가장 큰 덩어리가 아님)
  const k = detectKeypoints(d, w, h, { minPixels: 6 });
  assert.deepEqual(k.shoulder_left, { x: 10, y: 10 }); assert.deepEqual(k.knee_right, { x: 40, y: 30 });
  assert.equal(k.neck, undefined); assert.match(keypointPrompt(), /LEFT side of the picture/);
});

test('flare joints replace bent-arm and crossed-leg guesses and clear their warnings', () => {
  const rig = { frame: 'full', method: 'partial', missing: ['arm_left', 'legs'], points: { neck: { x: 50, y: 20 }, head: { x: 50, y: 10 }, arm_left: { x: 0, y: 0 }, elbow_left: { x: 0, y: 0 }, wrist_left: { x: 0, y: 0 } },
    ends: {}, warnings: ['화면 왼쪽 팔을 골격에서 찾지 못해 비율로 채웠습니다', '다리 갈림 높이(77%)가 이상해', '머리 옆 끝점'], checks: [{ id: 'x', ok: false }] };
  const ai = { neck: { x: 50, y: 22 }, shoulder_left: { x: 40, y: 25 }, elbow_left: { x: 35, y: 40 }, wrist_left: { x: 36, y: 55 },
    hip_left: { x: 45, y: 60 }, knee_left: { x: 47, y: 80 }, ankle_left: { x: 44, y: 98 }, hip_right: { x: 55, y: 60 }, knee_right: { x: 50, y: 80 }, ankle_right: { x: 56, y: 98 } };
  const r = applyAiJoints(rig, ai);
  assert.equal(r.method, 'skeleton'); assert.deepEqual(r.missing, []);
  assert.deepEqual(r.points.elbow_left, { x: 35, y: 40 }); assert.deepEqual(r.points.knee_right, { x: 50, y: 80 });
  assert.ok(r.points.body.y > r.points.chest.y && r.points.body.y < 60);
  assert.deepEqual(r.warnings, ['머리 옆 끝점']); assert.ok(r.ends.hand_tip_left.y > 55);
});
