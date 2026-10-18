import type { CompiledRoute, RouteStation, Service } from "./types";

export type PidRouteStation = { kind: "station"; station: RouteStation; index: number; isPass: boolean };
export type PidPassGroup = { kind: "pass-group"; stations: PidRouteStation[] };
export type PidRouteItem = PidRouteStation | PidPassGroup;
export type PidRoutePage = { items: PidRouteItem[]; continued: boolean; gapAfterFocus: boolean };

/** Compact pass runs, retain the previous stop, and pin the focus stop on subsequent pages. */
export function buildPidRoutePages(service: Service, route: CompiledRoute, focusIndex: number, capacity = 8): PidRoutePage[] {
  if (!route.stations.length) return [];
  const previousStop = route.stations.findLastIndex((station, index) =>
    index < focusIndex && service.timings[station.occurrenceKey]?.mode === "stop",
  );
  const entries: PidRouteItem[] = [];
  let passes: PidRouteStation[] = [];
  const flushPasses = () => {
    if (passes.length >= 3) entries.push({ kind: "pass-group", stations: passes });
    else entries.push(...passes);
    passes = [];
  };
  route.stations.forEach((station, index) => {
    if (index < Math.max(0, previousStop)) return;
    const item: PidRouteStation = { kind: "station", station, index, isPass: service.timings[station.occurrenceKey]?.mode !== "stop" };
    if (item.isPass) passes.push(item);
    else {
      flushPasses();
      entries.push(item);
    }
  });
  flushPasses();

  // At most a previous stop and two ungrouped passes precede the focus stop.
  const pageSize = Math.max(4, Math.floor(capacity));
  const focus = entries.find((item) => item.kind === "station"
    ? item.index === focusIndex
    : item.stations.some((station) => station.index === focusIndex)) ?? entries[0];
  const focusEnd = focus.kind === "station" ? focus.index : focus.stations.at(-1)!.index;
  const pages: PidRoutePage[] = [{ items: entries.slice(0, pageSize), continued: false, gapAfterFocus: false }];
  for (let cursor = pageSize; cursor < entries.length; cursor += pageSize - 1) {
    const next = entries[cursor];
    const nextStart = next.kind === "station" ? next.index : next.stations[0].index;
    pages.push({ items: [focus, ...entries.slice(cursor, cursor + pageSize - 1)], continued: true, gapAfterFocus: nextStart > focusEnd + 1 });
  }
  return pages;
}
