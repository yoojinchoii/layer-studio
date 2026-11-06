// 색 영역 + 관절 → 리그 파츠. 모델 없이 "뼈까지의 측지 거리"와 영역 단위 투표로 정한다.
// 파츠 이름은 layer-studio rig-core.js가 이해하는 이름을 쓴다.
// _r = 캐릭터 오른쪽 = 화면 왼쪽(관절 *_left), _l = 화면 오른쪽(관절 *_right).

export const GROUPS = [
  { id: 'head', bones: [['head', 'head_top'], ['head', 'hair']] },
  { id: 'neck', bones: [['neck', 'head']] },
  // 어깨선은 60%까지만 몸통: 어깨 끝과 소매는 팔이 가져간다.
  { id: 'torso', bones: [['body', 'chest'], ['chest', 'neck'], ['chest', 'shoulder_mid_left'], ['chest', 'shoulder_mid_right']] },
  { id: 'arm_r', bones: [['arm_left', 'elbow_left'], ['elbow_left', 'wrist_left'], ['wrist_left', 'hand_tip_left']] },
  { id: 'arm_l', bones: [['arm_right', 'elbow_right'], ['elbow_right', 'wrist_right'], ['wrist_right', 'hand_tip_right']] },
  { id: 'pelvis', bones: [['body', 'pelvis'], ['pelvis', 'hip_left'], ['pelvis', 'hip_right']] },
  { id: 'leg_r', bones: [['hip_left', 'knee_left'], ['knee_left', 'ankle_left']] },
  { id: 'leg_l', bones: [['hip_right', 'knee_right'], ['knee_right', 'ankle_right']] },
  { id: 'foot_r', bones: [['ankle_left', 'foot_tip_left']] },
  { id: 'foot_l', bones: [['ankle_right', 'foot_tip_right']] },
];

export const PART_LABELS = {
  handwear: '양팔 (팔짱 · 가슴 고정)',
  hair: '머리카락', face: '얼굴', neck: '목', topwear: '상의',
  sleeve_r: '소매 R (화면 왼쪽)', sleeve_l: '소매 L (화면 오른쪽)',
  arm_r: '팔 R (화면 왼쪽)', arm_l: '팔 L (화면 오른쪽)', bottomwear: '하의',
  legwear_r: '다리 R (화면 왼쪽)', legwear_l: '다리 L (화면 오른쪽)',
  footwear_r: '신발 R (화면 왼쪽)', footwear_l: '신발 L (화면 오른쪽)',
};
const PART_ORDER = Object.keys(PART_LABELS);

/** 선분을 픽셀로 찍는다. */
function rasterize(a, b, visit) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let k = 0; k <= steps; k++) {
    visit(Math.round(a.x + ((b.x - a.x) * k) / steps), Math.round(a.y + ((b.y - a.y) * k) / steps));
  }
}

/**
 * 전경 안에서만 퍼지는 BFS로 각 픽셀에 가장 가까운(측지 거리) 뼈 그룹을 정한다.
 * 팔과 몸통 사이처럼 배경으로 떨어진 곳은 건너뛰지 않는다.
 */
export function boneGroupMap(fg, w, h, points) {
  const groupOf = new Int8Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let tail = 0;
  GROUPS.forEach((group, g) => {
    for (const [from, to] of group.bones) {
      const a = points[from];
      const b = points[to];
      if (!a || !b) continue;
      rasterize(a, b, (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const i = y * w + x;
        if (!fg[i]) return;
        if (groupOf[i] < 0) queue[tail++] = i;
        groupOf[i] = g; // 뒤 그룹(팔다리)이 관절 위치에서 앞 그룹(몸통)을 덮는다
      });
    }
  });
  let head = 0;
  while (head < tail) {
    const i = queue[head++];
    const g = groupOf[i];
    const x = i % w;
    const spread = (j) => { if (fg[j] && groupOf[j] < 0) { groupOf[j] = g; queue[tail++] = j; } };
    if (x > 0) spread(i - 1);
    if (x < w - 1) spread(i + 1);
    if (i >= w) spread(i - w);
    if (i < w * (h - 1)) spread(i + w);
  }
  return groupOf;
}

