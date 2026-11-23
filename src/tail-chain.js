// 꼬리 체인: 사용자 레퍼(아기 악마의 Tail~Tail7)처럼 꼬리 레이어 중심선을 따라 여러 마디 뼈를 달아
// 다리와 따로, 끝으로 갈수록 크고 늦게 흔들리게 한다.
export const TAIL_LINKS = 5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const isTailLayer = (name) => /^(tail|꼬리)(_\d+)?$/i.test(String(name || ''));
export const tailParent = (rig) => (rig.points.pelvis ? 'pelvis' : rig.points.body ? 'body' : 'root');

/**
 * 꼬리 레이어의 중심선(뿌리→끝, links+1개 점)과 평균 굵기.
 * 뿌리 = 몸(anchor)에 가장 가까운 꼬리 픽셀. 거기서 꼬리 안으로 퍼지는 거리(측지 거리)를 띠로 나눠
 * 띠마다 무게중심을 이으면 휘어진 꼬리도 가운데를 지난다. 다리에 가려 끊긴 조각은 몇 px 틈을 건너 잇는다.
 */
export function tailCenterline(layer, anchor, { links = TAIL_LINKS, gap = 4 } = {}) {
  if (!layer?.data || !anchor) return null;
  const { width: w, height: h, data } = layer, n = w * h;
  const inside = new Uint8Array(n);
  let area = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] > 128) { inside[i] = 1; area++; }
  if (area < 40) return null;
  // 틈 건너기용 통로: 꼬리 픽셀에서 gap px 안
  const pass = inside.slice();
  for (let r = 0; r < gap; r++) { const prev = pass.slice(); for (let i = 0; i < n; i++) { if (prev[i]) continue; const x = i % w;
    if ((x > 0 && prev[i - 1]) || (x < w - 1 && prev[i + 1]) || (i >= w && prev[i - w]) || (i + w < n && prev[i + w])) pass[i] = 1; } }
  let start = -1, bestD = Infinity;
  for (let i = 0; i < n; i++) if (inside[i]) { const x = i % w, y = (i - x) / w, d = Math.hypot(layer.x + x + 0.5 - anchor.x, layer.y + y + 0.5 - anchor.y); if (d < bestD) { bestD = d; start = i; } }
  const dist = new Float32Array(n).fill(Infinity), q = [start];
  dist[start] = 0;
  // 8방향 BFS(대각선 √2). 정확한 최단거리가 아니어도 띠 나누기엔 충분하다.
  for (let k = 0; k < q.length; k++) { const i = q[k], x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X, d = dist[i] + (dx && dy ? Math.SQRT2 : 1); if (pass[j] && d < dist[j]) { dist[j] = d; q.push(j); } } }
  let far = 0, reached = 0;
  for (let i = 0; i < n; i++) if (inside[i] && dist[i] < Infinity) { reached++; if (dist[i] > far) far = dist[i]; }
  if (far < 12 || reached < area * 0.6) return null;
  const B = clamp(Math.round(far / 4), 8, 48), sx = new Float64Array(B), sy = new Float64Array(B), cnt = new Float64Array(B);
  for (let i = 0; i < n; i++) { if (!inside[i] || dist[i] === Infinity) continue; const b = Math.min(B - 1, Math.floor((dist[i] / far) * B)), x = i % w;
    sx[b] += x; sy[b] += (i - x) / w; cnt[b]++; }
  const line = [{ x: layer.x + (start % w) + 0.5, y: layer.y + Math.floor(start / w) + 0.5 }];
  for (let b = 0; b < B; b++) if (cnt[b]) line.push({ x: layer.x + sx[b] / cnt[b] + 0.5, y: layer.y + sy[b] / cnt[b] + 0.5 });
  // 호 길이로 같은 간격 links+1개 점
  const acc = [0];
  for (let k = 1; k < line.length; k++) acc.push(acc[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y));
  const L = acc.at(-1);
  if (L < 12) return null;
  const at = (s) => { let k = 1; while (k < line.length - 1 && acc[k] < s) k++; const a = line[k - 1], b = line[k], t = (s - acc[k - 1]) / Math.max(1e-6, acc[k] - acc[k - 1]);
    return { x: a.x + (b.x - a.x) * clamp(t, 0, 1), y: a.y + (b.y - a.y) * clamp(t, 0, 1) }; };
  const points = Array.from({ length: links + 1 }, (_, k) => at((L * k) / links));
  return { points, width: area / L, length: L };
}

