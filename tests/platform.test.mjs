import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const testCache = join(projectRoot, "node_modules", ".cache");
await mkdir(testCache, { recursive: true });
const compiledRoot = await mkdtemp(join(testCache, "rail-flow-platform-tests-"));
after(async () => {
  // Only remove the temporary compilation directory created by this test run.
  assert.equal(dirname(resolve(compiledRoot)), resolve(testCache));
  await rm(compiledRoot, { recursive: true, force: true });
});
await writeFile(join(compiledRoot, "package.json"), '{"type":"commonjs"}');
const sources = [
  "domain/types.ts", "domain/platform.ts", "domain/geometry.ts", "domain/sample.ts",
  "domain/simulation.ts", "domain/schedule.ts", "domain/stationBoard.ts", "lib/time.ts",
  "components/StationDisplay.tsx", "components/ServiceEditor.tsx",
];
await Promise.all(sources.map(async (file) => {
  const source = await readFile(join(projectRoot, "app", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const output = join(compiledRoot, file.replace(/\.tsx?$/, ".js"));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, outputText);
}));
const require = createRequire(import.meta.url);
const load = (file) => require(join(compiledRoot, file));
const { initialNetwork } = load("domain/sample.js");
const { compileRoute } = load("domain/geometry.js");
const { buildAnchors, collectActiveTrains } = load("domain/simulation.js");
const { createReversedSchedule, createUniformSchedule } = load("domain/schedule.js");
const { getStationBoardEvents, getStationTimetable } = load("domain/stationBoard.js");
const { normalizeTimingPlatform, reversePlatform, getStationPlatforms, matchesPlatforms } = load("domain/platform.js");
const { StationDisplay } = load("components/StationDisplay.js");
const { ServiceEditor } = load("components/ServiceEditor.js");

const { stations, lines, services } = initialNetwork;
const routesFor = (items) => new Map(items.map((service) => [
  service.id, compileRoute(service.routeLegs, stations, lines),
]));
const routes = routesFor(services);
const timetableAt = (stationId, items = services) => (
  getStationTimetable(stationId, items, routesFor(items), stations, lines)
);
const boardAt = (stationId, items = services, clock = 6 * 3600) => (
  getStationBoardEvents(stationId, items, routesFor(items), stations, lines, clock)
);
const noop = () => {};

test("old timing rules acquire a stopping platform or an explicit null for passing", () => {
  assert.deepEqual(normalizeTimingPlatform({ mode: "stop", arrival: 0, departure: 30 }), {
    mode: "stop", platform: "1", arrival: 0, departure: 30,
  });
  assert.deepEqual(normalizeTimingPlatform({ mode: "pass-exact", pass: 60 }), {
    mode: "pass-exact", platform: null, pass: 60,
  });
  assert.deepEqual(normalizeTimingPlatform({ mode: "pass-flexible" }), {
    mode: "pass-flexible", platform: null,
  });
  assert.equal(normalizeTimingPlatform({ mode: "stop", platform: " 10A ", arrival: 0, departure: 0 }).platform, "10A");
  assert.equal(normalizeTimingPlatform({ mode: "pass-flexible", platform: "  " }).platform, null);
});

test("board and timetable retain different stopping platforms at the same station", () => {
  for (const entries of [boardAt("s-central"), timetableAt("s-central")]) {
    assert.deepEqual(new Set(entries.map((entry) => entry.platform)), new Set(["1", "2"]));
    assert.ok(entries.filter((entry) => entry.serviceId === "service-r1").every((entry) => entry.platform === "1"));
    assert.ok(entries.filter((entry) => entry.serviceId === "service-l2").every((entry) => entry.platform === "2"));
  }
});

test("reversing numeric platforms swaps odd/even pairs and preserves other platform labels", () => {
  for (const [platform, paired] of [["1", "2"], ["2", "1"], ["3", "4"], ["4", "3"], ["9", "10"], ["10", "9"], [null, null], ["A", "A"], ["2A", "2A"], ["0", "0"]]) {
    assert.equal(reversePlatform(platform), paired);
    assert.equal(reversePlatform(paired), platform);
  }
});

const reverseService = (source) => {
  const routeLegs = [...source.routeLegs].reverse().map((leg) => ({
    ...leg, fromStationId: leg.toStationId, toStationId: leg.fromStationId,
  }));
  const sourceRoute = compileRoute(source.routeLegs, stations, lines);
  const reversedRoute = compileRoute(routeLegs, stations, lines);
  return { ...source, routeLegs, timings: createReversedSchedule(source, sourceRoute, reversedRoute) };
};

test("reversed services swap stopping and passing platforms while mirroring their times", () => {
  const source = structuredClone(services[0]);
  source.timings["s-central:0"].platform = "4";
  source.timings["s-tech:0"].platform = "9";
  const reversed = reverseService(source);
  assert.deepEqual(reversed.timings, {
    "s-harbor:0": { mode: "stop", platform: "2", arrival: 0, departure: 0 },
    "s-tech:0": { mode: "pass-exact", platform: "10", pass: 500 },
    "s-central:0": { mode: "stop", platform: "3", arrival: 880, departure: 1000 },
    "s-river:0": { mode: "pass-flexible", platform: null },
    "s-west:0": { mode: "stop", platform: "2", arrival: 1620, departure: 1620 },
  });
  assert.deepEqual(reverseService(reversed).timings, source.timings);
  assert.equal(source.timings["s-central:0"].platform, "4");
  source.timings["s-river:0"].platform = "5";
  source.timings["s-tech:0"].platform = null;
  const passingReversed = reverseService(source);
  assert.equal(passingReversed.timings["s-river:0"].platform, "6");
  assert.equal(passingReversed.timings["s-tech:0"].platform, null);
});

test("reversing a route with repeated station visits pairs the platform of each occurrence", () => {
  const source = structuredClone(services[0]);
  source.routeLegs = [
    { id: "out", lineId: "line-orange", fromStationId: "s-west", toStationId: "s-central" },
    { id: "back", lineId: "line-orange", fromStationId: "s-central", toStationId: "s-west" },
  ];
  source.timings = {
    "s-west:0": { mode: "stop", platform: "1", arrival: 0, departure: 0 },
    "s-river:0": { mode: "pass-flexible", platform: "3" },
    "s-central:0": { mode: "stop", platform: "4", arrival: 600, departure: 660 },
    "s-river:1": { mode: "pass-flexible", platform: null },
    "s-west:1": { mode: "stop", platform: "6", arrival: 1200, departure: 1200 },
  };
  const reversed = reverseService(source);
  assert.equal(reversed.timings["s-west:0"].platform, "5");
  assert.equal(reversed.timings["s-west:1"].platform, "2");
  assert.equal(reversed.timings["s-river:0"].platform, null);
  assert.equal(reversed.timings["s-river:1"].platform, "4");
  assert.deepEqual(reverseService(reversed).timings, source.timings);
});

test("exact and flexible passes support both a named platform and no platform", () => {
  for (const mode of ["pass-exact", "pass-flexible"]) {
    for (const platform of ["9A", null]) {
      const rapid = structuredClone(services[0]);
      rapid.timings["s-tech:0"] = mode === "pass-exact"
        ? { mode, platform, pass: 1120 } : { mode, platform };
      for (const entries of [boardAt("s-tech", [rapid]), timetableAt("s-tech", [rapid])]) {
        assert.ok(entries.length > 0);
        assert.ok(entries.every((entry) => entry.platform === platform));
      }
    }
  }
});

test("platform selection includes all services on selected platforms and can select none", () => {
  const entries = timetableAt("s-central");
  assert.equal(entries.filter((entry) => matchesPlatforms(entry.platform, null)).length, 14);
  assert.equal(entries.filter((entry) => matchesPlatforms(entry.platform, ["1"])).length, 6);
  assert.equal(entries.filter((entry) => matchesPlatforms(entry.platform, ["1", "2"])).length, 14);
  assert.equal(entries.filter((entry) => matchesPlatforms(entry.platform, [])).length, 0);
  assert.equal(matchesPlatforms(null, [null]), true);
  assert.equal(matchesPlatforms("1", [null]), false);
  assert.equal(matchesPlatforms(null, ["1"]), false);
});

test("platform choices come from all-day routes, including implicit passes and services without departures", () => {
  const items = ["10", "2", "1", null].map((platform, index) => {
    const service = structuredClone(services[0]);
    service.id = `choice-${index}`;
    service.departures = [];
    if (platform === null) delete service.timings["s-central:0"];
    else service.timings["s-central:0"].platform = platform;
    return service;
  });
  assert.deepEqual(getStationPlatforms("s-central", items, routesFor(items)), ["1", "2", "10", null]);
  assert.deepEqual(getStationPlatforms("missing", items, routesFor(items)), []);
});

test("uniform schedule generation preserves platforms for both passing modes", () => {
  const rapid = structuredClone(services[0]);
  rapid.timings["s-river:0"].platform = "3";
  rapid.timings["s-tech:0"].platform = null;
  const route = routes.get(rapid.id);
  const preserved = createUniformSchedule(rapid, route, 80, 60, true);
  assert.equal(preserved["s-river:0"].mode, "pass-flexible");
  assert.equal(preserved["s-river:0"].platform, "3");
  assert.equal(preserved["s-tech:0"].mode, "pass-exact");
  assert.equal(preserved["s-tech:0"].platform, null);
  const allStops = createUniformSchedule(rapid, route, 80, 60, false);
  assert.equal(allStops["s-river:0"].platform, "3");
  assert.equal(allStops["s-tech:0"].platform, "1");
  assert.ok(Object.values(allStops).every((rule) => rule.mode === "stop" && rule.platform));
});

test("repeated visits to one station retain their own platforms", () => {
  const service = structuredClone(services[0]);
  service.routeLegs = [
    { id: "out", lineId: "line-orange", fromStationId: "s-west", toStationId: "s-central" },
    { id: "back", lineId: "line-orange", fromStationId: "s-central", toStationId: "s-west" },
  ];
  service.timings = {
    "s-west:0": { mode: "stop", platform: "1", arrival: 0, departure: 0 },
    "s-central:0": { mode: "stop", platform: "2", arrival: 600, departure: 660 },
    "s-west:1": { mode: "stop", platform: "3", arrival: 1200, departure: 1200 },
  };
  for (const entries of [boardAt("s-west", [service]), timetableAt("s-west", [service])]) {
    assert.deepEqual(new Set(entries.map((entry) => entry.platform)), new Set(["1", "3"]));
  }
});

test("changing platforms leaves movement anchors and map positions unchanged", () => {
  const changed = structuredClone(services);
  for (const service of changed) {
    for (const rule of Object.values(service.timings)) rule.platform = "99";
    assert.deepEqual(buildAnchors(service, routes.get(service.id)), buildAnchors(services.find((item) => item.id === service.id), routes.get(service.id)));
  }
  for (const clock of [21600, 22500, 23800, 25000]) {
    assert.deepEqual(collectActiveTrains(changed, routes, clock), collectActiveTrains(services, routes, clock));
  }
});

test("saving and loading JSON preserves null passing platforms and named platforms", () => {
  const restored = JSON.parse(JSON.stringify(initialNetwork));
  assert.equal(restored.services[0].timings["s-river:0"].platform, null);
  assert.equal(restored.services[0].timings["s-tech:0"].platform, "2");
  assert.equal(restored.services[1].timings["s-central:0"].platform, "2");
});

test("board renders its platform column and timetable renders platform choices without Service choices", () => {
  const props = { initialStationId: "s-central", stations, lines, services, routes, clockSeconds: 21600, onClose: noop };
  const board = renderToStaticMarkup(createElement(StationDisplay, props));
  assert.match(board, /<th>站台<\/th>/);
  assert.match(board, /class="board-platform">1<\/td>/);
  assert.match(board, /class="board-platform">2<\/td>/);
  const timetable = renderToStaticMarkup(createElement(StationDisplay, { ...props, initialView: "timetable" }));
  assert.match(timetable, /aria-label="选择显示站台"/);
  assert.match(timetable, />1 站台<\/button>/);
  assert.match(timetable, />2 站台<\/button>/);
  assert.doesNotMatch(timetable, /选择时刻表 Service|显示 Service/);
  const passing = renderToStaticMarkup(createElement(StationDisplay, { ...props, initialStationId: "s-river", initialView: "timetable" }));
  assert.match(passing, /无站台（正线通过）/);
});

test("Service editor exposes required stopping platforms and blank passing platforms", () => {
  const service = services[0];
  const html = renderToStaticMarkup(createElement(ServiceEditor, {
    service, stations, lines, serviceGroups: initialNetwork.serviceGroups,
    route: routes.get(service.id), onChange: noop, onDelete: noop, onDuplicate: noop,
  }));
  assert.match(html, /aria-label="西郊站台"[^>]*required=""[^>]*value="1"/);
  assert.match(html, /aria-label="江湾站台"[^>]*placeholder="无站台（正线通过）"[^>]*value=""/);
  assert.match(html, /aria-label="科创园站台"[^>]*value="2"/);
});
