import type {
  CompiledRoute,
  Point,
  RailLine,
  RouteLeg,
  Station,
} from "./types";

const SEGMENTS_PER_SPAN = 28;

export type SampledLine = {
  points: Point[];
  cumulativeDistances: number[];
  stationPointIndices: number[];
};

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export function withCumulativeDistances(points: Point[]) {
  const cumulativeDistances = new Array<number>(points.length).fill(0);
  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistances[index] =
      cumulativeDistances[index - 1] + distance(points[index - 1], points[index]);
  }
  return cumulativeDistances;
}

export function sampleLine(line: RailLine, stationMap: Map<string, Station>): SampledLine {
  const controls = line.stationIds
    .map((stationId) => stationMap.get(stationId)?.position)
    .filter((point): point is Point => Boolean(point));

  if (controls.length < 2) {
    return { points: controls, cumulativeDistances: [0], stationPointIndices: [0] };
  }

  const points: Point[] = [];
  const stationPointIndices: number[] = [];
  for (let span = 0; span < controls.length - 1; span += 1) {
    stationPointIndices.push(points.length);
    const p0 = controls[Math.max(0, span - 1)];
    const p1 = controls[span];
    const p2 = controls[span + 1];
    const p3 = controls[Math.min(controls.length - 1, span + 2)];
    for (let step = 0; step < SEGMENTS_PER_SPAN; step += 1) {
      points.push(catmullRom(p0, p1, p2, p3, step / SEGMENTS_PER_SPAN));
    }
  }
  stationPointIndices.push(points.length);
  points.push(controls.at(-1)!);
  return { points, cumulativeDistances: withCumulativeDistances(points), stationPointIndices };
}

function invalidRoute(error: string): CompiledRoute {
  return {
    points: [],
    cumulativeDistances: [],
    stations: [],
    totalDistance: 0,
    valid: false,
    error,
  };
}

function legStationIds(line: RailLine, leg: RouteLeg) {
  const from = line.stationIds.indexOf(leg.fromStationId);
  const to = line.stationIds.indexOf(leg.toStationId);
  if (from < 0 || to < 0 || from === to) return null;
  const step = from < to ? 1 : -1;
  const ids: string[] = [];
  for (let index = from; ; index += step) {
    ids.push(line.stationIds[index]);
    if (index === to) break;
  }
  return { ids, from, to, step };
}

export function compileRoute(
  legs: RouteLeg[],
  stations: Station[],
  lines: RailLine[],
): CompiledRoute {
  if (!legs.length) return invalidRoute("至少需要一个运行区段");
  const stationMap = new Map(stations.map((station) => [station.id, station]));
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  const routePoints: Point[] = [];
  const stationEntries: Array<{ stationId: string; distance: number }> = [];
  let routeDistance = 0;

  for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
    const leg = legs[legIndex];
    const line = lineMap.get(leg.lineId);
    if (!line) return invalidRoute("运行区段引用了已删除的线路");
    const indices = legStationIds(line, leg);
    if (!indices) return invalidRoute(`线路「${line.name}」上的起终点无效`);
    if (legIndex > 0 && legs[legIndex - 1].toStationId !== leg.fromStationId) {
      return invalidRoute("相邻运行区段没有在同一站点衔接");
    }

    const sampled = sampleLine(line, stationMap);
    const startPointIndex = sampled.stationPointIndices[indices.from];
    const endPointIndex = sampled.stationPointIndices[indices.to];
    const pointStep = startPointIndex < endPointIndex ? 1 : -1;
    const legPoints: Point[] = [];
    for (let index = startPointIndex; ; index += pointStep) {
      legPoints.push(sampled.points[index]);
      if (index === endPointIndex) break;
    }
    if (routePoints.length) legPoints.shift();
    const legCumulative = withCumulativeDistances(legPoints);
    routePoints.push(...legPoints);

    for (let index = 0; index < indices.ids.length; index += 1) {
      if (legIndex > 0 && index === 0) continue;
      const lineStationIndex = indices.from + index * indices.step;
      const sampleIndex = sampled.stationPointIndices[lineStationIndex];
      const localDistance = Math.abs(
        sampled.cumulativeDistances[sampleIndex] -
          sampled.cumulativeDistances[startPointIndex],
      );
      stationEntries.push({ stationId: indices.ids[index], distance: routeDistance + localDistance });
    }
    routeDistance += legCumulative.at(-1) ?? 0;
  }

  const occurrenceCounts = new Map<string, number>();
  const routeStations = stationEntries.map((entry) => {
    const visit = occurrenceCounts.get(entry.stationId) ?? 0;
    occurrenceCounts.set(entry.stationId, visit + 1);
    return { ...entry, occurrenceKey: `${entry.stationId}:${visit}` };
  });
  const cumulativeDistances = withCumulativeDistances(routePoints);
  return {
    points: routePoints,
    cumulativeDistances,
    stations: routeStations,
    totalDistance: cumulativeDistances.at(-1) ?? 0,
    valid: true,
  };
}

export function pointAtDistance(route: CompiledRoute, target: number) {
  const distances = route.cumulativeDistances;
  if (!route.points.length) return { point: { x: 0, y: 0 }, angle: 0 };
  const clamped = Math.max(0, Math.min(target, route.totalDistance));
  let low = 0;
  let high = distances.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (distances[mid] < clamped) low = mid + 1;
    else high = mid;
  }
  const end = Math.max(1, low);
  const start = end - 1;
  const span = distances[end] - distances[start] || 1;
  const ratio = (clamped - distances[start]) / span;
  const a = route.points[start];
  const b = route.points[end];
  return {
    point: { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio },
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

export function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
}
