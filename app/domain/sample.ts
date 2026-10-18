import type { NetworkSnapshot, Service } from "./types";

const rapid: Service = {
  id: "service-r1",
  name: "晨光快线",
  groupId: "service-group-daily",
  category: "高速",
  idFormula: "G{100+n*2}",
  departures: [21600, 23400, 25200, 27000, 28800, 30600],
  color: "#ffb36b",
  routeLegs: [
    { id: "leg-r1-1", lineId: "line-orange", fromStationId: "s-west", toStationId: "s-central" },
    { id: "leg-r1-2", lineId: "line-teal", fromStationId: "s-central", toStationId: "s-harbor" },
  ],
  timings: {
    "s-west:0": { mode: "stop", platform: "1", arrival: 0, departure: 0 },
    "s-river:0": { mode: "pass-flexible", platform: null },
    "s-central:0": { mode: "stop", platform: "1", arrival: 620, departure: 740 },
    "s-tech:0": { mode: "pass-exact", platform: "2", pass: 1120 },
    "s-harbor:0": { mode: "stop", platform: "1", arrival: 1620, departure: 1620 },
  },
};

const local: Service = {
  id: "service-l2",
  name: "环城通勤",
  groupId: "service-group-daily",
  category: "普通",
  idFormula: "C{20+n}",
  departures: [22200, 23100, 24000, 24900, 25800, 26700, 27600, 28500],
  color: "#83d8c5",
  routeLegs: [
    { id: "leg-l2-1", lineId: "line-teal", fromStationId: "s-north", toStationId: "s-harbor" },
  ],
  timings: {
    "s-north:0": { mode: "stop", platform: "1", arrival: 0, departure: 0 },
    "s-central:0": { mode: "stop", platform: "2", arrival: 430, departure: 490 },
    "s-tech:0": { mode: "stop", platform: "1", arrival: 790, departure: 850 },
    "s-harbor:0": { mode: "stop", platform: "2", arrival: 1280, departure: 1280 },
  },
};

export const initialNetwork: NetworkSnapshot = {
  serviceGroups: [{ id: "service-group-daily", name: "日常运行" }],
  stations: [
    { id: "s-west", name: "西郊", position: { x: 160, y: 390 } },
    { id: "s-river", name: "江湾", position: { x: 350, y: 315 } },
    { id: "s-central", name: "中央站", position: { x: 565, y: 350 } },
    { id: "s-east", name: "东城", position: { x: 805, y: 260 } },
    { id: "s-north", name: "北站", position: { x: 510, y: 120 } },
    { id: "s-tech", name: "科创园", position: { x: 670, y: 470 } },
    { id: "s-harbor", name: "临港", position: { x: 850, y: 590 } },
  ],
  lines: [
    {
      id: "line-orange",
      name: "曙光线",
      color: "#e8834d",
      stationIds: ["s-west", "s-river", "s-central", "s-east"],
    },
    {
      id: "line-teal",
      name: "湾区线",
      color: "#42a99a",
      stationIds: ["s-north", "s-central", "s-tech", "s-harbor"],
    },
  ],
  services: [rapid, local],
};
