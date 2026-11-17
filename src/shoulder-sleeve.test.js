import test from 'node:test';
import assert from 'node:assert/strict';
import { readPNG } from '../scripts/png-read.mjs';
import { runLocalEngine } from './local-engine/index.js';

const cache = new Map();
const run = (file) => cache.get(file) || cache.set(file, (() => { const img = readPNG(new URL(`../dist/${file}`, import.meta.url)); return { img, out: runLocalEngine(new Uint8ClampedArray(img.data), img.width, img.height) }; })()).get(file);

// 예전에는 겨드랑이 높이(소매 높이의 70% 이상 아래, 소매 끝 근처)에 잡혔다.
test('A-pose shoulders sit in the upper part of the short sleeve, not at the armpit', () => {
  for (const file of ['sample-character.png', 'sample-half-body.png']) {
    const { img, out } = run(file);
    for (const [key, name] of [['shoulder_R', 'sleeve_r'], ['shoulder_L', 'sleeve_l']]) {
      const sleeve = out.layers.find((l) => l.label === name), y = out.pipeline.analysis.joints[key][1] * (img.height - 1) / 1000;
      assert.ok(y < sleeve.y + sleeve.height * 0.6, `${file} ${key} y=${y.toFixed(0)} sleeve ${sleeve.y}..${sleeve.y + sleeve.height}`);
    }
  }
});

test('sleeves bend from the chest to the upper arm instead of turning rigidly', () => {
  const { out } = run('sample-character.png');
  for (const name of ['sleeve_r', 'sleeve_l']) {
    const l = out.layers.find((x) => x.label === name);
    assert.equal(l.art.mode, name === 'sleeve_r' ? 'sleeve_left' : 'sleeve_right');
    assert.deepEqual(l.art.allowed_bones, ['chest', name === 'sleeve_r' ? 'arm_left' : 'arm_right']);
  }
});