const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 픽셀 단위로 나눌 수 있는 그룹 짝 (관절에서 이어지는 곳만). 나머지는 영역 다수 그룹으로 접는다.
const SPLIT_PARTNERS = {
  torso: ['arm_r', 'arm_l'], arm_r: ['torso'], arm_l: ['torso'],
  head: ['neck'], neck: ['head'],
  leg_r: ['foot_r'], foot_r: ['leg_r'], leg_l: ['foot_l'], foot_l: ['leg_l'],
};

function withHelperPoints(points) {
  const p = { ...points };
  for (const side of ['left', 'right']) {
    const c = p.chest;
    const s = p[`arm_${side}`];
    if (c && s) p[`shoulder_mid_${side}`] = { x: c.x + (s.x - c.x) * 0.6, y: c.y + (s.y - c.y) * 0.6 };
  }
  return p;
}

/**
 * 영역마다 뼈 그룹 비율을 투표한다.
 * - 한 그룹이 splitThreshold 이상이면 영역 전체를 그 그룹에.
 * - 하체 비율이 25% 이상이면 영역 전체를 하체에 (반바지·치마는 통째로 두고 리그에서 허벅지 가중치를 준다).
 * - 그 밖에는 픽셀 단위로 나눈다 (예: 소매가 이어진 상의 → 몸통 + 양 소매).
 */
/**
 * 턱 관절을 얼굴 피부색으로 다시 잡는다. 긴 머리가 목을 가리면 실루엣이 목에서 가늘어지지 않아
 * 골격만으로는 턱이 눈높이에 놓이기 때문이다. 얼굴 피부 폭이 가장 넓은 줄 아래에서 60% 밑으로
 * 줄어드는 곳을 턱으로 본다. rig.points를 직접 고친다(head, neck, hair).
 */
