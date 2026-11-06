// 실루엣의 중심축 골격에서 리그 관절 후보를 찾는다 (모델 없음).
// 관절 이름은 layer-studio의 rig-core.js와 같다. left/right는 "화면 기준" 왼쪽/오른쪽.

import { distanceTransform, closeGaps } from './segment-core.js';

export const JOINT_IDS = [
  'root', 'body', 'upper', 'pelvis', 'chest', 'neck', 'head', 'hair',
  'arm_left', 'elbow_left', 'wrist_left', 'arm_right', 'elbow_right', 'wrist_right',
  'hip_left', 'knee_left', 'ankle_left', 'hip_right', 'knee_right', 'ankle_right',
];
// 뼈 끝점(관절은 아니지만 파츠 배정에 쓰는 말단).
export const END_IDS = ['head_top', 'hand_tip_left', 'hand_tip_right', 'foot_tip_left', 'foot_tip_right'];

const SKELETON_SIZE = 512; // 골격은 이 해상도로 줄여서 계산한다

/** 전경 마스크를 블록 다수결로 축소한다. */
function downsample(fg, w, h, f) {
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const out = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      let on = 0;
      let all = 0;
      for (let y = sy * f; y < Math.min(h, sy * f + f); y++) {
        for (let x = sx * f; x < Math.min(w, sx * f + f); x++) { on += fg[y * w + x]; all++; }
      }
      out[sy * sw + sx] = on * 2 >= all ? 1 : 0;
    }
  }
  return { mask: out, sw, sh };
}

/** 가장 큰 연결 덩어리만 남긴다 (떨어진 먼지·장식 제거). */
function largestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = ++next;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < mask.length && mask[j] && !label[j]) { label[j] = id; queue[tail++] = j; }
      }
    }
    if (tail > bestSize) { bestSize = tail; best = id; }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/** Zhang–Suen 세선화: 두께 1px의 중심선을 남긴다. */
