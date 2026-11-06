// 모델 없이 선화·색 영역으로 원화를 나누는 분할 코어.
// 입력: RGBA 픽셀 배열 + 크기. 출력: 배경 마스크, 선화 마스크, 영역 라벨, 영역 통계.
// 브라우저(Worker)와 Node(테스트) 양쪽에서 같은 코드로 동작한다.

export const DEFAULT_PARAMS = Object.freeze({
  bgTolerance: 10, // 배경 플러드필 색 허용 오차 (ΔE)
  lineContrast: 12, // 주변 평균보다 이만큼 어두우면 선화 (L*)
  lineAbsolute: 12, // 이 밝기보다 어두우면 무조건 선화 (L*)
  lineWindow: 6, // 주변 평균을 구하는 반경 (px)
  gapRadius: 1, // 끊긴 선을 메우는 닫힘 연산 반경 (px), 0이면 끔
  colorTolerance: 14, // 한 영역으로 묶는 색 허용 오차 (ΔE, 영역 평균 기준)
  minArea: 40, // 이보다 작은 영역은 이웃 영역에 흡수 (px)
  style: 'auto', // 'auto' | 'cel'(셀 채색) | 'painted'(페인팅·3D 렌더)
  paintedK90: 25, // 전경 90%를 덮는 데 영역이 이보다 많이 필요하면 페인팅으로 본다
  paintedLightness: 0.3, // 페인팅: 밝기 차이 가중치 (음영은 밝기만 바뀌므로 낮게)
  paintedTolerance: 12, // 페인팅: 영역 합치기 평균색 허용 오차 (밝기 가중 ΔE)
  paintedEdge: 5, // 페인팅: 경계에서 이웃 픽셀 색 차이 평균이 이보다 작아야(부드러운 음영) 합침
  paintedMinFraction: 0.0003, // 페인팅: 전경 대비 이보다 작은 잡티는 이웃에 합침
});

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** RGBA → CIE Lab (D65). 반투명 픽셀은 흰 바탕에 합성한 색으로 계산한다. */
export function rgbaToLab(data, n) {
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = SRGB_TO_LINEAR[Math.round(data[i * 4] * a + 255 * (1 - a))];
    const g = SRGB_TO_LINEAR[Math.round(data[i * 4 + 1] * a + 255 * (1 - a))];
    const b = SRGB_TO_LINEAR[Math.round(data[i * 4 + 2] * a + 255 * (1 - a))];
    const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const fy = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const fz = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    lab[i * 3] = 116 * fy - 16;
    lab[i * 3 + 1] = 500 * (fx - fy);
    lab[i * 3 + 2] = 200 * (fy - fz);
  }
  return lab;
}

function hasTransparentBorder(data, w, h) {
  let transparent = 0;
  let total = 0;
  const check = (x, y) => {
    total++;
    if (data[(y * w + x) * 4 + 3] < 250) transparent++;
  };
  for (let x = 0; x < w; x++) { check(x, 0); check(x, h - 1); }
  for (let y = 0; y < h; y++) { check(0, y); check(w - 1, y); }
  return transparent / total > 0.5;
}

function median(values) {
  const sorted = Float32Array.from(values).sort();
  return sorted[sorted.length >> 1];
}

/**
 * 전경 마스크(1 = 캐릭터). 알파가 있으면 알파를 쓰고,
 * 없으면 테두리의 대표 배경색에서 플러드필로 배경을 걷어낸다.
 */
