import type { Service } from "./types";
import { createDepartureRange, parseClock, parseDuration } from "../lib/time";

export const MAX_RANGE_DEPARTURES = 10000;

type DepartureRange = {
  line: number;
  start: number;
  end: number;
  interval: number;
  count: number;
  last: number;
};

const sortedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

export function parseDepartureRanges(text: string) {
  const ranges: DepartureRange[] = [];
  const errors: { line: number; message: string }[] = [];
  let totalCount = 0;

  text.split(/\r?\n/).forEach((row, index) => {
    if (!row.trim()) return;
    const line = index + 1;
    const fields = row.split(/[,，]/).map((field) => field.trim());
    if (fields.length !== 3 || fields.some((field) => !/^\d{2}:\d{2}:\d{2}$/.test(field))) {
      errors.push({ line, message: "请按 hh:mm:ss, hh:mm:ss, hh:mm:ss 输入首班、末班上限和间隔" });
      return;
    }
    const start = parseClock(fields[0]);
    const end = parseClock(fields[1]);
    const interval = parseDuration(fields[2]);
    if (start === null || end === null || interval === null) {
      errors.push({ line, message: "时刻小时应为 00–47，分钟和秒应为 00–59" });
      return;
    }
    if (interval <= 0) {
      errors.push({ line, message: "发车间隔必须大于 00:00:00" });
      return;
    }
    if (end < start) {
      errors.push({ line, message: "末班上限不能早于首班；跨午夜请使用 24:00:00 及以后的时刻" });
      return;
    }
    const count = Math.floor((end - start) / interval) + 1;
    totalCount += count;
    ranges.push({ line, start, end, interval, count, last: start + (count - 1) * interval });
    if (totalCount > MAX_RANGE_DEPARTURES) {
      errors.push({ line, message: `范围展开合计不能超过 ${MAX_RANGE_DEPARTURES.toLocaleString("en-US")} 个班次，请增大发车间隔` });
    }
  });

  // Validate the entire input before expanding any rows, so partial schedules cannot be saved.
  const departures = errors.length ? [] : sortedUnique(
    ranges.flatMap(({ start, end, interval }) => createDepartureRange(start, end, interval)),
  );
  return { ranges, errors, departures, duplicateCount: errors.length ? 0 : totalCount - departures.length };
}

export function getIndividualDepartures(service: Service) {
  return service.departurePlan?.individualDepartures ?? service.departures;
}

export function setDepartureRanges(service: Service, rangeText: string): Service | null {
  const parsed = parseDepartureRanges(rangeText);
  if (parsed.errors.length) return null;
  const individualDepartures = sortedUnique(getIndividualDepartures(service));
  return {
    ...service,
    departurePlan: rangeText.trim() ? { rangeText, individualDepartures } : undefined,
    departures: sortedUnique([...individualDepartures, ...parsed.departures]),
  };
}

export function setIndividualDepartures(service: Service, values: number[]): Service {
  const individualDepartures = sortedUnique(values);
  if (!service.departurePlan) return { ...service, departures: individualDepartures };
  const parsed = parseDepartureRanges(service.departurePlan.rangeText);
  return {
    ...service,
    departurePlan: { ...service.departurePlan, individualDepartures },
    departures: sortedUnique([...individualDepartures, ...parsed.departures]),
  };
}
