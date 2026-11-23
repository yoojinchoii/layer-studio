// gpt-image-2.6-flare (사내 AI Proxy 경유) 호출: 파츠 분리용 부위 지도, 가려진 부분까지 파츠 완성하기.
// AI Proxy API(aiproxy-api…)는 브라우저 CORS를 허용하므로 사용자의 AI Proxy 토큰으로 바로 부른다.
// 토큰은 이 브라우저에만 보관한다(기본: 탭을 닫으면 지워지는 sessionStorage, 선택 시 localStorage).

import { segmentationPrompt, classifyMap } from './local-engine/ai-labels.js';
import { faceMapPrompt, classifyFaceMap, faceCropBox } from './local-engine/face-map.js';

export const FLARE_ENGINE = 'flare';
export const FLARE_MODEL = 'gpt-image-2.6-flare';
// 그리기(가려진 부분·뒷머리·눈꺼풀)는 더 정밀한 sunburst가 기본: 옷 주름·레이스·머리결을 원화 비율 그대로 살린다(대신 2~3배 느림).
// 부위 지도·관절 점은 모양만 맞으면 되니 빠른 flare로.
export const DRAW_MODELS = { sunburst: 'gpt-image-2.6-sunburst', flare: FLARE_MODEL };
let drawModel = DRAW_MODELS.sunburst;
export const setDrawModel = (key) => { drawModel = DRAW_MODELS[key] || DRAW_MODELS.sunburst; };
export const currentDrawModel = () => drawModel;
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

async function callFlare({ token, image, mask, prompt, size, quality = 'medium', signal, model = FLARE_MODEL }) {
  const form = new FormData();
  form.append('model', model);
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

/**
 * 얼굴 세부 지도: 전신 지도의 얼굴 덩어리 둘레를 원본 해상도에서 잘라 크게 보내고, 결과를 작업 해상도 범주로 돌려준다.
 * @param {{token:string, source:HTMLCanvasElement, full:CanvasImageSource & {width:number,height:number}, labels:Uint8Array, signal?:AbortSignal}} o
 * source = 작업 해상도 원화, full = 원본 해상도 원화, labels = 전신 지도 범주
 */
export async function requestFaceMap({ token, source, full, labels, signal }) {
  const w = source.width, h = source.height, box = faceCropBox(labels, w, h);
  if (!box) return null;
  const k = full.width / w, B = { x: box.x * k, y: box.y * k, width: box.width * k, height: box.height * k };
  const size = flareSize(B.width, B.height), t = fitTransform(B.width, B.height, size[0], size[1]);
  const input = make(size[0], size[1]), ctx = input.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size[0], size[1]);
  ctx.drawImage(full, B.x, B.y, B.width, B.height, t.ox, t.oy, B.width * t.s, B.height * t.s);
  const { canvas: map } = await callFlare({ token, image: await toBlob(input), prompt: faceMapPrompt(), size, signal });
  const back = make(w, h), bctx = back.getContext('2d', { willReadFrequently: true });
  bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, w, h); bctx.imageSmoothingEnabled = false;
  const sx = map.width / size[0], sy = map.height / size[1];
  bctx.drawImage(map, t.ox * sx, t.oy * sy, B.width * t.s * sx, B.height * t.s * sy, box.x, box.y, box.width, box.height);
  return classifyFaceMap(bctx.getImageData(0, 0, w, h).data, w * h);
}

