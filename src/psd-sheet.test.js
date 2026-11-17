import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetLayout, sheetDocument } from './psd-sheet.js';

const part = (name, w, h, x = 0, y = 0) => ({ name, width: w, height: h, x, y, data: new Uint8ClampedArray(w * h * 4).fill(255) });

test('sheet layout keeps every part inside the sheet with no overlap', () => {
  const layers = [part('hair', 200, 160), part('eye', 20, 8), part('top', 140, 150), part('leg_r', 50, 300), part('leg_l', 50, 300), part('shoe', 60, 70)];
  const { width, height, places } = sheetLayout(layers, { gap: 10 });
  const boxes = layers.map((l, i) => ({ ...places[i], w: l.width, h: l.height }));
  for (const b of boxes) assert.ok(b.x >= 10 && b.y >= 10 && b.x + b.w <= width && b.y + b.h <= height);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.x + a.w + 10 <= b.x || b.x + b.w + 10 <= a.x || a.y + a.h + 10 <= b.y || b.y + b.h + 10 <= a.y, `${layers[i].name} overlaps ${layers[j].name}`);
  }
});

test('sheet psd has a visible spread group and a hidden assembled group with original positions', () => {
  const layers = [part('front', 30, 30, 5, 5), part('back', 40, 40, 0, 0)];
  const doc = sheetDocument(layers, 64, 64, { gap: 8 });
  const [assembled, spread] = doc.children;
  assert.equal(assembled.hidden, true);
  assert.deepEqual(assembled.children.map((c) => [c.name, c.left, c.top]), [['back', 0, 0], ['front', 5, 5]]);
  assert.deepEqual(spread.children.map((c) => c.name), ['back', 'front']);
  assert.ok(doc.width >= 64 && doc.imageData.data.length === doc.width * doc.height * 4);
});
