// gpt-image-2.6-flare (사내 AI Proxy 경유) 호출: 파츠 분리용 부위 지도, 가려진 부분까지 파츠 완성하기.
// AI Proxy API(aiproxy-api…)는 브라우저 CORS를 허용하므로 사용자의 AI Proxy 토큰으로 바로 부른다.
// 토큰은 이 브라우저에만 보관한다(기본: 탭을 닫으면 지워지는 sessionStorage, 선택 시 localStorage).

import { segmentationPrompt, classifyMap } from './local-engine/ai-labels.js';

export const FLARE_ENGINE = 'flare';
export const FLARE_MODEL = 'gpt-image-2.6-flare';
const API_DEFAULT = 'https://aiproxy-api.backoffice.bagelgames.com/openai/v1/images/edits';
// 개발용: localhost에서만 ?flareApi=http://127.0.0.1:포트 로 중계 서버를 쓸 수 있다(배포 사이트에서는 무시).
const API = (() => {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return API_DEFAULT;
    const relay = new URLSearchParams(location.search).get('flareApi');
    return relay && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(relay) ? `${relay}/openai/v1/images/edits` : API_DEFAULT;
  } catch { return API_DEFAULT; }
})();
const TOKEN_KEY = 'layer-studio.aiproxy-token.v1';

export function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function tokenRemembered() {
  try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
}
export function saveToken(token, remember) {
  const value = String(token || '').trim();
  try {
    sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
    if (value) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
  } catch { /* 저장소를 못 쓰는 환경: 이번 화면에서만 쓴다 */ }
  return value;
}
export function validToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9._~+/=-]{16,512}$/.test(token.trim());
}

const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toBlob = (c) => new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(Error('PNG를 만들 수 없습니다.'))), 'image/png'));

/** 원본 비율에 가장 가까운 flare 출력 크기 */
export function flareSize(w, h) {
  const r = w / h;
  return r > 1.25 ? [1536, 1024] : r < 0.8 ? [1024, 1536] : [1024, 1024];
}

/** 가로세로 비율을 지키며 target 캔버스 가운데에 넣는 변환 */
export function fitTransform(w, h, tw, th, margin = 0) {
  const s = Math.min((tw - 2 * margin) / w, (th - 2 * margin) / h);
  return { s, ox: (tw - w * s) / 2, oy: (th - h * s) / 2 };
}

async function callFlare({ token, image, mask, prompt, size, quality = 'medium', signal }) {
  const form = new FormData();
  form.append('model', FLARE_MODEL);
  form.append('image', image, 'image.png');
  if (mask) form.append('mask', mask, 'mask.png');
  form.append('prompt', prompt);
  form.append('size', size.join('x'));
  form.append('quality', quality);
  // 기본값은 투명 배경 PNG라 투명 자리를 그대로 읽으면 검게 된다 → 불투명으로 받는다.
  form.append('background', 'opaque');
  form.append('n', '1');
  let response;
  try {
    response = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw Error('AI Proxy에 연결하지 못했어요. 회사 네트워크(VPN) 연결을 확인해주세요.');
  }
  if (!response.ok) {
    let detail = '';
    try { const j = await response.json(); detail = j?.error?.message || j?.message || ''; } catch { /* 본문 없음 */ }
    if (response.status === 401 || response.status === 403) throw Error('AI Proxy 토큰이 만료됐거나 올바르지 않아요. 새 토큰을 넣어주세요.');
    if (response.status === 402 || /BUDGET/i.test(detail)) throw Error('AI Proxy 월 예산을 다 썼어요. codeb budget으로 확인해주세요.');
    if (response.status === 429) throw Error('AI Proxy 요청이 많아요. 잠시 뒤 다시 시도해주세요.');
    throw Error(`flare 오류 (${response.status})${detail ? `: ${String(detail).slice(0, 160)}` : ''}`);
  }
  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length > 40_000_000) throw Error('flare가 이미지를 돌려주지 않았어요.');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const out = make(bitmap.width, bitmap.height);
  out.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas: out, usage: data.usage || null };
}