// ── 관절: flare가 흰 바탕에 관절마다 정해진 색 점을 찍고, 점의 위치를 읽는다 ──
// 좌우는 화면 기준(어깨·엉덩이가 그림 왼쪽에 있는 팔·다리 = _left). 리그 관절 이름도 화면 기준이다.
export const KEYPOINT_COLORS = {
  neck: [255, 255, 0],
  shoulder_left: [255, 0, 0], elbow_left: [255, 136, 0], wrist_left: [255, 0, 255],
  shoulder_right: [0, 0, 255], elbow_right: [0, 255, 255], wrist_right: [136, 0, 255],
  hip_left: [0, 255, 0], knee_left: [0, 102, 0], ankle_left: [136, 68, 0],
  hip_right: [255, 136, 204], knee_right: [0, 0, 136], ankle_right: [0, 136, 136],
};
export function keypointPrompt() {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), K = KEYPOINT_COLORS;
  return 'Pose keypoint chart. Keep exactly the same canvas, framing and scale. Replace the whole illustration with a plain white background and draw only a thin light-gray stick figure '
    + 'where the character\'s skeleton is, with a filled circle (about 14 px wide, flat pure color, no outline, no shading) on each joint at its exact position in the original picture:\n'
    + `- base of the neck (between the collarbones): yellow ${hex(K.neck)}\n`
    + `- the arm whose shoulder is on the LEFT side of the picture: shoulder red ${hex(K.shoulder_left)}, elbow orange ${hex(K.elbow_left)}, wrist magenta ${hex(K.wrist_left)}\n`
    + `- the arm whose shoulder is on the RIGHT side of the picture: shoulder blue ${hex(K.shoulder_right)}, elbow cyan ${hex(K.elbow_right)}, wrist purple ${hex(K.wrist_right)}\n`
    + `- the leg whose hip is on the LEFT side of the picture: hip green ${hex(K.hip_left)}, knee dark green ${hex(K.knee_left)}, ankle brown ${hex(K.ankle_left)}\n`
    + `- the leg whose hip is on the RIGHT side of the picture: hip pink ${hex(K.hip_right)}, knee navy ${hex(K.knee_right)}, ankle teal ${hex(K.ankle_right)}\n`
    + 'The wrist is where the hand meets the forearm, not on the fingers. Place joints where they really are even if hidden under clothing, hair or a skirt (estimate from the body). '
    + 'Skip a limb entirely if it is not in the picture. Do not draw the character, clothes, hair, text or any other marks.';
}
/** 키포인트 그림(RGBA, w×h)에서 색마다 가장 큰 점 덩어리의 가운데. 없거나 너무 작으면 빠진다. */
export function detectKeypoints(data, w, h, { tolerance = 110, minPixels = 6 } = {}) {
  const out = {}, entries = Object.entries(KEYPOINT_COLORS), label = new Int8Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 40 && !(r < 60 && g < 60 && b < 60)) continue; // 흰 바탕·회색 막대
    let best = -1, bd = tolerance;
    entries.forEach(([, c], k) => { const d = Math.hypot(r - c[0], g - c[1], b - c[2]); if (d < bd) { bd = d; best = k; } });
    label[i] = best;
  }
  const seen = new Uint8Array(w * h);
  entries.forEach(([name], k) => {
    let bestN = 0, bx = 0, by = 0;
    for (let i = 0; i < w * h; i++) {
      if (label[i] !== k || seen[i]) continue;
      const q = [i]; seen[i] = 1; let n = 0, sx = 0, sy = 0;
      while (q.length) { const p = q.pop(), x = p % w, y = (p - x) / w; n++; sx += x; sy += y;
        for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (j >= 0 && !seen[j] && label[j] === k) { seen[j] = 1; q.push(j); } }
      if (n > bestN) { bestN = n; bx = sx / n; by = sy / n; }
    }
    if (bestN >= minPixels) out[name] = { x: bx, y: by };
  });
  return out;
}
/** 원화(작업 해상도 canvas)의 관절 위치를 flare로 찾는다. 작업 해상도 픽셀 좌표. */
export async function requestKeypoints({ token, source, signal }) {
  const w = source.width, h = source.height, size = flareSize(w, h), t = fitTransform(w, h, size[0], size[1]);
  const input = make(size[0], size[1]), ctx = input.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size[0], size[1]); ctx.drawImage(source, t.ox, t.oy, w * t.s, h * t.s);
  const { canvas: map } = await callFlare({ token, image: await toBlob(input), prompt: keypointPrompt(), size, signal });
  const back = make(w, h), bctx = back.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = false;
  const sx = map.width / size[0], sy = map.height / size[1];
  bctx.drawImage(map, t.ox * sx, t.oy * sy, w * t.s * sx, h * t.s * sy, 0, 0, w, h);
  return detectKeypoints(bctx.getImageData(0, 0, w, h).data, w, h, { minPixels: Math.max(4, Math.round((w * h) / 200000)) });
}

