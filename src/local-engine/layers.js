// 파츠 → 리깅용 레이어 (모델 없음).
// 1) 얼굴에서 눈썹·속눈썹·눈동자·흰자·입·코를 떼어 fake 3D용 레이어로 만든다.
// 2) 앞 파츠에 가려진 곳(소매 밑 팔, 반바지 밑 허벅지, 앞머리 밑 이마, 턱 밑 목 …)을
//    같은 파츠의 보이는 색에서 번져 채운다(가장 가까운 색 + 평활).
// 3) 얼굴 뒤를 채운 뒷머리(back_hair)를 만든다.
// 4) 레이어를 다시 합성해 원본과 비교한다(채운 곳이 밖으로 보이면 실패).
// 레이어 이름은 layer-studio의 규칙(face-rig.js, rig-core.js)을 따른다. _r = 화면 왼쪽.

import { distanceTransform } from './segment-core.js';

const lum = (d, i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
const rgbDist = (d, i, c) => Math.hypot(d[i * 4] - c[0], d[i * 4 + 1] - c[1], d[i * 4 + 2] - c[2]);

function dilate(mask, w, h, r) {
  if (r <= 0) return Uint8Array.from(mask);
  const d = distanceTransform(mask, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}

function erode(mask, w, h, r) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = distanceTransform(inv, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > r ? 1 : 0;
  return out;
}

const and = (a, b) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && b[i] ? 1 : 0; return o; };
const or = (...ms) => { const o = new Uint8Array(ms[0].length); for (const m of ms) if (m) for (let i = 0; i < o.length; i++) if (m[i]) o[i] = 1; return o; };
const minus = (a, b) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && !b[i] ? 1 : 0; return o; };
const count = (m) => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };

