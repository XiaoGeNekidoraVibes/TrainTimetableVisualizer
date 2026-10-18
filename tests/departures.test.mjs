import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const testCache = join(projectRoot, "node_modules/.cache");
await mkdir(testCache, { recursive: true });
const compiledRoot = await mkdtemp(join(testCache, "departure-tests-"));
for (const file of ["domain/types.ts", "lib/time.ts", "domain/departures.ts"]) {
  const source = await readFile(join(projectRoot, "app", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const output = join(compiledRoot, file.replace(/\.ts$/, ".js"));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, outputText);
}
after(() => {
  assert.equal(dirname(resolve(compiledRoot)), resolve(testCache));
  return rm(compiledRoot, { recursive: true, force: true });
});
const require = createRequire(import.meta.url);
const { MAX_RANGE_DEPARTURES, parseDepartureRanges, setDepartureRanges, setIndividualDepartures, getIndividualDepartures } = require(join(compiledRoot, "domain/departures.js"));
const { formatDuration } = require(join(compiledRoot, "lib/time.js"));
const format = (departures) => departures.map((time) => formatDuration(time));
const service = { id: "test", name: "Local", departures: [21600, 23400], routeLegs: [], timings: {}, category: "普通", color: "#fff", idFormula: "T{n}" };

test("inclusive range produces the requested eleven departures from 06:30 to 09:00", () => {
  const result = parseDepartureRanges("06:30:00, 09:00:00, 00:15:00");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(format(result.departures), [
    "06:30:00", "06:45:00", "07:00:00", "07:15:00", "07:30:00", "07:45:00",
    "08:00:00", "08:15:00", "08:30:00", "08:45:00", "09:00:00",
  ]);
  assert.equal(result.ranges[0].count, 11);
});

test("nondivisible ranges stop before the upper bound, and equal bounds generate one departure", () => {
  const result = parseDepartureRanges("06:30:05, 07:00:06, 00:20:00\n08:00:01, 08:00:01, 00:01:00");
  assert.deepEqual(format(result.departures), ["06:30:05", "06:50:05", "08:00:01"]);
  assert.equal(result.ranges[0].last, 24605);
});

test("multiple rows accept CRLF, blank lines and Chinese commas; overlaps sort and deduplicate", () => {
  const result = parseDepartureRanges("\r\n 07:00:00，07:30:00，00:15:00 \r\n\r\n06:30:00, 07:15:00, 00:15:00\r\n");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(format(result.departures), ["06:30:00", "06:45:00", "07:00:00", "07:15:00", "07:30:00"]);
  assert.deepEqual(result.ranges.map((row) => row.line), [2, 4]);
  assert.equal(result.duplicateCount, 2);
});

test("invalid rows report original line numbers and never return a partial schedule", () => {
  const badRows = [
    "06:00, 07:00:00, 00:10:00", "06:00:00, 07:00:00", "06:00:00, 07:00:00, 00:10:00,",
    "06:60:00, 07:00:00, 00:10:00", "48:00:00, 49:00:00, 00:10:00",
    "06:00:00, 07:00:00, 00:00:00", "07:00:00, 06:00:00, 00:10:00",
    "06:00:00, 07:00:00, 00:00:0.5", "06:00:00, 07:00:00, -1:00:00",
    "06:00:00, 07:00:00, 00:60:00", "06:00:00, 07:00:00, Infinity:00:00",
  ];
  for (const row of badRows) {
    const result = parseDepartureRanges(`06:00:00, 06:30:00, 00:15:00\n\n${row}`);
    assert.equal(result.errors.length, 1, row);
    assert.equal(result.errors[0].line, 3, row);
    assert.deepEqual(result.departures, [], row);
    assert.equal(setDepartureRanges(service, row), null, row);
  }
});

test("extended service-day hours preserve explicit after-midnight times", () => {
  const result = parseDepartureRanges("23:30:00, 24:30:00, 00:30:00");
  assert.deepEqual(format(result.departures), ["23:30:00", "24:00:00", "24:30:00"]);
  assert.equal(parseDepartureRanges("23:30:00, 00:30:00, 00:30:00").errors.length, 1);
});

test("large expansions are rejected before allocation, including excessive combined row counts", () => {
  assert.equal(parseDepartureRanges("00:00:00, 02:46:39, 00:00:01").departures.length, MAX_RANGE_DEPARTURES);
  for (const text of ["00:00:00, 47:59:59, 00:00:01", "00:00:00, 01:30:00, 00:00:01\n02:00:00, 03:30:00, 00:00:01"]) {
    const result = parseDepartureRanges(text);
    assert.ok(result.errors.length);
    assert.deepEqual(result.departures, []);
  }
});

test("saved range edits replace generated times and preserve individual departures, including overlaps", () => {
  const first = setDepartureRanges(service, "06:30:00, 07:00:00, 00:15:00");
  assert.deepEqual(format(first.departures), ["06:00:00", "06:30:00", "06:45:00", "07:00:00"]);
  const updated = setDepartureRanges(first, "08:00:00, 08:30:00, 00:30:00");
  assert.deepEqual(format(updated.departures), ["06:00:00", "06:30:00", "08:00:00", "08:30:00"]);
  assert.deepEqual(getIndividualDepartures(updated), service.departures);
  assert.equal(first.departurePlan.rangeText, "06:30:00, 07:00:00, 00:15:00");
  assert.deepEqual(service.departures, [21600, 23400]);
});

test("editing individual departures keeps generated times, while clearing ranges retains only individual times", () => {
  const first = setDepartureRanges(service, "06:30:00, 07:00:00, 00:15:00");
  const individual = setIndividualDepartures(first, [32400, 32400]);
  assert.deepEqual(format(individual.departures), ["06:30:00", "06:45:00", "07:00:00", "09:00:00"]);
  const cleared = setDepartureRanges(individual, "\n ");
  assert.equal(cleared.departurePlan, undefined);
  assert.deepEqual(format(cleared.departures), ["09:00:00"]);
  assert.deepEqual(setIndividualDepartures(first, []).departures, [23400, 24300, 25200]);
});

test("project JSON preserves editable original rows and independent departures", () => {
  const source = " 06:30:00，09:00:00，00:15:00\n\n17:00:00, 19:00:00, 00:10:00 ";
  const first = setDepartureRanges(service, source);
  const restored = JSON.parse(JSON.stringify({ services: [first] })).services[0];
  assert.deepEqual(restored.departurePlan, { rangeText: source, individualDepartures: service.departures });
  assert.deepEqual(restored.departures, first.departures);
  assert.deepEqual(setDepartureRanges(restored, "").departures, service.departures);
});