const PART_TEXT = {
  front_hair: 'hair', back_hair: 'back part of the hair seen behind the head', face: 'face skin', neck: 'neck', topwear: 'upper-body clothing (shirt or top)',
  sleeve_r: 'sleeve', sleeve_l: 'sleeve', arm_r: 'arm and hand', arm_l: 'arm and hand', handwear: 'arms and hands',
  bottomwear: 'lower-body clothing (skirt, shorts or trousers)', legwear_r: 'leg', legwear_l: 'leg', footwear_r: 'shoe', footwear_l: 'shoe', tail: 'tail',
  irides_r: 'iris and pupil of an eye', irides_l: 'iris and pupil of an eye', eyewhite_r: 'white of an eye', eyewhite_l: 'white of an eye',
};
// 앞에서 가리던 파츠 이름(프롬프트에서 "이건 그리지 말라"고 알려 준다)
const COVER_TEXT = {
  front_hair: 'the hair', face: 'the face', neck: 'the neck', topwear: 'the shirt', sleeve_r: 'a sleeve', sleeve_l: 'a sleeve', arm_r: 'an arm', arm_l: 'an arm',
  handwear: 'the arms', bottomwear: 'the skirt or shorts', footwear_r: 'a shoe', footwear_l: 'a shoe', legwear_r: 'a leg', legwear_l: 'a leg', tail: 'the tail',
  eyebrow_r: 'the eyebrows', eyebrow_l: 'the eyebrows', eyelash_r: 'the eyes', eyelash_l: 'the eyes', eyewhite_r: 'the eyes', eyewhite_l: 'the eyes',
  irides_r: 'the eyes', irides_l: 'the eyes', mouth: 'the mouth', nose: 'the nose',
};
// 파츠별 지시: 가려진 쪽으로 어디까지 이어지는지, 무엇을 그리면 안 되는지.
const PART_HINT = {
  face: 'The eyes, eyebrows, eyelashes, nose and mouth are separate layers: paint their places as smooth bare skin only (no eyes, no eye whites, no mouth, no hair strands). The face skin continues up under the bangs to the hairline. Any ears hidden under the hair are small, rounded human ears, never pointed. This layer is only the bare skin of the face: there is no hair on it at all, so every place where hair lay over or around the face stays flat background except the face skin itself. ',
  neck: 'The neck continues a little upward behind the chin and downward under the collar; draw only plain neck skin, never a face, ears or hair. Most of the masked area is not neck: leave it as background. ',
  topwear: 'If the garment has sleeves, its body fabric continues outward under each sleeve: draw full rounded shoulders that reach out to the outer edge of the shoulders, and the sides of the garment going down from the armpits, with the same outline. Do not draw the sleeves themselves, arms, hands, hair or skin. ',
  arm_r: 'The bare arm continues upward under the sleeve to a rounded shoulder; draw that upper arm and shoulder with its outline. ',
  arm_l: 'The bare arm continues upward under the sleeve to a rounded shoulder; draw that upper arm and shoulder with its outline. ',
  legwear_r: 'The leg continues a little upward under the skirt or shorts and down to the ankle as bare skin; draw it with its outline. Never draw a shoe, boot or sock: footwear is a separate layer. Do not draw the other leg. ',
  legwear_l: 'The leg continues a little upward under the skirt or shorts and down to the ankle as bare skin; draw it with its outline. Never draw a shoe, boot or sock: footwear is a separate layer. Do not draw the other leg. ',
  bottomwear: 'The waistband continues upward a little under the shirt; draw the hidden top of the garment with its outline. ',
  back_hair: 'Draw the hair mass behind the head and neck that the face and front hair were hiding. ',
  tail: 'The tail continues under the legs, skirt or body toward its root at the lower back; draw that hidden part of the same tail with its outline, keeping its thickness. Never draw legs, clothing or a second tail. ',
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
  // 뒷머리는 원화에 보이는 곳이 없다: 얼굴 뒤 자리(레이어 모양)를 통째로 그리게 하고, 앞머리를 둘레 참고 그림으로 보여 준다.
  if (layer.label === 'back_hair') return backHairPlan(layers, layer, W, H, pad);
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    const j = y * layer.width + x;
    if (layer.data[j * 4 + 3] > 0 && !layer.fillMask?.[j]) vis[(layer.y + y) * W + layer.x + x] = 1;
  }
  // 다리는 신발 속을 발목까지만(신발 입구 쪽 35%) 연다: 더 열면 flare가 그 자리에 신발·양말을 그린다.
  const ankleOnly = /^legwear/.test(layer.label);
  for (const f of layers.slice(0, Math.max(0, index)).reverse()) for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const j = y * f.width + x;
    if (f.data[j * 4 + 3] <= 128 || f.fillMask?.[j]) continue;
    if (ankleOnly && /^footwear/.test(f.label) && y > f.height * 0.35) continue;
    const i = (f.y + y) * W + f.x + x;
    cov[i] = 1; front.set(f.data.subarray(j * 4, j * 4 + 4), i * 4);
    if (!covers.has(f.label)) covers.set(f.label, []);
    covers.get(f.label).push(i);
  }
  // 닿는 거리: 작업 해상도의 reach 비율, 다만 작은 파츠(눈 등)는 제 크기의 60%까지만(얼굴 전체로 번지지 않게)
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let i = 0; i < W * H; i++) if (vis[i]) { const x = i % W, y = (i - x) / W; if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y; }
  // 흰자·눈동자는 눈 크기의 30%까지만: 더 열면 눈보다 훨씬 큰 공을 그린다(어차피 얼굴의 눈 구멍 둘레만 보인다).
  const own = /^(eyewhite|irides)/.test(layer.label) ? 0.3 : 0.6;
  const dist = distanceFrom(vis, W, H), R = Math.min(Math.max(W, H) * reach, Math.max(8, (Math.max(bx1 - bx0, by1 - by0) + 1) * own));
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