/**
 * 원화(작업 해상도 캔버스) → 픽셀별 부위 범주(Uint8Array, 작업 해상도).
 * 흰 배경에 얹어 보내고, 돌아온 지도를 같은 변환으로 되돌려 읽는다.
 */
export async function requestPartMap({ token, source, signal }) {
  const w = source.width, h = source.height, size = flareSize(w, h);
  const t = fitTransform(w, h, size[0], size[1]);
  const input = make(size[0], size[1]);
  const ctx = input.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size[0], size[1]);
  ctx.drawImage(source, t.ox, t.oy, w * t.s, h * t.s);
  const { canvas: map } = await callFlare({ token, image: await toBlob(input), prompt: segmentationPrompt(), size, signal });
  // 결과 크기가 요청과 다를 수 있어 요청 크기로 맞춘 뒤 원본 영역만 작업 해상도로 잘라 온다(가까운 픽셀).
  const back = make(w, h), bctx = back.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = false;
  const sx = map.width / size[0], sy = map.height / size[1];
  bctx.drawImage(map, t.ox * sx, t.oy * sy, w * t.s * sx, h * t.s * sy, 0, 0, w, h);
  return { labels: classifyMap(bctx.getImageData(0, 0, w, h).data, w * h), preview: back };
}

const PART_TEXT = {
  front_hair: 'hair', back_hair: 'back part of the hair seen behind the head', face: 'face skin', neck: 'neck', topwear: 'upper-body clothing (shirt or top)',
  sleeve_r: 'sleeve', sleeve_l: 'sleeve', arm_r: 'arm and hand', arm_l: 'arm and hand', handwear: 'arms and hands',
  bottomwear: 'lower-body clothing (skirt, shorts or trousers)', legwear_r: 'leg', legwear_l: 'leg', footwear_r: 'shoe', footwear_l: 'shoe',
  irides_r: 'iris and pupil of an eye', irides_l: 'iris and pupil of an eye', eyewhite_r: 'white of an eye', eyewhite_l: 'white of an eye',
};
// 앞에서 가리던 파츠 이름(프롬프트에서 "이건 그리지 말라"고 알려 준다)
const COVER_TEXT = {
  front_hair: 'the hair', face: 'the face', neck: 'the neck', topwear: 'the shirt', sleeve_r: 'a sleeve', sleeve_l: 'a sleeve', arm_r: 'an arm', arm_l: 'an arm',
  handwear: 'the arms', bottomwear: 'the skirt or shorts', footwear_r: 'a shoe', footwear_l: 'a shoe', legwear_r: 'a leg', legwear_l: 'a leg',
  eyebrow_r: 'the eyebrows', eyebrow_l: 'the eyebrows', eyelash_r: 'the eyes', eyelash_l: 'the eyes', eyewhite_r: 'the eyes', eyewhite_l: 'the eyes',
  irides_r: 'the eyes', irides_l: 'the eyes', mouth: 'the mouth', nose: 'the nose',
};
// 파츠별 지시: 가려진 쪽으로 어디까지 이어지는지, 무엇을 그리면 안 되는지.
const PART_HINT = {
  face: 'The eyes, eyebrows, eyelashes, nose and mouth are separate layers: paint their places as smooth bare skin only (no eyes, no eye whites, no mouth, no hair strands). The face skin continues up under the bangs to the hairline. ',
  neck: 'The neck continues a little upward behind the chin and downward under the collar; draw only plain neck skin, never a face, ears or hair. Most of the masked area is not neck: leave it as background. ',
  topwear: 'If the garment has sleeves, its body fabric continues outward under each sleeve: draw full rounded shoulders that reach out to the outer edge of the shoulders, and the sides of the garment going down from the armpits, with the same outline. Do not draw the sleeves themselves, arms, hands, hair or skin. ',
  arm_r: 'The bare arm continues upward under the sleeve to a rounded shoulder; draw that upper arm and shoulder with its outline. ',
  arm_l: 'The bare arm continues upward under the sleeve to a rounded shoulder; draw that upper arm and shoulder with its outline. ',
  legwear_r: 'The leg continues a little upward under the skirt or shorts and downward into the shoe; draw it with its outline. Do not draw the other leg. ',
  legwear_l: 'The leg continues a little upward under the skirt or shorts and downward into the shoe; draw it with its outline. Do not draw the other leg. ',
  bottomwear: 'The waistband continues upward a little under the shirt; draw the hidden top of the garment with its outline. ',
  back_hair: 'Draw the hair mass behind the head and neck that the face and front hair were hiding. ',
  irides_r: 'Complete the iris and pupil as one full circle or oval with the same rings, colors and highlight style, including the parts hidden under the eyelid skin and lashes. ',
  irides_l: 'Complete the iris and pupil as one full circle or oval with the same rings, colors and highlight style, including the parts hidden under the eyelid skin and lashes. ',
  eyewhite_r: 'Complete the white of the eye as one full smooth almond or round shape that continues under the surrounding skin and lashes, plain white with the same soft shading. Do not draw an iris, pupil, lashes or skin. ',
  eyewhite_l: 'Complete the white of the eye as one full smooth almond or round shape that continues under the surrounding skin and lashes, plain white with the same soft shading. Do not draw an iris, pupil, lashes or skin. ',
};
export const MIN_REDRAW_PIXELS = 250;
// 덮인 자리 중 파츠에서 이 거리(작업 해상도의 비율) 안만 그리게 한다.
export const COMPLETE_REACH = 0.12;
// 덮인 자리를 거의 다 칠했으면(큰 자리일 때) 가리던 파츠를 그대로 다시 그린 것으로 본다.
export const MAX_FILLED_SHARE = 0.9;

