"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileRoute } from "../domain/geometry";
import { initialNetwork } from "../domain/sample";
import type {
  NetworkSnapshot,
  Point,
  RailLine,
  Selection,
  Service,
  Station,
  ToolMode,
} from "../domain/types";
import { formatTime, parseClock } from "../lib/time";
import { Inspector } from "./Inspector";
import { RailCanvas } from "./RailCanvas";
import { StationDisplay } from "./StationDisplay";

const LINE_COLORS = ["#e8834d", "#42a99a", "#d8b557", "#7c92df", "#c96b86"];
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type ClockRuntime = {
  baseSeconds: number;
  baseRealTime: number;
  playing: boolean;
  speed: number;
};

function useSimulationClock(initialSeconds: number) {
  const runtime = useRef<ClockRuntime>({
    baseSeconds: initialSeconds,
    baseRealTime: 0,
    playing: true,
    speed: 1,
  });
  const [displaySeconds, setDisplaySeconds] = useState(initialSeconds);
  const [playing, setPlayingState] = useState(true);
  const [speed, setSpeedState] = useState(1);

  const getSeconds = useCallback(() => {
    const current = runtime.current;
    if (current.baseRealTime === 0) current.baseRealTime = performance.now();
    if (!current.playing) return current.baseSeconds;
    return current.baseSeconds + ((performance.now() - current.baseRealTime) / 1000) * current.speed;
  }, []);

  const setSeconds = useCallback((seconds: number) => {
    runtime.current.baseSeconds = ((seconds % 86400) + 86400) % 86400;
    runtime.current.baseRealTime = performance.now();
    setDisplaySeconds(runtime.current.baseSeconds);
  }, []);

  const setPlaying = useCallback((next: boolean) => {
    const now = getSeconds();
    runtime.current = { ...runtime.current, baseSeconds: now, baseRealTime: performance.now(), playing: next };
    setPlayingState(next);
  }, [getSeconds]);

  const setSpeed = useCallback((next: number) => {
    const now = getSeconds();
    runtime.current = { ...runtime.current, baseSeconds: now, baseRealTime: performance.now(), speed: next };
    setSpeedState(next);
  }, [getSeconds]);

  useEffect(() => {
    const timer = window.setInterval(() => setDisplaySeconds(getSeconds()), 100);
    return () => window.clearInterval(timer);
  }, [getSeconds]);

  return { displaySeconds, getSeconds, setSeconds, playing, setPlaying, speed, setSpeed };
}

