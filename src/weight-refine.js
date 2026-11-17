// 웨이트 기반 메쉬 세분화 (모델 없음).
// 메쉬 정점은 관절 띠 줄과 외곽선에만 있어서, 무릎~발목·허리~가슴처럼 띠를 가로지르는 큰 삼각형이 생긴다.
// 이런 삼각형은 세 꼭짓점의 웨이트가 크게 달라 관절을 굽히면 통째로 눌리거나 뒤집힌다(선형 블렌드 스키닝의 한계).
// 그래서 꼭짓점 웨이트 차이가 큰 긴 변의 가운데에 정점을 더 넣어, 웨이트가 바뀌는 구간을 작은 삼각형으로 촘촘히 나눈다.
// 웨이트가 같은 넓은 면(단단한 부분)은 그대로 두므로 정점 수가 크게 늘지 않는다.

/** 두 웨이트(뼈→값, 합 1)의 차이: 0(같음) ~ 1(완전히 다른 뼈) */
export function weightDistance(a, b) {
  let d = 0;
  for (const [bone, w] of a) d += Math.abs(w - (b.get(bone) || 0));
  for (const [bone, w] of b) if (!a.has(bone)) d += w;
  return d / 2;
}

/**
 * @param {number[][]} points 메쉬 정점 [x,y] (레이어 좌표)
 * @param {number[]} triangles 정점 번호 3개씩
 * @param {(x:number,y:number)=>Map<string,number>} weightAt
 * @param {{minEdge:number, threshold?:number, limit?:number}} options
 * @returns {number[][]} 새로 넣을 점
 */
export function refinementPoints(points, triangles, weightAt, { minEdge, threshold = 0.3, limit = 160 }) {
  const weights = points.map(([x, y]) => weightAt(x, y));
  const seen = new Set(), out = [];
  const edges = [];
  for (let k = 0; k + 2 < triangles.length; k += 3) {
    const t = [triangles[k], triangles[k + 1], triangles[k + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [ax, ay] = points[a], [bx, by] = points[b], length = Math.hypot(bx - ax, by - ay);
      if (length < minEdge) continue;
      const d = weightDistance(weights[a], weights[b]);
      if (d < threshold) continue;
      // 웨이트 차이 × 길이가 큰 변부터: 굽힐 때 가장 크게 눌리는 곳
      edges.push({ score: d * length, x: (ax + bx) / 2, y: (ay + by) / 2 });
    }
  }
  edges.sort((p, q) => q.score - p.score);
  for (const e of edges.slice(0, limit)) out.push([e.x, e.y]);
  return out;
}
