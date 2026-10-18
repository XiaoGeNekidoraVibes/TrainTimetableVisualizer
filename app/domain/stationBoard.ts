import { buildAnchors, formatTrainId, validateSchedule } from "./simulation";
import { timingPlatform } from "./platform";
import type { CompiledRoute, RailLine, Service, Station, TimingRule } from "./types";

export type StationEvent = {
  key: string;
  serviceId: string;
  serviceName: string;
  category: string;
  color: string;
  trainId: string;
  origin: string;
  destination: string;
  platform: string | null;
  arrival?: number;
  departure?: number;
  passTime?: number;
  referenceTime: number;
  countdown: number;
  status: "dwelling" | "arriving" | "passing";
  stoppingStations: string[];
  lineIds: string[];
};

export type TimetableDeparture = {
  key: string;
  serviceId: string;
  serviceName: string;
  category: string;
  color: string;
  trainId: string;
  destination: string;
  platform: string | null;
  time: number;
  passing: boolean;
  lineIds: string[];
};

const normalizeDay = (seconds: number) => ((seconds % 86400) + 86400) % 86400;

function stationLineIds(service: Service, stationId: string, lines: RailLine[]) {
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  const ids = service.routeLegs.flatMap((leg) => {
    const line = lineMap.get(leg.lineId);
    if (!line) return [];
    const from = line.stationIds.indexOf(leg.fromStationId);
    const to = line.stationIds.indexOf(leg.toStationId);
    const station = line.stationIds.indexOf(stationId);
    if (from < 0 || to < 0 || station < Math.min(from, to) || station > Math.max(from, to)) return [];
    return [line.id];
  });
  return Array.from(new Set(ids));
}

function flexiblePassOffset(service: Service, route: CompiledRoute, distance: number) {
  const anchors = buildAnchors(service, route);
  if (anchors.length < 2) return null;
  let previous = anchors[0];
  let next = anchors.at(-1)!;
  for (const anchor of anchors) {
    if (anchor.distance <= distance) previous = anchor;
    if (anchor.distance >= distance) {
      next = anchor;
      break;
    }
  }
  const span = next.distance - previous.distance;
  if (span <= 0) return previous.time;
  return previous.time + ((distance - previous.distance) / span) * (next.time - previous.time);
}

function timingAtStation(service: Service, route: CompiledRoute, occurrenceKey: string, distance: number) {
  const rule: TimingRule = service.timings[occurrenceKey] ?? { mode: "pass-flexible", platform: null };
  if (rule.mode === "stop") return { kind: "stop" as const, arrival: rule.arrival, departure: rule.departure };
  if (rule.mode === "pass-exact") return { kind: "pass" as const, pass: rule.pass };
  const pass = flexiblePassOffset(service, route, distance);
  return pass === null ? null : { kind: "pass" as const, pass };
}

function routeLabels(route: CompiledRoute, stationMap: Map<string, Station>) {
  return {
    origin: stationMap.get(route.stations[0]?.stationId)?.name ?? "—",
    destination: stationMap.get(route.stations.at(-1)?.stationId ?? "")?.name ?? "—",
  };
}

function stoppingStationNames(
  service: Service,
  route: CompiledRoute,
  stationMap: Map<string, Station>,
  afterStationIndex: number,
) {
  return route.stations
    .slice(afterStationIndex + 1)
    .filter((station) => service.timings[station.occurrenceKey]?.mode === "stop")
    .map((station) => stationMap.get(station.stationId)?.name ?? "已删除站点");
}