export function refineHeadJoints(seg, rig) {
  const P = rig.points;
  if (!P.hair || !P.head || !P.neck) return false;
  const { width: w, height: h, labels, regions, fg } = seg;
  let y0 = h, y1 = -1, x0 = w, x1 = -1;
  for (let i = 0; i < fg.length; i++) if (fg[i]) { const x = i % w, y = (i - x) / w; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  const H = y1 - y0 + 1;
  const W = x1 - x0 + 1;
  const px = Math.round((P.hair.x + P.head.x) / 2);
  const py = Math.round(P.hair.y + (P.head.y - P.hair.y) * 0.6);
  const probe = labels[py * w + px];
  if (!probe) return false;
  const skin = regions[probe - 1].color;
  const isSkin = new Uint8Array(regions.length + 1);
  for (const r of regions) isSkin[r.id] = Math.hypot(r.color[0] - skin[0], r.color[1] - skin[1], r.color[2] - skin[2]) < 45 ? 1 : 0;
  const cx = px;
  const reach = Math.round(W * 0.25);
  let maxWidth = 0;
  let maxY = py;
  let chin = -1;
  for (let y = py; y < Math.min(h, py + H * 0.4); y++) {
    // 가운데에서 이어진 피부 구간의 폭
    let x = cx;
    while (x < Math.min(w - 1, cx + reach) && !isSkin[labels[y * w + x]]) x++;
    if (!isSkin[labels[y * w + x]]) { if (maxWidth) { chin = y; break; } continue; }
    let a = x, b = x;
    while (a > Math.max(0, cx - reach) && isSkin[labels[y * w + a - 1]]) a--;
    while (b < Math.min(w - 1, cx + reach) && isSkin[labels[y * w + b + 1]]) b++;
    const width = b - a + 1;
    if (width > maxWidth) { maxWidth = width; maxY = y; }
    else if (y > maxY && width < maxWidth * 0.6) { chin = y; break; }
  }
  if (chin < 0 || maxWidth < W * 0.08) return false;
  if (Math.abs(chin - P.head.y) < H * 0.015) return false;
  P.head = { x: P.head.x, y: chin };
  if (P.neck.y < chin + H * 0.02) P.neck = { x: P.neck.x, y: chin + H * 0.04 };
  P.hair = { x: P.hair.x, y: y0 + (chin - y0) * 0.45 };
  rig.warnings = [...(rig.warnings || []), '턱 관절을 얼굴 피부 폭으로 다시 잡았습니다.'];
  return true;
}

export function assignParts(seg, rig, { splitThreshold = 0.9, minShare = 0.05 } = {}) {
  const { width: w, height: h, fg, labels, regions } = seg;
  refineHeadJoints(seg, rig);
  // 양팔을 골격에서 못 찾았으면(팔짱·몸에 붙은 팔) 팔 그룹을 만들지 않는다:
  // 비율로 짐작한 팔 뼈가 머리카락·몸통을 끌어가는 것을 막고, 가슴 위 피부를 'handwear' 한 장으로 묶는다.
  const crossed = (rig.missing || []).includes('arm_left') && (rig.missing || []).includes('arm_right') && rig.frame === 'full';
  const base = { ...rig.points, ...rig.ends };
  if (crossed) for (const id of ['arm_left', 'elbow_left', 'wrist_left', 'hand_tip_left', 'arm_right', 'elbow_right', 'wrist_right', 'hand_tip_right']) delete base[id];
  const points = withHelperPoints(base);
  const groupOf = boneGroupMap(fg, w, h, points);
  const G = GROUPS.length;
  const R = regions.length;
  const votes = new Int32Array((R + 1) * G);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] && groupOf[i] >= 0) votes[labels[i] * G + groupOf[i]]++;
  }
  const gid = (name) => GROUPS.findIndex((g) => g.id === name);
  const PELVIS = gid('pelvis');
  const LEG_R = gid('leg_r');
  const LEG_L = gid('leg_l');
  const TORSO = gid('torso');
  const HEAD = gid('head');

  // 피부색: 머리카락 관절과 턱 관절 사이(코 근처) 영역의 색.
  const faceRegion = (() => {
    const a = rig.points.hair;
    const b = rig.points.head;
    if (!a || !b) return -1;
    const x = Math.round((a.x + b.x) / 2);
    const y = Math.round(a.y + (b.y - a.y) * 0.6);
    return x >= 0 && y >= 0 && x < w && y < h ? labels[y * w + x] : -1;
  })();
  const skinColor = faceRegion > 0 ? regions[faceRegion - 1].color : null;
  const skinLike = (r) => r === faceRegion || (skinColor && colorDistance(regions[r - 1].color, skinColor) < 45);
  const topRegion0 = (() => { for (let i = 0; i < labels.length; i++) if (fg[i]) return labels[i]; return -1; })();
  const hairColor0 = topRegion0 > 0 ? regions[topRegion0 - 1].color : null;
  // 머리카락: 맨 위 영역이거나 그 색에 가깝고, 피부색보다 머리색에 더 가까운 영역.
  // 머리색 후보: 맨 위 영역 + 턱 위에서 피부가 아닌 가장 큰 영역 (맨 위가 두건·모자일 수 있다)
  const hairColors = [];
  if (hairColor0) hairColors.push(hairColor0);
  {
    let best = null;
    for (const reg of regions) {
      if (!rig.points.head || reg.centroid[1] >= rig.points.head.y || skinLike(reg.id) || reg.id === topRegion0) continue;
      if (!best || reg.area > best.area) best = reg;
    }
    if (best && best.area > (regions[topRegion0 - 1]?.area || 0) * 0.3) hairColors.push(best.color);
  }
  // 머리카락: 맨 위 영역이거나, 피부가 아니고 머리색 후보 중 하나에 피부색보다 가까운 영역
  const hairLike = (r) => r === topRegion0 || (!skinLike(r) && hairColors.some((c) => {
    const d = colorDistance(regions[r - 1].color, c);
    return d < 60 && (!skinColor || d < colorDistance(regions[r - 1].color, skinColor));
  }));
  // 영역별 결정: whole = 그룹 번호, 아니면 null(픽셀 단위)
  const decision = new Array(R + 1).fill(null);
  const allowed = [];
  for (let r = 1; r <= R; r++) {
    let total = 0;
    let best = 0;
    for (let g = 0; g < G; g++) {
      total += votes[r * G + g];
      if (votes[r * G + g] > votes[r * G + best]) best = g;
    }
    if (!total) { decision[r] = -1; continue; }
    const share = (g) => votes[r * G + g] / total;
    // 어깨·가슴으로 내려온 긴 머리: 허리 위의 머리색 영역은 통째로 머리카락
    if (hairLike(r) && rig.points.body && regions[r - 1].centroid[1] < rig.points.body.y && ['torso', 'arm_r', 'arm_l', 'neck'].includes(GROUPS[best].id)) { decision[r] = HEAD; continue; }
    if (share(best) >= splitThreshold) decision[r] = best;
    // 양다리에 걸친 옷(반바지·치마)은 통째로 하의.
    else if (share(PELVIS) + share(LEG_R) + share(LEG_L) >= 0.6 && share(LEG_R) >= 0.15 && share(LEG_L) >= 0.15) decision[r] = PELVIS;
    else {
      // 머리·목에 걸친 피부가 아닌 영역(머리카락)은 쪼개지 않고 통째로 머리.
      if ((best === HEAD || GROUPS[best].id === 'neck') && hairLike(r)) { decision[r] = HEAD; continue; }
      const partners = SPLIT_PARTNERS[GROUPS[best].id] || [];
      const keep = [best, ...partners.map(gid).filter((g) => share(g) >= minShare)];
      if (keep.length === 1) decision[r] = best;
      else {
        decision[r] = null;
        allowed[r] = new Set(keep);
        allowed[r].best = best;
      }
    }
  }

  // (영역, 그룹) 조각 → 파츠 이름
  const regionColor = (r) => regions[r - 1].color;
  const topRegion = (() => {
    let top = -1;
    for (let i = 0; i < labels.length; i++) if (fg[i]) { top = labels[i]; break; }
    return top;
  })();
  const hairColor = topRegion > 0 ? regionColor(topRegion) : null;
  const faceBox = faceRegion > 0 ? regions[faceRegion - 1].bbox : null;
  const insideFace = (r) => {
    if (!faceBox) return false;
    const [x, y, bw, bh] = regions[r - 1].bbox;
    return x >= faceBox[0] && y >= faceBox[1] && x + bw <= faceBox[0] + faceBox[2] && y + bh <= faceBox[1] + faceBox[3];
  };
  let torsoColor = null;
  let torsoBest = 0;
  for (let r = 1; r <= R; r++) {
    if (decision[r] === TORSO || (decision[r] === null && allowed[r].best === TORSO)) {
      if (regions[r - 1].area > torsoBest) { torsoBest = regions[r - 1].area; torsoColor = regionColor(r); }
    }
  }
  const nameFor = (r, g, wasSplit) => {
    const group = GROUPS[g].id;
    if (group === 'head') {
      if (r === topRegion) return 'hair';
      if (r === faceRegion || insideFace(r)) return 'face';
      if (skinColor && colorDistance(regionColor(r), skinColor) < 45) return 'face';
      return 'hair';
    }
    if (group === 'neck') return hairLike(r) ? 'hair' : 'neck';
    // 몸통 그룹의 피부(흉상·반신의 목~가슴)는 목 파츠로.
    if (group === 'torso') {
      if (!skinLike(r)) return 'topwear';
      // 팔짱: 쇄골 아래 가슴 위의 피부는 팔
      if (crossed && rig.points.neck && regions[r - 1].centroid[1] > rig.points.neck.y + h * 0.03) return 'handwear';
      return 'neck';
    }
    if (group === 'pelvis') return 'bottomwear';
    const side = group.slice(-1);
    if (group.startsWith('arm')) {
      const sleeve = wasSplit && allowed[r].has(TORSO);
      const shirtColored = torsoColor && colorDistance(regionColor(r), torsoColor) < 30;
      return `${sleeve || shirtColored ? 'sleeve' : 'arm'}_${side}`;
    }
    if (group.startsWith('leg')) return `legwear_${side}`;
    return `footwear_${side}`;
  };

  const partIndex = new Map();
  const parts = [];
  const partOf = (name) => {
    if (!partIndex.has(name)) {
      partIndex.set(name, parts.length + 1);
      parts.push({ name, label: PART_LABELS[name] || name, area: 0, regions: new Set(), minX: w, minY: h, maxX: -1, maxY: -1 });
    }
    return partIndex.get(name);
  };
  const cache = new Map();
  const partLabels = new Int32Array(w * h);
  for (let i = 0; i < labels.length; i++) {
    const r = labels[i];
    if (!r) continue;
    let g = decision[r];
    let split = false;
    if (g === null) {
      split = true;
      g = groupOf[i] >= 0 && allowed[r].has(groupOf[i]) ? groupOf[i] : allowed[r].best;
    }
    if (g < 0) g = HEAD;
    const key = r * 64 + g * 2 + (split ? 1 : 0);
    let p = cache.get(key);
    if (p === undefined) { p = partOf(nameFor(r, g, split)); cache.set(key, p); }
    partLabels[i] = p;
    const part = parts[p - 1];
    part.area++;
    part.regions.add(r);
    const x = i % w;
    const y = (i - x) / w;
    if (x < part.minX) part.minX = x;
    if (x > part.maxX) part.maxX = x;
    if (y < part.minY) part.minY = y;
    if (y > part.maxY) part.maxY = y;
  }

  // 파츠마다 큰 덩어리만 남기고, 떨어진 작은 조각은 가장 많이 맞닿은 이웃 파츠로 보낸다
  // (관절 경계에서 픽셀 단위로 나뉘며 생긴 부스러기가 메쉬를 뒤집는 것을 막는다).
  cleanIslands(partLabels, w, h, parts.length);
  for (const part of parts) { part.area = 0; part.minX = w; part.minY = h; part.maxX = -1; part.maxY = -1; }
  for (let i = 0; i < partLabels.length; i++) {
    const p = partLabels[i];
    if (!p) continue;
    const part = parts[p - 1];
    part.area++;
    const x = i % w;
    const y = (i - x) / w;
    if (x < part.minX) part.minX = x;
    if (x > part.maxX) part.maxX = x;
    if (y < part.minY) part.minY = y;
    if (y > part.maxY) part.maxY = y;
  }

  // 표준 순서로 재번호
  const order = parts.map((p, k) => k).sort((a, b) => {
    const ia = PART_ORDER.indexOf(parts[a].name);
    const ib = PART_ORDER.indexOf(parts[b].name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const remap = new Int32Array(parts.length + 1);
  order.filter((k) => parts[k].area > 0).forEach((k, n) => { remap[k + 1] = n + 1; });
  for (let i = 0; i < partLabels.length; i++) partLabels[i] = remap[partLabels[i]];
  const out = order.filter((k) => parts[k].area > 0).map((k, n) => {
    const p = parts[k];
    return {
      id: n + 1, name: p.name, label: p.label, area: p.area, regionCount: p.regions.size,
      bbox: [p.minX, p.minY, p.maxX - p.minX + 1, p.maxY - p.minY + 1],
    };
  });
  const splitRegions = decision.filter((d, r) => r > 0 && d === null).length;
  return { partLabels, parts: out, groupOf, splitRegions };
}

/** 파츠 라벨에서 작은 섬(파츠 면적의 3% 미만이고 가장 큰 덩어리가 아닌 것)을 이웃 파츠로 흡수한다. */
export function cleanIslands(partLabels, w, h, partCount) {
  const n = w * h;
  const comp = new Int32Array(n);
  const queue = new Int32Array(n);
  const area = new Int32Array(partCount + 1);
  for (let i = 0; i < n; i++) area[partLabels[i]]++;
  const islands = [];
  const biggest = new Map();
  let next = 0;
  for (let s = 0; s < n; s++) {
    const p = partLabels[s];
    if (!p || comp[s]) continue;
    const id = ++next;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < n && !comp[j] && partLabels[j] === p) { comp[j] = id; queue[tail++] = j; }
      }
    }
    const pixels = queue.slice(0, tail);
    const best = biggest.get(p);
    if (!best || tail > best.size) biggest.set(p, { id, size: tail });
    islands.push({ id, part: p, pixels });
  }
  let moved = 0;
  for (const island of islands) {
    if (biggest.get(island.part).id === island.id) continue;
    // 테두리 이웃 집계: 다른 파츠별 수 + 배경(0) 수
    const votes = new Map();
    let border = 0;
    for (const i of island.pixels) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n) { border++; continue; }
        const q = partLabels[j];
        if (q === island.part) continue;
        border++;
        if (q) votes.set(q, (votes.get(q) || 0) + 1);
      }
    }
    let target = 0;
    let most = 0;
    for (const [q, v] of votes) if (v > most) { most = v; target = q; }
    if (!target) continue; // 떨어진 섬(장식 등)은 그대로 둔다
    // 작은 조각이거나, 크더라도 한 파츠에 85% 이상 둘러싸인 조각(앞치마의 무늬 등)은 그 파츠로.
    const small = island.pixels.length < area[island.part] * 0.03;
    const surrounded = most >= border * 0.85;
    if (!small && !surrounded) continue;
    for (const i of island.pixels) partLabels[i] = target;
    moved += island.pixels.length;
  }
  return moved;
}
