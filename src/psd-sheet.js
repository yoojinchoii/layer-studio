// 쪼갠 파츠를 겹치지 않게 펼쳐 한 장의 PSD로 본다.
// 위쪽 그룹 "펼친 파츠"는 파츠마다 레이어 하나(가려졌던 자리까지 다 보임),
// 아래쪽 그룹 "조립본"은 원래 위치 그대로(숨김) — 한 파일에서 둘을 번갈아 볼 수 있다.
import {compositePixels} from './psd-document.js';

const sizeOf = (l) => ({ w: l.canvas?.width || l.width, h: l.canvas?.height || l.height });

/**
 * 선반(shelf) 배치: 큰 파츠부터 줄 단위로 왼쪽→오른쪽으로 놓는다. 입력 순서(앞→뒤)는 바꾸지 않고 좌표만 돌려준다.
 * @returns {{width:number,height:number,places:Array<{x:number,y:number}>}}
 */
export function sheetLayout(layers, { gap = 24, minWidth = 0 } = {}) {
  const sizes = layers.map(sizeOf);
  const area = sizes.reduce((a, s) => a + (s.w + gap) * (s.h + gap), 0);
  const widest = sizes.reduce((a, s) => Math.max(a, s.w), 0);
  const width = Math.ceil(Math.max(minWidth, widest + gap * 2, Math.sqrt(area) * 1.25));
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || a - b);
  const places = new Array(layers.length);
  let x = gap, y = gap, row = 0;
  for (const i of order) {
    const { w, h } = sizes[i];
    if (x > gap && x + w + gap > width) { x = gap; y += row + gap; row = 0; }
    places[i] = { x, y };
    x += w + gap; row = Math.max(row, h);
  }
  return { width, height: Math.ceil(y + row + gap), places };
}

/** ag-psd 문서: 펼친 파츠(보임) + 조립본(숨김). layers는 앞→뒤 순서, 각 {name,canvas|data,x,y,opacity,visible}. */
export function sheetDocument(layers, width, height, { gap = 24 } = {}) {
  const layout = sheetLayout(layers, { gap, minWidth: width });
  const W = Math.max(layout.width, width), H = Math.max(layout.height, height);
  const pixels = (l) => (l.canvas ? { canvas: l.canvas } : { imageData: { width: l.width, height: l.height, data: l.data } });
  const spread = layers.map((l, i) => ({ ...l, x: layout.places[i].x, y: layout.places[i].y, visible: true, opacity: 1 }));
  return {
    width: W, height: H, imageData: compositePixels(spread, W, H),
    children: [
      { name: '조립본 (원래 위치)', opened: false, hidden: true, blendMode: 'pass through',
        children: [...layers].reverse().map((l) => ({ name: l.name, left: l.x, top: l.y, opacity: l.opacity ?? 1, hidden: l.visible === false, blendMode: 'normal', ...pixels(l) })) },
      { name: '펼친 파츠', opened: true, blendMode: 'pass through',
        children: [...spread].reverse().map((l) => ({ name: l.name, left: l.x, top: l.y, opacity: 1, blendMode: 'normal', ...pixels(l) })) },
    ],
  };
}
