// Geometry helpers for spot generation. Coordinates are WoW map percent (0..100).

// DBSCAN on a uniform grid. Returns clusters (arrays of points); noise is dropped.
export function clusterPoints(points, eps, minPts) {
  const cell = (v) => Math.floor(v / eps);
  const grid = new Map();
  points.forEach((p, i) => {
    const k = `${cell(p.x)},${cell(p.y)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const neighbours = (i) => {
    const p = points[i];
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cell(p.x) + dx},${cell(p.y) + dy}`) ?? []) {
          if (Math.hypot(points[j].x - p.x, points[j].y - p.y) <= eps) out.push(j);
        }
      }
    }
    return out;
  };
  const label = new Array(points.length).fill(undefined);
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    if (label[i] !== undefined) continue;
    const nb = neighbours(i);
    if (nb.length < minPts) { label[i] = -1; continue; }
    const c = clusters.length;
    clusters.push([]);
    label[i] = c;
    const queue = [...nb];
    while (queue.length) {
      const j = queue.pop();
      if (label[j] === -1) label[j] = c;
      if (label[j] !== undefined) continue;
      label[j] = c;
      const nb2 = neighbours(j);
      if (nb2.length >= minPts) queue.push(...nb2);
    }
  }
  points.forEach((p, i) => { if (label[i] >= 0) clusters[label[i]].push(p); });
  return clusters;
}

// Andrew's monotone chain.
export function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// Closed tour by nearest neighbour + 2-opt. Straight lines on the map only (terrain is NOT considered).
export function nearestNeighbourTour(points) {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()];
  if (pts.length <= 2) return pts;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const used = new Array(pts.length).fill(false);
  const tour = [0];
  used[0] = true;
  for (let k = 1; k < pts.length; k++) {
    const last = pts[tour[tour.length - 1]];
    let best = -1; let bd = Infinity;
    for (let i = 0; i < pts.length; i++) if (!used[i] && d(last, pts[i]) < bd) { bd = d(last, pts[i]); best = i; }
    used[best] = true;
    tour.push(best);
  }
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < tour.length - 1; i++) {
      for (let j = i + 2; j < tour.length; j++) {
        const a = pts[tour[i]]; const b = pts[tour[i + 1]];
        const c = pts[tour[j]]; const e = pts[tour[(j + 1) % tour.length]];
        if (d(a, c) + d(b, e) < d(a, b) + d(c, e) - 1e-9) {
          tour.splice(i + 1, j - i, ...tour.slice(i + 1, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return tour.map((i) => pts[i]);
}

// Classic 1.12 rule (Wowpedia): level <= 20 -> (level - 10) * 10 (min 1), above -> level * 5.
export function skinningSkillForLevel(level) {
  if (level == null) return null;
  if (level <= 20) return Math.max(1, (level - 10) * 10);
  return level * 5;
}
