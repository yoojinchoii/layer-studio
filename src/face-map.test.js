// 얼굴 세부 지도: 색 → 범주, 얼굴 상자, 전신 지도 고치기(머리카락·얼굴 경계만), 지도로 눈·눈썹·입·코 나누기.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACE_CLASSES, FACE_ID, classifyFaceMap, faceCropBox, mergeFaceMap, faceMapPrompt } from './local-engine/face-map.js';
import { faceDetailsFromMap } from './local-engine/layers.js';

test('face map colors classify to their class; white and far colors stay unassigned', () => {
  const px = [...FACE_CLASSES.map((c) => [...c.color, 255]), [255, 255, 255, 255], [120, 60, 200, 255]].flat();
  const out = classifyFaceMap(new Uint8ClampedArray(px), FACE_CLASSES.length + 2);
  assert.deepEqual([...out], [...FACE_CLASSES.map((c) => c.id), 0, 0]);
  assert.match(faceMapPrompt(), /#FF00FF/);
});

test('crop box surrounds the largest face blob with room for the hair around it', () => {
  const w = 100, h = 100, labels = new Uint8Array(w * h);
  for (let y = 30; y < 50; y++) for (let x = 40; x < 60; x++) labels[y * w + x] = 2;
  for (let y = 90; y < 95; y++) for (let x = 0; x < 5; x++) labels[y * w + x] = 2; // 손(작은 피부)
  const b = faceCropBox(labels, w, h);
  assert.ok(b.x <= 32 && b.x + b.width >= 68 && b.y <= 21 && b.y + b.height >= 54, JSON.stringify(b));
  assert.equal(faceCropBox(new Uint8Array(w * h), w, h), null);
});

test('merge fixes only the hair/face boundary and pins what it decided', () => {
  // 전신 지도: 머리카락(1)으로 칠한 눈, 얼굴(2), 목(3), 기타(10)
  const labels = Uint8Array.from([1, 2, 3, 10, 2, 0]);
  const face = Uint8Array.from([FACE_ID.iris, FACE_ID.hair, FACE_ID.skin, FACE_ID.hair, 0, FACE_ID.lash]);
  const { labels: out, pin } = mergeFaceMap(labels, face);
  assert.deepEqual([...out], [2, 1, 3, 10, 2, 2]);
  assert.deepEqual([...pin], [2, 1, 0, 0, 0, 2]);
});

test('eyes, brows, mouth and nose come from the map inside the face; ear shading is not taken as the nose', () => {
  const w = 120, h = 120, face = new Uint8Array(w * h), ai = new Uint8Array(w * h), data = new Uint8ClampedArray(w * h * 4).fill(200);
  for (let y = 10; y < 110; y++) for (let x = 10; x < 110; x++) { face[y * w + x] = 1; ai[y * w + x] = FACE_ID.skin; }
  const tone = { [FACE_ID.white]: [250, 250, 248], [FACE_ID.iris]: [60, 110, 210], [FACE_ID.lash]: [40, 25, 25], [FACE_ID.brow]: [120, 80, 40], [FACE_ID.nose]: [200, 140, 120], [FACE_ID.mouth]: [220, 90, 100] };
  for (let i = 0; i < w * h; i++) data.set([232, 190, 170, 255], i * 4);
  const rect = (x0, y0, x1, y1, k) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { ai[y * w + x] = k; data.set([...tone[k], 255], (y * w + x) * 4); } };
  for (const cx of [35, 85]) { rect(cx - 12, 42, cx + 12, 54, FACE_ID.white); rect(cx - 5, 43, cx + 5, 54, FACE_ID.iris); rect(cx - 13, 39, cx + 13, 42, FACE_ID.lash); rect(cx - 12, 28, cx + 12, 32, FACE_ID.brow); }
  rect(55, 64, 65, 72, FACE_ID.nose); rect(12, 60, 18, 75, FACE_ID.nose); rect(45, 85, 75, 93, FACE_ID.mouth);
  const r = faceDetailsFromMap(data, w, h, face, ai), d = r.details, cnt = (m) => m.reduce((n, v) => n + v, 0);
  for (const k of ['eyelash_r', 'eyelash_l', 'irides_r', 'irides_l', 'eyewhite_r', 'eyewhite_l', 'eyebrow_r', 'eyebrow_l', 'mouth', 'nose']) assert.ok(d[k] && cnt(d[k]) > 0, k);
  // 화면 왼쪽 눈 = _r
  assert.ok(d.irides_r[48 * w + 35] && d.irides_l[48 * w + 85]);
  assert.ok(d.nose[68 * w + 60] && !d.nose[67 * w + 15], 'ear shading stays in the face');
  // 지도가 속눈썹이라 한 눈동자색 픽셀은 눈동자로 돌아간다(감은 눈 위 파란 점 방지)
  const ai2 = ai.slice(); for (let x = 31; x < 40; x++) { ai2[42 * w + x] = FACE_ID.lash; data.set([62, 112, 208, 255], (42 * w + x) * 4); }
  const d2 = faceDetailsFromMap(data, w, h, face, ai2).details; assert.ok(d2.irides_r[42 * w + 35] && !d2.eyelash_r[42 * w + 35]);
  assert.equal(faceDetailsFromMap(data, w, h, face, new Uint8Array(w * h)), null);
});

test('eye whites drawn past the face outline are cut so they never show outside the face', async () => {
  const { clipEyesToFace } = await import('./flare-client.js');
  const mk = (label, x, y, width, height) => ({ label, x, y, width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });
  const face = mk('face', 0, 0, 20, 20), white = mk('eyewhite_l', 12, 5, 20, 6);
  const cut = clipEyesToFace([face, white]);
  const a = (gx) => white.data[((0) * white.width + (gx - white.x)) * 4 + 3];
  assert.equal(a(14), 255); assert.equal(a(22), 255); assert.equal(a(24), 0); assert.ok(cut > 0);
});

test('the iris inside the face eye hole is kept when clipping', async () => {
  const { clipEyesToFace } = await import('./flare-client.js');
  const mk = (label, x, y, width, height) => ({ label, x, y, width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });
  const face = mk('face', 0, 0, 30, 30); for (let y = 10; y < 20; y++) for (let x = 8; x < 22; x++) face.data[(y * 30 + x) * 4 + 3] = 0; // 눈 구멍
  const iris = mk('irides_r', 9, 11, 12, 8);
  assert.equal(clipEyesToFace([face, iris]), 0);
});