export function foregroundMask(data, lab, w, h, tolerance) {
  const n = w * h;
  const fg = new Uint8Array(n);
  if (hasTransparentBorder(data, w, h)) {
    for (let i = 0; i < n; i++) fg[i] = data[i * 4 + 3] > 16 ? 1 : 0;
    return { fg, method: 'alpha' };
  }
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const bgL = median(border.map((i) => lab[i * 3]));
  const bgA = median(border.map((i) => lab[i * 3 + 1]));
  const bgB = median(border.map((i) => lab[i * 3 + 2]));
  const tol2 = tolerance * tolerance;
  const isBg = (i) => {
    const dl = lab[i * 3] - bgL;
    const da = lab[i * 3 + 1] - bgA;
    const db = lab[i * 3 + 2] - bgB;
    return dl * dl + da * da + db * db <= tol2;
  };
  fg.fill(1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const i of border) {
    if (fg[i] && isBg(i)) { fg[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0 && fg[i - 1] && isBg(i - 1)) { fg[i - 1] = 0; queue[tail++] = i - 1; }
    if (x < w - 1 && fg[i + 1] && isBg(i + 1)) { fg[i + 1] = 0; queue[tail++] = i + 1; }
    if (y > 0 && fg[i - w] && isBg(i - w)) { fg[i - w] = 0; queue[tail++] = i - w; }
    if (y < h - 1 && fg[i + w] && isBg(i + w)) { fg[i + w] = 0; queue[tail++] = i + w; }
  }
  return { fg, method: 'flood', background: [bgL, bgA, bgB] };
}

/**
 * 선화 마스크. 절대적으로 어둡거나, 주변 평균보다 충분히 어두운 픽셀.
 * 넓은 그림자 면은 주변 평균도 함께 어두워서 선으로 잡히지 않는다.
 */
export function lineMask(lab, fg, w, h, { lineContrast, lineAbsolute, lineWindow }) {
  const n = w * h;
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += lab[(y * w + x) * 3];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + rowSum;
    }
  }
  const line = new Uint8Array(n);
  const r = Math.max(1, Math.round(lineWindow));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!fg[i]) continue;
      const L = lab[i * 3];
      if (L < lineAbsolute) { line[i] = 1; continue; }
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (mean - L > lineContrast) line[i] = 1;
    }
  }
  return line;
}

/**
 * 마스크(1)까지의 거리 (px 단위). 기본은 chamfer 3-4(유클리드 근사),
 * diagonalCost=3이면 체스판 거리(정사각형 구조 요소)가 된다.
 */
export function distanceTransform(mask, w, h, diagonalCost = 4) {
  const D = diagonalCost;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** 닫힘 연산(팽창 후 침식): 반경 이하의 선 틈을 막는다. */
export function closeGaps(mask, w, h, radius) {
  if (radius <= 0) return Uint8Array.from(mask);
  const grown = distanceTransform(mask, w, h, 3);
  const dilated = new Uint8Array(w * h);
  for (let i = 0; i < dilated.length; i++) dilated[i] = grown[i] <= radius ? 1 : 0;
  const inverse = new Uint8Array(w * h);
  for (let i = 0; i < inverse.length; i++) inverse[i] = dilated[i] ? 0 : 1;
  const shrink = distanceTransform(inverse, w, h, 3);
  // 이미지 바깥은 비어 있는 것으로 보고 침식한다 (테두리에 붙은 팽창이 남지 않게).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const toEdge = Math.min(x, y, w - 1 - x, h - 1 - y) + 1;
      const i = y * w + x;
      if (toEdge < shrink[i]) shrink[i] = toEdge;
    }
  }
  const closed = new Uint8Array(w * h);
  for (let i = 0; i < closed.length; i++) closed[i] = dilated[i] && shrink[i] > radius ? 1 : 0;
  // 원래 선은 항상 유지한다.
  for (let i = 0; i < closed.length; i++) if (mask[i]) closed[i] = 1;
  return closed;
}

/**
 * 장벽(선화·배경)에 막히고, 영역 평균색과 허용 오차 이내인 픽셀만 한 영역으로 묶는다.
 * 반환 라벨: 0 = 미배정, 1.. = 영역.
 */
export function floodRegions(lab, fg, barrier, w, h, colorTolerance, lightWeight = 1) {
  const n = w * h;
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const tol2 = colorTolerance * colorTolerance;
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (labels[start] || !fg[start] || barrier[start]) continue;
    const id = ++next;
    let sumL = lab[start * 3];
    let sumA = lab[start * 3 + 1];
    let sumB = lab[start * 3 + 2];
    let count = 1;
    labels[start] = id;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    const tryAdd = (j) => {
      if (labels[j] || !fg[j] || barrier[j]) return;
      const dl = (lab[j * 3] - sumL / count) * lightWeight;
      const da = lab[j * 3 + 1] - sumA / count;
      const db = lab[j * 3 + 2] - sumB / count;
      if (dl * dl + da * da + db * db > tol2) return;
      labels[j] = id;
      sumL += lab[j * 3];
      sumA += lab[j * 3 + 1];
      sumB += lab[j * 3 + 2];
      count++;
      queue[tail++] = j;
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) tryAdd(i - 1);
      if (x < w - 1) tryAdd(i + 1);
      if (i >= w) tryAdd(i - w);
      if (i < n - w) tryAdd(i + w);
    }
  }
  return { labels, count: next };
}