export function thin(mask, w, h) {
  const m = Uint8Array.from(mask);
  for (let x = 0; x < w; x++) { m[x] = 0; m[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { m[y * w] = 0; m[y * w + w - 1] = 0; }
  let list = [];
  for (let i = 0; i < m.length; i++) if (m[i]) list.push(i);
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del = [];
      for (const i of list) {
        if (!m[i]) continue;
        const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1];
        const p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let a = 0;
        for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++;
        if (a !== 1) continue;
        if (step === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(i);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
    list = list.filter((i) => m[i]);
  }
  return m;
}

function neighbors8(i, w) {
  return [i - w - 1, i - w, i - w + 1, i - 1, i + 1, i + w - 1, i + w, i + w + 1];
}

/** 둘레 8칸을 한 바퀴 돌며 0→1로 바뀌는 횟수. 1 = 끝점, 2 = 선 중간, 3 이상 = 갈림. */
function crossings(skel, i, w) {
  const ring = [i - w, i - w + 1, i + 1, i + w + 1, i + w, i + w - 1, i - 1, i - w - 1];
  let c = 0;
  for (let k = 0; k < 8; k++) if (!skel[ring[k]] && skel[ring[(k + 1) % 8]]) c++;
  return c;
}
const isEnd = (skel, i, w) => skel[i] && crossings(skel, i, w) === 1;
const isFork = (skel, i, w) => skel[i] && crossings(skel, i, w) >= 3;

/** 바깥 테두리와 이어지지 않은 빈 곳(구멍)을 채운다. */
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** 국소 두께보다 짧은 잔가지(머리카락 끝, 손가락 등)를 쳐낸다. */
export function prune(skel, w, h, dt, { minLength = 4, thicknessRatio = 1.2, rounds = 6 } = {}) {
  for (let round = 0; round < rounds; round++) {
    let removed = 0;
    const ends = [];
    for (let i = 0; i < skel.length; i++) if (isEnd(skel, i, w)) ends.push(i);
    for (const e of ends) {
      if (!skel[e]) continue;
      const path = [e];
      const seen = new Set(path);
      let cur = e;
      let junction = -1;
      for (;;) {
        const next = neighbors8(cur, w).filter((j) => skel[j] && !seen.has(j));
        if (next.length === 0) break;
        const fork = next.find((j) => isFork(skel, j, w));
        if (fork !== undefined) { junction = fork; break; }
        // 계단 모양 선은 한 걸음에 두 칸이 이웃일 수 있다: 둘 다 같은 가지로 본다.
        for (const j of next) { seen.add(j); path.push(j); }
        cur = next[next.length - 1];
        if (path.length > 4 * w) break;
      }
      if (junction < 0) continue;
      if (path.length < Math.max(minLength, thicknessRatio * dt[junction])) {
        for (const i of path) skel[i] = 0;
        removed++;
      }
    }
    if (!removed) break;
  }
  return skel;
}

/** 골격 위 BFS 최단 경로 (8방향). */
function bfsParents(skel, w, start) {
  const parent = new Int32Array(skel.length).fill(-2);
  const queue = new Int32Array(skel.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  parent[start] = -1;
  while (head < tail) {
    const i = queue[head++];
    for (const j of neighbors8(i, w)) {
      if (skel[j] && parent[j] === -2) { parent[j] = i; queue[tail++] = j; }
    }
  }
  return parent;
}

function pathTo(parent, target) {
  if (parent[target] === -2) return null;
  const path = [];
  for (let i = target; i !== -1; i = parent[i]) path.push(i);
  return path.reverse();
}

function commonPrefix(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k - 1;
}

function argBy(path, dt, from, to, better) {
  const a = Math.max(0, Math.min(path.length - 1, Math.round(from)));
  const b = Math.max(a, Math.min(path.length - 1, Math.round(to)));
  let best = a;
  for (let k = a; k <= b; k++) if (better(dt[path[k]], dt[path[best]])) best = k;
  return best;
}

function bbox(fg, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 아래가 잘린 구도(반신 기준) 비율. 팔은 만들지 않는다. */
function proportionalCut(box) {
  const { x, y, width: bw, height: bh } = box;
  const cx = x + bw / 2;
  const at = (fy) => ({ x: cx, y: y + fy * bh });
  const points = { root: at(1), body: at(0.999), upper: at(0.98), chest: at(0.7), neck: at(0.42), head: at(0.36), hair: at(0.15) };
  return { points, ends: { head_top: at(0) } };
}

/** 실루엣 박스 비율로 정면 A포즈 관절을 추정한다 (골격 실패 시 대체). */
export function proportionalJoints(box, frame = 'full') {
  if (frame === 'cut') return proportionalCut(box);
  const { x, y, width: bw, height: bh } = box;
  const cx = x + bw / 2;
  const at = (fx, fy) => ({ x: cx + fx * bw, y: y + fy * bh });
  const points = {
    root: { x: cx, y: y + bh },
    body: at(0, 0.5), upper: at(0, 0.485), pelvis: at(0, 0.515),
    chest: at(0, 0.3), neck: at(0, 0.2), head: at(0, 0.17), hair: at(0, 0.07),
    arm_left: at(-0.14, 0.23), elbow_left: at(-0.25, 0.36), wrist_left: at(-0.34, 0.5),
    arm_right: at(0.14, 0.23), elbow_right: at(0.25, 0.36), wrist_right: at(0.34, 0.5),
    hip_left: at(-0.07, 0.53), knee_left: at(-0.08, 0.72), ankle_left: at(-0.09, 0.9),
    hip_right: at(0.07, 0.53), knee_right: at(0.08, 0.72), ankle_right: at(0.09, 0.9),
  };
  const ends = {
    head_top: at(0, 0), hand_tip_left: at(-0.4, 0.56), hand_tip_right: at(0.4, 0.56),
    foot_tip_left: at(-0.1, 1), foot_tip_right: at(0.1, 1),
  };
  return { points, ends };
}

/**
 * 전경 마스크 → 골격 → 관절 후보.
 * - frame: 'full'(전신) | 'cut'(아래가 잘린 반신·흉상)
 * - 팔·다리는 따로 맞추고, 못 찾거나 상식에 어긋나면 그 부위만 비율로 채우거나(전신) 비운다(잘린 구도).
 * 반환 좌표는 입력 마스크(작업 해상도) 기준.
 */
export function fitJoints(fg, w, h) {
  const box = bbox(fg, w, h);
  const warnings = [];
  if (box.width <= 0) {
    return { method: 'empty', frame: 'full', ...proportionalJoints({ x: 0, y: 0, width: w, height: h }), skeleton: [], endpoints: [], missing: ['all'], warnings: ['전경이 없습니다.'] };
  }
  // 잘린 구도(반신·흉상) 판별: 전신은 키가 폭의 1.6배 이상이고, 잘린 그림은 아래 끝이 넓게 막혀 있다.
  // (반신은 손끝이 가장 아래라 아래 끝만으로는 알 수 없어 비율을 함께 본다.)
  let bottomRow = 0;
  const by = box.y + box.height - 3;
  for (let x = 0; x < w; x++) bottomRow += fg[by * w + x];
  const aspect = box.height / box.width;
  const frame = aspect < 1.6 || bottomRow > box.width * 0.35 ? 'cut' : 'full';

  const f = Math.max(1, Math.ceil(Math.max(w, h) / SKELETON_SIZE));
  const { mask: small, sw, sh } = downsample(fg, w, h, f);
  // 잘린 구도는 아래 테두리를 지우지 않도록 한 줄 여유를 둔다(세선화가 테두리를 0으로 만든다).
  const solid = fillHoles(largestComponent(closeGaps(small, sw, sh, 1), sw, sh), sw, sh);
  const inverse = new Uint8Array(sw * sh);
  for (let i = 0; i < inverse.length; i++) inverse[i] = solid[i] ? 0 : 1;
  const dt = distanceTransform(inverse, sw, sh);
  const skel = prune(thin(solid, sw, sh), sw, sh, dt);

  const toWork = (i) => ({ x: (i % sw) * f + f / 2, y: Math.floor(i / sw) * f + f / 2 });
  const P = toWork;
  const skeletonPoints = [];
  for (let i = 0; i < skel.length; i++) if (skel[i]) skeletonPoints.push(toWork(i));
  const prop = proportionalJoints(box, frame);
  const fallback = (reason) => {
    warnings.push(reason);
    return { method: 'proportional', frame, ...prop, skeleton: skeletonPoints, endpoints: [], missing: ['all'], warnings };
  };

  const ends = [];
  for (let i = 0; i < skel.length; i++) if (isEnd(skel, i, sw)) ends.push(i);
  if (!skeletonPoints.length) return fallback('골격을 만들지 못했습니다.');

  const sb = { x: box.x / f, y: box.y / f, width: box.width / f, height: box.height / f };
  const ex = (i) => i % sw;
  const ey = (i) => Math.floor(i / sw);
  const cx = sb.x + sb.width / 2;
  const relY = (i) => (ey(i) - sb.y) / sb.height;
  const larger = (a, b) => a > b;
  const smaller = (a, b) => a < b;

  // 머리 꼭대기: 위 30% 안의 가장 높은 끝점, 없으면 가장 높은 골격 점.
  let headTop = ends.filter((i) => relY(i) < 0.3).sort((a, b) => ey(a) - ey(b))[0];
  if (headTop === undefined) {
    for (let i = 0; i < skel.length; i++) if (skel[i]) { headTop = i; break; }
  }
  const parent = bfsParents(skel, sw, headTop);
  const reachable = (i) => parent[i] !== -2;
  const missing = [];
  const points = {};
  const endsOut = { head_top: { x: P(headTop).x, y: box.y } }; // x는 머리 관절을 찾은 뒤 맞춘다

  // 1) 몸통 축(spine)과 다리
  let spine = null;
  let crotch = -1;
  let feet = null;
  if (frame === 'full') {
    const feetCandidates = ends.filter((i) => relY(i) > 0.8 && reachable(i));
    const footL = feetCandidates.filter((i) => ex(i) < cx).sort((a, b) => ey(b) - ey(a))[0];
    const footR = feetCandidates.filter((i) => ex(i) >= cx).sort((a, b) => ey(b) - ey(a))[0];
    if (footL !== undefined && footR !== undefined) {
      const pL = pathTo(parent, footL);
      const pR = pathTo(parent, footR);
      const c = commonPrefix(pL, pR);
      const cy = relY(pL[c]);
      if (cy > 0.3 && cy < 0.75) { crotch = c; spine = pL.slice(0, c + 1); feet = { pL, pR, footL, footR }; }
      else warnings.push(`다리 갈림 높이(${Math.round(cy * 100)}%)가 이상해 다리는 비율로 채웠습니다.`);
    } else {
      warnings.push('양발 끝점을 찾지 못해(긴 치마 등) 다리는 비율로 채웠습니다.');
    }
  }
  if (!spine) {
    // 잘린 구도: 맨 아래 가운데, 전신(다리 실패): 높이 55% 가운데에 가장 가까운 골격 점까지.
    const targetY = frame === 'cut' ? sh : sb.y + sb.height * 0.55;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < skel.length; i++) {
      if (!skel[i] || !reachable(i)) continue;
      if (Math.abs(ex(i) - cx) > sb.width * 0.2) continue;
      const d = Math.abs(ey(i) - targetY) * 2 + Math.abs(ex(i) - cx);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return fallback('몸통 중심선을 찾지 못했습니다.');
    spine = pathTo(parent, best);
  }
  if (spine.length < 8) return fallback('몸통 중심선이 너무 짧습니다.');

  // 머리 원: 몸통 축 위쪽 40%에서 가장 두꺼운 곳. 팔은 이 원 아래에서 갈라져야 한다(옆머리 끝 ≠ 손).
  // 위에서부터 두께가 커지다가 목에서 25% 이상 줄어들기 직전의 최대점 = 머리 중심.
  let headIdx = -1;
  {
    let runMax = 0;
    let runIdx = 0;
    for (let k = 0; k < spine.length * 0.6; k++) {
      const v = dt[spine[k]];
      if (v > runMax) { runMax = v; runIdx = k; }
      else if (runMax > 3 && v < runMax * 0.75) { headIdx = runIdx; break; }
    }
    if (headIdx < 0) headIdx = argBy(spine, dt, 0, spine.length * 0.4, larger);
  }
  const headBottomY = ey(spine[headIdx]) + dt[spine[headIdx]];

  // 2) 팔: 몸통 축에서 일찍 갈라지고, 몸 중심에서 충분히 떨어진 끝점만 손으로 인정한다.
  const used = new Set([headTop, feet?.footL, feet?.footR]);
  const handLimit = frame === 'full' ? 0.8 : 1.01;
  const handBand = ends.filter((i) => !used.has(i) && reachable(i) && relY(i) > 0.12 && relY(i) < handLimit);
  const arms = {};
  for (const side of ['left', 'right']) {
    const pool = handBand.filter((i) => (side === 'left' ? ex(i) < cx - sb.width * 0.08 : ex(i) > cx + sb.width * 0.08))
      .sort((a, b) => (side === 'left' ? ex(a) - ex(b) : ex(b) - ex(a)));
    let found = null;
    for (const hand of pool) {
      const path = pathTo(parent, hand);
      const branch = commonPrefix(path, spine);
      const limbLen = path.length - branch;
      const maxBranch = frame === 'full' ? (crotch > 0 ? crotch * 0.6 : spine.length * 0.7) : spine.length * 0.85;
      if (branch > maxBranch) { warnings.push(`${side === 'left' ? '화면 왼쪽' : '화면 오른쪽'} 손 후보가 허리 아래에서 갈라져 팔이 아닌 것으로 봤습니다(치마 끝 등).`); continue; }
      if (limbLen < sb.height * 0.12) continue;
      if (ey(path[branch]) < headBottomY) { warnings.push('머리 옆 끝점(머리카락 등)은 손으로 보지 않았습니다.'); continue; }
      found = { hand, path, branch };
      break;
    }
    if (found) arms[side] = found;
  }

  // 3) 머리·목
  const armBranches = Object.values(arms).map((a) => a.branch);
  const shoulderIdx = armBranches.length ? Math.min(...armBranches)
    : Math.max(4, spine.findIndex((i) => relY(i) >= (frame === 'full' ? 0.22 : 0.55)));
  const limit = shoulderIdx > 0 ? shoulderIdx : spine.length - 1;
  const headCenter = argBy(spine, dt, 0, limit * 0.7, larger);
  const neckMin = argBy(spine, dt, headCenter, limit, smaller);
  const thinR = dt[spine[neckMin]];
  let chin = neckMin;
  while (chin > headCenter && dt[spine[chin]] < thinR * 1.2) chin--;
  let collar = neckMin;
  while (collar < limit && dt[spine[collar]] < thinR * 1.5) collar++;
  points.head = P(spine[chin]);
  points.neck = P(spine[collar]);
  points.hair = { x: points.head.x, y: box.y + (points.head.y - box.y) * 0.45 };
  endsOut.head_top = { x: points.head.x, y: box.y };

  // 4) 몸통
  const torsoEnd = crotch > 0 ? crotch : spine.length - 1;
  const torsoLen = Math.max(1, torsoEnd - collar);
  const offset = box.height * 0.015;
  points.chest = P(spine[collar + Math.round(torsoLen * (frame === 'cut' ? 0.4 : 0.3))]);
  const body = frame === 'cut' ? { x: P(spine[torsoEnd]).x, y: h - 1 } : P(spine[collar + Math.round(torsoLen * 0.75)]);
  points.body = body;
  points.upper = { x: body.x, y: body.y - offset };
  if (frame === 'full') points.pelvis = { x: body.x, y: body.y + offset };

  // 5) 팔 관절
  const fitArm = ({ path, branch, hand }, side) => {
    const limb = path.slice(branch);
    const n = limb.length;
    const mid = [];
    for (let k = Math.round(n * 0.3); k <= Math.round(n * 0.7); k++) mid.push(dt[limb[k]]);
    mid.sort((a, b) => a - b);
    const armR = mid[mid.length >> 1] || 1;
    // 어깨: 갈림점→손끝 직선에서 가장 멀리 꺾이는 곳(A포즈의 어깨 모서리).
    // 꺾임이 거의 없으면(T포즈) 몸통 두께가 팔 두께로 줄어드는 곳.
    const a = limb[0];
    const b = limb[n - 1];
    const ax = a % sw, ay = Math.floor(a / sw), bx = b % sw, by = Math.floor(b / sw);
    const chord = Math.hypot(bx - ax, by - ay) || 1;
    let s = 0;
    let bend = 0;
    for (let k = 0; k < n * 0.6; k++) {
      const px = limb[k] % sw, py = Math.floor(limb[k] / sw);
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / chord;
      if (d > bend) { bend = d; s = k; }
    }
    if (bend < armR) {
      s = 0;
      while (s < n - 1 && dt[limb[s]] > armR * 1.4) s++;
    }
    const len = n - s;
    const wrist = argBy(limb, dt, s + len * 0.65, s + len * 0.9, smaller);
    const elbow = Math.round((s + wrist) / 2);
    points[`arm_${side}`] = P(limb[s]);
    points[`elbow_${side}`] = P(limb[elbow]);
    points[`wrist_${side}`] = P(limb[wrist]);
    endsOut[`hand_tip_${side}`] = P(hand);
  };
  for (const side of ['left', 'right']) {
    if (arms[side]) fitArm(arms[side], side);
    else {
      missing.push(`arm_${side}`);
      if (frame === 'full') {
        for (const id of [`arm_${side}`, `elbow_${side}`, `wrist_${side}`]) points[id] = prop.points[id];
        endsOut[`hand_tip_${side}`] = prop.ends[`hand_tip_${side}`];
        warnings.push(`${side === 'left' ? '화면 왼쪽' : '화면 오른쪽'} 팔을 골격에서 찾지 못해 비율로 채웠습니다(팔짱·몸에 붙은 팔 등). 관절을 직접 옮겨주세요.`);
      } else {
        // 잘린 구도(흉상)에서 팔이 없는 것은 정상이라 실패로 세지 않는다.
        missing.pop();
        warnings.push(`${side === 'left' ? '화면 왼쪽' : '화면 오른쪽'} 팔이 보이지 않아 팔 관절을 만들지 않았습니다.`);
      }
    }
  }

  // 6) 다리
  if (frame === 'full') {
    if (feet) {
      const fitLeg = (path, side) => {
        const limb = path.slice(crotch);
        const n = limb.length;
        const hip = Math.round(n * 0.12);
        const ankle = argBy(limb, dt, n * 0.78, n * 0.95, smaller);
        const knee = Math.round((hip + ankle) / 2);
        points[`hip_${side}`] = { x: P(limb[hip]).x, y: P(spine[crotch]).y - offset };
        points[`knee_${side}`] = P(limb[knee]);
        points[`ankle_${side}`] = P(limb[ankle]);
      };
      fitLeg(feet.pL, 'left');
      fitLeg(feet.pR, 'right');
      endsOut.foot_tip_left = P(feet.footL);
      endsOut.foot_tip_right = P(feet.footR);
    } else {
      missing.push('legs');
      for (const id of ['hip_left', 'knee_left', 'ankle_left', 'hip_right', 'knee_right', 'ankle_right']) points[id] = prop.points[id];
      endsOut.foot_tip_left = prop.ends.foot_tip_left;
      endsOut.foot_tip_right = prop.ends.foot_tip_right;
    }
    points.root = { x: (endsOut.foot_tip_left.x + endsOut.foot_tip_right.x) / 2, y: box.y + box.height };
  } else {
    points.root = { x: body.x, y: h - 1 };
  }

  // 7) 상식 검사 (실패해도 결과는 쓰되 경고)
  const checks = [];
  const order = ['hair', 'head', 'neck', 'chest', 'body'].filter((id) => points[id]);
  checks.push({ id: 'spine-order', ok: order.every((id, k) => k === 0 || points[order[k - 1]].y < points[id].y), message: '머리카락→턱→목→가슴→허리가 위에서 아래 순서' });
  if (points.arm_left && points.arm_right && !missing.includes('arm_left') && !missing.includes('arm_right')) {
    checks.push({ id: 'shoulder-level', ok: Math.abs(points.arm_left.y - points.arm_right.y) < box.height * 0.08, message: '양 어깨 높이가 비슷함' });
  }
  for (const side of ['left', 'right']) {
    if (!points[`arm_${side}`] || missing.includes(`arm_${side}`)) continue;
    checks.push({ id: `shoulder-${side}`, ok: points[`arm_${side}`].y > points.head.y && points[`arm_${side}`].y < (points.pelvis || points.body).y, message: '어깨가 턱과 허리 사이' });
  }
  for (const c of checks) if (!c.ok) warnings.push(`상식 검사 실패: ${c.message}`);

  const method = missing.length ? 'partial' : 'skeleton';
  const unique = [...new Set(warnings)];
  warnings.length = 0;
  warnings.push(...unique);
  return { method, frame, points, ends: endsOut, skeleton: skeletonPoints, endpoints: ends.map(P), missing, checks, warnings };
}