function bboxOf(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** 8방향 연결 덩어리. */
function components(mask, w, h) {
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const out = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = out.length + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = id;
    let sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !label[j]) { label[j] = id; queue[tail++] = j; }
        }
      }
    }
    out.push({ id, area: tail, cx: sx / tail, cy: sy / tail, x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  return { label, list: out };
}

function fillHolesMask(mask, w, h) {
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

/** 가장 흔한 색(4비트 양자화 최빈 칸의 평균). */
function dominantColor(data, mask) {
  const bins = new Map();
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || data[i * 4 + 3] < 200) continue;
    const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
    const b = bins.get(key) || [0, 0, 0, 0];
    b[0] += data[i * 4]; b[1] += data[i * 4 + 1]; b[2] += data[i * 4 + 2]; b[3]++;
    bins.set(key, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : [200, 200, 200];
}

/**
 * target 픽셀을 source 픽셀 색으로 채운다 (피라미드 push-pull 보간).
 * source 색을 2배씩 줄여 가며 평균 낸 뒤 다시 키우면서 빈 곳을 채우므로,
 * 가까운 색은 또렷하게, 먼 곳은 부드러운 그라데이션으로 이어진다. 결과는 out(RGBA, 전체 캔버스)에 쓴다.
 */
export function diffuseFill(data, w, h, source, target, out, { darken = 1 } = {}) {
  // source와 target을 모두 담는 박스만 계산한다.
  let x0 = w, y0 = h, x1 = -1, y1 = -1, any = 0;
  for (let i = 0; i < w * h; i++) {
    if (!source[i] && !target[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (target[i]) any++;
  }
  if (!any) return 0;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const levels = [];
  let lw = bw;
  let lh = bh;
  let col = new Float32Array(lw * lh * 3);
  let wt = new Float32Array(lw * lh);
  let known = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0;
      if (!source[i]) continue;
      const k = y * bw + x;
      col[k * 3] = data[i * 4]; col[k * 3 + 1] = data[i * 4 + 1]; col[k * 3 + 2] = data[i * 4 + 2];
      wt[k] = 1;
      known++;
    }
  }
  if (!known) return 0;
  levels.push({ col, wt, lw, lh });
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, Math.ceil(lw / 2));
    const nh = Math.max(1, Math.ceil(lh / 2));
    const ncol = new Float32Array(nw * nh * 3);
    const nwt = new Float32Array(nw * nh);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const k = y * lw + x;
        if (!wt[k]) continue;
        const nk = (y >> 1) * nw + (x >> 1);
        ncol[nk * 3] += col[k * 3] * wt[k]; ncol[nk * 3 + 1] += col[k * 3 + 1] * wt[k]; ncol[nk * 3 + 2] += col[k * 3 + 2] * wt[k];
        nwt[nk] += wt[k];
      }
    }
    for (let k = 0; k < nw * nh; k++) {
      if (!nwt[k]) continue;
      ncol[k * 3] /= nwt[k]; ncol[k * 3 + 1] /= nwt[k]; ncol[k * 3 + 2] /= nwt[k];
      nwt[k] = Math.min(1, nwt[k]);
    }
    col = ncol; wt = nwt; lw = nw; lh = nh;
    levels.push({ col, wt, lw, lh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const cur = levels[l];
    const up = levels[l + 1];
    for (let y = 0; y < cur.lh; y++) {
      for (let x = 0; x < cur.lw; x++) {
        const k = y * cur.lw + x;
        const a = cur.wt[k];
        if (a >= 1) continue;
        // 위 단계에서 쌍선형 보간
        const fx = Math.min(up.lw - 1, Math.max(0, (x - 0.5) / 2));
        const fy = Math.min(up.lh - 1, Math.max(0, (y - 0.5) / 2));
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const ix1 = Math.min(up.lw - 1, ix + 1), iy1 = Math.min(up.lh - 1, iy + 1);
        for (let c = 0; c < 3; c++) {
          const v = (up.col[(iy * up.lw + ix) * 3 + c] * (1 - tx) + up.col[(iy * up.lw + ix1) * 3 + c] * tx) * (1 - ty) +
            (up.col[(iy1 * up.lw + ix) * 3 + c] * (1 - tx) + up.col[(iy1 * up.lw + ix1) * 3 + c] * tx) * ty;
          cur.col[k * 3 + c] = cur.col[k * 3 + c] * a + v * (1 - a);
        }
        cur.wt[k] = 1;
      }
    }
  }
  const base = levels[0];
  let filled = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0;
      if (!target[i]) continue;
      const k = y * bw + x;
      out[i * 4] = base.col[k * 3] * darken;
      out[i * 4 + 1] = base.col[k * 3 + 1] * darken;
      out[i * 4 + 2] = base.col[k * 3 + 2] * darken;
      out[i * 4 + 3] = 255;
      filled++;
    }
  }
  return filled;
}