function areas(labels, count) {
  const area = new Int32Array(count + 1);
  for (let i = 0; i < labels.length; i++) area[labels[i]]++;
  return area;
}

/** 작은 영역을 지우고, 미배정 전경 픽셀(선화·자투리)을 가장 가까운 영역으로 키워 채운다. */
export function absorbUnassigned(labels, fg, w, h, count, minArea) {
  const n = w * h;
  const area = areas(labels, count);
  for (let i = 0; i < n; i++) if (labels[i] && area[labels[i]] < minArea) labels[i] = 0;

  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (!labels[i]) continue;
    const x = i % w;
    const touchesFree = (j) => fg[j] && !labels[j];
    if ((x > 0 && touchesFree(i - 1)) || (x < w - 1 && touchesFree(i + 1)) ||
        (i >= w && touchesFree(i - w)) || (i < n - w && touchesFree(i + w))) {
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const id = labels[i];
    const x = i % w;
    const grow = (j) => {
      if (fg[j] && !labels[j]) { labels[j] = id; queue[tail++] = j; }
    };
    if (x > 0) grow(i - 1);
    if (x < w - 1) grow(i + 1);
    if (i >= w) grow(i - w);
    if (i < n - w) grow(i + w);
  }

  // 영역이 하나도 닿지 않는 전경 덩어리(선만 있는 조각)는 각자 새 영역으로 둔다.
  let next = count;
  for (let start = 0; start < n; start++) {
    if (!fg[start] || labels[start]) continue;
    const id = ++next;
    labels[start] = id;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const grow = (j) => {
        if (fg[j] && !labels[j]) { labels[j] = id; queue[tail++] = j; }
      };
      if (x > 0) grow(i - 1);
      if (x < w - 1) grow(i + 1);
      if (i >= w) grow(i - w);
      if (i < n - w) grow(i + w);
    }
  }
  return next;
}

/** 라벨을 면적 큰 순서로 1..K 재번호하고 영역 통계를 만든다. */
export function summarizeRegions(labels, data, w, h, count) {
  const stats = [];
  for (let id = 0; id <= count; id++) {
    stats.push({ id, area: 0, r: 0, g: 0, b: 0, sx: 0, sy: 0, minX: w, minY: h, maxX: -1, maxY: -1 });
  }
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id) continue;
    const s = stats[id];
    const x = i % w;
    const y = (i - x) / w;
    s.area++;
    s.r += data[i * 4];
    s.g += data[i * 4 + 1];
    s.b += data[i * 4 + 2];
    s.sx += x;
    s.sy += y;
    if (x < s.minX) s.minX = x;
    if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
  }
  const used = stats.slice(1).filter((s) => s.area > 0).sort((a, b) => b.area - a.area || a.id - b.id);
  const remap = new Int32Array(count + 1);
  used.forEach((s, index) => { remap[s.id] = index + 1; });
  for (let i = 0; i < labels.length; i++) labels[i] = remap[labels[i]];
  return used.map((s, index) => ({
    id: index + 1,
    area: s.area,
    color: [Math.round(s.r / s.area), Math.round(s.g / s.area), Math.round(s.b / s.area)],
    centroid: [Math.round(s.sx / s.area), Math.round(s.sy / s.area)],
    bbox: [s.minX, s.minY, s.maxX - s.minX + 1, s.maxY - s.minY + 1],
  }));
}