function count(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; }

// 맨 앞 파츠(앞머리·소매)는 덮인 자리가 있어도 그 밑을 볼 일이 없어 완성하지 않는다.
const SKIP_COMPLETE = new Set(['front_hair', 'sleeve_r', 'sleeve_l']);
/** 완성할 파츠: 이름이 있는 몸·옷 파츠 (눈동자·흰자 같은 작은 조각, 맨 앞 파츠 제외) */
export function redrawTargets(layers) {
  return layers.filter((l) => PART_TEXT[l.label] && !SKIP_COMPLETE.has(l.label) && l.data);
}

/** 가까운 거리(체스판 근사) — 1 = 거리 0인 시작 픽셀 */
function distanceFrom(seed, w, h) {
  const d = new Float32Array(w * h).fill(1e9), D = Math.SQRT2;
  for (let i = 0; i < seed.length; i++) if (seed[i]) d[i] = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = d[i];
    if (x) v = Math.min(v, d[i - 1] + 1);
    if (y) { v = Math.min(v, d[i - w] + 1); if (x) v = Math.min(v, d[i - w - 1] + D); if (x < w - 1) v = Math.min(v, d[i - w + 1] + D); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + D); if (x) v = Math.min(v, d[i + w - 1] + D); }
    d[i] = v;
  }
  return d;
}

/**
 * 파츠 완성 계획 (전체 캔버스 좌표). layers는 앞→뒤 순서, 각 {label,x,y,width,height,data,fillMask}.
 * visible = 원화에 보이는 이 파츠의 픽셀(알고리즘 채움 제외), edit = 앞 파츠가 덮던 자리 중 파츠에서 reach px 안.
 * flare는 edit 안에서만 그리므로, 평소(조립된) 모습은 원화 그대로다.
 */
