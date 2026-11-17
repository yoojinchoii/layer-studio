// flare(gpt-image-2.6-flare)가 그린 "부위별 단색 지도"를 파츠 배정에 반영한다.
// 의미(이게 소매인지 팔인지)는 AI 지도를, 경계(어디서 끊기는지)는 원화의 색 영역을 믿는다:
// 색 영역 하나 안에서 AI 지도의 다수결로 파츠를 정하므로 AI 지도가 몇 픽셀 어긋나도 경계가 선을 따라간다.

import { PART_LABELS, cleanIslands } from './parts.js';

/** AI 지도 색 → 범주. 0은 배경·판단 불가. */
export const AI_CLASSES = [
  { id: 1, key: 'hair', color: [255, 0, 0], prompt: 'hair (all hair, including bangs, ponytails and braids)' },
  { id: 2, key: 'face', color: [255, 255, 0], prompt: 'face, ears and all skin of the head (eyes, eyebrows and mouth stay this color too)' },
  { id: 3, key: 'neck', color: [255, 128, 0], prompt: 'neck' },
  { id: 4, key: 'topwear', color: [0, 0, 255], prompt: 'upper-body clothing torso (shirt, jacket, vest, dress top, cape body)' },
  { id: 5, key: 'sleeve', color: [0, 255, 255], prompt: 'sleeves' },
  { id: 6, key: 'arm', color: [0, 255, 0], prompt: 'bare arms, hands and gloves' },
  { id: 7, key: 'bottomwear', color: [255, 0, 255], prompt: 'lower-body clothing (skirt, shorts, trousers, apron)' },
  { id: 8, key: 'legwear', color: [128, 0, 255], prompt: 'legs, tights and socks' },
  { id: 9, key: 'footwear', color: [0, 128, 128], prompt: 'shoes and boots' },
  { id: 10, key: 'other', color: [128, 128, 128], prompt: 'hats, bags, weapons, held items and other accessories' },
];
const SIDED = new Set(['sleeve', 'arm', 'legwear', 'footwear']);
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

export function segmentationPrompt() {
  return 'Convert this character illustration into a flat semantic segmentation map. Keep exactly the same canvas, composition, pose, '
    + 'silhouette, position and size; every boundary must stay exactly where it is in the original. Paint each region with one flat solid '
    + 'color, with no outlines, no shading, no gradients, no texture and no text. Classes: '
    + AI_CLASSES.map((c) => `${c.prompt} = ${hex(c.color)}`).join('; ')
    + '; background = pure white #FFFFFF.';
}

/**
 * AI 지도 RGBA → 범주 번호. 가장 가까운 팔레트 색이 충분히 가까울 때만 받는다(경계의 섞인 색·흰 배경은 0).
 * @param {Uint8ClampedArray} rgba
 */
export function classifyMap(rgba, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (r > 225 && g > 225 && b > 225) continue;
    let best = 0, bestD = Infinity;
    for (const c of AI_CLASSES) {
      const d = (r - c.color[0]) ** 2 + (g - c.color[1]) ** 2 + (b - c.color[2]) ** 2;
      if (d < bestD) { bestD = d; best = c.id; }
    }
    if (bestD < 90 * 90) out[i] = best;
  }
  return out;
}

function sideOf(key, x, rig) {
  const P = rig.points;
  const legs = key === 'legwear' || key === 'footwear';
  const a = legs ? (P.hip_left || P.knee_left) : (P.arm_left || P.elbow_left);
  const b = legs ? (P.hip_right || P.knee_right) : (P.arm_right || P.elbow_right);
  const mid = a && b ? (a.x + b.x) / 2 : (P.body || P.chest || P.pelvis || { x: rig.width / 2 }).x;
  // _r = 캐릭터 오른쪽 = 화면 왼쪽
  return x < mid ? 'r' : 'l';
}

/**
 * assignParts 결과를 AI 지도로 고친다. 원래 결과 객체 형식({partLabels, parts, ...})을 그대로 돌려준다.
 * @param {{width:number,height:number,labels:Int32Array,regions:Array,fg:Uint8Array}} seg
 * @param {object} rig fitJoints 결과
 * @param {{partLabels:Int32Array,parts:Array}} partsResult
 * @param {Uint8Array} ai 작업 해상도 픽셀별 AI 범주(classifyMap 결과)
 */