/** 얼굴 안의 눈·눈썹·입·코를 찾는다. 반환: 이름 → 마스크. */
export function faceDetails(data, w, h, faceMask, lineMask) {
  const area = count(faceMask);
  const fb = bboxOf(faceMask, w, h);
  if (!fb || area < 400) return { details: {}, skin: null, notes: ['얼굴 파츠가 작아 세부를 나누지 않았습니다.'] };
  const skin = dominantColor(data, faceMask);
  const inner = erode(faceMask, w, h, Math.max(2, fb.width * 0.03));
  const nonSkin = new Uint8Array(w * h);
  for (let i = 0; i < nonSkin.length; i++) if (inner[i] && rgbDist(data, i, skin) > 45) nonSkin[i] = 1;
  const grouped = and(dilate(nonSkin, w, h, Math.max(1.5, fb.width * 0.012)), faceMask);
  const { label, list } = components(grouped, w, h);
  const rel = (c) => ({ fx: (c.cx - fb.x) / fb.width, fy: (c.cy - fb.y) / fb.height });
  const comps = list.filter((c) => c.area >= area * 0.0006);
  const maskOf = (c) => {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) if (label[i] === c.id && nonSkin[i]) m[i] = 1;
    return fillHolesMask(m, w, h);
  };
  const notes = [];
  const eyes = {};
  for (const side of ['r', 'l']) {
    const pool = comps.filter((c) => {
      const { fx, fy } = rel(c);
      return fy > 0.12 && fy < 0.78 && (side === 'r' ? fx < 0.45 : fx > 0.55) && c.area >= area * 0.003;
    }).sort((a, b) => b.area - a.area);
    if (pool[0]) eyes[side] = pool[0];
  }
  if (eyes.r && eyes.l && Math.abs(eyes.r.cy - eyes.l.cy) > fb.height * 0.15) {
    notes.push('두 눈 높이가 많이 달라 작은 쪽 눈은 버렸습니다.');
    if (eyes.r.area < eyes.l.area) delete eyes.r; else delete eyes.l;
  }
  const details = {};
  const taken = new Set(Object.values(eyes).map((c) => c.id));
  for (const [side, c] of Object.entries(eyes)) {
    const eye = maskOf(c);
    // 흰자: 밝고 채도 낮은 픽셀. 나머지에서 가는 선(속눈썹)을 열림 연산으로 걷어낸 가장 큰 덩어리 = 눈동자.
    const white = new Uint8Array(w * h);
    for (let i = 0; i < eye.length; i++) {
      if (!eye[i]) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (lum(data, i) > 175 && Math.max(r, g, b) - Math.min(r, g, b) < 55) white[i] = 1;
    }
    const rest = minus(eye, white);
    const r0 = Math.max(1, c.height * 0.12);
    const opened = dilate(erode(rest, w, h, r0), w, h, r0);
    const blobs = components(and(opened, rest), w, h);
    const iris = blobs.list.sort((a, b) => b.area - a.area)[0];
    let irides = new Uint8Array(w * h);
    if (iris && iris.area > c.area * 0.08) {
      for (let i = 0; i < irides.length; i++) if (blobs.label[i] === iris.id) irides[i] = 1;
      irides = and(fillHolesMask(irides, w, h), eye); // 동공 하이라이트까지
    } else notes.push(`${side === 'r' ? '화면 왼쪽' : '화면 오른쪽'} 눈동자를 찾지 못했습니다.`);
    const lashes = minus(rest, irides);
    details[`eyelash_${side}`] = lashes;
    details[`irides_${side}`] = irides;
    details[`eyewhite_${side}`] = minus(eye, or(lashes, irides));
    details[`_eye_${side}`] = eye;
    // 눈썹: 눈 위쪽, 같은 편, 가로로 긴 덩어리 중 가장 가까운 것.
    const brow = comps.filter((b) => !taken.has(b.id) && b.cy < c.y && b.cy > c.y - c.height * 2.5 &&
      Math.abs(b.cx - c.cx) < c.width && b.width > b.height * 1.3).sort((a, b) => b.cy - a.cy)[0];
    if (brow) { taken.add(brow.id); details[`eyebrow_${side}`] = maskOf(brow); }
  }
  const eyeBottom = Math.max(...Object.values(eyes).map((c) => c.y + c.height), fb.y + fb.height * 0.45);
  const mouth = comps.filter((c) => !taken.has(c.id) && c.cy > eyeBottom + fb.height * 0.06 && Math.abs(rel(c).fx - 0.5) < 0.2)
    .sort((a, b) => b.area - a.area)[0];
  if (mouth) { taken.add(mouth.id); details.mouth = maskOf(mouth); }
  const nose = comps.filter((c) => !taken.has(c.id) && c.cy > eyeBottom - fb.height * 0.05 && (!mouth || c.cy < mouth.y) && Math.abs(rel(c).fx - 0.5) < 0.12)
    .sort((a, b) => b.area - a.area)[0];
  if (nose) { taken.add(nose.id); details.nose = maskOf(nose); }
  if (!eyes.r && !eyes.l) notes.push('눈을 찾지 못해 얼굴 세부는 나누지 않았습니다.');
  return { details, skin, notes };
}

// 앞→뒤 그리기 순서 (layer-studio는 0번이 가장 앞).
const ORDER = [
  'front_hair', 'eyebrow_r', 'eyebrow_l', 'eyelash_r', 'eyelash_l', 'irides_r', 'irides_l', 'eyewhite_r', 'eyewhite_l',
  'mouth', 'nose', 'face',
  'sleeve_r', 'sleeve_l', 'arm_r', 'arm_l', 'topwear', 'bottomwear', 'neck',
  'footwear_r', 'footwear_l', 'legwear_r', 'legwear_l', 'back_hair',
];

