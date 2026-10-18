import type { CompiledRoute, Service, TimingRule } from "./types";

// Older projects have no platform field. Stops use platform 1; passes use the main line.
export function timingPlatform(rule: TimingRule | undefined): string | null {
  const platform = rule?.platform?.trim();
  return platform || (rule?.mode === "stop" ? "1" : null);
}

export function normalizeTimingPlatform(rule: TimingRule): TimingRule {
  const platform = timingPlatform(rule);
  return rule.mode === "stop"
    ? { ...rule, platform: platform ?? "1" }
    : { ...rule, platform };
}

export function reversePlatform(platform: string | null): string | null {
  if (platform === null || !/^\d+$/.test(platform)) return platform;
  const number = Number(platform);
  if (!Number.isSafeInteger(number) || number < 1) return platform;
  const paired = number % 2 === 0 ? number - 1 : number + 1;
  return Number.isSafeInteger(paired) ? String(paired) : platform;
}

export function getStationPlatforms(
  stationId: string,
  services: Service[],
  routes: Map<string, CompiledRoute>,
) {
  const platforms = new Set<string | null>();
  for (const service of services) {
    const route = routes.get(service.id);
    if (!route?.valid) continue;
    for (const station of route.stations) {
      if (station.stationId === stationId) {
        platforms.add(timingPlatform(service.timings[station.occurrenceKey]));
      }
    }
  }
  return Array.from(platforms).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, "zh-CN", { numeric: true });
  });
}

// null selects all platforms; an empty array deliberately selects none.
export function matchesPlatforms(platform: string | null, selected: (string | null)[] | null) {
  return selected === null || selected.includes(platform);
}

export function platformLabel(platform: string | null) {
  return platform === null ? "无站台（正线通过）" : `${platform} 站台`;
}