/** 뒷머리 계획: edit = 뒷머리 자리(3px 넓힘), color = 둘레의 앞머리(참고용, 파츠에는 넣지 않는다), visible 없음. */
function backHairPlan(layers, layer, W, H, pad) {
  const area = new Uint8Array(W * H);
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) if (layer.data[(y * layer.width + x) * 4 + 3] > 0) area[(layer.y + y) * W + layer.x + x] = 1;
  const d = distanceFrom(area, W, H), editAll = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1, editable = 0;
  for (let i = 0; i < W * H; i++) if (d[i] <= 3) { editAll[i] = 1; editable++; const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const hair = layers.find((l) => l.label === 'front_hair');
  if (hair) { x0 = Math.min(x0, hair.x); y0 = Math.min(y0, hair.y); x1 = Math.max(x1, hair.x + hair.width - 1); y1 = Math.max(y1, hair.y + hair.height - 1); }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, edit = new Uint8Array(w * h), color = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edit[y * w + x] = editAll[(y0 + y) * W + x0 + x];
  if (hair) for (let y = 0; y < hair.height; y++) for (let x = 0; x < hair.width; x++) {
    const gx = hair.x + x - x0, gy = hair.y + y - y0, j = (y * hair.width + x) * 4;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h || edit[gy * w + gx]) continue;
    color.set(hair.data.subarray(j, j + 4), (gy * w + gx) * 4);
  }
  return { x0, y0, w, h, visible: new Uint8Array(w * h), edit, color, front: new Uint8ClampedArray(w * h * 4), editable, covering: [], whole: true };
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
  if (label === 'back_hair') return `Draw one isolated layer of a ${plain ? 'fully clothed, all-ages 2D cartoon game' : '2D anime'} character for Spine skeletal animation. The image shows only the front hair (bangs and side locks) on a flat ${bgName} background; the face has been removed. `
    + 'Inside the masked area, draw the back part of the same hair that sits behind the head: a hair mass with the same hair color, a slightly darker shade because it is behind, the same strand lines, highlights and outline style. '
    + `Fill the masked area with hair, following the hair flow. Never draw a face, skin, ears, eyes, neck or clothing. Keep everything outside the mask unchanged.`;
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
  for (let i = 0; i < n; i++) if (visible[i] || (plan.whole && edit[i] && alpha[i] >= 0.5)) { keep[i] = 1; queue.push(i); }
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
    ({ canvas: out } = await callFlare({ token, image, mask, prompt: completionPrompt(layer.label, plan.covering, bg.name), size, signal, model: drawModel }));
  } catch (e) {
    // 다리·목처럼 맨살 파츠는 안전 필터에 가끔 걸린다: 순한 문장으로 한 번 더.
    if (!/safety|moderation|rejected/i.test(e.message)) throw e;
    ({ canvas: out } = await callFlare({ token, image, mask, prompt: completionPrompt(layer.label, plan.covering, bg.name, { plain: true }), size, signal, model: drawModel }));
  }
  const back = make(w, h), bctx = back.getContext('2d', { willReadFrequently: true });
  const sx = out.width / size[0], sy = out.height / size[1];
  bctx.drawImage(out, t.ox * sx, t.oy * sy, w * t.s * sx, h * t.s * sy, 0, 0, w, h);
  const merged = mergeCompletion(plan, bctx.getImageData(0, 0, w, h).data, bg.rgb);
  if (!merged) throw Error('flare 결과에서 파츠를 찾지 못했어요');
  if (!plan.whole && plan.editable > 4000 && merged.drawn / plan.editable > MAX_FILLED_SHARE) throw Error(`가리던 파츠까지 그린 것 같아 버렸어요 (${Math.round((100 * merged.drawn) / plan.editable)}%)`);
  return merged;
}