export function applyAiLabels(seg, rig, partsResult, ai, { regionShare = 0.88 } = {}) {
  const { width: w, height: h, labels, fg } = seg;
  const n = w * h;
  const K = AI_CLASSES.length + 1;
  const R = seg.regions.length;
  const votes = new Int32Array((R + 1) * K);
  const size = new Int32Array(R + 1);
  for (let i = 0; i < n; i++) {
    if (!fg[i]) continue;
    size[labels[i]]++;
    if (ai[i]) votes[labels[i] * K + ai[i]]++;
  }
  // 영역별 대표 범주: AI 표가 영역의 30% 이상이고 거의(88%) 한 범주일 때만 영역 통째로.
  // 같은 천으로 된 상의+소매처럼 한 색 영역에 두 부위가 있으면 픽셀 단위 AI 판단을 따른다.
  const regionClass = new Uint8Array(R + 1);
  for (let r = 1; r <= R; r++) {
    let total = 0, best = 0, top = 0;
    for (let k = 1; k < K; k++) { const v = votes[r * K + k]; total += v; if (v > top) { top = v; best = k; } }
    if (total >= size[r] * 0.3 && top >= total * regionShare) regionClass[r] = best;
  }

  const oldNames = new Map(partsResult.parts.map((p) => [p.id, p.name]));
  // 턱(head 관절) 위의 얼굴 픽셀은 머리카락 말고 다른 부위로 넘기지 않는다.
  // flare 지도가 눈·입을 목이나 옷 색으로 칠하면 눈이 목 레이어로 빠지고 얼굴엔 구멍이 남는다.
  const chinY = rig.points?.head?.y ?? -1;
  const keyOf = (id) => AI_CLASSES[id - 1]?.key;
  const names = new Array(n);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (!fg[i]) continue;
    const old = oldNames.get(partsResult.partLabels[i]) || null;
    const k = regionClass[labels[i]] || ai[i];
    const key = keyOf(k);
    let name = old;
    // 팔짱(handwear)은 알고리즘 판단을 지킨다: 좌우로 쪼개면 가슴 고정 리깅이 깨진다.
    const faceGuard = old === 'face' && (i - (i % w)) / w < chinY && key !== 'hair' && key !== 'face';
    if (key && key !== 'other' && old !== 'handwear' && !faceGuard) {
      if (key === 'hair' || key === 'face' || key === 'neck' || key === 'topwear' || key === 'bottomwear') name = key;
      else if (SIDED.has(key)) {
        const oldSide = old && old.startsWith(key + '_') ? old.slice(-1) : null;
        name = `${key}_${oldSide || sideOf(key, i % w, rig)}`;
      }
    }
    if (name !== old) changed++;
    names[i] = name;
  }

  const order = Object.keys(PART_LABELS);
  const used = [...new Set(names.filter(Boolean))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const idOf = new Map(used.map((name, k) => [name, k + 1]));
  const partLabels = new Int32Array(n);
  for (let i = 0; i < n; i++) if (names[i]) partLabels[i] = idOf.get(names[i]);
  cleanIslands(partLabels, w, h, used.length);

  const stats = used.map((name) => ({ name, area: 0, minX: w, minY: h, maxX: -1, maxY: -1, regions: new Set() }));
  for (let i = 0; i < n; i++) {
    const p = partLabels[i];
    if (!p) continue;
    const s = stats[p - 1], x = i % w, y = (i - x) / w;
    s.area++; s.regions.add(labels[i]);
    if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x; if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y;
  }
  const parts = stats.map((s, k) => ({ id: k + 1, name: s.name, label: PART_LABELS[s.name] || s.name, area: s.area, regionCount: s.regions.size,
    bbox: [s.minX, s.minY, Math.max(0, s.maxX - s.minX + 1), Math.max(0, s.maxY - s.minY + 1)] })).filter((p) => p.area > 0);
  let aiPixels = 0, fgCount = 0;
  for (let i = 0; i < n; i++) if (fg[i]) { fgCount++; if (ai[i]) aiPixels++; }
  return { ...partsResult, partLabels, parts, ai: { changed, coverage: fgCount ? aiPixels / fgCount : 0 } };
}
