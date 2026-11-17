// 개발용: 웨이트 품질 측정. 원화 → 자체 엔진 → 리깅 → 관절을 여러 각도로 굽혀 메쉬 삼각형이 얼마나 찌그러지는지 잰다.
// 사용: node scripts/weight-bench.mjs <원화.png> [<원화2.png> ...]
// 지표 (그림이 있는 삼각형 기준, 면적 가중):
//   distortion = 평균 |ln(굽힌 면적 / 원래 면적)| × 100  (0이 이상적, 굽힘과 무관한 삼각형도 분모에 넣어 블렌드 폭과 상관없이 비교)
//   collapse   = 면적이 35% 미만으로 눌리거나 뒤집힌 삼각형 비율
//   stretch    = 면적이 2.5배 넘게 늘어난 삼각형 비율
import { pathToFileURL } from 'node:url';
import { readPNG } from './png-read.mjs';
import { runLocalEngine } from '../src/local-engine/index.js';
import { applyBuiltin } from '../src/rig-templates.js';
import { applyArtBindings, normalizeReport } from '../src/art-pipeline.js';
import { buildParts, makeSkeleton, poseMatrices, meshWorldVertices } from '../src/rig-core.js';
import { initializeControls } from '../src/rig-motion.js';

const BONES = ['upper_arm_R', 'upper_arm_L', 'forearm_R', 'forearm_L', 'thigh_R', 'thigh_L', 'shin_R', 'shin_L', 'torso', 'neck', 'head'];
const ANGLES = [-90, -45, 45, 90];

export function rigFor(file) {
  const img = readPNG(file);
  const out = runLocalEngine(new Uint8ClampedArray(img.data), img.width, img.height);
  const report = normalizeReport(out.pipeline);
  const layers = out.layers.map((l) => ({ name: l.label, x: l.x, y: l.y, width: l.width, height: l.height, data: l.data, opacity: 1, visible: true, ...(l.art ? { art: l.art } : {}) }));
  const rig = applyBuiltin(out.frame, layers, img.width, img.height).rig;
  if (report.rig_allowed) applyArtBindings(rig, layers, report);
  initializeControls(rig);
  return { rig, layers };
}

export function measure(parts, sk) {
  const rest = poseMatrices(sk);
  const area = (v, t, k) => { const [a, b, c] = [t[k], t[k + 1], t[k + 2]].map((i) => v[i]); return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); };
  const total = { w: 0, d: 0, collapse: 0, stretch: 0 }, per = {};
  const bones = BONES.filter((b) => sk.bones.some((x) => x.name === b));
  for (const p of parts) {
    const a = sk.skins[0].attachments[p.slot]?.[p.slot];
    if (a?.type !== 'mesh') continue;
    const v0 = meshWorldVertices(a, sk, rest);
    const tris = [];
    for (let k = 0; k < a.triangles.length; k += 3) {
      const ids = a.triangles.slice(k, k + 3);
      const u = ids.reduce((s, i) => s + a.uvs[i * 2], 0) / 3, w = ids.reduce((s, i) => s + a.uvs[i * 2 + 1], 0) / 3;
      if (p.data?.[(Math.min(p.height - 1, Math.floor(w * p.height)) * p.width + Math.min(p.width - 1, Math.floor(u * p.width))) * 4 + 3] < 32) continue;
      const base = area(v0, a.triangles, k);
      if (Math.abs(base) < 0.5) continue;
      tris.push([k, base]);
    }
    const s = per[p.slot] = { w: 0, d: 0, collapse: 0, stretch: 0 };
    for (const bone of bones) for (const angle of ANGLES) {
      const v1 = meshWorldVertices(a, sk, poseMatrices(sk, null, { [bone]: angle }));
      for (const [k, base] of tris) {
        const r = area(v1, a.triangles, k) / base, wt = Math.abs(base);
        for (const t of [s, total]) {
          t.w += wt; t.d += wt * Math.min(3, Math.abs(Math.log(Math.max(1e-3, r))));
          if (r < 0.35) t.collapse += wt; if (r > 2.5) t.stretch += wt;
        }
      }
    }
  }
  const fmt = (t) => ({ distortion: +(100 * t.d / (t.w || 1)).toFixed(3), collapse: +(100 * t.collapse / (t.w || 1)).toFixed(2), stretch: +(100 * t.stretch / (t.w || 1)).toFixed(2) });
  return { total: fmt(total), parts: Object.fromEntries(Object.entries(per).filter(([, t]) => t.w).map(([k, t]) => [k, fmt(t)])) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) {
    const { rig, layers } = rigFor(file);
    if (process.env.WR !== undefined) rig.weightRefine = Number(process.env.WR);
    if (process.env.MD) rig.meshDensity = process.env.MD;
    const parts = buildParts(layers, rig);
    const sk = makeSkeleton(parts, rig);
    const m = measure(parts, sk);
    const vertices = Object.values(sk.skins[0].attachments).flatMap((o) => Object.values(o)).filter((a) => a.type === 'mesh').reduce((n, a) => n + a.uvs.length / 2, 0);
    console.log(file.split('/').pop(), JSON.stringify({ ...m.total, vertices }));
    for (const [k, v] of Object.entries(m.parts).sort((a, b) => b[1].distortion - a[1].distortion).slice(0, 6)) console.log('   ', k.padEnd(14), JSON.stringify(v));
  }
}
