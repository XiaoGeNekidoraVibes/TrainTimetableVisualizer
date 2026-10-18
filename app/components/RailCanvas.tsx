"use client";

import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { distanceToSegment, sampleLine } from "../domain/geometry";
import { collectActiveTrains, getTrainFocusPosition } from "../domain/simulation";
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
  followedTrainKey: string | null;
  draftStationIds: string[];
  showOsm: boolean;
  osmOpacity: number;
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
  startingHit: Selection;
  draggingStationId?: string;
  stationGrabOffset?: Point;
  panning: boolean;
  moved: boolean;
};

type RenderSnapshot = {
  stations: Station[];
  lines: RailLine[];
  services: Service[];
  compiledRoutes: Map<string, CompiledRoute>;
  selection: Selection;
  followedTrainKey: string | null;
  draftStationIds: string[];
  stationMap: Map<string, Station>;
  sampledLines: Map<string, ReturnType<typeof sampleLine>>;
  showOsm: boolean;
  osmOpacity: number;
  getClockSeconds: () => number;
  onActiveCountChange: (count: number) => void;
};

const WORLD_WIDTH = 1020;
const WORLD_HEIGHT = 720;
const OSM_TILE_SIZE = 256;
const OSM_BASE_ZOOM = 13;
const OSM_MIN_ZOOM = 2;
const OSM_MAX_ZOOM = 19;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const OSM_CENTER = { longitude: 121.4737, latitude: 31.2304 };
const POINTER_DRAG_THRESHOLD = 8;
const osmTileCache = new Map<string, HTMLImageElement | null>();

function longitudeToPixel(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * OSM_TILE_SIZE * 2 ** zoom;
}