/**
 * 레이어 만들기.
 * @returns {{ layers: Array<{name,x,y,width,height,data,filled}>, report: object, notes: string[] }}
 */
export function buildLayers(data, w, h, seg, rig, partsResult) {
  const { partLabels, parts } = partsResult;
  const notes = [];
  const box = bboxOf(seg.fg, w, h) || { x: 0, y: 0, width: w, height: h };
  const H = box.height;
  const mask = {};
  for (const p of parts) {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) if (partLabels[i] === p.id) m[i] = 1;
    mask[p.name === 'hair' ? 'front_hair' : p.name] = m;
  }
  const empty = new Uint8Array(w * h);
  const get = (name) => mask[name] || empty;

  // 1) 얼굴 세부
  const visible = { ...mask };
  const fills = {}; // 이름 → { target, source, opts }
  if (mask.face) {
    const { details, notes: faceNotes } = faceDetails(data, w, h, mask.face, seg.line);
    notes.push(...faceNotes);
    let removed = new Uint8Array(w * h);
    for (const [name, m] of Object.entries(details)) {
      if (name.startsWith('_') || count(m) < 4) continue;
      visible[name] = m;
      removed = or(removed, m);
    }
    visible.face = minus(mask.face, removed);
    // 얼굴: 세부 자리 + 앞머리 밑(이마·옆얼굴)을 피부로
    const faceBox = bboxOf(mask.face, w, h);
    const under = and(get('front_hair'), dilate(mask.face, w, h, faceBox.width * 0.15));
    fills.face = { target: or(and(dilate(removed, w, h, 1), mask.face), under), source: visible.face };
    // 흰자: 눈동자·속눈썹 밑을 흰자로 (눈동자가 움직여도 비지 않게)
    for (const side of ['r', 'l']) {
      const eye = details[`_eye_${side}`];
      if (!eye || !visible[`eyewhite_${side}`] || count(visible[`eyewhite_${side}`]) < 4) continue;
      fills[`eyewhite_${side}`] = { target: or(visible[`irides_${side}`] || empty, visible[`eyelash_${side}`] || empty), source: visible[`eyewhite_${side}`] };
    }
    // 뒷머리: 머리카락 가로 범위 안, 턱 위의 얼굴 뒤를 머리색(조금 어둡게)으로
    if (mask.front_hair && rig.points.head) {
      const hairBox = bboxOf(mask.front_hair, w, h);
      const chinY = rig.points.head.y;
      const target = new Uint8Array(w * h);
      for (let y = hairBox.y; y < Math.min(h, chinY); y++) {
        let x0 = -1, x1 = -1;
        for (let x = 0; x < w; x++) if (mask.front_hair[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; }
        if (x0 < 0) continue;
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (seg.fg[i] && !mask.front_hair[i]) target[i] = 1;
        }
      }
      if (count(target) > 50) {
        visible.back_hair = new Uint8Array(w * h);
        fills.back_hair = { target, source: mask.front_hair, opts: { darken: 0.85 } };
      }
    }
  }

  // 2) 몸 파츠의 가려진 곳 (뒤 ← 앞, 앞 파츠 안에서 뒤 파츠로부터 거리 D 이내)
  const near = (back, fronts, D) => and(or(...fronts.map(get)), dilate(get(back), w, h, D));
  const add = (name, target) => {
    if (!mask[name]) return;
    fills[name] = { target: fills[name] ? or(fills[name].target, target) : target, source: visible[name] || mask[name] };
  };
  const neckBox = mask.neck ? bboxOf(mask.neck, w, h) : null;
  if (mask.neck) add('neck', near('neck', ['face', 'front_hair', 'topwear'], Math.min(H * 0.06, Math.max(H * 0.03, neckBox.width * 0.15))));
  add('topwear', near('topwear', ['sleeve_r', 'sleeve_l', 'arm_r', 'arm_l', 'front_hair'], H * 0.04));
  for (const s of ['r', 'l']) add(`arm_${s}`, near(`arm_${s}`, [`sleeve_${s}`], H * 0.035));
  add('bottomwear', near('bottomwear', ['topwear'], H * 0.03));
  for (const s of ['r', 'l']) add(`legwear_${s}`, near(`legwear_${s}`, ['bottomwear', `footwear_${s}`], H * 0.06));

  // 3) 레이어 픽셀 (채우기는 원본이 완전히 불투명한 곳 밑에만: 반투명 외곽선 밑을 채우면 밖으로 비친다)
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < opaque.length; i++) opaque[i] = data[i * 4 + 3] >= 250 ? 1 : 0;
  // 채울 색의 출처: 선화·테두리를 뺀, 파츠 주색에 가까운 픽셀만 (검은 외곽선이 번지면 줄무늬가 생긴다).
  const cleanSource = (m) => {
    const base = dominantColor(data, m);
    const inner = erode(m, w, h, 1.5);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) if (inner[i] && !seg.line[i] && opaque[i] && rgbDist(data, i, base) < 70) out[i] = 1;
    return out;
  };
  const layers = [];
  const names = ORDER.filter((n) => visible[n]).concat(Object.keys(visible).filter((n) => !ORDER.includes(n) && !n.startsWith('_')));
  for (const name of names) {
    const full = new Uint8ClampedArray(w * h * 4);
    const vis = visible[name];
    for (let i = 0; i < vis.length; i++) {
      if (!vis[i]) continue;
      full[i * 4] = data[i * 4]; full[i * 4 + 1] = data[i * 4 + 1]; full[i * 4 + 2] = data[i * 4 + 2]; full[i * 4 + 3] = data[i * 4 + 3];
    }
    let filled = 0;
    const f = fills[name];
    if (f) {
      const src = cleanSource(f.source);
      filled = diffuseFill(data, w, h, count(src) > 20 ? src : f.source, and(minus(f.target, vis), opaque), full, f.opts);
    }
    // 잘라내기
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) {
      if (!full[i * 4 + 3]) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) continue;
    const lw = x1 - x0 + 1;
    const lh = y1 - y0 + 1;
    const cropped = new Uint8ClampedArray(lw * lh * 4);
    for (let y = 0; y < lh; y++) cropped.set(full.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * lw * 4);
    layers.push({ name, x: x0, y: y0, width: lw, height: lh, data: cropped, filled, visible: count(vis) });
  }

  // 4) 재합성 검사
  const comp = composite(layers, w, h);
  let bad = 0;
  let fgCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (!seg.fg[i]) continue;
    fgCount++;
    const a = data[i * 4 + 3] / 255;
    const ca = comp[i * 4 + 3] / 255;
    const diff = Math.max(
      Math.abs(data[i * 4] * a - comp[i * 4] * ca), Math.abs(data[i * 4 + 1] * a - comp[i * 4 + 1] * ca),
      Math.abs(data[i * 4 + 2] * a - comp[i * 4 + 2] * ca), Math.abs(data[i * 4 + 3] - comp[i * 4 + 3]));
    if (diff > 24) bad++;
  }
  const recompositeError = fgCount ? bad / fgCount : 0;
  return { layers, notes, recompositeError };
}

/** 레이어 목록(앞→뒤)을 뒤에서부터 덮어 합성한다. */
export function composite(layers, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let k = layers.length - 1; k >= 0; k--) {
    const l = layers[k];
    for (let y = 0; y < l.height; y++) {
      for (let x = 0; x < l.width; x++) {
        const s = (y * l.width + x) * 4;
        const a = l.data[s + 3] / 255;
        if (!a) continue;
        const d = ((y + l.y) * w + x + l.x) * 4;
        const da = out[d + 3] / 255;
        const oa = a + da * (1 - a);
        for (let c = 0; c < 3; c++) out[d + c] = (l.data[s + c] * a + out[d + c] * da * (1 - a)) / (oa || 1);
        out[d + 3] = oa * 255;
      }
    }
  }
  return out;
}
