export type Point = { x: number; y: number };

export type Station = {
  id: string;
  name: string;
  position: Point;
};

export type RailLine = {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
};

export type RouteLeg = {
  id: string;
  lineId: string;
  fromStationId: string;
  toStationId: string;
};

export type TimingRule =
  | { mode: "stop"; arrival: number; departure: number }
  | { mode: "pass-exact"; pass: number }
  | { mode: "pass-flexible" };

export type Service = {
  id: string;
  name: string;
  category: string;
  idFormula: string;
  departures: number[];
  routeLegs: RouteLeg[];
  timings: Record<string, TimingRule>;
  color: string;
};

export type RouteStation = {
  stationId: string;
  occurrenceKey: string;
  distance: number;
};

export type CompiledRoute = {
  points: Point[];
  cumulativeDistances: number[];
  stations: RouteStation[];
  totalDistance: number;
  valid: boolean;
  error?: string;
};

export type TrainRenderState = {
  key: string;
  id: string;
  serviceId: string;
  serviceName: string;
  category: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  nextStationId?: string;
  relativeTime: number;
};

export type Selection =
  | { type: "station"; id: string }
  | { type: "line"; id: string }
  | { type: "service"; id: string }
  | { type: "train"; id: string; serviceId: string }
  | null;

export type ToolMode = "select" | "station" | "line";

export type NetworkSnapshot = {
  stations: Station[];
  lines: RailLine[];
  services: Service[];
};