function latitudeToPixel(latitude: number, zoom: number) {
  const radians = (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
    * OSM_TILE_SIZE * 2 ** zoom;
}

const OSM_REFERENCE_METERS_PER_PIXEL = Math.cos((OSM_CENTER.latitude * Math.PI) / 180)
  * EARTH_CIRCUMFERENCE_METERS / (OSM_TILE_SIZE * 2 ** OSM_BASE_ZOOM);
const OSM_REFERENCE_SCALE = 1 / OSM_REFERENCE_METERS_PER_PIXEL;
const MIN_CAMERA_SCALE = OSM_REFERENCE_SCALE * 2 ** (OSM_MIN_ZOOM - OSM_BASE_ZOOM);
const MAX_CAMERA_SCALE = OSM_REFERENCE_SCALE * 2 ** (OSM_MAX_ZOOM - OSM_BASE_ZOOM);

function cameraScaleForMapZoom(zoom: number) {
  return OSM_REFERENCE_SCALE * 2 ** (zoom - OSM_BASE_ZOOM);
}

function getOsmTile(zoom: number, x: number, y: number) {
  const tilesPerAxis = 2 ** zoom;
  if (y < 0 || y >= tilesPerAxis) return null;
  const wrappedX = ((x % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
  const key = `${zoom}/${wrappedX}/${y}`;
  if (osmTileCache.has(key)) return osmTileCache.get(key) ?? null;
  if (osmTileCache.size >= 320) osmTileCache.delete(osmTileCache.keys().next().value!);
  const tile = new Image();
  tile.crossOrigin = "anonymous";
  tile.decoding = "async";
  tile.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
  tile.onerror = () => osmTileCache.set(key, null);
  osmTileCache.set(key, tile);
  return tile;
}

function drawOsmBaseMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  opacity: number,
) {
  const zoom = Math.max(OSM_MIN_ZOOM, Math.min(
    OSM_MAX_ZOOM,
    Math.round(OSM_BASE_ZOOM + Math.log2(camera.scale / OSM_REFERENCE_SCALE)),
  ));
  const metresPerPixel = Math.cos((OSM_CENTER.latitude * Math.PI) / 180)
    * EARTH_CIRCUMFERENCE_METERS / (OSM_TILE_SIZE * 2 ** zoom);
  const centerPixel = {
    x: longitudeToPixel(OSM_CENTER.longitude, zoom),
    y: latitudeToPixel(OSM_CENTER.latitude, zoom),
  };
  const left = -camera.x / camera.scale;
  const top = -camera.y / camera.scale;
  const right = (width - camera.x) / camera.scale;
  const bottom = (height - camera.y) / camera.scale;
  const worldCenter = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  const startX = Math.floor((centerPixel.x + (left - worldCenter.x) / metresPerPixel) / OSM_TILE_SIZE);
  const endX = Math.floor((centerPixel.x + (right - worldCenter.x) / metresPerPixel) / OSM_TILE_SIZE);
  const startY = Math.floor((centerPixel.y + (top - worldCenter.y) / metresPerPixel) / OSM_TILE_SIZE);
  const endY = Math.floor((centerPixel.y + (bottom - worldCenter.y) / metresPerPixel) / OSM_TILE_SIZE);
  const worldTileSize = OSM_TILE_SIZE * metresPerPixel;

  ctx.save();
  ctx.globalAlpha = opacity;
  for (let tileY = startY; tileY <= endY; tileY += 1) {
    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const tile = getOsmTile(zoom, tileX, tileY);
      if (!tile?.complete || !tile.naturalWidth) continue;
      ctx.drawImage(
        tile,
        worldCenter.x + (tileX * OSM_TILE_SIZE - centerPixel.x) * metresPerPixel,
        worldCenter.y + (tileY * OSM_TILE_SIZE - centerPixel.y) * metresPerPixel,
        worldTileSize + 0.5,
        worldTileSize + 0.5,
      );
    }
  }
  ctx.globalAlpha = Math.min(0.34, opacity * 0.62);
  ctx.fillStyle = "#0d110e";
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.restore();
}

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
  const desiredWorldSpacing = 58 / camera.scale;
  const magnitude = 10 ** Math.floor(Math.log10(desiredWorldSpacing));
  const normalized = desiredWorldSpacing / magnitude;
  const niceMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const spacing = niceMultiplier * magnitude * camera.scale;
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
  followedTrainKey,
  draftStationIds,
  showOsm,
  osmOpacity,
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
  const focusAnimationRef = useRef(0);
  const lastFocusedLineRef = useRef<string | null>(null);
  const previousViewRef = useRef<{ center: Point; scale: number } | null>(null);
  const stationMap = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations],
  );
  const sampledLines = useMemo(
    () => new Map(lines.map((line) => [line.id, sampleLine(line, stationMap)])),
    [lines, stationMap],
  );

  useEffect(() => {
    if (selection?.type !== "line") {
      lastFocusedLineRef.current = null;
      return;
    }
    if (lastFocusedLineRef.current === selection.id) return;
    const canvas = canvasRef.current;
    const points = sampledLines.get(selection.id)?.points ?? [];
    if (!canvas || points.length < 2) return;
    lastFocusedLineRef.current = selection.id;
    cancelAnimationFrame(focusAnimationRef.current);
    const bounds = canvas.getBoundingClientRect();
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let index = 1; index < points.length; index += 1) {
      minX = Math.min(minX, points[index].x);
      maxX = Math.max(maxX, points[index].x);
      minY = Math.min(minY, points[index].y);
      maxY = Math.max(maxY, points[index].y);
    }
    const padding = 90;
    const targetScale = Math.max(MIN_CAMERA_SCALE, Math.min(
      MAX_CAMERA_SCALE,
      Math.min(
        Math.max(1, bounds.width - padding * 2) / Math.max(1, maxX - minX),
        Math.max(1, bounds.height - padding * 2) / Math.max(1, maxY - minY),
      ),
    ));
    const target = {
      scale: targetScale,
      x: bounds.width / 2 - ((minX + maxX) / 2) * targetScale,
      y: bounds.height / 2 - ((minY + maxY) / 2) * targetScale,
    };
    const start = { ...cameraRef.current };
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 360);
      const eased = 1 - (1 - progress) ** 3;
      cameraRef.current = {
        scale: start.scale + (target.scale - start.scale) * eased,
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
      };
      if (progress < 1) focusAnimationRef.current = requestAnimationFrame(animate);
    };
    focusAnimationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(focusAnimationRef.current);
  }, [sampledLines, selection]);
  const renderSnapshotRef = useRef<RenderSnapshot>({
    stations,
    lines,
    services,
    compiledRoutes,
    selection,
    followedTrainKey,
    draftStationIds,
    stationMap,
    sampledLines,
    showOsm,
    osmOpacity,
    getClockSeconds,
    onActiveCountChange,
  });

  useEffect(() => {
    renderSnapshotRef.current = {
      stations,
      lines,
      services,
      compiledRoutes,
      selection,
      followedTrainKey,
      draftStationIds,
      stationMap,
      sampledLines,
      showOsm,
      osmOpacity,
      getClockSeconds,
      onActiveCountChange,
    };
  }, [
    compiledRoutes,
    draftStationIds,
    getClockSeconds,
    lines,
    onActiveCountChange,
    osmOpacity,
    sampledLines,
    selection,
    followedTrainKey,
    services,
    showOsm,
    stationMap,
    stations,
  ]);

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
      if (initializedRef.current) {
        cameraRef.current.x += (bounds.width - width) / 2;
        cameraRef.current.y += (bounds.height - height) / 2;
      }
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
      const render = renderSnapshotRef.current;
      const camera = cameraRef.current;
      const clockSeconds = render.getClockSeconds();
      const trains = collectActiveTrains(render.services, render.compiledRoutes, clockSeconds);
      trainsRef.current = trains;
      if (render.followedTrainKey) {
        if (!previousViewRef.current) {
          previousViewRef.current = {
            center: screenToWorld({ x: width / 2, y: height / 2 }, camera),
            scale: camera.scale,
          };
        }
        const train = trains.find((candidate) => candidate.key === render.followedTrainKey);
        const followedSelection = render.selection?.type === "train" ? render.selection : null;
        const service = !train && followedSelection
          ? render.services.find((candidate) => candidate.id === followedSelection.serviceId)
          : undefined;
        const route = service && render.compiledRoutes.get(service.id);
        const position = train ?? (service && route && followedSelection
          ? getTrainFocusPosition(service, route, followedSelection.departureIndex, clockSeconds)
          : null);
        if (position) {
          camera.x = width / 2 - position.x * camera.scale;
          camera.y = height / 2 - position.y * camera.scale;
        }
      } else if (previousViewRef.current) {
        const previous = previousViewRef.current;
        camera.scale = previous.scale;
        camera.x = width / 2 - previous.center.x * camera.scale;
        camera.y = height / 2 - previous.center.y * camera.scale;
        previousViewRef.current = null;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#151816";
      context.fillRect(0, 0, width, height);
      drawGrid(context, width, height, camera);

      context.save();
      context.translate(camera.x, camera.y);
      context.scale(camera.scale, camera.scale);

      if (render.showOsm) drawOsmBaseMap(context, width, height, camera, render.osmOpacity);

      for (const line of render.lines) {
        const sampled = render.sampledLines.get(line.id);
        if (!sampled?.points.length) continue;
        const selected = render.selection?.type === "line" && render.selection.id === line.id;
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

      if (render.draftStationIds.length) {
        const points = render.draftStationIds
          .map((id) => render.stationMap.get(id)?.position)
          .filter((point): point is Point => Boolean(point));
        context.save();
        context.setLineDash([8 / camera.scale, 7 / camera.scale]);
        context.strokeStyle = "#f4c78d";
        context.lineWidth = 2 / camera.scale;
        tracePolyline(context, points);
        context.stroke();
        context.restore();
      }

      for (const station of render.stations) {
        const selected = render.selection?.type === "station" && render.selection.id === station.id;
        const drafted = render.draftStationIds.includes(station.id);
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

      if (trains.length !== activeCountRef.current) {
        activeCountRef.current = trains.length;
        render.onActiveCountChange(trains.length);
      }
      const visibleLeft = -camera.x / camera.scale - 30 / camera.scale;
      const visibleTop = -camera.y / camera.scale - 30 / camera.scale;
      const visibleRight = (width - camera.x) / camera.scale + 30 / camera.scale;
      const visibleBottom = (height - camera.y) / camera.scale + 30 / camera.scale;
      const denseMode = trains.length > 2500;
      for (const train of trains) {
        if (train.x < visibleLeft || train.x > visibleRight || train.y < visibleTop || train.y > visibleBottom) continue;
        const selected = render.selection?.type === "train" && render.selection.departureIndex === train.departureIndex && render.selection.serviceId === train.serviceId;
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
  }, []);

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
    if (closestTrain) return {
      type: "train",
      id: closestTrain.id,
      serviceId: closestTrain.serviceId,
      departureIndex: closestTrain.departureIndex,
    };

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
    if (followedTrainKey) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = eventPoint(event, canvas);
    const hit = findHit(point);
    canvas.setPointerCapture(event.pointerId);
    const draggedStation = tool === "select" && hit?.type === "station"
      ? stations.find((station) => station.id === hit.id)
      : undefined;
    const worldPoint = screenToWorld(point, cameraRef.current);
    pointerRef.current = {
      pointerId: event.pointerId,
      startClient: point,
      lastClient: point,
      startingHit: hit,
      draggingStationId: draggedStation?.id,
      stationGrabOffset: draggedStation ? {
        x: draggedStation.position.x - worldPoint.x,
        y: draggedStation.position.y - worldPoint.y,
      } : undefined,
      panning: tool !== "select" || hit?.type !== "station",
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (followedTrainKey) return;
    const canvas = canvasRef.current;
    const pointer = pointerRef.current;
    if (!canvas || !pointer || pointer.pointerId !== event.pointerId) return;
    const point = eventPoint(event, canvas);
    const movement = Math.hypot(
      point.x - pointer.startClient.x,
      point.y - pointer.startClient.y,
    );
    if (!pointer.moved && movement < POINTER_DRAG_THRESHOLD) return;
    if (!pointer.moved) {
      pointer.moved = true;
      if (pointer.draggingStationId) {
        onSelect({ type: "station", id: pointer.draggingStationId });
      }
    }
    const dx = point.x - pointer.lastClient.x;
    const dy = point.y - pointer.lastClient.y;
    if (pointer.draggingStationId) {
      const world = screenToWorld(point, cameraRef.current);
      onMoveStation(pointer.draggingStationId, {
        x: world.x + (pointer.stationGrabOffset?.x ?? 0),
        y: world.y + (pointer.stationGrabOffset?.y ?? 0),
      });
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
    const pointer = pointerRef.current;
    if (!followedTrainKey && pointer && pointer.pointerId === event.pointerId && !pointer.moved) {
      const hit = findHit(point);
      if (tool === "station" && !hit) {
        onAddStation(screenToWorld(point, cameraRef.current));
      } else if (tool === "line" && hit?.type === "station") {
        onAppendDraftStation(hit.id);
      } else if (tool === "select") {
        onSelect(hit);
      }
    }
    pointerRef.current = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = followedTrainKey
      ? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
      : eventPoint(event, canvas);
    const camera = cameraRef.current;
    const before = screenToWorld(point, camera);
    const factor = Math.exp(-event.deltaY * 0.0022);
    camera.scale = Math.max(MIN_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, camera.scale * factor));
    camera.x = point.x - before.x * camera.scale;
    camera.y = point.y - before.y * camera.scale;
  };

  const zoomAtViewportCenter = (nextScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const point = { x: bounds.width / 2, y: bounds.height / 2 };
    const camera = cameraRef.current;
    const before = screenToWorld(point, camera);
    camera.scale = Math.max(MIN_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, nextScale));
    camera.x = point.x - before.x * camera.scale;
    camera.y = point.y - before.y * camera.scale;
  };

  return (
    <>
    <canvas
      ref={canvasRef}
      className={`rail-canvas tool-${tool} ${followedTrainKey ? "is-following" : ""}`}
      aria-label="铁路运行画布"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerRef.current = null;
      }}
      onWheel={handleWheel}
    />
    {showOsm && (
      <div className="canvas-zoom-controls" aria-label="地图缩放">
        <button type="button" aria-label="放大地图" title="放大" onClick={() => zoomAtViewportCenter(cameraRef.current.scale * 2)}>＋</button>
        <button type="button" aria-label="缩小地图" title="缩小" onClick={() => zoomAtViewportCenter(cameraRef.current.scale / 2)}>−</button>
        <button type="button" className="intercontinental-zoom" title="快速缩放到洲际范围" onClick={() => zoomAtViewportCenter(cameraScaleForMapZoom(4))}>洲际</button>
      </div>
    )}
    </>
  );
}