/** 여러 파츠를 동시에 최대 limit개씩 완성한다. 하나가 실패해도 나머지는 계속한다(실패한 파츠는 알고리즘 채움 유지). */
export async function redrawAll({ token, layers, signal, limit = 4, onProgress = () => {} }) {
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

// ── 눈꺼풀: flare가 "감은 눈"을 그리고, 그 피부를 얼굴 뒤 눈꺼풀 레이어로 쓴다 ──
// 그림은 위가 평평하고(구멍 맨 위 줄) 아래는 열마다 구멍 아래끝까지: 높이 H = 구멍 전체 높이.
// 평소에는 H만큼 위(얼굴 피부 뒤)에 숨어 있다가, 깜빡일 때 자기 뼈(face_lid_cover)가 H만큼 내려와 얼굴 눈 구멍을 덮는다.
// 내려올 거리가 레이어 높이 그 자체라 리깅 쪽은 픽셀 없이 크기만으로 안다.
export const EYELID_PROMPT = 'Close-up of an anime character\'s open eye. Paint the same eye closed: inside the masked area draw only the smooth upper eyelid skin '
  + 'that covers the eye when it is closed, in the same skin tone with the same soft cel shading, and at most a thin, faint eyelid crease. '
  + 'No eye white, iris, pupil, highlight or eyelashes inside the mask. Keep everything outside the mask unchanged.';

/** 눈 뜬 자리(흰자·눈동자의 원화 픽셀을 열마다 위~아래로 메운 것)와 flare에 보낼 잘라 낸 영역. side = 'r' | 'l' */
export function eyelidPlan(layers, side) {
  const parts = layers.filter((l) => l.label === `eyewhite_${side}` || l.label === `irides_${side}`);
  if (!parts.length) return null;
  let W = 0, H = 0;
  for (const l of layers) { W = Math.max(W, l.x + l.width); H = Math.max(H, l.y + l.height); }
  const top = new Map(), bot = new Map();
  const put = (gx, gy) => { if (!top.has(gx) || gy < top.get(gx)) top.set(gx, gy); if (!bot.has(gx) || gy > bot.get(gx)) bot.set(gx, gy); };
  let ex0 = Infinity, ey0 = Infinity, ex1 = -1, ey1 = -1;
  for (const l of parts) for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
    const j = y * l.width + x;
    if (l.data[j * 4 + 3] <= 16 || l.fillMask?.[j]) continue;
    const gx = l.x + x, gy = l.y + y; put(gx, gy);
    ex0 = Math.min(ex0, gx); ey0 = Math.min(ey0, gy); ex1 = Math.max(ex1, gx); ey1 = Math.max(ey1, gy);
  }
  // 얼굴의 눈 구멍(얼굴이 다 불투명하지 않은 곳)도 눈 뜬 자리: 구멍 가장자리로 흰자 테두리가 비치지 않게
  const face = layers.find((l) => l.label === 'face');
  if (face && ex1 >= 0) for (let gy = ey0 - 3; gy <= ey1 + 3; gy++) for (let gx = ex0 - 3; gx <= ex1 + 3; gx++) {
    const x = gx - face.x, y = gy - face.y; if (x < 0 || y < 0 || x >= face.width || y >= face.height) continue;
    if (face.data[(y * face.width + x) * 4 + 3] < 200) put(gx, gy);
  }
  if (top.size < 4) return null;
  const xs = [...top.keys()].sort((a, b) => a - b), x0 = xs[0], x1 = xs[xs.length - 1];
  // 빈 열(속눈썹 끝 등)은 양옆 값을 잇는다
  for (let x = x0; x <= x1; x++) if (!top.has(x)) { let k = 1; while (!top.has(x - k) && !top.has(x + k)) k++; const s = top.has(x - k) ? x - k : x + k; top.set(x, top.get(s)); bot.set(x, bot.get(s)); }
  let minTop = Infinity, maxTop = -Infinity, maxBot = -Infinity;
  for (let x = x0; x <= x1; x++) { minTop = Math.min(minTop, top.get(x)); maxTop = Math.max(maxTop, top.get(x)); maxBot = Math.max(maxBot, bot.get(x)); }
  const S = maxBot - minTop + 1, bw = x1 - x0 + 1, m = Math.round(Math.max(bw, S) * 0.8);
  const crop = { x: Math.max(0, x0 - m), y: Math.max(0, minTop - m) };
  crop.w = Math.min(W, x1 + 1 + m) - crop.x; crop.h = Math.min(H, maxBot + 1 + m) - crop.y;
  return { side, x0, x1, top, bot, minTop, maxTop, S, crop, W, H };
}

/** 앞→뒤 레이어를 잘라 낸 영역에 합성(흰 바탕) */
export function compositeCrop(layers, crop) {
  const out = new Uint8ClampedArray(crop.w * crop.h * 4).fill(255);
  for (const l of [...layers].reverse()) for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
    const cx = l.x + x - crop.x, cy = l.y + y - crop.y; if (cx < 0 || cy < 0 || cx >= crop.w || cy >= crop.h) continue;
    const s = (y * l.width + x) * 4, a = l.data[s + 3] / 255; if (!a) continue;
    const d = (cy * crop.w + cx) * 4; for (let k = 0; k < 3; k++) out[d + k] = l.data[s + k] * a + out[d + k] * (1 - a);
  }
  return out;
}

