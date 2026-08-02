export function formatTime(totalSeconds: number, includeSeconds = true) {
  const normalized = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return includeSeconds ? `${base}:${String(seconds).padStart(2, "0")}` : base;
}

export function parseClock(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;
  const [hours, minutes, seconds = 0] = parts;
  if (hours < 0 || hours > 47 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function parseDuration(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [hours, minutes, seconds] = parts;
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function createDepartureRange(start: number, end: number, interval: number) {
  if (interval <= 0 || end < start) return [];
  const result: number[] = [];
  for (let time = start; time <= end; time += interval) result.push(time);
  return result;
}

export function parseDepartureList(value: string) {
  return value
    .split(/[，,\n\s]+/)
    .map(parseClock)
    .filter((time): time is number => time !== null)
    .sort((a, b) => a - b);
}
