// 자체 알고리즘 엔진을 화면이 멈추지 않도록 별도 스레드에서 돌린다.
// 빌드: dist/local-engine-worker.js (package.json build 스크립트)
import { runLocalEngine } from './index.js';

self.onmessage = (event) => {
  const { id, buffer, width, height } = event.data;
  try {
    const result = runLocalEngine(new Uint8ClampedArray(buffer), width, height);
    self.postMessage({ id, ok: true, result }, result.layers.map((l) => l.data.buffer));
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