/**
 * flare 결과(잘라 낸 영역 크기 RGBA)로 눈꺼풀 레이어를 만든다. 감은 자리 색이 피부와 너무 다르거나 흰 픽셀이 많으면(눈을 그대로 그림) null.
 * skin = 얼굴 피부색 [r,g,b]
 */
export function buildEyelid(plan, result, skin) {
  const { x0, x1, top, bot, minTop, S, crop } = plan, width = x1 - x0 + 1, height = S;
  const at = (gx, gy) => { const cx = Math.min(crop.w - 1, Math.max(0, gx - crop.x)), cy = Math.min(crop.h - 1, Math.max(0, gy - crop.y)); return result.subarray((cy * crop.w + cx) * 4, (cy * crop.w + cx) * 4 + 3); };
  // 눈 둘레(구멍 밖 2~6px)의 실제 색: 페인팅풍은 눈가 음영(보랏빛 그림자)·옆 머리카락이 있어 얼굴 대표색 하나로는 피부를 못 가린다.
  const inHole = (x, y) => x >= x0 && x <= x1 && y >= top.get(x) - 1 && y <= bot.get(x) + 1;
  const ring = [];
  let maxBot = minTop; for (let x = x0; x <= x1; x++) maxBot = Math.max(maxBot, bot.get(x));
  for (let y = minTop - 6; y <= maxBot + 6; y += 2) for (let x = x0 - 6; x <= x1 + 6; x += 2) {
    if (inHole(x, y) || x < crop.x || y < crop.y || x >= crop.x + crop.w || y >= crop.y + crop.h) continue;
    let near = false; for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (inHole(x + dx, y + dy)) { near = true; break; }
    if (!near) ring.push(at(x, y));
  }
  const skinLike = (c) => Math.hypot(c[0] - skin[0], c[1] - skin[1], c[2] - skin[2]) <= 70 || ring.some((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) <= 45);
  let n = 0, far = 0, white = 0;
  for (let x = x0; x <= x1; x++) for (let y = top.get(x); y <= bot.get(x); y++) {
    const c = at(x, y); n++;
    if (!skinLike(c)) far++;
    if (c[0] > 235 && c[1] > 235 && c[2] > 235) white++;
  }
  // 감은 눈 선·주름은 피부와 다르므로 35%까지 허용(흰 픽셀이 10%를 넘으면 눈을 그대로 그린 것)
  if (!n || far / n > 0.35 || white / n > 0.1) return null;
  const data = new Uint8ClampedArray(width * height * 4), fillMask = new Uint8Array(width * height).fill(1);
  for (let x = x0; x <= x1; x++) {
    const b = bot.get(x);
    for (let gy = minTop; gy <= b; gy++) {
      const c = at(x, gy), d = ((gy - minTop) * width + (x - x0)) * 4;
      data[d] = c[0]; data[d + 1] = c[1]; data[d + 2] = c[2]; data[d + 3] = 255;
    }
  }
  // 평소 자리: 높이만큼 위(얼굴 피부 뒤)
  return { label: `eyelid_${plan.side}`, x: x0, y: minTop - S, width, height, data, fillMask, lidDrop: S };
}

/**
 * 얼굴 눈 구멍 둘레 2px의 밝은 테두리(원화의 피부↔흰자 섞인 색)를 피부색 쪽으로 70% 당기고 불투명하게 한다.
 * 그대로 두면 눈을 감았을 때 눈꺼풀 둘레에 흰 고리가 남는다.
 */
export function tidyFaceRim(face, plan, skin) {
  if (!face?.data) return 0;
  const inOpen = (gx, gy) => gx >= plan.x0 && gx <= plan.x1 && gy >= plan.top.get(gx) && gy <= plan.bot.get(gx);
  const skinLum = 0.299 * skin[0] + 0.587 * skin[1] + 0.114 * skin[2];
  let n = 0;
  for (let gy = plan.minTop - 3; gy <= plan.minTop + plan.S + 2; gy++) for (let gx = plan.x0 - 3; gx <= plan.x1 + 3; gx++) {
    const x = gx - face.x, y = gy - face.y; if (x < 0 || y < 0 || x >= face.width || y >= face.height || inOpen(gx, gy)) continue;
    const i = (y * face.width + x) * 4; if (face.data[i + 3] < 200) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) if (inOpen(gx + dx, gy + dy)) near = true;
    if (!near) continue;
    const lum = 0.299 * face.data[i] + 0.587 * face.data[i + 1] + 0.114 * face.data[i + 2];
    if (lum > skinLum + 10) { for (let k = 0; k < 3; k++) face.data[i + k] = face.data[i + k] * 0.3 + skin[k] * 0.7; n++; }
    face.data[i + 3] = 255;
  }
  return n;
}