/** 전경 90%를 덮는 데 필요한 영역 수 (작을수록 큰 면으로 칠한 셀 채색). */
export function coverCount(labels, count, fraction = 0.9) {
  const area = new Int32Array(count + 1);
  let total = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i]) { area[labels[i]]++; total++; }
  const sorted = Array.from(area.subarray(1)).sort((a, b) => b - a);
  let acc = 0;
  for (let k = 0; k < sorted.length; k++) { acc += sorted[k]; if (acc >= total * fraction) return k + 1; }
  return sorted.length;
}

/**
 * 페인팅용 영역 합치기. 두 이웃 영역은 (1) 맞닿은 경계에서 이웃 픽셀끼리 색 차이가 작고(부드러운 음영)
 * (2) 평균색이 밝기를 덜 본 거리로 가까울 때만 합친다. 재질 경계(피부|머리카락)는 경계가 또렷해서 남는다.
 * 매우 작은 조각만 가장 비슷한 이웃에 강제로 합친다. labels를 1..K로 다시 매기고 K를 돌려준다.
 */
export function mergeRegions(labels, lab, w, h, count, { lightWeight = 0.3, tol = 16, edgeTol = 6, minArea = 0, fg = null } = {}) {
  const parent = new Int32Array(count + 1);
  for (let i = 0; i <= count; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const sum = new Float64Array((count + 1) * 4);
  for (let i = 0; i < labels.length; i++) {
    const r = labels[i];
    if (!r) continue;
    sum[r * 4] += lab[i * 3]; sum[r * 4 + 1] += lab[i * 3 + 1]; sum[r * 4 + 2] += lab[i * 3 + 2]; sum[r * 4 + 3]++;
  }
  // 원래 영역 쌍마다 경계 픽셀 수와 경계 색 차이 합
  const N = count + 1;
  const edgeN = new Map();
  const edgeD = new Map();
  const pixelDist = (i, j) => Math.hypot(lab[i * 3] - lab[j * 3], lab[i * 3 + 1] - lab[j * 3 + 1], lab[i * 3 + 2] - lab[j * 3 + 2]);
  const link = (i, j) => {
    const a = labels[i], b = labels[j];
    if (!a || !b || a === b) return;
    const k = a < b ? a * N + b : b * N + a;
    edgeN.set(k, (edgeN.get(k) || 0) + 1);
    edgeD.set(k, (edgeD.get(k) || 0) + pixelDist(i, j));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) link(i, i + 1);
      if (y < h - 1) link(i, i + w);
    }
  }
  const pairs = [...edgeN.keys()].map((k) => [Math.floor(k / N), k % N, edgeN.get(k), edgeD.get(k)]);
  const dist = (a, b) => {
    const na = sum[a * 4 + 3], nb = sum[b * 4 + 3];
    const dl = (sum[a * 4] / na - sum[b * 4] / nb) * lightWeight;
    const da = sum[a * 4 + 1] / na - sum[b * 4 + 1] / nb;
    const db = sum[a * 4 + 2] / na - sum[b * 4 + 2] / nb;
    return Math.sqrt(dl * dl + da * da + db * db);
  };
  const unite = (a, b) => { parent[b] = a; for (let c = 0; c < 4; c++) sum[a * 4 + c] += sum[b * 4 + c]; };
  // 1) 부드러운 경계 + 비슷한 색: 합쳐진 덩어리 기준으로 경계를 다시 모아 반복
  for (let pass = 0; pass < 8; pass++) {
    const agg = new Map();
    for (const [a0, b0, n, d] of pairs) {
      const a = find(a0), b = find(b0);
      if (a === b) continue;
      const k = a < b ? a * N + b : b * N + a;
      const e = agg.get(k) || [0, 0];
      e[0] += n; e[1] += d;
      agg.set(k, e);
    }
    const scored = [];
    for (const [k, [n, d]] of agg) {
      const a = Math.floor(k / N), b = k % N;
      const edge = d / n;
      if (edge > edgeTol || n < 3) continue;
      const c = dist(a, b);
      // 경계가 아주 매끄러우면(같은 면이 어두워지며 채도도 같이 바뀌는 음영) 평균색 차이를 더 봐준다.
      if (c <= tol || (edge <= edgeTol * 0.5 && c <= tol * 2)) scored.push([edge + c * 0.25, a, b]);
    }
    if (!scored.length) break;
    scored.sort((x, y) => x[0] - y[0]);
    const touched = new Set();
    let merged = 0;
    for (const [, a, b] of scored) {
      if (touched.has(a) || touched.has(b)) continue; // 한 번에 한 쌍씩: 연쇄로 번지는 것 방지
      touched.add(a); touched.add(b);
      if (sum[a * 4 + 3] >= sum[b * 4 + 3]) unite(a, b); else unite(b, a);
      merged++;
    }
    if (!merged) break;
  }
  // 2) 아주 작은 조각(잡티)만 가장 비슷한 이웃에
  if (minArea > 0) {
    for (let pass = 0; pass < 4; pass++) {
      let merged = 0;
      const best = new Map();
      for (const [a0, b0] of pairs) {
        const a = find(a0), b = find(b0);
        if (a === b) continue;
        for (const [s1, s2] of [[a, b], [b, a]]) {
          if (sum[s1 * 4 + 3] >= minArea) continue;
          const d = dist(s1, s2);
          const cur = best.get(s1);
          if (!cur || d < cur[0]) best.set(s1, [d, s2]);
        }
      }
      for (const [small, [, other]] of best) {
        const a = find(small), b = find(other);
        if (a === b || sum[a * 4 + 3] >= minArea) continue;
        unite(b, a);
        merged++;
      }
      if (!merged) break;
    }
  }
  const remap = new Int32Array(count + 1);
  let next = 0;
  for (let i = 0; i < labels.length; i++) {
    const r = labels[i];
    if (!r) continue;
    const root = find(r);
    if (!remap[root]) remap[root] = ++next;
    labels[i] = remap[root];
  }
  return next;
}