export function completionPlan(layers, layer, { reach = COMPLETE_REACH, pad = 16 } = {}) {
  let W = 0, H = 0;
  for (const l of layers) { W = Math.max(W, l.x + l.width); H = Math.max(H, l.y + l.height); }
  const index = layers.indexOf(layer), vis = new Uint8Array(W * H), cov = new Uint8Array(W * H), front = new Uint8ClampedArray(W * H * 4);
  const covers = new Map();
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    const j = y * layer.width + x;
    if (layer.data[j * 4 + 3] > 0 && !layer.fillMask?.[j]) vis[(layer.y + y) * W + layer.x + x] = 1;
  }
  for (const f of layers.slice(0, Math.max(0, index)).reverse()) for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const j = y * f.width + x;
    if (f.data[j * 4 + 3] <= 128 || f.fillMask?.[j]) continue;
    const i = (f.y + y) * W + f.x + x;
    cov[i] = 1; front.set(f.data.subarray(j * 4, j * 4 + 4), i * 4);
    if (!covers.has(f.label)) covers.set(f.label, []);
    covers.get(f.label).push(i);
  }
  // 닿는 거리: 작업 해상도의 reach 비율, 다만 작은 파츠(눈 등)는 제 크기의 60%까지만(얼굴 전체로 번지지 않게)
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let i = 0; i < W * H; i++) if (vis[i]) { const x = i % W, y = (i - x) / W; if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y; }
  const dist = distanceFrom(vis, W, H), R = Math.min(Math.max(W, H) * reach, Math.max(8, (Math.max(bx1 - bx0, by1 - by0) + 1) * 0.6));
  let x0 = W, y0 = H, x1 = -1, y1 = -1, editable = 0;
  const editAll = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (cov[i] && !vis[i] && dist[i] <= R) { editAll[i] = 1; editable++; }
    if (vis[i] || editAll[i]) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const crop = (src, k = 1) => { const out = new (src.constructor)(w * h * k); for (let y = 0; y < h; y++) out.set(src.subarray(((y0 + y) * W + x0) * k, ((y0 + y) * W + x0 + w) * k), y * w * k); return out; };
  // 원화에 보이는 이 파츠의 색(반투명 테두리 포함)
  const color = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    const j = y * layer.width + x, gx = layer.x + x - x0, gy = layer.y + y - y0;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h || !vis[(layer.y + y) * W + layer.x + x]) continue;
    color.set(layer.data.subarray(j * 4, j * 4 + 4), (gy * w + gx) * 4);
  }
  // 이 파츠의 덮인 자리를 실제로 덮던 앞 파츠(20px 이상)
  const covering = [];
  for (const [label, pixels] of covers) {
    let hits = 0;
    for (const i of pixels) if (editAll[i] && ++hits >= 20) break;
    if (hits >= 20 && COVER_TEXT[label] && !covering.includes(COVER_TEXT[label])) covering.push(COVER_TEXT[label]);
  }
  return { x0, y0, w, h, visible: crop(vis), edit: crop(editAll), color, front: crop(front, 4), editable, covering };
}

const WHITE = [255, 255, 255], MAGENTA = [255, 0, 255];
/** 배경색: 흰색 계열 파츠(흰 옷 등)는 자홍색 배경, 나머지는 흰 배경. */
export function backgroundFor(plan, label = '') {
  // 흰 계열 픽셀이 조금이라도 많으면(흰자·흰 옷 — 그늘진 흰자는 평균색이 어두워도 대부분 희다) 자홍색 배경
  if (/^eyewhite/.test(label)) return { rgb: MAGENTA, name: 'magenta' };
  let light = 0, n = 0;
  for (let i = 0; i < plan.visible.length; i++) if (plan.visible[i] && plan.color[i * 4 + 3] > 200) { n++; if (Math.hypot(255 - plan.color[i * 4], 255 - plan.color[i * 4 + 1], 255 - plan.color[i * 4 + 2]) < 60) light++; }
  return n && light / n > 0.25 ? { rgb: MAGENTA, name: 'magenta' } : { rgb: WHITE, name: 'white' };
}