/**
 * 위 속눈썹 밑의 얼굴 픽셀을 flare의 감은 눈 그림(같은 자리)으로 칠한다. 깜빡일 때 속눈썹이 내려가면 이 자리가 드러나는데,
 * 원화에는 속눈썹 테두리 섞인 색·흰 점이 남아 있어 지저분하다. 평소에는 속눈썹이 덮고 있어 거의 그대로다.
 */
export function paintUnderLash(face, lash, plan, result, ring = 2) {
  if (!face?.data || !lash?.data) return 0;
  const { crop } = plan; let n = 0;
  const on = (gx, gy) => { const x = gx - lash.x, y = gy - lash.y; return x >= 0 && y >= 0 && x < lash.width && y < lash.height && lash.data[(y * lash.width + x) * 4 + 3] >= 8; };
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  for (let gy = lash.y - ring; gy < lash.y + lash.height + ring; gy++) for (let gx = lash.x - ring; gx < lash.x + lash.width + ring; gx++) {
    const fx = gx - face.x, fy = gy - face.y, cx = gx - crop.x, cy = gy - crop.y;
    if (fx < 0 || fy < 0 || fx >= face.width || fy >= face.height || cx < 0 || cy < 0 || cx >= crop.w || cy >= crop.h) continue;
    const i = (fy * face.width + fx) * 4, j = (cy * crop.w + cx) * 4;
    if (face.data[i + 3] < 200) continue; // 눈 구멍은 그대로(눈꺼풀 그림이 덮는다)
    const under = on(gx, gy);
    if (!under) {
      // 속눈썹 둘레 ring px: 속눈썹 테두리 섞인 색(감은 눈 그림과 밝기가 12 넘게 다른 픽셀)만
      let near = false;
      for (let dy = -ring; dy <= ring && !near; dy++) for (let dx = -ring; dx <= ring && !near; dx++) if (on(gx + dx, gy + dy)) near = true;
      if (!near || Math.abs(lum(face.data, i) - lum(result, j)) <= 12) continue;
    }
    face.data[i] = result[j]; face.data[i + 1] = result[j + 1]; face.data[i + 2] = result[j + 2]; face.data[i + 3] = 255; n++;
  }
  return n;
}

/** 속눈썹 레이어에 붙어 있던 알고리즘 피부 띠(채움 픽셀)를 걷어 낸다 */
export function stripLashBand(layer) {
  if (!layer?.fillMask) return 0;
  let n = 0;
  for (let i = 0; i < layer.fillMask.length; i++) if (layer.fillMask[i]) { layer.data[i * 4 + 3] = 0; layer.fillMask[i] = 0; n++; }
  return n;
}

function skinOf(layers) {
  const face = layers.find((l) => l.label === 'face'); if (!face) return [240, 205, 185];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < face.width * face.height; i++) if (face.data[i * 4 + 3] > 250 && !face.fillMask?.[i]) { r += face.data[i * 4]; g += face.data[i * 4 + 1]; b += face.data[i * 4 + 2]; n++; }
  if (!n) return [240, 205, 185];
  // 피부 주색: 평균 근처 픽셀만 다시 평균(선·그림자 제외)
  const m = [r / n, g / n, b / n]; r = g = b = n = 0;
  for (let i = 0; i < face.width * face.height; i++) if (face.data[i * 4 + 3] > 250) { const c = face.data.subarray(i * 4, i * 4 + 3); if (Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]) < 40) { r += c[0]; g += c[1]; b += c[2]; n++; } }
  return n ? [r / n, g / n, b / n] : m;
}

/** 양쪽 눈꺼풀을 flare로 그려 레이어를 만든다. 얼굴 바로 뒤에 끼우고 속눈썹의 피부 띠는 걷어 낸다. */
/**
 * 흰자·눈동자는 얼굴 뒤에서 눈 구멍으로만 보인다: 완성하며 얼굴 윤곽 밖(머리카락 밑)까지 그려진 부분은 지운다.
 * 남겨 두면 고개를 돌리거나 머리카락이 흔들릴 때 얼굴 밖으로 흰 조각이 드러난다.
 * @returns {number} 지운 픽셀 수
 */
