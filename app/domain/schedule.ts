import { buildAnchors } from "./simulation";
import type { CompiledRoute, RailLine, Service, TimingRule } from "./types";

export type ResolvedStationTime = {
  arrival: number;
  departure: number;
  timed: boolean;
};

export type TimingIntervalInfo = {
  nextOccurrenceKey: string;
  speedKmh: number;
};

export function resolveStationTimes(service: Service, route: CompiledRoute) {
  const anchors = buildAnchors(service, route);
  if (!anchors.length) {
    return route.stations.map<ResolvedStationTime>(() => ({ arrival: 0, departure: 0, timed: false }));
  }
  return route.stations.map<ResolvedStationTime>((station) => {
    const rule = service.timings[station.occurrenceKey];
    if (rule?.mode === "stop") {
      return { arrival: rule.arrival, departure: rule.departure, timed: true };
    }
    if (rule?.mode === "pass-exact") {
      return { arrival: rule.pass, departure: rule.pass, timed: true };
    }

    let previous = anchors[0];
    let next = anchors.at(-1)!;
    for (const anchor of anchors) {
      if (anchor.distance <= station.distance) previous = anchor;
      if (anchor.distance >= station.distance) {
        next = anchor;
        break;
      }
    }
    const distanceSpan = next.distance - previous.distance;
    const ratio = distanceSpan <= 0 ? 0 : (station.distance - previous.distance) / distanceSpan;
    const time = previous.time + (next.time - previous.time) * ratio;
    return { arrival: time, departure: time, timed: false };
  });
}

export function getTimingIntervals(service: Service, route: CompiledRoute) {
  const resolved = resolveStationTimes(service, route);
  const result = new Map<string, TimingIntervalInfo>();
  let intervalStartIndex = 0;

  for (let index = 0; index < route.stations.length; index += 1) {
    const rule = service.timings[route.stations[index].occurrenceKey];
    if (rule && rule.mode !== "pass-flexible") intervalStartIndex = index;
    let nextIndex = index + 1;
    while (nextIndex < route.stations.length) {
      const nextRule = service.timings[route.stations[nextIndex].occurrenceKey];
      if (nextRule && nextRule.mode !== "pass-flexible") break;
      nextIndex += 1;
    }
    if (nextIndex >= route.stations.length) continue;

    const start = route.stations[intervalStartIndex];
    const next = route.stations[nextIndex];
    const seconds = resolved[nextIndex].arrival - resolved[intervalStartIndex].departure;
    if (seconds <= 0) continue;
    result.set(route.stations[index].occurrenceKey, {
      nextOccurrenceKey: next.occurrenceKey,
      speedKmh: ((next.distance - start.distance) / seconds) * 3.6,
    });
  }
  return result;
}

export function createUniformSchedule(
  service: Service,
  route: CompiledRoute,
  speedKmh: number,
  dwellSeconds: number,
  preservePassRules: boolean,
) {
  const timings: Record<string, TimingRule> = {};
  const metresPerSecond = Math.max(0.1, speedKmh / 3.6);
  let currentDeparture = 0;

  route.stations.forEach((station, index) => {
    const isFirst = index === 0;
    const isLast = index === route.stations.length - 1;
    const previous = route.stations[Math.max(0, index - 1)];
    const arrival = isFirst
      ? 0
      : Math.round(currentDeparture + (station.distance - previous.distance) / metresPerSecond);
    const previousRule = service.timings[station.occurrenceKey];
    const mode = isFirst || isLast || !preservePassRules
      ? "stop"
      : previousRule?.mode ?? "stop";

    if (mode === "pass-flexible") {
      timings[station.occurrenceKey] = { mode };
      currentDeparture = arrival;
    } else if (mode === "pass-exact") {
      timings[station.occurrenceKey] = { mode, pass: arrival };
      currentDeparture = arrival;
    } else {
      const departure = arrival + (isFirst || isLast ? 0 : Math.max(0, dwellSeconds));
      timings[station.occurrenceKey] = { mode, arrival, departure };
      currentDeparture = departure;
    }
  });
  return timings;
}

export function serviceLineIdsAtStation(service: Service, lines: RailLine[], stationId: string) {
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  return new Set(service.routeLegs.flatMap((leg) => {
    const line = lineMap.get(leg.lineId);
    if (!line) return [];
    const from = line.stationIds.indexOf(leg.fromStationId);
    const to = line.stationIds.indexOf(leg.toStationId);
    const stationIndex = line.stationIds.indexOf(stationId);
    if (from < 0 || to < 0 || stationIndex < Math.min(from, to) || stationIndex > Math.max(from, to)) return [];
    return [line.id];
  }));
}
