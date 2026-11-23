// 얼굴 세부 지도: 전신 부위 지도에서는 얼굴이 작아(150px 남짓) 눈·속눈썹이 머리카락색으로 칠해지거나
// 페인팅풍 음영 때문에 눈을 못 찾는다. 얼굴만 크게 잘라 flare에 한 번 더 보내 피부·머리카락·눈썹·흰자·눈동자·
// 속눈썹·입·코를 단색으로 받는다. 의미는 이 지도를, 경계 다듬기는 원화 픽셀을 쓴다.

/** 얼굴 지도 색 → 범주. 0은 배경·그 밖(목·옷·배경). */
export const FACE_CLASSES = [
  { id: 1, key: 'skin', color: [255, 255, 0], prompt: 'skin of the face and ears, including the forehead, cheeks, eyelids, chin and the skin of the nose' },
  { id: 2, key: 'hair', color: [255, 0, 0], prompt: 'all hair, including bangs and loose strands crossing the face' },
  { id: 3, key: 'brow', color: [0, 0, 255], prompt: 'eyebrows' },
  { id: 4, key: 'white', color: [0, 255, 0], prompt: 'the visible whites of the eyes' },
  { id: 5, key: 'iris', color: [255, 0, 255], prompt: 'irises and pupils, including their highlights' },
  { id: 6, key: 'lash', color: [0, 0, 0], prompt: 'upper and lower eyelashes and the dark eyelid lines around each eye' },
  { id: 7, key: 'mouth', color: [0, 255, 255], prompt: 'lips, mouth opening and teeth' },
  { id: 8, key: 'nose', color: [255, 128, 0], prompt: 'only the drawn nose details: nostrils and the nose outline or shadow line' },
];
export const FACE_ID = Object.fromEntries(FACE_CLASSES.map((c) => [c.key, c.id]));
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

export function faceMapPrompt() {
  return 'This is a close-up crop of a character illustration around the face. Convert it into a flat semantic color map. Keep exactly the same '
    + 'canvas, framing, position and size; every boundary must stay exactly where it is in the original, and each eye, eyebrow and lash line '
    + 'must keep its exact shape and place. Paint each region with one flat solid color, with no outlines, no shading, no gradients and no text. '
    + 'Classes: ' + FACE_CLASSES.map((c) => `${c.prompt} = ${hex(c.color)}`).join('; ')
    + '; everything else (neck, clothing, accessories, background) = pure white #FFFFFF.';
}

/** 얼굴 지도 RGBA → 범주 번호(가장 가까운 팔레트 색이 충분히 가까울 때만). */
export function classifyFaceMap(rgba, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (r > 215 && g > 215 && b > 215) continue;
    let best = 0, bestD = Infinity;
    for (const c of FACE_CLASSES) {
      const d = (r - c.color[0]) ** 2 + (g - c.color[1]) ** 2 + (b - c.color[2]) ** 2;
      if (d < bestD) { bestD = d; best = c.id; }
    }
    if (bestD < 100 * 100) out[i] = best;
  }
  return out;
}

/**
 * 전신 부위 지도(AI_CLASSES 번호)에서 얼굴 덩어리를 찾아 얼굴 지도용 상자를 돌려준다.
 * 얼굴 주변 머리카락까지 들어가게 넉넉히(가로 40%, 위 45%, 아래 20%) 넓힌다.
 */
export function faceCropBox(labels, w, h, faceId = 2) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  // 가장 큰 얼굴 덩어리만(손·다리 피부가 얼굴색으로 칠해진 경우 제외)
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let i0 = 0; i0 < w * h; i0++) {
    if (labels[i0] !== faceId || seen[i0]) continue;
    const q = [i0]; seen[i0] = 1; let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i - x) / w;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && labels[j] === faceId && !seen[j]) { seen[j] = 1; q.push(j); }
    }
    if (!best || q.length > best.n) best = { n: q.length, x0: bx0, y0: by0, x1: bx1, y1: by1 };
  }
  if (!best || best.n < 200) return null;
  ({ x0, y0, x1, y1, n } = best);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const X0 = Math.max(0, Math.floor(x0 - bw * 0.4)), X1 = Math.min(w, Math.ceil(x1 + 1 + bw * 0.4));
  const Y0 = Math.max(0, Math.floor(y0 - bh * 0.45)), Y1 = Math.min(h, Math.ceil(y1 + 1 + bh * 0.2));
  return { x: X0, y: Y0, width: X1 - X0, height: Y1 - Y0, area: n };
}

/**
 * 얼굴 지도로 전신 부위 지도를 고친다(얼굴 상자 안). 머리카락·얼굴 경계만 다시 정한다:
 * 피부·이목구비 → 얼굴(전신 지도가 머리카락·얼굴·빈칸이던 자리만), 머리카락 → 머리카락(얼굴이던 자리만).
 * 목·옷·머리띠 같은 다른 부위는 건드리지 않는다(얼굴 지도는 머리띠도 머리카락으로 칠하곤 한다).
 */
export function mergeFaceMap(labels, face, { hairId = 1, faceId = 2, otherId = 10 } = {}) {
  const out = labels.slice(), pin = new Uint8Array(labels.length);
  let changed = 0;
  for (let i = 0; i < out.length; i++) {
    const k = face[i], was = out[i];
    if (!k) continue;
    let to = was;
    if (k === FACE_ID.hair) { if (was === faceId || was === hairId) to = hairId; }
    // 전신 지도의 '기타'(손에 든 물건·머리띠)는 얼굴로 바꾸지 않는다: 얼굴 상자 안에 들어온 삼지창 끝이 얼굴이 된다.
    else if (was === hairId || was === faceId || was === 0) to = faceId;
    // 고친 자리는 고정(pin): 색 영역 다수결이 얼굴 지도를 다시 덮지 않게(페인팅풍은 피부·금발이 한 색 영역으로 묶이곤 한다)
    if (to === faceId || to === hairId) pin[i] = to;
    if (to !== was) { out[i] = to; changed++; }
  }
  return { labels: out, pin, changed };
}