export function completionPrompt(label, covering = [], bgName = 'white', { plain = false } = {}) {
  const part = PART_TEXT[label] || 'part';
  const cover = covering.length ? covering.join(' and ') : 'other parts';
  // plain: 안전 필터에 걸렸을 때 다시 보내는 순한 문장(맨살 위치 설명을 빼고, 옷을 다 입은 전 연령 캐릭터임을 밝힌다)
  if (plain) return `Complete one isolated layer of a fully clothed, all-ages 2D cartoon game character. The image shows only the ${part} on a flat ${bgName} background. `
    + `Inside the masked area, continue the ${part} where it was hidden by ${cover}, keeping its outline, colors and simple cel shading in the same art style. `
    + `Where the ${part} would not reach, keep the flat ${bgName} background. Never draw ${cover} or any other part. Keep everything outside the mask unchanged.`;
  return `Complete one isolated layer of a 2D anime character for Spine skeletal animation. The image shows only the ${part} on a flat ${bgName} background. `
    + `In the full illustration ${cover} lay on top of it inside the masked area; they have been removed. `
    + `Inside the masked area, draw the portion of the ${part} that was hidden underneath, so that the ${part} looks complete and uncovered: `
    + 'continue its silhouette, outline, colors, cel shading and folds in exactly the same art style. '
    + (PART_HINT[label] || '')
    + `Where the ${part} would not reach, keep the flat ${bgName} background. Never draw ${cover} or any other body part, clothing, hair or object. Keep everything outside the mask unchanged.`;
}

/**
 * flare 결과(잘라 낸 영역과 같은 크기의 RGBA)를 파츠에 합친다.
 * 보이는 픽셀은 원화 그대로, 덮인 자리는 배경색이 아닌 곳만 파츠로(배경과의 거리로 알파, 배경 섞임은 걷어 냄).
 * 보이는 파츠와 이어진 조각만 남기고, 그 안의 작은 구멍(하이라이트가 배경색과 같아진 곳)은 메운다.
 * @returns {{x,y,width,height,data,fillMask,drawn}|null}
 */
export function mergeCompletion(plan, result, bg = WHITE) {
  const { w, h, visible, edit, color } = plan, n = w * h;
  const alpha = new Float32Array(n), rgb = new Float32Array(n * 3), dist = new Float32Array(n);
  for (let i = 0; i < n; i++) if (edit[i]) dist[i] = Math.hypot(result[i * 4] - bg[0], result[i * 4 + 1] - bg[1], result[i * 4 + 2] - bg[2]);
  // 안쪽은 불투명, 가장자리(배경과 맞닿은 1~2px)만 배경과 섞인 정도로 알파를 매기고 배경색을 걷어 낸다.
  // 섞인 정도의 기준은 가장자리 바로 안쪽 파츠색과 배경의 거리(흰 바탕 살색 ~80, 자홍 바탕 흰자 ~255).
  const solidPx = (i) => dist[i] > 16;
  for (let i = 0; i < n; i++) {
    if (!edit[i] || !solidPx(i)) continue;
    const x = i % w, y = (i - x) / w;
    let edge = false, ref = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (edit[j] && !solidPx(j) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) edge = true;
      const d = edit[j] ? dist[j] : visible[j] ? Math.hypot(color[j * 4] - bg[0], color[j * 4 + 1] - bg[1], color[j * 4 + 2] - bg[2]) : 0;
      if (d > ref) ref = d;
    }
    const a = edge ? Math.min(1, dist[i] / Math.max(40, ref)) : 1;
    alpha[i] = a;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.min(255, Math.max(0, (result[i * 4 + k] - bg[k] * (1 - a)) / a));
  }
  // 보이는 파츠와 이어진 조각만(8방향)
  const keep = new Uint8Array(n), queue = [];
  for (let i = 0; i < n; i++) if (visible[i]) { keep[i] = 1; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx; if (keep[j] || alpha[j] < 0.3) continue;
      keep[j] = 1; queue.push(j);
    }
  }
  // 구멍: 바깥(테두리·덮이지 않은 빈 곳)에서 닿지 않는 빈 자리
  const outside = new Uint8Array(n), q2 = [];
  const solid = (i) => keep[i] && (visible[i] || alpha[i] >= 0.3);
  for (let i = 0; i < n; i++) { const x = i % w, y = (i - x) / w; if (!solid(i) && (!edit[i] || x === 0 || y === 0 || x === w - 1 || y === h - 1)) { outside[i] = 1; q2.push(i); } }
  for (let q = 0; q < q2.length; q++) {
    const i = q2[q], x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !outside[j] && !solid(j)) { outside[j] = 1; q2.push(j); }
  }
  // 작은 구멍만 메운다(큰 빈 자리는 flare가 일부러 비운 곳일 수 있다).
  const maxHole = Math.max(60, n * 0.004), seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (outside[i] || seen[i] || solid(i) || !edit[i]) continue;
    const comp = [i]; seen[i] = 1;
    for (let q = 0; q < comp.length; q++) {
      const k = comp[q], x = k % w, y = (k - x) / w;
      for (const j of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) if (j >= 0 && !seen[j] && !outside[j] && !solid(j)) { seen[j] = 1; comp.push(j); }
    }
    if (comp.length > maxHole) for (const k of comp) outside[k] = 1;
  }
  let drawn = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  const full = new Uint8ClampedArray(n * 4), fill = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (visible[i]) { full.set(color.subarray(i * 4, i * 4 + 4), i * 4); }
    else if (edit[i] && (keep[i] && alpha[i] > 0 || !outside[i])) {
      const a = outside[i] ? alpha[i] : 1, hole = !(keep[i] && alpha[i] > 0);
      for (let k = 0; k < 3; k++) full[i * 4 + k] = hole ? result[i * 4 + k] : rgb[i * 3 + k];
      full[i * 4 + 3] = Math.round(255 * a); fill[i] = 1; drawn++;
    } else continue;
    const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const width = x1 - x0 + 1, height = y1 - y0 + 1, data = new Uint8ClampedArray(width * height * 4), fillMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    data.set(full.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + width) * 4), y * width * 4);
    fillMask.set(fill.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + width), y * width);
  }
  return { x: plan.x0 + x0, y: plan.y0 + y0, width, height, data, fillMask, drawn };
}