export function TrainVisualizer() {
  const [network, setNetwork] = useState<NetworkSnapshot>(initialNetwork);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<ToolMode>("select");
  const [draftStationIds, setDraftStationIds] = useState<string[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [notice, setNotice] = useState("示例网络已就绪");
  const [stationDisplay, setStationDisplay] = useState<{
    stationId: string;
    view: "board" | "timetable";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clock = useSimulationClock(6 * 3600 + 42 * 60);
  const { playing: clockPlaying, setPlaying: setClockPlaying } = clock;

  const compiledRoutes = useMemo(
    () => new Map(
      network.services.map((service) => [
        service.id,
        compileRoute(service.routeLegs, network.stations, network.lines),
      ]),
    ),
    [network],
  );

  const selectTool = (next: ToolMode) => {
    setTool(next);
    if (next !== "line") setDraftStationIds([]);
    setNotice(next === "station" ? "点击画布空白处摆放站点" : next === "line" ? "依次点击站点，按 Enter 完成线路" : "拖动站点或画布，滚轮缩放");
  };

  const addStation = (position: Point) => {
    const id = makeId("station");
    const station: Station = { id, name: `新站 ${network.stations.length + 1}`, position };
    setNetwork((current) => ({ ...current, stations: [...current.stations, station] }));
    setSelection({ type: "station", id });
    setTool("select");
    setNotice("站点已创建，可在右侧重命名");
  };

  const finishLine = useCallback(() => {
    if (draftStationIds.length < 2) {
      setNotice("线路至少需要两个站点");
      return;
    }
    const id = makeId("line");
    const line: RailLine = {
      id,
      name: `线路 ${network.lines.length + 1}`,
      color: LINE_COLORS[network.lines.length % LINE_COLORS.length],
      stationIds: draftStationIds,
    };
    setNetwork((current) => ({ ...current, lines: [...current.lines, line] }));
    setDraftStationIds([]);
    setTool("select");
    setSelection({ type: "line", id });
    setNotice("线路已创建，曲线已按站点自动插值");
  }, [draftStationIds, network.lines.length]);

  const createService = () => {
    const line = network.lines.find((candidate) => candidate.stationIds.length >= 2);
    if (!line) {
      setNotice("请先创建一条包含至少两个站点的线路");
      return;
    }
    const id = makeId("service");
    const first = line.stationIds[0];
    const last = line.stationIds.at(-1)!;
    const service: Service = {
      id,
      name: `新 Service ${network.services.length + 1}`,
      category: "普通",
      idFormula: "T{100+n}",
      departures: [21600],
      color: LINE_COLORS[(network.services.length + 2) % LINE_COLORS.length],
      routeLegs: [{ id: makeId("leg"), lineId: line.id, fromStationId: first, toStationId: last }],
      timings: {
        [`${first}:0`]: { mode: "stop", arrival: 0, departure: 0 },
        [`${last}:0`]: { mode: "stop", arrival: 1800, departure: 1800 },
      },
    };
    setNetwork((current) => ({ ...current, services: [...current.services, service] }));
    setSelection({ type: "service", id });
    setNotice("Service 已创建，请完善路径和时间约束");
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify({ version: 1, ...network }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rail-flow-project.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("项目 JSON 已导出");
  };

  const importProject = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Partial<NetworkSnapshot>;
      if (!Array.isArray(data.stations) || !Array.isArray(data.lines) || !Array.isArray(data.services)) {
        throw new Error("invalid project");
      }
      setNetwork({
        stations: data.stations,
        lines: data.lines,
        services: data.services.map((service, index) => ({
          ...service,
          category: service.category || "普通",
          color: service.color || LINE_COLORS[index % LINE_COLORS.length],
        })),
      });
      setSelection(null);
      setNotice("项目已导入");
    } catch {
      setNotice("无法导入：文件格式不正确");
    }
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key.toLowerCase() === "v") selectTool("select");
      if (event.key.toLowerCase() === "s") selectTool("station");
      if (event.key.toLowerCase() === "l") selectTool("line");
      if (event.key === "Enter" && tool === "line") finishLine();
      if (event.key === "Escape") {
        setDraftStationIds([]);
        setTool("select");
      }
      if (event.key === " ") {
        event.preventDefault();
        setClockPlaying(!clockPlaying);
      }
    };
    const openService = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setSelection({ type: "service", id });
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("open-service", openService);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("open-service", openService);
    };
  }, [clockPlaying, finishLine, setClockPlaying, tool]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><span /><span /></div>
          <div><strong>RAIL FLOW</strong><small>运行图工作台</small></div>
        </div>

        <div className="clock-cluster">
          <button
            type="button"
            className={`play-button ${clock.playing ? "is-playing" : ""}`}
            aria-label={clock.playing ? "暂停" : "播放"}
            onClick={() => clock.setPlaying(!clock.playing)}
          >{clock.playing ? "Ⅱ" : "▶"}</button>
          <label className="clock-input-wrap">
            <span>模拟时间</span>
            <input
              type="time"
              step={1}
              value={formatTime(clock.displaySeconds)}
              onChange={(event) => {
                const next = parseClock(event.target.value);
                if (next !== null) clock.setSeconds(next);
              }}
            />
          </label>
          <select className="speed-select" value={clock.speed} onChange={(event) => clock.setSpeed(Number(event.target.value))} aria-label="模拟倍速">
            {[0.25, 0.5, 1, 2, 5, 10, 60].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
          <input
            className="day-slider"
            type="range"
            min={0}
            max={86399}
            step={1}
            value={Math.floor(clock.displaySeconds) % 86400}
            onChange={(event) => clock.setSeconds(Number(event.target.value))}
            aria-label="调整当日时间"
          />
        </div>

        <div className="top-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>导入</button>
          <button type="button" onClick={exportProject}>导出</button>
          <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importProject(file);
            event.target.value = "";
          }} />
          <div className="running-badge"><span />{activeCount} 列运行中</div>
        </div>
      </header>

      <aside className="tool-rail" aria-label="画布工具">
        <button className={tool === "select" ? "active" : ""} onClick={() => selectTool("select")} title="选择 (V)"><span className="tool-glyph arrow-glyph">↖</span><small>选择</small></button>
        <button className={tool === "station" ? "active" : ""} onClick={() => selectTool("station")} title="站点 (S)"><span className="tool-glyph station-glyph" /><small>站点</small></button>
        <button className={tool === "line" ? "active" : ""} onClick={() => selectTool("line")} title="线路 (L)"><span className="tool-glyph line-glyph" /><small>线路</small></button>
      </aside>

      <aside className="library-panel">
        <div className="library-top">
          <span className="eyebrow">NETWORK</span>
          <h1>铁路网络</h1>
          <p>{network.stations.length} 站 · {network.lines.length} 线</p>
        </div>
        <section className="library-section">
          <div className="library-title"><span>线路</span><small>{network.lines.length}</small></div>
          <div className="entity-list">
            {network.lines.map((line) => (
              <button key={line.id} className={selection?.type === "line" && selection.id === line.id ? "selected" : ""} onClick={() => setSelection({ type: "line", id: line.id })}>
                <span className="entity-color" style={{ background: line.color }} />
                <span><strong>{line.name}</strong><small>{line.stationIds.length} 个站点</small></span>
                <i>›</i>
              </button>
            ))}
          </div>
        </section>
        <section className="library-section service-library">
          <div className="library-title"><span>Services</span><button type="button" onClick={createService}>＋ 新建</button></div>
          <div className="entity-list">
            {network.services.map((service) => (
              <button key={service.id} className={selection?.type === "service" && selection.id === service.id ? "selected" : ""} onClick={() => setSelection({ type: "service", id: service.id })}>
                <span className="service-monogram" style={{ borderColor: service.color }}>{service.name.slice(0, 1)}</span>
                <span><strong>{service.name}</strong><small>{service.departures.length} 个班次</small></span>
                <i>›</i>
              </button>
            ))}
          </div>
        </section>
        <div className="library-footer"><span className="status-light" />本地项目 · 自动运行</div>
      </aside>

      <section className="canvas-stage">
        <RailCanvas
          stations={network.stations}
          lines={network.lines}
          services={network.services}
          compiledRoutes={compiledRoutes}
          tool={tool}
          selection={selection}
          draftStationIds={draftStationIds}
          getClockSeconds={clock.getSeconds}
          onSelect={setSelection}
          onAddStation={addStation}
          onMoveStation={(stationId, position) => setNetwork((current) => ({
            ...current,
            stations: current.stations.map((station) => station.id === stationId ? { ...station, position } : station),
          }))}
          onAppendDraftStation={(stationId) => setDraftStationIds((current) => current.at(-1) === stationId || current.includes(stationId) ? current : [...current, stationId])}
          onActiveCountChange={setActiveCount}
        />
        <div className="canvas-status">
          <span>{notice}</span>
          <div><kbd>滚轮</kbd> 缩放 <kbd>拖动</kbd> 平移</div>
        </div>
        {tool === "line" && (
          <div className="draft-actions">
            <strong>新线路</strong><span>已选 {draftStationIds.length} 站</span>
            <button disabled={draftStationIds.length < 2} onClick={finishLine}>完成线路</button>
            <button className="secondary" onClick={() => setDraftStationIds([])}>清除</button>
          </div>
        )}
      </section>

      <aside className={`inspector-panel ${selection ? "has-selection" : "is-empty"}`}>
        <Inspector
          selection={selection}
          stations={network.stations}
          lines={network.lines}
          services={network.services}
          routes={compiledRoutes}
          onStationChange={(next) => setNetwork((current) => ({ ...current, stations: current.stations.map((item) => item.id === next.id ? next : item) }))}
          onLineChange={(next) => setNetwork((current) => ({ ...current, lines: current.lines.map((item) => item.id === next.id ? next : item) }))}
          onServiceChange={(next) => setNetwork((current) => ({ ...current, services: current.services.map((item) => item.id === next.id ? next : item) }))}
          onDeleteStation={(id) => {
            setNetwork((current) => ({ ...current, stations: current.stations.filter((station) => station.id !== id), lines: current.lines.map((line) => ({ ...line, stationIds: line.stationIds.filter((stationId) => stationId !== id) })) }));
            setSelection(null);
            setNotice("站点已删除；受影响的 Service 会显示路径错误");
          }}
          onDeleteLine={(id) => {
            setNetwork((current) => ({ ...current, lines: current.lines.filter((line) => line.id !== id) }));
            setSelection(null);
            setNotice("线路已删除；引用它的 Service 保留并等待修复");
          }}
          onDeleteService={(id) => {
            setNetwork((current) => ({ ...current, services: current.services.filter((service) => service.id !== id) }));
            setSelection(null);
            setNotice("Service 已删除");
          }}
          onOpenStationDisplay={(stationId, view) => setStationDisplay({ stationId, view })}
        />
      </aside>
      {stationDisplay && (
        <StationDisplay
          key={`${stationDisplay.stationId}:${stationDisplay.view}`}
          initialStationId={stationDisplay.stationId}
          initialView={stationDisplay.view}
          stations={network.stations}
          lines={network.lines}
          services={network.services}
          routes={compiledRoutes}
          clockSeconds={((clock.displaySeconds % 86400) + 86400) % 86400}
          onClose={() => setStationDisplay(null)}
        />
      )}
    </main>
  );
}