export function clipEyesToFace(layers) {
  const face = layers.find((l) => l.label === 'face'); if (!face) return 0;
  // 얼굴 윤곽 안쪽 = 얼굴 픽셀 + 그 안에 갇힌 구멍(눈 자리). 바깥과 이어진 빈칸만 '얼굴 밖'.
  const W = face.width, H = face.height, outside = new Uint8Array(W * H), q = [];
  const push = (i) => { if (!outside[i] && face.data[i * 4 + 3] <= 128) { outside[i] = 1; q.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  for (let k = 0; k < q.length; k++) { const i = q[k], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W); }
  const alpha = (gx, gy) => { const x = gx - face.x, y = gy - face.y; return x < 0 || y < 0 || x >= W || y >= H || outside[y * W + x] ? 0 : 255; };
  let cut = 0;
  for (const l of layers) {
    if (!/^(eyewhite|irides)_/.test(l.label)) continue;
    for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
      const j = (y * l.width + x) * 4; if (!l.data[j + 3]) continue;
      // 얼굴 픽셀(구멍 포함 1px 안쪽 여유)이 둘레 3px 안에 있으면 남긴다
      let inside = false;
      for (let dy = -3; dy <= 3 && !inside; dy++) for (let dx = -3; dx <= 3; dx++) if (alpha(l.x + x + dx, l.y + y + dy) > 128) { inside = true; break; }
      if (!inside) { l.data[j + 3] = 0; cut++; }
    }
  }
  return cut;
}

export async function drawEyelids({ token, layers, signal }) {
  const made = [], errors = [], skin = skinOf(layers);
  await Promise.all(['r', 'l'].map(async (side) => {
    const plan = eyelidPlan(layers, side); if (!plan) return;
    try {
      const { crop } = plan, size = flareSize(crop.w, crop.h), t = fitTransform(crop.w, crop.h, size[0], size[1]);
      const src = make(crop.w, crop.h); src.getContext('2d').putImageData(new ImageData(compositeCrop(layers, crop), crop.w, crop.h), 0, 0);
      const scene = make(size[0], size[1]), sctx = scene.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, size[0], size[1]); sctx.drawImage(src, t.ox, t.oy, crop.w * t.s, crop.h * t.s);
      const hole = make(crop.w, crop.h), hctx = hole.getContext('2d'), hd = hctx.createImageData(crop.w, crop.h);
      for (let x = plan.x0 - 1; x <= plan.x1 + 1; x++) {
        const cx = Math.min(plan.x1, Math.max(plan.x0, x));
        for (let y = plan.top.get(cx) - 1; y <= plan.bot.get(cx) + 1; y++) { const px = x - crop.x, py = y - crop.y; if (px >= 0 && py >= 0 && px < crop.w && py < crop.h) hd.data[(py * crop.w + px) * 4 + 3] = 255; }
      }
      hctx.putImageData(hd, 0, 0);
      const mask = make(size[0], size[1]), mctx = mask.getContext('2d'); mctx.fillStyle = '#000'; mctx.fillRect(0, 0, size[0], size[1]);
      mctx.globalCompositeOperation = 'destination-out'; mctx.drawImage(hole, t.ox, t.oy, crop.w * t.s, crop.h * t.s);
      // 거부되면 다른 모델로 한 번 더(한쪽 눈만 눈꺼풀이 없으면 깜빡일 때 그 눈만 구멍이 드러난다)
      const image = await toBlob(scene), maskBlob = await toBlob(mask);
      let lid = null, result = null;
      for (const model of [...new Set([drawModel, drawModel === DRAW_MODELS.flare ? DRAW_MODELS.sunburst : DRAW_MODELS.flare])]) {
        const { canvas: out } = await callFlare({ token, image, mask: maskBlob, prompt: EYELID_PROMPT, size, signal, model });
        const back = make(crop.w, crop.h), bctx = back.getContext('2d', { willReadFrequently: true }), sx = out.width / size[0], sy = out.height / size[1];
        bctx.drawImage(out, t.ox * sx, t.oy * sy, crop.w * t.s * sx, crop.h * t.s * sy, 0, 0, crop.w, crop.h);
        result = bctx.getImageData(0, 0, crop.w, crop.h).data;
        lid = buildEyelid(plan, result, skin);
        if (lid) break;
      }
      if (!lid) throw Error('감은 눈 자리가 피부가 아니라서 버렸어요');
      made.push(lid); lid.plan = plan; lid.result = result;
    } catch (e) { if (e.name === 'AbortError') throw e; errors.push(`eyelid_${side}: ${e.message}`); }
  }));
  for (const lid of made) {
    const lash = layers.find((l) => l.label === `eyelash_${lid.label.slice(-1)}`), face = layers.find((l) => l.label === 'face');
    stripLashBand(lash);
    paintUnderLash(face, lash, lid.plan, lid.result);
    tidyFaceRim(face, lid.plan, skin); delete lid.plan; delete lid.result;
    const at = layers.findIndex((l) => l.label === 'face');
    layers.splice(at >= 0 ? at + 1 : layers.length, 0, lid);
  }
  return { made: made.map((l) => l.label), errors };
}
