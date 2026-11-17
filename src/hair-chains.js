// 머리카락 체인: 얼굴 옆으로 늘어진 가닥(옆머리·뒷머리 끝)마다 3마디 뼈를 단다.
// 사용자 예시(chef·Zoey)처럼 가닥이 마디마다 늦게 따라와 흔들리게 하는 2차 움직임용.
import {pixelBounds} from './face-rig.js';

export const HAIR_LINKS = 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const SIDE_TEXT = { left: '화면 왼쪽', right: '화면 오른쪽' };

/**
 * 한 머리 레이어에서 늘어진 가닥의 중심선(위→끝)을 찾는다. 얼굴 상자 기준으로 눈 높이 아래, 얼굴 가장자리 바깥쪽 픽셀.
 * @returns {Array<{side:'left'|'right', points:Array<{x,y}>, width:number}>}
 */
export function hairStrands(layer, face, { split = 0.45, minLength = 0.25 } = {}) {
  if (!layer?.data || !face) return [];
  const y0 = Math.round(face.y + face.height * split), out = [];
  for (const side of ['left', 'right']) {
    const inner = side === 'left' ? face.x + face.width * 0.3 : face.x + face.width * 0.7;
    const rows = [];
    for (let y = Math.max(y0, layer.y); y < layer.y + layer.height; y++) {
      let sx = 0, n = 0, lo = Infinity, hi = -Infinity;
      for (let x = 0; x < layer.width; x++) {
        const gx = layer.x + x;
        if (side === 'left' ? gx >= inner : gx <= inner) continue;
        if (layer.data[((y - layer.y) * layer.width + x) * 4 + 3] < 128) continue;
        sx += gx; n++; lo = Math.min(lo, gx); hi = Math.max(hi, gx);
      }
      if (n >= 3) rows.push({ y, x: sx / n, w: hi - lo + 1 });
    }
    if (rows.length < 4) continue;
    // 위에서부터 끊기지 않은 줄만(아래 떨어진 조각은 다른 가닥)
    let end = 0;
    while (end + 1 < rows.length && rows[end + 1].y - rows[end].y <= 3) end++;
    const run = rows.slice(0, end + 1), top = run[0], tip = run[run.length - 1];
    if (tip.y - top.y < face.height * minLength) continue;
    const at = (f) => { const ty = top.y + (tip.y - top.y) * f; const r = run.reduce((a, b) => (Math.abs(b.y - ty) < Math.abs(a.y - ty) ? b : a)); return { x: r.x, y: ty }; };
    const points = Array.from({ length: HAIR_LINKS + 1 }, (_, k) => at(k / HAIR_LINKS));
    const width = run.reduce((a, r) => a + r.w, 0) / run.length;
    out.push({ side, points, width });
  }
  return out;
}

/** 리그에 머리카락 체인 관절을 더한다(얼굴 리그가 있는 경우). 이미 있으면 다시 만들지 않는다. */
export function addHairChains(rig, layers, maxJoints = 64) {
  if (!rig.faceRig || rig.hairChains) return false;
  const face = rig.faceGeometry?.face;
  if (!face) return false;
  rig.hairChains = {};
  layers.forEach((layer, i) => {
    const root = rig.assignments?.[i];
    if (!/^face_hair_(front|back)$/.test(root || '') || !rig.activeBones?.includes(root)) return;
    const which = root.endsWith('front') ? 'front' : 'back';
    const b = pixelBounds(layer);
    if (!b) return;
    for (const strand of hairStrands(layer, face, { split: which === 'front' ? 0.45 : 0.55 })) {
      if (Object.keys(rig.points).length + HAIR_LINKS > maxJoints) break;
      const ids = Array.from({ length: HAIR_LINKS }, (_, k) => `hair_${which}_${strand.side}_${k + 1}`);
      ids.forEach((id, k) => {
        rig.points[id] = { ...strand.points[k] };
        rig.parents[id] = k ? ids[k - 1] : root;
        rig.labels[id] = `${which === 'front' ? '앞머리' : '뒷머리'} 가닥 ${SIDE_TEXT[strand.side]} ${k + 1}`;
      });
      rig.activeBones.push(...ids);
      (rig.hairChains[root] ??= []).push({ side: strand.side, ids, tip: { ...strand.points[HAIR_LINKS] }, width: strand.width });
      for (const key of ['faceBindings', 'partBones']) if (rig[key]?.[i]) rig[key][i] = [...new Set([...rig[key][i], ...ids])];
    }
  });
  if (!Object.keys(rig.hairChains).length) { delete rig.hairChains; return false; }
  return true;
}

