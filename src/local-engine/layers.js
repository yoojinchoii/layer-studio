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

/** 마스크가 같은 줄 좌우 또는 같은 열 위아래에서 감싸는 빈 자리 (마스크 자신은 제외). */
export function enclosedBy(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (first < 0) first = x; last = x; }
    for (let x = first + 1; x < last; x++) if (!mask[y * w + x]) out[y * w + x] = 1;
  }
  for (let x = 0; x < w; x++) {
    let first = -1, last = -1;
    for (let y = 0; y < h; y++) if (mask[y * w + x]) { if (first < 0) first = y; last = y; }
    for (let y = first + 1; y < last; y++) if (!mask[y * w + x]) out[y * w + x] = 1;
  }
  return out;
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

/**
 * 앞 파츠 밑으로 이어지는 뒤 파츠의 "연장" 모양 (소매 밑 어깨, 반바지 밑 허벅지, 턱 밑 목 …).
 * 두 파츠가 닿는 선(접합선)마다 방향을 구해 뒤 파츠의 폭 그대로 앞 파츠 밑으로 밀어 넣고, 끝은 둥글게,
 * 투명도는 접합선에서 멀어질수록 서서히 0으로 줄인다(관절을 돌렸을 때 잘린 티가 나지 않게).
 * 거리만으로 넓히면 앞 파츠 모양대로 각진 덩어리가 생기고 옆으로 삐져나온다.
 * @returns {{target:Uint8Array, alpha:Float32Array}}
 */
