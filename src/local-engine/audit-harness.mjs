// 개발용: 자체 엔진 결과를 웹앱과 같은 순서로 리깅·굽힘 검사까지 돌려 본다 (브라우저 없이).
// 사용: node src/local-engine/audit-harness.mjs <raw RGBA 파일> <width> <height>
import fs from 'node:fs';
import { runLocalEngine } from './index.js';
import { applyBuiltin } from '../rig-templates.js';
import { applyArtBindings, normalizeReport, completeRigReview } from '../art-pipeline.js';
import { buildParts, makeSkeleton } from '../rig-core.js';
import { initializeControls } from '../rig-motion.js';
import { auditRig } from '../rig-audit.js';
import { packAtlas, encodePNG } from '../spine-export.js';
import path from 'node:path';

const [file, W, H, outDir] = process.argv.slice(2);
const width = Number(W);
const height = Number(H);
const out = runLocalEngine(new Uint8ClampedArray(fs.readFileSync(file)), width, height);
const report = normalizeReport(out.pipeline);
const layers = out.layers.map((l) => ({ name: l.label, x: l.x, y: l.y, width: l.width, height: l.height, data: l.data, opacity: 1, visible: true, ...(l.art ? { art: l.art } : {}) }));
const rig = applyBuiltin(out.frame, layers, width, height).rig;
if (report.rig_allowed) applyArtBindings(rig, layers, report);
initializeControls(rig);
const parts = buildParts(layers, rig);
const sk = makeSkeleton(parts, rig);
const audit = auditRig(parts, rig, sk);
const final = report.rig_allowed ? completeRigReview(report, audit) : report;
console.log(JSON.stringify({ frame: out.frame, status: final.status, layers: layers.length, parts: parts.length, bones: sk.bones.length, slots: sk.slots.length,
  animations: Object.keys(sk.animations || {}), audit: { poses: audit.poses, issues: audit.issues } }, null, 1));

// 선택: 웹앱의 'Spine 리그 ZIP'과 같은 구성으로 파일을 쓴다 (spine/skeleton.json + images, unity/ atlas).
if (outDir) {
  const name = 'character';
  fs.mkdirSync(path.join(outDir, 'spine', 'images'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'unity'), { recursive: true });
  const json = JSON.stringify(sk, null, 2);
  fs.writeFileSync(path.join(outDir, 'spine', 'skeleton.json'), json);
  for (const p of parts) fs.writeFileSync(path.join(outDir, 'spine', 'images', `${p.slot}.png`), encodePNG(p.data, p.width, p.height));
  const packed = packAtlas(parts.map((p) => ({ slot: p.slot, width: p.width, height: p.height, data: p.data })), { name });
  fs.writeFileSync(path.join(outDir, 'unity', `${name}.json`), json);
  fs.writeFileSync(path.join(outDir, 'unity', `${name}.atlas.txt`), packed.atlas);
  for (const pg of packed.pages) fs.writeFileSync(path.join(outDir, 'unity', pg.file), encodePNG(pg.rgba, pg.width, pg.height));
  fs.writeFileSync(path.join(outDir, 'layer-map.json'), JSON.stringify(parts.map(({ slot, x, y, width, height, bone, name: n }) => ({ slot, name: n, x, y, width, height, bone })), null, 2));
  console.log('Spine 파일:', outDir);
}