export const hairChainIds = (rig, root) => (rig.hairChains?.[root] || []).flatMap((c) => c.ids);

/**
 * 머리 가닥 정점의 웨이트. 가닥 중심선에 투영해 마디마다 나누고 관절 근처에서 섞는다.
 * 가닥 밖(정수리·앞머리 가운데)은 null을 돌려 기존 머리 웨이트를 쓰게 한다.
 */
export function hairChainWeights(rig, root, x, y, base) {
  const chains = rig.hairChains?.[root];
  if (!chains?.length) return null;
  let best = null;
  for (const chain of chains) {
    const pts = [...chain.ids.map((id) => rig.points[id]), chain.tip];
    let acc = 0, bestD = Infinity, bestT = 0;
    const lens = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const u = ((x - a.x) * dx + (y - a.y) * dy) / (L * L), c = clamp(u, k === 0 ? -Infinity : 0, k === pts.length - 2 ? Infinity : 1);
      const d = Math.hypot(x - (a.x + dx * c), y - (a.y + dy * c));
      if (d < bestD) { bestD = d; bestT = acc + c * L; }
      lens.push(L); acc += L;
    }
    if (bestD > Math.max(chain.width * 0.9, 12)) continue;
    if (!best || bestD < best.d) best = { chain, t: bestT, d: bestD, lens };
  }
  if (!best) return null;
  const { chain, t, lens } = best, ids = chain.ids, band = Math.max(4, Math.min(...lens) * 0.3);
  // 체인 시작 위: 기존 머리 웨이트 → 첫 마디로 섞는다
  if (t <= band) {
    const s = smooth((t + band) / (2 * band));
    return [...base.map(([id, w]) => [id, w * (1 - s)]), [ids[0], s]].filter(([, w]) => w > 0);
  }
  let start = 0;
  for (let k = 0; k < ids.length; k++) {
    const end = start + lens[k];
    if (t <= end || k === ids.length - 1) {
      if (k < ids.length - 1 && t > end - band) { const s = smooth((t - (end - band)) / (2 * band)); return [[ids[k], 1 - s], [ids[k + 1], s]]; }
      if (k > 0 && t < start + band) { const s = smooth((t - (start - band)) / (2 * band)); return [[ids[k - 1], 1 - s], [ids[k], s]]; }
      return [[ids[k], 1]];
    }
    start = end;
  }
  return [[ids[ids.length - 1], 1]];
}

/**
 * 모든 모션에 얹을 머리 가닥 흔들림: 끝으로 갈수록 크게, 늦게(마디마다 위상 지연).
 * duration·cycles로 끝과 시작이 이어지게 한다. 좌우 가닥은 반대 방향(바깥으로 벌어졌다 모임)이 아니라 같은 방향으로 흔든다.
 */
export function hairSwaySpec(rig, duration, { amplitude = 2.2, energy = 1 } = {}) {
  const spec = {}, cycles = Math.max(1, Math.round(duration / 1.6));
  for (const chains of Object.values(rig.hairChains || {})) for (const chain of chains) chain.ids.forEach((id, k) => {
    const amp = amplitude * energy * (k + 1) * 0.7, lag = 0.07 * (k + 1);
    spec[id] = { rotate: (p) => amp * Math.sin((p * cycles - lag) * 2 * Math.PI) };
  });
  return spec;
}
