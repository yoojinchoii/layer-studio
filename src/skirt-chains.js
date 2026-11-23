// 치마 뼈: 사용자 레퍼(Alice·옥토버페스트의 Skirt L/R)처럼 치마 왼쪽·오른쪽에 2마디 뼈를 달아
// 다리(허벅지)와 따로, 끝으로 갈수록 늦게 흔들리게 한다. 반바지·바지는 다리 사이가 비어 있어 대상이 아니다.
export const SKIRT_LINKS = 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const SIDE_TEXT = { left: '화면 왼쪽', right: '화면 오른쪽' };
const alphaAt = (l, gx, gy) => {
  const x = Math.floor(gx - l.x), y = Math.floor(gy - l.y);
  return x < 0 || y < 0 || x >= l.width || y >= l.height ? 0 : l.data[(y * l.width + x) * 4 + 3];
};

/** 하의가 치마인지(다리 사이가 천으로 이어짐) 보고 치마 모양(허리·밑단·좌우 중심선)을 돌려준다. */
export function skirtShape(layer, rig) {
  const P = rig.points, hl = P.hip_left, hr = P.hip_right, kl = P.knee_left, kr = P.knee_right;
  if (!layer?.data || !hl || !hr || !kl || !kr) return null;
  let top = -1, hem = -1;
  for (let y = 0; y < layer.height && top < 0; y++) for (let x = 0; x < layer.width; x++) if (layer.data[(y * layer.width + x) * 4 + 3] > 128) { top = y; break; }
  for (let y = layer.height - 1; y >= 0 && hem < 0; y--) for (let x = 0; x < layer.width; x++) if (layer.data[(y * layer.width + x) * 4 + 3] > 128) { hem = y; break; }
  if (top < 0) return null;
  top += layer.y; hem += layer.y;
  const hipY = (hl.y + hr.y) / 2, kneeY = (kl.y + kr.y) / 2, thigh = Math.max(1, kneeY - hipY), cx = (hl.x + hr.x) / 2, half = Math.max(2, Math.abs(hr.x - hl.x) * 0.25);
  if (hem < hipY + thigh * 0.25) return null;
  // 허벅지 중간과 밑단 바로 위, 두 줄 모두 다리 사이가 천으로 채워져 있어야 치마
  const filled = (y) => { let n = 0, k = 0; for (let x = cx - half; x <= cx + half; x += 1, k++) if (alphaAt(layer, x, y) > 128) n++; return n / Math.max(1, k); };
  // 밑단 바로 위는 프릴·다리가 겹쳐 들쭉날쭉하므로 밑단에서 20% 올라온 줄을 본다
  const rows = [Math.min(hipY + thigh * 0.45, hem - (hem - hipY) * 0.2), hem - (hem - hipY) * 0.2];
  if (rows.some((y) => y <= hipY || filled(y) < 0.85)) return null;
  const sideCenter = (y, side) => {
    let sx = 0, n = 0;
    for (let x = layer.x; x < layer.x + layer.width; x++) {
      if (side === 'left' ? x >= cx : x < cx) continue;
      if (alphaAt(layer, x, y) > 128) { sx += x; n++; }
    }
    return n ? sx / n : side === 'left' ? cx - half * 2 : cx + half * 2;
  };
  const H = hem - top, at = (f, side) => { const y = top + H * f; return { x: sideCenter(y, side), y }; };
  const chain = (side) => ({ points: [at(0.18, side), at(0.58, side)], tip: at(0.97, side) });
  return { top, hem, cx, band: Math.max(4, layer.width * 0.12), left: chain('left'), right: chain('right') };
}

/** 리그에 치마 뼈를 더한다. 이미 있으면 다시 만들지 않는다. */
export function addSkirtChains(rig, layers, maxJoints = 64) {
  if (rig.skirtChains) return false;
  const i = layers.findIndex((l, k) => rig.modes?.[k] === 'bottoms' && l.data);
  if (i < 0 || Object.keys(rig.points).length + SKIRT_LINKS * 2 > maxJoints) return false;
  const shape = skirtShape(layers[i], rig);
  if (!shape) return false;
  const parent = rig.points.pelvis ? 'pelvis' : 'body';
  const chains = {};
  for (const side of ['left', 'right']) {
    const ids = Array.from({ length: SKIRT_LINKS }, (_, k) => `skirt_${side}_${k + 1}`);
    ids.forEach((id, k) => {
      rig.points[id] = { ...shape[side].points[k] };
      rig.parents[id] = k ? ids[k - 1] : parent;
      rig.labels[id] = `치마 ${SIDE_TEXT[side]} ${k + 1}`;
    });
    if (rig.activeBones) rig.activeBones.push(...ids);
    chains[side] = { ids, tip: { ...shape[side].tip } };
  }
  rig.skirtChains = { source: i, top: shape.top, hem: shape.hem, cx: shape.cx, band: shape.band, ...chains };
  if (rig.partBones?.[i]) rig.partBones[i] = [...new Set([parent, ...chains.left.ids, ...chains.right.ids])];
  return true;
}

export const skirtChainIds = (rig) => ['left', 'right'].flatMap((s) => rig.skirtChains?.[s]?.ids || []);

/** 치마 정점 웨이트: 허리띠는 하체 뼈, 아래로 갈수록 그쪽 치마 뼈 1→2마디, 가운데는 좌우를 섞는다. */
export function skirtWeights(rig, x, y) {
  const sk = rig.skirtChains;
  if (!sk) return null;
  const parent = rig.points.pelvis ? 'pelvis' : 'body', t = (y - sk.top) / Math.max(1, sk.hem - sk.top);
  const wl = 1 - smooth((x - (sk.cx - sk.band)) / (2 * sk.band)), wp = 1 - smooth((t - 0.04) / 0.22), s2 = smooth((t - 0.42) / 0.3), r = 1 - wp;
  return [[parent, wp], [sk.left.ids[0], wl * r * (1 - s2)], [sk.left.ids[1], wl * r * s2], [sk.right.ids[0], (1 - wl) * r * (1 - s2)], [sk.right.ids[1], (1 - wl) * r * s2]].filter(([, w]) => w > 1e-4);
}

/** 모든 모션에 얹을 치마 흔들림: 끝 마디가 더 크고 늦게. 좌우는 같은 방향(진자처럼). */
export function skirtSwaySpec(rig, duration, { amplitude = 2, energy = 1 } = {}) {
  const spec = {}, cycles = Math.max(1, Math.round(duration / 2));
  for (const side of ['left', 'right']) for (const [k, id] of (rig.skirtChains?.[side]?.ids || []).entries()) {
    const amp = amplitude * energy * (k ? 1.6 : 1), lag = 0.1 * (k + 1) + (side === 'left' ? 0 : 0.03);
    spec[id] = { rotate: (p) => amp * Math.sin((p * cycles - lag) * 2 * Math.PI) };
  }
  return spec;
}