/** 리그에 꼬리 체인 뼈를 더한다(꼬리 레이어가 있을 때). 이미 있으면 다시 만들지 않는다. */
export function addTailChain(rig, layers, maxJoints = 64) {
  if (rig.tailChain) return false;
  const i = layers.findIndex((l) => isTailLayer(l.name) && l.data);
  if (i < 0 || Object.keys(rig.points).length + TAIL_LINKS > maxJoints) return false;
  const parent = tailParent(rig), anchor = rig.points[parent] || rig.points.root;
  const line = tailCenterline(layers[i], anchor);
  if (!line) return false;
  const ids = Array.from({ length: TAIL_LINKS }, (_, k) => `tail_${k + 1}`);
  ids.forEach((id, k) => { rig.points[id] = { ...line.points[k] }; rig.parents[id] = k ? ids[k - 1] : parent; rig.labels[id] = `꼬리 ${k + 1}`; });
  if (rig.activeBones) rig.activeBones.push(...ids);
  rig.tailChain = { source: i, ids, tip: { ...line.points[TAIL_LINKS] }, width: line.width };
  rig.assignments[i] = parent; rig.modes[i] = 'tail';
  if (rig.partBones) rig.partBones[i] = [parent, ...ids];
  return true;
}

export const tailChainIds = (rig) => rig.tailChain?.ids || [];

// 중심선 위 위치(뿌리에서 호 길이)와 마디 길이들
function chainPosition(rig, x, y) {
  const tc = rig.tailChain, pts = [...tc.ids.map((id) => rig.points[id]), tc.tip], lens = [];
  let acc = 0, bestD = Infinity, bestT = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const u = ((x - a.x) * dx + (y - a.y) * dy) / (L * L), c = clamp(u, k === 0 ? -Infinity : 0, k === pts.length - 2 ? Infinity : 1);
    const d = Math.hypot(x - (a.x + dx * c), y - (a.y + dy * c));
    if (d < bestD) { bestD = d; bestT = acc + c * L; }
    lens.push(L); acc += L;
  }
  return { t: bestT, lens };
}

/** 꼬리 정점 웨이트: 중심선에 투영해 마디마다 나누고 관절 근처에서 이웃 마디와 섞는다. 뿌리 앞은 몸(골반)에서 첫 마디로. */
export function tailWeights(rig, x, y) {
  const tc = rig.tailChain;
  if (!tc) return null;
  const { t, lens } = chainPosition(rig, x, y), ids = tc.ids, band = Math.max(3, Math.min(...lens) * 0.35), parent = tailParent(rig);
  if (t <= band) { const s = smooth((t + band) / (2 * band)); return [[parent, 1 - s], [ids[0], s]].filter(([, w]) => w > 1e-4); }
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
  return [[ids.at(-1), 1]];
}

/** 메쉬 안쪽 점: 마디마다 중심선과 양옆(굵기의 ±35%), 관절 앞뒤로 촘촘하게. 레이어 좌표. */
export function tailMeshPoints(layer, rig) {
  const tc = rig.tailChain;
  if (!tc || !layer.data) return [];
  const pts = [...tc.ids.map((id) => rig.points[id]), tc.tip], out = [], half = Math.max(2, tc.width * 0.35);
  const alpha = (x, y) => { const X = Math.floor(x), Y = Math.floor(y); return X < 0 || Y < 0 || X >= layer.width || Y >= layer.height ? 0 : layer.data[(Y * layer.width + X) * 4 + 3]; };
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const cx = a.x + dx * f - layer.x, cy = a.y + dy * f - layer.y;
      for (const o of [-half, 0, half]) { const x = cx + nx * o, y = cy + ny * o; if (alpha(x, y) > 8) out.push([x, y]); }
    }
  }
  return out;
}

/** 모든 모션에 얹을 꼬리 흔들림: 레퍼처럼 끝 마디로 갈수록 크고 늦게(채찍처럼). */
export function tailSwaySpec(rig, duration, { amplitude = 5, energy = 1 } = {}) {
  const spec = {}, ids = tailChainIds(rig), cycles = Math.max(1, Math.round(duration / 2));
  ids.forEach((id, k) => {
    const amp = amplitude * energy * (0.6 + 0.25 * k), lag = 0.09 * (k + 1);
    spec[id] = { rotate: (p) => amp * Math.sin((p * cycles - lag) * 2 * Math.PI) };
  });
  return spec;
}