/**
 * 팔·다리 뿌리 정리: flare가 새로 그린 픽셀 중 뿌리 관절(어깨·엉덩이)보다 몸통 쪽은 지운다(관절에서 3px에 걸쳐 흐리게).
 * 팔은 상의보다 앞 레이어라, 어깨 둥근 곳까지 그려 두면 팔을 들 때 소매 위로 맨살이 비집고 나온다.
 * 그 자리는 상의(완성된 어깨)가 보여야 한다. 원화에 보이던 픽셀은 건드리지 않는다.
 */
export function trimLimbRoot(layer, root, next, margin = 0) {
  const len = Math.hypot(next.x - root.x, next.y - root.y);
  if (!layer?.fillMask || !len) return 0;
  const dx = (next.x - root.x) / len, dy = (next.y - root.y) / len;
  let trimmed = 0;
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    const i = y * layer.width + x;
    if (!layer.fillMask[i] || !layer.data[i * 4 + 3]) continue;
    const t = (layer.x + x + 0.5 - root.x) * dx + (layer.y + y + 0.5 - root.y) * dy - margin;
    if (t >= 3) continue;
    const k = Math.max(0, t / 3);
    layer.data[i * 4 + 3] = Math.round(layer.data[i * 4 + 3] * k);
    if (!layer.data[i * 4 + 3]) { layer.fillMask[i] = 0; trimmed++; }
  }
  return trimmed;
}

/**
 * 완성된 팔에서 어깨 관절보다 몸통 쪽(+ 위팔 길이의 25%)에 새로 그린 픽셀을 지운다.
 * joints는 파이프라인 analysis.joints(0–1000 정규화), width·height는 작업 해상도.
 */
export function trimArmRoots(layers, joints, width, height, share = 0.25) {
  const P = (k) => (Array.isArray(joints?.[k]) ? { x: (joints[k][0] * (width - 1)) / 1000, y: (joints[k][1] * (height - 1)) / 1000 } : null);
  let trimmed = 0;
  for (const [label, a, b] of [['arm_r', 'shoulder_R', 'elbow_R'], ['arm_l', 'shoulder_L', 'elbow_L']]) {
    const layer = layers.find((l) => l.label === label), root = P(a), next = P(b);
    if (layer && root && next) trimmed += trimLimbRoot(layer, root, next, share * Math.hypot(next.x - root.x, next.y - root.y));
  }
  return trimmed;
}

/**
 * 한 파츠를 flare로 완성한다: 파츠만 단색 배경에 놓고, 앞 파츠가 덮던 자리를 마스크로 열어
 * 가려졌던 부분(외곽선·음영 포함)을 그리게 한다. 모양도 flare가 정한다.
 */
