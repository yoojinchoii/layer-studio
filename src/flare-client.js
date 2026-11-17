// gpt-image-2.6-flare (사내 AI Proxy 경유) 호출: 파츠 분리용 부위 지도, 가려진 부분 다시 그리기.
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
};
// 앞에서 가리던 파츠 이름(프롬프트에서 "이건 그리지 말라"고 알려 준다)
const COVER_TEXT = {
  front_hair: 'hair', face: 'the face', neck: 'the neck', topwear: 'the shirt', sleeve_r: 'a sleeve', sleeve_l: 'a sleeve', arm_r: 'an arm', arm_l: 'an arm',
  handwear: 'the arms', bottomwear: 'the skirt or shorts', footwear_r: 'a shoe', footwear_l: 'a shoe', legwear_r: 'a leg', legwear_l: 'a leg',
};
export const MIN_REDRAW_PIXELS = 250;
export const MAX_FOREIGN_SHARE = 0.3;

/** 다시 그릴 레이어: 채운 픽셀이 충분하고 의미가 있는 파츠만 (눈동자·흰자 같은 작은 조각 제외) */
export function redrawTargets(layers) {
  return layers.filter((l) => l.fillMask && PART_TEXT[l.label] && count(l.fillMask) >= MIN_REDRAW_PIXELS);
}
function count(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; }

/** 이 레이어의 채운 자리를 실제로 덮고 있던 앞쪽 파츠 이름들 (layers는 앞→뒤 순서) */
export function coveringParts(layers, layer) {
  const index = layers.indexOf(layer), names = new Set();
  for (const front of layers.slice(0, Math.max(0, index))) {
    if (!COVER_TEXT[front.label]) continue;
    let hits = 0;
    for (let y = 0; y < layer.height && hits < 20; y++) for (let x = 0; x < layer.width; x++) {
      if (!layer.fillMask[y * layer.width + x]) continue;
      const fx = layer.x + x - front.x, fy = layer.y + y - front.y;
      if (fx >= 0 && fy >= 0 && fx < front.width && fy < front.height && front.data[(fy * front.width + fx) * 4 + 3] > 128 && ++hits >= 20) break;
    }
    if (hits >= 20) names.add(COVER_TEXT[front.label]);
  }
  return [...names];
}

export function redrawPrompt(label, covering = []) {
  const part = PART_TEXT[label] || 'part';
  const cover = covering.length ? covering.join(' and ') : 'other parts';
  return `Inpainting task. The image shows ONE isolated layer of a 2D character for Spine skeletal animation: ${part}. `
    + `The masked area is the part of this ${part} that was covered by ${cover} in the full illustration; the covering parts have been removed and must NOT be drawn. `
    + `Fill the masked area with the ${part} itself, with the same material and colors as its visible part, continuing its outline, cel shading and any folds or pattern `
    + `so it looks like one complete, uncovered ${part} in exactly the same art style. Never paint ${cover} or any clothing, hair, face or object that is not part of the ${part}. `
    + 'Keep the plain white background and keep everything outside the mask unchanged.';
}

/**
 * 한 레이어의 가려진 자리(fillMask)를 flare로 다시 그린다. 알파(모양)는 그대로 두고 그 자리 색만 바꾼다.
 * @param {{label,x,y,width,height,data:Uint8ClampedArray,fillMask:Uint8Array}} layer
 * @param {Array} context 함께 보여 줄 다른 레이어(예: 뒷머리에는 앞머리) — 같은 좌표계
 */