export function extendUnder(back, front, w, h, maxDepth, { depthScale = 1.5, fade = 0.45 } = {}) {
  const target = new Uint8Array(w * h), alpha = new Float32Array(w * h);
  const joint = and(back, dilate(front, w, h, 1.5));
  if (count(joint) < 4) return { target, alpha };
  const { label, list } = components(dilate(joint, w, h, 2), w, h);
  for (const c of list) {
    if (c.area < 8) continue;
    // 접합선 픽셀의 주축(PCA): t = 선 방향, n = 연장 방향
    let n0 = 0, mx = 0, my = 0;
    for (let i = 0; i < w * h; i++) if (joint[i] && label[i] === c.id) { const x = i % w; mx += x; my += (i - x) / w; n0++; }
    if (n0 < 4) continue;
    mx /= n0; my /= n0;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < w * h; i++) if (joint[i] && label[i] === c.id) { const x = i % w - mx, y = (i - (i % w)) / w - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const tx = Math.cos(ang), ty = Math.sin(ang);
    let nx = -ty, ny = tx;
    let a0 = Infinity, a1 = -Infinity;
    for (let i = 0; i < w * h; i++) if (joint[i] && label[i] === c.id) { const v = (i % w - mx) * tx + ((i - (i % w)) / w - my) * ty; if (v < a0) a0 = v; if (v > a1) a1 = v; }
    const hw = Math.max(2, (a1 - a0) / 2), mid = (a0 + a1) / 2;
    // 뒤 파츠 쪽의 반대가 연장 방향
    let side = 0;
    const R = hw * 2;
    for (let y = Math.max(0, Math.floor(my - R)); y < Math.min(h, my + R); y++) for (let x = Math.max(0, Math.floor(mx - R)); x < Math.min(w, mx + R); x++) {
      const i = y * w + x;
      if (back[i] && !joint[i]) side += (x - mx) * nx + (y - my) * ny;
    }
    if (side > 0) { nx = -nx; ny = -ny; }
    const D = Math.min(maxDepth, Math.max(6, hw * depthScale)), cap = Math.min(D, hw * 0.9);
    const ext = D + hw + 2;
    for (let y = Math.max(0, Math.floor(my - ext)); y < Math.min(h, my + ext); y++) for (let x = Math.max(0, Math.floor(mx - ext)); x < Math.min(w, mx + ext); x++) {
      const i = y * w + x;
      if (!front[i] || back[i]) continue;
      const u = (x - mx) * nx + (y - my) * ny, v = (x - mx) * tx + (y - my) * ty - mid;
      if (u < -2 || u > D) continue;
      const k = u <= D - cap ? 1 : Math.sqrt(Math.max(0, 1 - ((u - (D - cap)) / cap) ** 2));
      const lim = hw * k;
      if (Math.abs(v) > lim + 1) continue;
      const t = clamp01((u / D - fade) / (1 - fade));
      const a = (1 - t * t * (3 - 2 * t)) * clamp01(lim + 1 - Math.abs(v));
      if (a <= 0.02) continue;
      target[i] = 1;
      if (a > alpha[i]) alpha[i] = a;
    }
  }
  return { target, alpha };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 닫힘(팽창 후 침식): 마스크의 오목한 곳(소매가 파고든 겨드랑이 등)을 둥글게 메운다. */
function closeMask(mask, w, h, r) {
  return erode(dilate(mask, w, h, r), w, h, r);
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
  'front_hair', 'eyebrow_r', 'eyebrow_l', 'eyelash_r', 'eyelash_l', 'eyelash_lower_r', 'eyelash_lower_l', 'irides_r', 'irides_l', 'eyewhite_r', 'eyewhite_l',
  'mouth', 'nose', 'face',
  'handwear', 'sleeve_r', 'sleeve_l', 'arm_r', 'arm_l', 'topwear', 'bottomwear', 'neck',
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
  const eyeOpen = {}; // 눈 뜬 자리(흰자+눈동자+속눈썹), 눈꺼풀 만들 때 쓴다
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
      if (eye) eyeOpen[side] = { eye, open: or(details[`eyewhite_${side}`] || empty, details[`irides_${side}`] || empty) };
      // 아래 속눈썹(눈 가운데보다 아래)은 따로: 위 눈꺼풀과 함께 내려가면 볼 위로 떨어진다.
      // 눈 위를 지나는 머리카락 가닥이 속눈썹으로 잡히면 앞머리로 돌려보낸다(눈꺼풀과 같이 내려오지 않게).
      if (visible[`eyelash_${side}`] && mask.front_hair) {
        const hair = dominantColor(data, mask.front_hair), lashMask = visible[`eyelash_${side}`], back = new Uint8Array(w * h);
        // 앞머리와 맞닿은 머리카락색 조각만 (속눈썹 가장자리의 갈색 섞인 픽셀은 그대로 둔다)
        const touch = dilate(mask.front_hair, w, h, 2);
        for (let i = 0; i < back.length; i++) if (lashMask[i] && touch[i] && rgbDist(data, i, hair) < 50 && lum(data, i) > 60) back[i] = 1;
        // 눈 뜬 자리 맨 위보다 한참 위(흰자 높이의 35% 넘게)나 눈 양옆 멀리 있는 조각 중 앞머리에 붙은 것은 머리카락 윤곽선
        const open = eyeOpen[side]?.open, ob = open && bboxOf(open, w, h), toFace = new Uint8Array(w * h);
        if (ob) {
          const margin = ob.width * 0.25, tops = new Int32Array(w).fill(-1);
          for (let x = ob.x; x < ob.x + ob.width; x++) for (let y = ob.y; y < ob.y + ob.height; y++) if (open[y * w + x]) { tops[x] = y; break; }
          for (let i = 0; i < back.length; i++) {
            if (!lashMask[i]) continue;
            const x = i % w, y = (i - x) / w;
            if (back[i]) continue;
            if (x < ob.x - margin || x >= ob.x + ob.width + margin) { toFace[i] = 1; continue; }
            const t = tops[Math.min(ob.x + ob.width - 1, Math.max(ob.x, x))];
            if (t >= 0 && t - y > ob.height * 0.35) toFace[i] = 1;
          }
        }
        if (count(toFace)) {
          // 앞머리 가까이(4px)의 조각만 앞머리 가닥의 윤곽선으로 보고 앞머리로. 나머지(눈꼬리 등)는 속눈썹에 둔다.
          // 앞머리 가까이(4px)이거나 머리카락색에 가까운 조각은 얼굴로: 앞머리로 보내면 앞머리 메쉬 밖이라 빠질 수 있고,
          // 얼굴에 두면 평소엔 원본 그대로, 눈을 감으면 내려온 눈꺼풀이 덮는다.
          const nearHair = dilate(mask.front_hair, w, h, 4), rest = new Uint8Array(w * h);
          for (let i = 0; i < rest.length; i++) if (toFace[i] && (nearHair[i] || rgbDist(data, i, hair) < 70)) rest[i] = 1;
          if (count(rest)) { visible[`eyelash_${side}`] = minus(visible[`eyelash_${side}`], rest); visible.face = or(visible.face, rest); }
        }
        if (count(back)) {
          visible[`eyelash_${side}`] = minus(visible[`eyelash_${side}`], back);
          visible.front_hair = or(visible.front_hair || mask.front_hair, back); mask.front_hair = or(mask.front_hair, back);
          // 얼굴은 그 밑을 피부로 채운다
          if (fills.face) fills.face.target = or(fills.face.target, back);
        }
      }
      const lash = visible[`eyelash_${side}`], ob = eyeOpen[side] && bboxOf(eyeOpen[side].open, w, h);
      if (lash && ob) {
        const mid = ob.y + ob.height * 0.55, lower = new Uint8Array(w * h);
        for (let i = 0; i < lower.length; i++) if (lash[i] && i / w >= mid) lower[i] = 1;
        if (count(lower) >= 4) { visible[`eyelash_lower_${side}`] = lower; visible[`eyelash_${side}`] = minus(lash, lower); }
      }
      if (!eye || !visible[`eyewhite_${side}`] || count(visible[`eyewhite_${side}`]) < 4) continue;
      // 속눈썹 밑은 흰자로 채우지 않는다: 눈꺼풀이 내려오면 그 자리는 얼굴 피부가 보여야 한다.
      fills[`eyewhite_${side}`] = { target: visible[`irides_${side}`] || empty, source: visible[`eyewhite_${side}`] };
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

  // 2) 몸 파츠의 가려진 곳
  // 2-0) 접합선의 선화(소매 끝단·반바지 끝단·신발 입구·턱선)는 덮는 쪽 파츠 것으로 옮긴다.
  //      뒤 파츠에 남으면 관절을 돌렸을 때 팔·다리 한가운데 선이 그어져 보인다.
  const add = (name, target, alpha = null) => {
    if (!mask[name]) return;
    const prev = fills[name];
    const t = prev ? or(prev.target, target) : target;
    let a = null;
    if (alpha || prev?.alpha) {
      a = new Float32Array(w * h);
      for (let i = 0; i < a.length; i++) if (t[i]) a[i] = Math.max(prev ? (prev.alpha ? prev.alpha[i] : prev.target[i]) : 0, alpha ? alpha[i] : target[i]);
    }
    fills[name] = { target: t, alpha: a, source: visible[name] || mask[name], opts: prev?.opts };
  };
  // 접합선 정리: 뒤 파츠의 보이는 픽셀 중 앞 파츠 가장자리 r px 안에서 선화·섞인 색·짙은 그림자는 앞 파츠로 옮기고,
  // 뒤 파츠는 그 자리를 채운다(옮긴 픽셀은 원래 자리 그대로라 합성 결과는 원본과 같다).
  const moveSeam = (back, front, r = 4.5, thr = 40, lumThr = 8) => {
    const vb = visible[back] || mask[back], vf = visible[front] || mask[front];
    if (!vb || !vf || !count(vb) || !count(vf)) return;
    const base = dominantColor(data, vb), baseLum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
    const zone = and(vb, dilate(vf, w, h, r));
    const moved = new Uint8Array(w * h);
    for (let i = 0; i < moved.length; i++) if (zone[i] && ((seg.line && seg.line[i]) || rgbDist(data, i, base) > thr || Math.abs(lum(data, i) - baseLum) > lumThr)) moved[i] = 1;
    if (!count(moved)) return;
    visible[back] = minus(vb, moved);
    if (mask[back]) mask[back] = minus(mask[back], moved);
    visible[front] = or(vf, moved);
    if (mask[front]) mask[front] = or(mask[front], moved);
    add(back, moved);
  };
  // 얼굴 세부(눈·눈썹·입·코) 둘레의 옅은 테두리도 세부 쪽으로 (얼굴 바탕에 점선 고리가 남지 않게)
  // (눈동자는 시선 따라, 속눈썹은 깜빡일 때 움직이므로 제외: 테두리 점이 따라다닌다. 속눈썹 둘레는 눈꺼풀 피부 띠가 덮는다)
  if (visible.face) for (const name of Object.keys(visible)) if (/^(eyebrow|eyewhite|mouth|nose)_?/.test(name)) moveSeam('face', name, 3, 18, 5);
  moveSeam('face', 'front_hair', 3, 18, 5);
  for (const [back, front] of [['neck', 'face'], ['neck', 'topwear'], ['bottomwear', 'topwear'], ['topwear', 'sleeve_r'], ['topwear', 'sleeve_l'],
    ['arm_r', 'sleeve_r'], ['arm_l', 'sleeve_l'], ['legwear_r', 'bottomwear'], ['legwear_l', 'bottomwear'], ['legwear_r', 'footwear_r'], ['legwear_l', 'footwear_l']]) {
    if (mask[back] && mask[front]) moveSeam(back, front);
  }
  const near = (back, fronts, D) => and(or(...fronts.map(get)), dilate(get(back), w, h, D));
  const extend = (back, fronts, maxDepth, opts) => {
    if (!mask[back]) return;
    const r = extendUnder(visible[back] || mask[back], or(...fronts.map(get)), w, h, maxDepth, opts);
    if (count(r.target)) add(back, r.target, r.alpha);
  };
  extend('neck', ['face', 'front_hair', 'topwear'], H * 0.08);
  // 상의: 소매·팔·머리카락이 파고든 오목한 곳만 둥글게 메운다(소매 모양대로 뾰족하게 늘리지 않는다).
  if (mask.topwear) {
    const fronts = or(get('sleeve_r'), get('sleeve_l'), get('arm_r'), get('arm_l'), get('front_hair'));
    add('topwear', or(and(closeMask(visible.topwear || mask.topwear, w, h, H * 0.06), fronts), near('topwear', ['sleeve_r', 'sleeve_l', 'arm_r', 'arm_l', 'front_hair'], 2)));
  }
  // 상의 어깨 끝도 소매 밑으로 조금 둥글게 이어서, 팔을 들어도 세로로 잘린 단면이 보이지 않게
  extend('topwear', ['sleeve_r', 'sleeve_l'], H * 0.05, { depthScale: 0.6 });
  for (const s of ['r', 'l']) extend(`arm_${s}`, [`sleeve_${s}`], H * 0.09);
  extend('bottomwear', ['topwear'], H * 0.05);
  for (const s of ['r', 'l']) { extend(`legwear_${s}`, ['bottomwear'], H * 0.1); extend(`legwear_${s}`, [`footwear_${s}`], H * 0.05); }

  // 2-2) 감싸인 곳: 뒤 파츠가 같은 줄의 좌우 또는 같은 열의 위아래에서 감싸는 자리를 앞 파츠가 덮고 있으면
  //      크기와 상관없이 채운다 (팔짱 낀 팔 밑 가슴, 머리카락 가닥 밑 얼굴, 손 밑 앞치마 등).
  //      덮는 쪽은 그리기 순서상 앞에 있는 파츠만, 비어 있는 배경은 채우지 않는다.
  const bodyOrder = ORDER.filter((n) => mask[n] && !/^(eye|irides|eyebrow|mouth|nose|back_hair)/.test(n));
  for (let k = 1; k < bodyOrder.length; k++) {
    const back = bodyOrder[k];
    const fronts = or(...bodyOrder.slice(0, k).map(get));
    const enclosed = and(enclosedBy(get(back), w, h), fronts);
    if (count(enclosed)) add(back, enclosed);
  }

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
  const fulls = new Map();
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
      const target = and(minus(f.target, vis), opaque);
      filled = diffuseFill(data, w, h, count(src) > 20 ? src : f.source, target, full, f.opts);
      if (f.alpha) for (let i = 0; i < target.length; i++) if (target[i]) full[i * 4 + 3] = Math.round(255 * f.alpha[i]);
    }
    fulls.set(name, { full, filled });
  }
  // 위 눈꺼풀: 속눈썹 위에 "눈 높이만큼의 얼굴 피부"를 붙인다. 평소에는 뒤의 얼굴과 똑같아 보이지 않고,
  // 위 눈꺼풀 뼈가 눈 높이만큼 내려오면 이 피부가 흰자·눈동자를 덮어 눈을 감은 모양이 된다.
  const faceFull = fulls.get('face')?.full;
  const lids = {};
  // 피부 띠 색: 대부분은 얼굴 레이어를 그대로 복사(평소엔 뒤 얼굴과 똑같아 안 보임)하고,
  // 속눈썹·눈 둘레 3px과 앞머리 밑의 머리카락 부스러기는 매끈한 피부색으로 바꾼다(감을 때 점선·갈색 점이 따라 내려오지 않게).
  const hairCover = mask.front_hair ? dilate(mask.front_hair, w, h, 2) : empty, skinColor = visible.face ? dominantColor(data, visible.face) : [230, 200, 180];
  const faceSource = visible.face ? cleanSource(visible.face) : null;
  for (const side of ['r', 'l']) {
    const lash = fulls.get(`eyelash_${side}`), found = eyeOpen[side];
    if (!lash || !found || !faceFull) continue;
    const { open } = found, ob = bboxOf(open, w, h);
    if (!ob || ob.height < 3) continue;
    // 깜빡임 때 내려오는 거리는 흰자 높이 × 0.95(rig-demo-motions). 피부 띠는 그보다 길게(1.6배) 만들고
    // 위쪽 25%만 흐리게 해서, 다 내려와도 흐린 부분이 눈 위에 걸리지 않게 한다.
    const lift = Math.round(ob.height * 1.6), lid = new Uint8Array(w * h), alpha = new Float32Array(w * h);
    // 열마다 눈 뜬 자리의 맨 위(t)에서 위로 lift만큼: 눈꺼풀이 내려오면 그 열의 눈 뜬 자리를 다 덮는다.
    // 눈 양옆으로 조금(폭의 12%) 더 넓혀 눈가 테두리까지 덮는다. 눈 밖 열은 가장 가까운 열의 높이를 쓴다.
    const tops = new Int32Array(ob.width).fill(-1);
    for (let x = ob.x; x < ob.x + ob.width; x++) for (let y = ob.y; y < ob.y + ob.height; y++) if (open[y * w + x]) { tops[x - ob.x] = y; break; }
    const topAt = (x) => { const c = Math.min(ob.width - 1, Math.max(0, x - ob.x)); for (let d = 0; d < ob.width; d++) { if (c - d >= 0 && tops[c - d] >= 0) return tops[c - d]; if (c + d < ob.width && tops[c + d] >= 0) return tops[c + d]; } return -1; };
    const side0 = Math.round(ob.width * 0.12);
    for (let x = Math.max(0, ob.x - side0); x < Math.min(w, ob.x + ob.width + side0); x++) {
      const t = topAt(x);
      if (t < 0) continue;
      for (let y = Math.max(0, t - lift); y < t; y++) {
        const i = y * w + x;
        if (lash.full[i * 4 + 3] >= 250 || faceFull[i * 4 + 3] < 250) continue;
        // 위로 갈수록 흐려지게: 관절이 내려와도 위쪽 끝의 경계가 보이지 않는다
        const k = (t - y) / lift;
        lid[i] = 1; alpha[i] = k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25);
      }
    }
    if (!count(lid)) continue;
    const near = dilate(or(visible[`eyelash_${side}`] || empty, open), w, h, 3);
    const smooth = new Uint8ClampedArray(w * h * 4);
    if (faceSource) diffuseFill(data, w, h, faceSource, lid, smooth);
    let added = 0;
    for (let i = 0; i < lid.length; i++) {
      if (!lid[i]) continue;
      // 피부와 크게 다른 픽셀(머리카락 가닥 등)은 원본 그대로: 평소 모습이 원본과 달라지면 안 된다
      const plain = near[i] && rgbDist(faceFull, i, skinColor) <= 28;
      const src = plain && faceSource ? [smooth[i * 4], smooth[i * 4 + 1], smooth[i * 4 + 2]] : [faceFull[i * 4], faceFull[i * 4 + 1], faceFull[i * 4 + 2]];
      // 반투명 속눈썹 가장자리는 피부 위에 얹는다
      const la = lash.full[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) lash.full[i * 4 + c] = lash.full[i * 4 + c] * la + src[c] * (1 - la);
      lash.full[i * 4 + 3] = Math.round(255 * Math.max(la, alpha[i]));
      added++;
    }
    if (added) { lash.filled += added; lids[`eyelash_${side}`] = lid; }
  }
  for (const name of names) {
    if (!fulls.has(name)) continue;
    const { full, filled } = fulls.get(name);
    const vis = visible[name];
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
    // 채운(원래 가려져 있던) 픽셀 표시: flare가 이 자리만 다시 그린다.
    let fillMask = null;
    if (filled) {
      fillMask = new Uint8Array(lw * lh);
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
        const i = (y + y0) * w + x + x0;
        if (full[i * 4 + 3] && !vis[i]) fillMask[y * lw + x] = 1;
      }
    }
    layers.push({ name, x: x0, y: y0, width: lw, height: lh, data: cropped, filled, visible: count(vis), fillMask });
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