export async function completePart({ token, layers, layer, signal }) {
  const plan = completionPlan(layers, layer);
  if (!plan || plan.editable < MIN_REDRAW_PIXELS) return null;
  const { w, h } = plan, size = flareSize(w, h), t = fitTransform(w, h, size[0], size[1]);
  const bg = backgroundFor(plan, layer.label), css = `rgb(${bg.rgb.join(',')})`;
  const crop = make(w, h);
  crop.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(plan.color), w, h), 0, 0);
  const scene = make(size[0], size[1]), sctx = scene.getContext('2d');
  sctx.fillStyle = css; sctx.fillRect(0, 0, size[0], size[1]);
  sctx.drawImage(crop, t.ox, t.oy, w * t.s, h * t.s);
  // 마스크: 투명 = 그릴 자리(덮인 자리를 1px 넓혀 경계까지). 바깥 여백은 불투명(그대로).
  const hole = make(w, h), hctx = hole.getContext('2d'), hd = hctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let open = plan.edit[y * w + x];
    for (let dy = -1; dy <= 1 && !open; dy++) for (let dx = -1; dx <= 1 && !open; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && plan.edit[ny * w + nx]) open = 1; }
    if (open) hd.data[(y * w + x) * 4 + 3] = 255;
  }
  hctx.putImageData(hd, 0, 0);
  const maskCanvas = make(size[0], size[1]), mctx = maskCanvas.getContext('2d');
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, size[0], size[1]);
  mctx.globalCompositeOperation = 'destination-out';
  mctx.drawImage(hole, t.ox, t.oy, w * t.s, h * t.s);
  const image = await toBlob(scene), mask = await toBlob(maskCanvas);
  let out;
  try {
    ({ canvas: out } = await callFlare({ token, image, mask, prompt: completionPrompt(layer.label, plan.covering, bg.name), size, signal }));
  } catch (e) {
    // 다리·목처럼 맨살 파츠는 안전 필터에 가끔 걸린다: 순한 문장으로 한 번 더.
    if (!/safety|moderation|rejected/i.test(e.message)) throw e;
    ({ canvas: out } = await callFlare({ token, image, mask, prompt: completionPrompt(layer.label, plan.covering, bg.name, { plain: true }), size, signal }));
  }
  const back = make(w, h), bctx = back.getContext('2d', { willReadFrequently: true });
  const sx = out.width / size[0], sy = out.height / size[1];
  bctx.drawImage(out, t.ox * sx, t.oy * sy, w * t.s * sx, h * t.s * sy, 0, 0, w, h);
  const merged = mergeCompletion(plan, bctx.getImageData(0, 0, w, h).data, bg.rgb);
  if (!merged) throw Error('flare 결과에서 파츠를 찾지 못했어요');
  if (plan.editable > 4000 && merged.drawn / plan.editable > MAX_FILLED_SHARE) throw Error(`가리던 파츠까지 그린 것 같아 버렸어요 (${Math.round((100 * merged.drawn) / plan.editable)}%)`);
  return merged;
}

/** 여러 파츠를 동시에 최대 limit개씩 완성한다. 하나가 실패해도 나머지는 계속한다(실패한 파츠는 알고리즘 채움 유지). */
export async function redrawAll({ token, layers, signal, limit = 3, onProgress = () => {} }) {
  const targets = redrawTargets(layers);
  const results = new Map();
  const errors = [];
  let next = 0, done = 0;
  onProgress(0, targets.length);
  const worker = async () => {
    while (next < targets.length) {
      const layer = targets[next++];
      if (signal?.aborted) return;
      try {
        const r = await completePart({ token, layers, layer, signal });
        if (r?.drawn) results.set(layer.label, r);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        errors.push(`${layer.label}: ${e.message}`);
        // 토큰·예산 문제는 다른 파츠도 똑같이 실패하므로 멈춘다.
        if (/토큰|예산/.test(e.message)) { next = targets.length; }
      }
      onProgress(++done, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  return { results, errors, total: targets.length };
}