export async function redrawHidden({ token, layer, context = [], covering = [], signal }) {
  const pad = Math.round(Math.max(layer.width, layer.height) * 0.08) + 4;
  let x0 = layer.x - pad, y0 = layer.y - pad, x1 = layer.x + layer.width + pad, y1 = layer.y + layer.height + pad;
  for (const c of context) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.width); y1 = Math.max(y1, c.y + c.height); }
  const w = x1 - x0, h = y1 - y0, size = flareSize(w, h), t = fitTransform(w, h, size[0], size[1]);
  const scene = make(w, h), sctx = scene.getContext('2d');
  sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, w, h);
  const own = make(layer.width, layer.height);
  own.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.width, layer.height), 0, 0);
  sctx.drawImage(own, layer.x - x0, layer.y - y0);
  for (const c of context) {
    const cc = make(c.width, c.height);
    cc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(c.data), c.width, c.height), 0, 0);
    sctx.drawImage(cc, c.x - x0, c.y - y0);
  }
  // 고칠 자리 = 이 레이어의 채운 픽셀 중 앞에 그린 context에 덮이지 않은 곳(1px 넓혀서 경계까지)
  const covered = (gx, gy) => context.some((c) => { const cx = gx - c.x, cy = gy - c.y; return cx >= 0 && cy >= 0 && cx < c.width && cy < c.height && c.data[(cy * c.width + cx) * 4 + 3] > 128; });
  const edit = make(w, h), ectx = edit.getContext('2d'), mask = ectx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) mask.data[i * 4 + 3] = 255;
  let editable = 0;
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    if (!layer.fillMask[y * layer.width + x] || covered(layer.x + x, layer.y + y)) continue;
    editable++;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const mx = layer.x + x - x0 + dx, my = layer.y + y - y0 + dy;
      if (mx >= 0 && my >= 0 && mx < w && my < h) mask.data[(my * w + mx) * 4 + 3] = 0;
    }
  }
  if (editable < MIN_REDRAW_PIXELS) return { changed: 0 };
  ectx.putImageData(mask, 0, 0);
  const place = (c) => { const o = make(size[0], size[1]), ctx = o.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size[0], size[1]); ctx.drawImage(c, t.ox, t.oy, w * t.s, h * t.s); return o; };
  const maskCanvas = make(size[0], size[1]), mctx = maskCanvas.getContext('2d');
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, size[0], size[1]);
  mctx.globalCompositeOperation = 'destination-out';
  // 마스크: 투명 = 고칠 자리. 바깥 여백은 불투명(그대로).
  const hole = make(w, h), hctx = hole.getContext('2d'), holeData = hctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (!mask.data[i * 4 + 3]) holeData.data[i * 4 + 3] = 255;
  hctx.putImageData(holeData, 0, 0);
  mctx.drawImage(hole, t.ox, t.oy, w * t.s, h * t.s);
  const { canvas: out } = await callFlare({ token, image: await toBlob(place(scene)), mask: await toBlob(maskCanvas), prompt: redrawPrompt(layer.label, covering), size, signal });
  // 결과를 레이어 좌표로 되돌려 채운 픽셀의 색만 바꾼다(알파는 원래 모양).
  const back = make(layer.width, layer.height), bctx = back.getContext('2d', { willReadFrequently: true });
  const sx = out.width / size[0], sy = out.height / size[1];
  bctx.drawImage(out, (t.ox + (layer.x - x0) * t.s) * sx, (t.oy + (layer.y - y0) * t.s) * sy, layer.width * t.s * sx, layer.height * t.s * sy, 0, 0, layer.width, layer.height);
  const px = bctx.getImageData(0, 0, layer.width, layer.height).data;
  const data = new Uint8ClampedArray(layer.data);
  // 흰 옷처럼 원래 흰색이 많은 파츠가 아니면, flare가 흰 배경으로 남긴 자리는 "여기는 그리지 않음"으로 보고 기존 채움을 둔다
  // (모양을 깎아 내면 팔을 들 때 어깨에 구멍이 난다).
  let white = 0, seen = 0;
  for (let i = 0; i < layer.fillMask.length; i++) if (!layer.fillMask[i] && data[i * 4 + 3] > 200) { seen++; if (Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= 236) white++; }
  const whitePart = seen && white / seen > 0.15;
  let changed = 0, far = 0, total = 0;
  for (let i = 0; i < layer.fillMask.length; i++) {
    if (!layer.fillMask[i] || !data[i * 4 + 3]) continue;
    const x = i % layer.width, y = (i - x) / layer.width;
    if (covered(layer.x + x, layer.y + y)) continue;
    // 반투명·투명으로 돌아온 자리는 기존 채움색과 섞는다(투명 = 그리지 않음).
    const a = px[i * 4 + 3] / 255;
    if (a < 0.05) continue;
    if (!whitePart && Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) >= 246) continue;
    const rgb = [0, 1, 2].map((k) => px[i * 4 + k] * a + data[i * 4 + k] * (1 - a));
    total++;
    if (Math.hypot(rgb[0] - data[i * 4], rgb[1] - data[i * 4 + 1], rgb[2] - data[i * 4 + 2]) > 110) far++;
    data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2];
    changed++;
  }
  // 안전장치: 다시 그린 자리의 상당 부분이 원래 파츠 색(보간 채움)과 동떨어지면 가리던 옷 등을 그린 것으로 보고 버린다.
  if (total && far / total > MAX_FOREIGN_SHARE) throw Error(`다시 그린 색이 원래 파츠와 너무 달라 버렸어요 (${Math.round((100 * far) / total)}%)`);
  return { changed, data };
}

/** 여러 레이어를 동시에 최대 limit개씩 다시 그린다. 하나가 실패해도 나머지는 계속한다. */
export async function redrawAll({ token, layers, signal, limit = 3, onProgress = () => {} }) {
  const targets = redrawTargets(layers);
  const byLabel = new Map(layers.map((l) => [l.label, l]));
  const results = new Map();
  const errors = [];
  let next = 0, done = 0;
  onProgress(0, targets.length);
  const worker = async () => {
    while (next < targets.length) {
      const layer = targets[next++];
      if (signal?.aborted) return;
      const context = layer.label === 'back_hair' && byLabel.get('front_hair') ? [byLabel.get('front_hair')] : [];
      try {
        const r = await redrawHidden({ token, layer, context, covering: coveringParts(layers, layer), signal });
        if (r.changed) results.set(layer.label, r);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        errors.push(`${layer.label}: ${e.message}`);
        // 토큰·예산 문제는 다른 레이어도 똑같이 실패하므로 멈춘다.
        if (/토큰|예산/.test(e.message)) { next = targets.length; }
      }
      onProgress(++done, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  return { results, errors, total: targets.length };
}