/** 전체 파이프라인. 단계별 소요 시간(ms)도 함께 돌려준다. */
export function segment(data, w, h, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const now = () => (globalThis.performance ? performance.now() : Date.now());
  const timings = {};
  let t = now();
  const lap = (name) => {
    const t2 = now();
    timings[name] = Math.round(t2 - t);
    t = t2;
  };

  const n = w * h;
  const lab = rgbaToLab(data, n);
  lap('lab');
  const { fg, method } = foregroundMask(data, lab, w, h, p.bgTolerance);
  lap('background');
  const line = lineMask(lab, fg, w, h, p);
  lap('lines');
  const closed = closeGaps(line, w, h, p.gapRadius);
  lap('gaps');
  let { labels, count } = floodRegions(lab, fg, closed, w, h, p.colorTolerance);
  lap('flood');
  let total = absorbUnassigned(labels, fg, w, h, count, p.minArea);
  lap('absorb');
  // 그림체: 큰 면 몇 개로 대부분이 덮이면 셀 채색, 음영 때문에 잘게 쪼개지면 페인팅·3D 렌더.
  const k90 = coverCount(labels, total);
  const style = p.style === 'auto' ? (k90 > p.paintedK90 ? 'painted' : 'cel') : p.style;
  if (style === 'painted') {
    // 셀 채색과 같은 분할(음영 띠로 잘게 쪼개짐) 위에서, 경계가 부드러운 이웃끼리만 합친다.
    let fgCount0 = 0;
    for (let i = 0; i < n; i++) fgCount0 += fg[i];
    total = mergeRegions(labels, lab, w, h, total, { lightWeight: p.paintedLightness, tol: p.paintedTolerance, edgeTol: p.paintedEdge, minArea: fgCount0 * p.paintedMinFraction });
    lap('painted');
  }
  const regions = summarizeRegions(labels, data, w, h, total);
  lap('summary');

  let fgCount = 0;
  let lineCount = 0;
  let gapCount = 0;
  for (let i = 0; i < n; i++) {
    fgCount += fg[i];
    lineCount += line[i];
    gapCount += closed[i] && !line[i] ? 1 : 0;
  }
  return {
    width: w,
    height: h,
    params: p,
    style,
    k90,
    backgroundMethod: method,
    fg,
    line,
    closed,
    labels,
    regions,
    stats: { foreground: fgCount, line: lineCount, gapFilled: gapCount, regions: regions.length },
    timings,
  };
}
