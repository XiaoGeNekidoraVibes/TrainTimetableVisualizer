import { pointAtDistance } from "./geometry";
import type {
  CompiledRoute,
  Service,
  TimingRule,
  TrainRenderState,
} from "./types";

type Anchor = { time: number; distance: number };

type ServiceRuntime = {
  route: CompiledRoute;
  anchors: Anchor[];
  trainIds: string[];
  error: string | null;
};

const runtimeCache = new WeakMap<Service, ServiceRuntime>();

export function buildAnchors(service: Service, route: CompiledRoute): Anchor[] {
  const anchors: Anchor[] = [];
  for (const station of route.stations) {
    const rule: TimingRule | undefined = service.timings[station.occurrenceKey];
    if (!rule || rule.mode === "pass-flexible") continue;
    if (rule.mode === "pass-exact") {
      anchors.push({ time: rule.pass, distance: station.distance });
    } else {
      anchors.push({ time: rule.arrival, distance: station.distance });
      anchors.push({ time: rule.departure, distance: station.distance });
    }
  }
  return anchors.sort((a, b) => a.time - b.time || a.distance - b.distance);
}

export function validateSchedule(service: Service, route: CompiledRoute) {
  if (!route.valid) return route.error ?? "路径无效";
  const anchors = buildAnchors(service, route);
  if (anchors.length < 2) return "至少需要两个指定时间点";
  if (anchors[0].distance !== 0) return "始发站必须设置停靠或指定通过时间";
  if (Math.abs(anchors.at(-1)!.distance - route.totalDistance) > 0.01) {
    return "终到站必须设置停靠或指定通过时间";
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (current.time < previous.time) return "指定时间必须沿运行方向递增";
    if (current.time === previous.time && current.distance !== previous.distance) {
      return "列车无法在同一时刻位于两个不同位置";
    }
    if (current.distance < previous.distance) return "时间点顺序与运行方向不一致";
  }
  return null;
}

export function evaluateArithmetic(expression: string, n: number) {
  const source = expression.replace(/\s+/g, "");
  let cursor = 0;
  const parseExpression = (): number => {
    let value = parseTerm();
    while (source[cursor] === "+" || source[cursor] === "-") {
      const operator = source[cursor++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseFactor();
    while (source[cursor] === "*" || source[cursor] === "/") {
      const operator = source[cursor++];
      const right = parseFactor();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const parseFactor = (): number => {
    if (source[cursor] === "(") {
      cursor += 1;
      const value = parseExpression();
      if (source[cursor++] !== ")") throw new Error("括号不匹配");
      return value;
    }
    if (source[cursor] === "-") {
      cursor += 1;
      return -parseFactor();
    }
    if (source[cursor] === "n") {
      cursor += 1;
      return n;
    }
    const match = source.slice(cursor).match(/^\d+(?:\.\d+)?/);
    if (!match) throw new Error("编号公式包含不支持的表达式");
    cursor += match[0].length;
    return Number(match[0]);
  };
  const result = parseExpression();
  if (cursor !== source.length || !Number.isFinite(result)) throw new Error("编号公式无效");
  return result;
}

export function formatTrainId(formula: string, n: number) {
  try {
    return formula.replace(/\{([^{}]+)\}/g, (_, expression: string) =>
      String(Math.trunc(evaluateArithmetic(expression, n))),
    );
  } catch {
    return `${formula || "Train"}-${n}`;
  }
}

function positionAtRelativeTime(
  route: CompiledRoute,
  anchors: Anchor[],
  relativeTime: number,
) {
  if (anchors.length < 2 || relativeTime < anchors[0].time || relativeTime > anchors.at(-1)!.time) {
    return null;
  }
  let low = 1;
  let high = anchors.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (anchors[middle].time < relativeTime) low = middle + 1;
    else high = middle;
  }
  const nextIndex = low;
  const previous = anchors[Math.max(0, nextIndex - 1)];
  const next = anchors[Math.min(anchors.length - 1, nextIndex)];
  const duration = next.time - previous.time;
  const ratio = duration <= 0 ? 1 : (relativeTime - previous.time) / duration;
  const targetDistance = previous.distance + (next.distance - previous.distance) * ratio;
  return { ...pointAtDistance(route, targetDistance), targetDistance };
}

function getServiceRuntime(service: Service, route: CompiledRoute): ServiceRuntime {
  const cached = runtimeCache.get(service);
  if (cached?.route === route) return cached;
  const runtime = {
    route,
    anchors: buildAnchors(service, route),
    trainIds: service.departures.map((_, index) => formatTrainId(service.idFormula, index + 1)),
    error: validateSchedule(service, route),
  };
  runtimeCache.set(service, runtime);
  return runtime;
}

function nextStationAfter(route: CompiledRoute, distance: number) {
  let low = 0;
  let high = route.stations.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (route.stations[middle].distance <= distance + 0.1) low = middle + 1;
    else high = middle;
  }
  return route.stations[low];
}

export function collectActiveTrains(
  services: Service[],
  compiledRoutes: Map<string, CompiledRoute>,
  clockSeconds: number,
): TrainRenderState[] {
  const result: TrainRenderState[] = [];
  for (const service of services) {
    const route = compiledRoutes.get(service.id);
    if (!route?.valid) continue;
    const runtime = getServiceRuntime(service, route);
    if (runtime.error) continue;
    for (let departureIndex = 0; departureIndex < service.departures.length; departureIndex += 1) {
      const departure = service.departures[departureIndex];
      let relativeTime = clockSeconds - departure;
      if (relativeTime < -43200) relativeTime += 86400;
      const position = positionAtRelativeTime(route, runtime.anchors, relativeTime);
      if (!position) continue;
      const nextStation = nextStationAfter(route, position.targetDistance);
      const id = runtime.trainIds[departureIndex];
      result.push({
        key: `${service.id}:${departureIndex}`,
        id,
        serviceId: service.id,
        serviceName: service.name,
        x: position.point.x,
        y: position.point.y,
        angle: position.angle,
        color: service.color,
        nextStationId: nextStation?.stationId,
        relativeTime,
      });
    }
  }
  return result;
}