export function getStationBoardEvents(
  stationId: string,
  services: Service[],
  routes: Map<string, CompiledRoute>,
  stations: Station[],
  lines: RailLine[],
  clockSeconds: number,
  windowSeconds = 2 * 3600,
) {
  const stationMap = new Map(stations.map((station) => [station.id, station]));
  const events: StationEvent[] = [];
  for (const service of services) {
    const route = routes.get(service.id);
    if (!route?.valid || validateSchedule(service, route)) continue;
    const routeStations = route.stations
      .map((station, index) => ({ station, index }))
      .filter(({ station }) => station.stationId === stationId);
    if (!routeStations.length) continue;
    const labels = routeLabels(route, stationMap);
    const lineIds = stationLineIds(service, stationId, lines);
    for (const { station: routeStation, index: routeStationIndex } of routeStations) {
      const timing = timingAtStation(service, route, routeStation.occurrenceKey, routeStation.distance);
      if (!timing) continue;
      const platform = timingPlatform(service.timings[routeStation.occurrenceKey]);
      const onwardStops = stoppingStationNames(service, route, stationMap, routeStationIndex);
      for (let departureIndex = 0; departureIndex < service.departures.length; departureIndex += 1) {
        for (const dayShift of [-86400, 0, 86400]) {
          const base = service.departures[departureIndex] + dayShift;
          if (timing.kind === "stop") {
            const arrival = base + timing.arrival;
            const departure = base + timing.departure;
            if (departure < clockSeconds || arrival > clockSeconds + windowSeconds) continue;
            const dwelling = clockSeconds >= arrival && clockSeconds < departure;
            const referenceTime = dwelling ? departure : arrival;
            events.push({
              key: `${service.id}:${departureIndex}:${routeStation.occurrenceKey}:${dayShift}`,
              serviceId: service.id,
              serviceName: service.name,
              category: service.category || "普通",
              color: service.color,
              trainId: formatTrainId(service.idFormula, departureIndex + 1),
              ...labels,
              platform,
              arrival,
              departure,
              referenceTime,
              countdown: Math.max(0, referenceTime - clockSeconds),
              status: dwelling ? "dwelling" : "arriving",
              stoppingStations: onwardStops,
              lineIds,
            });
          } else {
            const passTime = base + timing.pass;
            if (passTime < clockSeconds || passTime > clockSeconds + windowSeconds) continue;
            events.push({
              key: `${service.id}:${departureIndex}:${routeStation.occurrenceKey}:${dayShift}`,
              serviceId: service.id,
              serviceName: service.name,
              category: service.category || "普通",
              color: service.color,
              trainId: formatTrainId(service.idFormula, departureIndex + 1),
              ...labels,
              platform,
              passTime,
              referenceTime: passTime,
              countdown: Math.max(0, passTime - clockSeconds),
              status: "passing",
              stoppingStations: onwardStops,
              lineIds,
            });
          }
        }
      }
    }
  }
  return events.sort((a, b) => a.referenceTime - b.referenceTime || a.trainId.localeCompare(b.trainId));
}

export function getStationTimetable(
  stationId: string,
  services: Service[],
  routes: Map<string, CompiledRoute>,
  stations: Station[],
  lines: RailLine[],
) {
  const stationMap = new Map(stations.map((station) => [station.id, station]));
  const departures: TimetableDeparture[] = [];
  for (const service of services) {
    const route = routes.get(service.id);
    if (!route?.valid || validateSchedule(service, route)) continue;
    const labels = routeLabels(route, stationMap);
    const lineIds = stationLineIds(service, stationId, lines);
    for (const routeStation of route.stations.filter((station) => station.stationId === stationId)) {
      const timing = timingAtStation(service, route, routeStation.occurrenceKey, routeStation.distance);
      if (!timing) continue;
      for (let departureIndex = 0; departureIndex < service.departures.length; departureIndex += 1) {
        const offset = timing.kind === "stop" ? timing.departure : timing.pass;
        departures.push({
          key: `${service.id}:${departureIndex}:${routeStation.occurrenceKey}`,
          serviceId: service.id,
          serviceName: service.name,
          category: service.category || "普通",
          color: service.color,
          trainId: formatTrainId(service.idFormula, departureIndex + 1),
          destination: labels.destination,
          platform: timingPlatform(service.timings[routeStation.occurrenceKey]),
          time: normalizeDay(service.departures[departureIndex] + offset),
          passing: timing.kind === "pass",
          lineIds,
        });
      }
    }
  }
  return departures.sort((a, b) => a.time - b.time || a.trainId.localeCompare(b.trainId));
}
