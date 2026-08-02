"use client";

import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { distanceToSegment, sampleLine } from "../domain/geometry";
import { collectActiveTrains } from "../domain/simulation";
import type {
  CompiledRoute,
  Point,
  RailLine,
  Selection,
  Service,
  Station,
  ToolMode,
  TrainRenderState,
} from "../domain/types";

type Camera = { x: number; y: number; scale: number };

type RailCanvasProps = {
  stations: Station[];
  lines: RailLine[];
  services: Service[];
  compiledRoutes: Map<string, CompiledRoute>;
  tool: ToolMode;
  selection: Selection;
  draftStationIds: string[];
  getClockSeconds: () => number;
  onSelect: (selection: Selection) => void;
  onAddStation: (position: Point) => void;
  onMoveStation: (stationId: string, position: Point) => void;
  onAppendDraftStation: (stationId: string) => void;
  onActiveCountChange: (count: number) => void;
};

type PointerState = {
  pointerId: number;
  startClient: Point;
  lastClient: Point;
  draggingStationId?: string;
  panning: boolean;
  moved: boolean;
};

const WORLD_WIDTH = 1020;
const WORLD_HEIGHT = 720;

function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

function eventPoint(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera) {
  ctx.save();
  ctx.strokeStyle = "rgba(221, 229, 218, 0.055)";
  ctx.lineWidth = 1;
  const spacing = 44 * camera.scale;
  const offsetX = ((camera.x % spacing) + spacing) % spacing;
  const offsetY = ((camera.y % spacing) + spacing) % spacing;
  ctx.beginPath();
  for (let x = offsetX; x < width; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = offsetY; y < height; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function tracePolyline(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
}

export function RailCanvas({
  stations,
  lines,
  services,
  compiledRoutes,
  tool,
  selection,
  draftStationIds,
  getClockSeconds,
  onSelect,
  onAddStation,
  onMoveStation,
  onAppendDraftStation,
  onActiveCountChange,
}: RailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const initializedRef = useRef(false);
  const pointerRef = useRef<PointerState | null>(null);
  const trainsRef = useRef<TrainRenderState[]>([]);
  const activeCountRef = useRef(-1);
  const stationMap = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations],
  );
  const sampledLines = useMemo(
    () => new Map(lines.map((line) => [line.id, sampleLine(line, stationMap)])),
    [lines, stationMap],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (!initializedRef.current) {
        const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * 0.93;
        cameraRef.current = {
          scale,
          x: (width - WORLD_WIDTH * scale) / 2,
          y: (height - WORLD_HEIGHT * scale) / 2,
        };
        initializedRef.current = true;
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = () => {
      const camera = cameraRef.current;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#151816";
      context.fillRect(0, 0, width, height);
      drawGrid(context, width, height, camera);

      context.save();
      context.translate(camera.x, camera.y);
      context.scale(camera.scale, camera.scale);

      for (const line of lines) {
        const sampled = sampledLines.get(line.id);
        if (!sampled?.points.length) continue;
        const selected = selection?.type === "line" && selection.id === line.id;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(0, 0, 0, 0.34)";
        context.lineWidth = (selected ? 13 : 10) / camera.scale;
        tracePolyline(context, sampled.points);
        context.stroke();
        context.strokeStyle = line.color;
        context.lineWidth = (selected ? 6 : 4) / camera.scale;
        tracePolyline(context, sampled.points);
        context.stroke();
      }

      if (draftStationIds.length) {
        const points = draftStationIds
          .map((id) => stationMap.get(id)?.position)
          .filter((point): point is Point => Boolean(point));
        context.save();
        context.setLineDash([8 / camera.scale, 7 / camera.scale]);
        context.strokeStyle = "#f4c78d";
        context.lineWidth = 2 / camera.scale;
        tracePolyline(context, points);
        context.stroke();
        context.restore();
      }

      for (const station of stations) {
        const selected = selection?.type === "station" && selection.id === station.id;
        const drafted = draftStationIds.includes(station.id);
        const radius = (selected || drafted ? 8 : 6) / camera.scale;
        context.beginPath();
        context.arc(station.position.x, station.position.y, radius, 0, Math.PI * 2);
        context.fillStyle = selected ? "#f2bd76" : drafted ? "#ffe0ad" : "#e8eee8";
        context.fill();
        context.lineWidth = 3 / camera.scale;
        context.strokeStyle = "#232724";
        context.stroke();
        context.fillStyle = selected ? "#ffe1b3" : "rgba(236, 242, 235, 0.88)";
        context.font = `600 ${12 / camera.scale}px var(--font-geist-sans), sans-serif`;
        context.textAlign = "center";
        context.fillText(station.name, station.position.x, station.position.y - 13 / camera.scale);
      }

      const trains = collectActiveTrains(services, compiledRoutes, getClockSeconds());
      trainsRef.current = trains;
      if (trains.length !== activeCountRef.current) {
        activeCountRef.current = trains.length;
        onActiveCountChange(trains.length);
      }
      const visibleLeft = -camera.x / camera.scale - 30 / camera.scale;
      const visibleTop = -camera.y / camera.scale - 30 / camera.scale;
      const visibleRight = (width - camera.x) / camera.scale + 30 / camera.scale;
      const visibleBottom = (height - camera.y) / camera.scale + 30 / camera.scale;
      const denseMode = trains.length > 2500;
      for (const train of trains) {
        if (train.x < visibleLeft || train.x > visibleRight || train.y < visibleTop || train.y > visibleBottom) continue;
        const selected = selection?.type === "train" && selection.id === train.id && selection.serviceId === train.serviceId;
        if (denseMode && !selected) {
          const unit = 1 / camera.scale;
          context.fillStyle = train.color;
          context.fillRect(train.x - 3 * unit, train.y - 2 * unit, 6 * unit, 4 * unit);
          continue;
        }
        context.save();
        context.translate(train.x, train.y);
        context.rotate(train.angle);
        const unit = 1 / camera.scale;
        context.shadowBlur = selected ? 14 : 7;
        context.shadowColor = train.color;
        context.fillStyle = selected ? "#fff2d6" : train.color;
        context.strokeStyle = "#111411";
        context.lineWidth = 2 * unit;
        context.beginPath();
        context.roundRect(-10 * unit, -5 * unit, 20 * unit, 10 * unit, 4 * unit);
        context.fill();
        context.stroke();
        context.fillStyle = "#222623";
        context.fillRect(-4 * unit, -2 * unit, 4 * unit, 4 * unit);
        context.fillRect(2 * unit, -2 * unit, 4 * unit, 4 * unit);
        context.restore();
      }
      context.restore();
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [
    compiledRoutes,
    draftStationIds,
    getClockSeconds,
    lines,
    onActiveCountChange,
    sampledLines,
    selection,
    services,
    stationMap,
    stations,
  ]);

  const findHit = (screenPoint: Point): Selection => {
    const camera = cameraRef.current;
    const worldPoint = screenToWorld(screenPoint, camera);
    let closestTrain: TrainRenderState | undefined;
    let trainDistance = 14 / camera.scale;
    for (const train of trainsRef.current) {
      const candidate = Math.hypot(train.x - worldPoint.x, train.y - worldPoint.y);
      if (candidate < trainDistance) {
        closestTrain = train;
        trainDistance = candidate;
      }
    }
    if (closestTrain) return { type: "train", id: closestTrain.id, serviceId: closestTrain.serviceId };

    let closestStation: Station | undefined;
    let stationDistance = 13 / camera.scale;
    for (const station of stations) {
      const candidate = Math.hypot(
        station.position.x - worldPoint.x,
        station.position.y - worldPoint.y,
      );
      if (candidate < stationDistance) {
        closestStation = station;
        stationDistance = candidate;
      }
    }
    if (closestStation) return { type: "station", id: closestStation.id };

    let closestLine: RailLine | undefined;
    let lineDistance = 9 / camera.scale;
    for (const line of lines) {
      const points = sampledLines.get(line.id)?.points ?? [];
      for (let index = 1; index < points.length; index += 1) {
        const candidate = distanceToSegment(worldPoint, points[index - 1], points[index]);
        if (candidate < lineDistance) {
          closestLine = line;
          lineDistance = candidate;
        }
      }
    }
    return closestLine ? { type: "line", id: closestLine.id } : null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = eventPoint(event, canvas);
    const hit = findHit(point);
    canvas.setPointerCapture(event.pointerId);
    if (tool === "line") {
      if (hit?.type === "station") onAppendDraftStation(hit.id);
      return;
    }
    if (tool === "station") return;
    pointerRef.current = {
      pointerId: event.pointerId,
      startClient: point,
      lastClient: point,
      draggingStationId: hit?.type === "station" ? hit.id : undefined,
      panning: !hit,
      moved: false,
    };
    if (hit) onSelect(hit);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const pointer = pointerRef.current;
    if (!canvas || !pointer || pointer.pointerId !== event.pointerId) return;
    const point = eventPoint(event, canvas);
    const dx = point.x - pointer.lastClient.x;
    const dy = point.y - pointer.lastClient.y;
    if (Math.hypot(point.x - pointer.startClient.x, point.y - pointer.startClient.y) > 3) {
      pointer.moved = true;
    }
    if (pointer.draggingStationId) {
      onMoveStation(pointer.draggingStationId, screenToWorld(point, cameraRef.current));
    } else if (pointer.panning) {
      cameraRef.current.x += dx;
      cameraRef.current.y += dy;
    }
    pointer.lastClient = point;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = eventPoint(event, canvas);
    if (tool === "station") {
      const hit = findHit(point);
      if (!hit) onAddStation(screenToWorld(point, cameraRef.current));
    } else if (tool === "select" && pointerRef.current && !pointerRef.current.moved) {
      onSelect(findHit(point));
    }
    pointerRef.current = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = eventPoint(event, canvas);
    const camera = cameraRef.current;
    const before = screenToWorld(point, camera);
    const factor = Math.exp(-event.deltaY * 0.001);
    camera.scale = Math.max(0.38, Math.min(3.2, camera.scale * factor));
    camera.x = point.x - before.x * camera.scale;
    camera.y = point.y - before.y * camera.scale;
  };

  return (
    <canvas
      ref={canvasRef}
      className={`rail-canvas tool-${tool}`}
      aria-label="铁路运行画布"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerRef.current = null;
      }}
      onWheel={handleWheel}
    />
  );
}
