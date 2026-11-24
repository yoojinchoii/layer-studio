import test from 'node:test';
import assert from 'node:assert/strict';
import { tailCenterline, addTailChain, tailWeights, tailSwaySpec, TAIL_LINKS } from './tail-chain.js';
import { AI_CLASSES, segmentationPrompt } from './local-engine/ai-labels.js';
import { inferRig } from './rig-core.js';

// 굽은 꼬리: 몸(오른쪽 위)에서 왼쪽으로 가다가 위로 꺾이는 굵기 6px 띠
function hookTail() {
  const width = 80, height = 60, data = new Uint8ClampedArray(width * height * 4);
  const put = (x, y) => { data[(y * width + x) * 4 + 3] = 255; };
  for (let x = 10; x < 80; x++) for (let y = 50; y < 56; y++) put(x, y);
  for (let y = 5; y < 56; y++) for (let x = 10; x < 16; x++) put(x, y);
  return { name: 'tail', x: 100, y: 200, width, height, data };
}

test('flare part map has a tail class', () => {
  assert.ok(AI_CLASSES.some((c) => c.key === 'tail'));
  assert.match(segmentationPrompt(), /tails/);
});

test('tail centerline runs from the body side to the hooked tip through the middle of the strip', () => {
  const line = tailCenterline(hookTail(), { x: 200, y: 253 });
  assert.equal(line.points.length, TAIL_LINKS + 1);
  const [root, tip] = [line.points[0], line.points.at(-1)];
  assert.ok(root.x > 170 && Math.abs(root.y - 253) < 4, JSON.stringify(root));
  assert.ok(tip.y < 215 && Math.abs(tip.x - 113) < 5, JSON.stringify(tip));
  assert.ok(line.width > 4 && line.width < 9);
});

test('tail layer gets its own chain bones, blended weights and a lagging sway', () => {
  const tail = hookTail(), rig = inferRig([tail], 320, 320);
  assert.equal(rig.modes[0], 'tail');
  assert.ok(addTailChain(rig, [tail]));
  assert.deepEqual(rig.tailChain.ids, ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5']);
  assert.equal(rig.parents.tail_1, 'pelvis');
  const p = rig.points.tail_3, w = tailWeights(rig, p.x, p.y);
  assert.ok(Math.abs(w.reduce((n, [, v]) => n + v, 0) - 1) < 1e-6);
  assert.ok(w.some(([id]) => id === 'tail_3'));
  const tipW = tailWeights(rig, rig.tailChain.tip.x, rig.tailChain.tip.y);
  assert.deepEqual(tipW.map(([id]) => id), ['tail_5']);
  const spec = tailSwaySpec(rig, 4);
  assert.ok(Math.abs(spec.tail_5.rotate(0.3)) !== Math.abs(spec.tail_1.rotate(0.3)));
});

test('brown eyes that flare left unpainted inside the face do not become a tail', async () => {
  const { dropStrayTail } = await import('./local-engine/ai-labels.js');
  const w = 60, h = 60, L = new Uint8Array(w * h).fill(2); // 얼굴
  for (let y = 20; y < 26; y++) for (let x = 20; x < 26; x++) L[y * w + x] = 11; // 얼굴 안 갈색 눈
  dropStrayTail(L, w, h);
  assert.equal(L[22 * w + 22], 2);
  // 몸 옆으로 길게 뻗은 진짜 꼬리는 남는다
  const T = new Uint8Array(w * h).fill(4);
  for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) T[y * w + x] = 11;
  dropStrayTail(T, w, h);
  assert.equal(T[30 * w + 3], 11);
});
