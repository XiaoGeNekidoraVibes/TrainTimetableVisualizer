"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { getStationBoardEvents, getStationTimetable } from "../domain/stationBoard";
import type { CompiledRoute, RailLine, Service, Station } from "../domain/types";
import { formatDuration, formatTime } from "../lib/time";

type StationDisplayProps = {
  initialStationId: string;
  initialView?: "board" | "timetable";
  stations: Station[];
  lines: RailLine[];
  services: Service[];
  routes: Map<string, CompiledRoute>;
  clockSeconds: number;
  onClose: () => void;
};

const FIELD_LABELS = {
  category: "种别",
  trainId: "车次",
  origin: "始发站",
  destination: "终到站",
  arrival: "到达",
  departure: "发车",
  countdown: "动态时间",
  stops: "停车站",
} as const;

type FieldKey = keyof typeof FIELD_LABELS;

function filterByLines(lineIds: string[], selectedLineIds: string[]) {
  return !selectedLineIds.length || lineIds.some((lineId) => selectedLineIds.includes(lineId));
}

export function StationDisplay({
  initialStationId,
  initialView = "board",
  stations,
  lines,
  services,
  routes,
  clockSeconds,
  onClose,
}: StationDisplayProps) {
  const [stationId, setStationId] = useState(initialStationId);
  const [view, setView] = useState<"board" | "timetable">(initialView);
  const [showPassing, setShowPassing] = useState(false);
  const [precision, setPrecision] = useState<"minute" | "second">("minute");
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<FieldKey, boolean>>({
    category: true,
    trainId: true,
    origin: true,
    destination: true,
    arrival: true,
    departure: true,
    countdown: true,
    stops: true,
  });

  const station = stations.find((item) => item.id === stationId) ?? stations[0];
  const availableLines = lines.filter((line) => line.stationIds.includes(station?.id));
  const boardEvents = useMemo(
    () => station ? getStationBoardEvents(station.id, services, routes, stations, lines, clockSeconds) : [],
    [clockSeconds, lines, routes, services, station, stations],
  );
  const timetable = useMemo(
    () => station ? getStationTimetable(station.id, services, routes, stations, lines) : [],
    [lines, routes, services, station, stations],
  );

  const filteredBoardEvents = boardEvents.filter((event) =>
    (showPassing || event.status !== "passing") && filterByLines(event.lineIds, selectedLineIds),
  );
  const filteredTimetable = timetable.filter((event) =>
    (showPassing || !event.passing) && filterByLines(event.lineIds, selectedLineIds),
  );

  const toggleLine = (lineId: string) => {
    setSelectedLineIds((current) => current.includes(lineId)
      ? current.filter((id) => id !== lineId)
      : [...current, lineId]);
  };

  return (
    <div className="station-display-layer" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
    <div className="station-display" role="dialog" aria-modal="true" aria-label={`${station?.name ?? "车站"}看板`}>
      <header className="station-display-header">
        <div className="station-display-brand">
          <span className="display-live-dot" />
          <div><span>STATION INFORMATION</span><strong>车站信息看板</strong></div>
        </div>
        <div className="station-display-tabs">
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>车站大屏</button>
          <button className={view === "timetable" ? "active" : ""} onClick={() => setView("timetable")}>日式时刻表</button>
        </div>
        <div className="station-display-clock">
          <span>{formatTime(clockSeconds)}</span>
          <button type="button" onClick={onClose} aria-label="关闭车站看板">×</button>
        </div>
      </header>

      <section className="station-display-toolbar">
        <label className="display-station-picker">
          <span>车站</span>
          <select value={station?.id} onChange={(event) => {
            setStationId(event.target.value);
            setSelectedLineIds([]);
          }}>
            {stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="display-line-filters">
          <span>线路筛选</span>
          <button className={!selectedLineIds.length ? "active" : ""} onClick={() => setSelectedLineIds([])}>全部</button>
          {availableLines.map((line) => (
            <button
              key={line.id}
              className={selectedLineIds.includes(line.id) ? "active" : ""}
              style={{ "--filter-color": line.color } as CSSProperties}
              onClick={() => toggleLine(line.id)}
            ><i />{line.name}</button>
          ))}
        </div>
        <label className="passing-toggle">
          <input type="checkbox" checked={showPassing} onChange={(event) => setShowPassing(event.target.checked)} />
          <span>显示通过本站列车</span>
        </label>
      </section>

      {view === "board" ? (
        <div className="departure-board-view">
          <div className="board-title-row">
            <div><span>LIVE DEPARTURES</span><h1>{station?.name} · 列车动态</h1></div>
            <div className="field-toggles">
              <span>显示项目</span>
              {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => (
                <label key={key}><input type="checkbox" checked={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.checked })} />{FIELD_LABELS[key]}</label>
              ))}
            </div>
          </div>
          <div className="departure-board-table-wrap">
            <table className="departure-board-table">
              <thead><tr>
                <th className="status-column">状态</th>
                {fields.category && <th>种别</th>}
                {fields.trainId && <th>车次</th>}
                {fields.origin && <th>始发站</th>}
                {fields.destination && <th>终到站</th>}
                {fields.arrival && <th>到达时间</th>}
                {fields.departure && <th>发车时间</th>}
                {fields.countdown && <th>距离下一节点</th>}
                {fields.stops && <th className="stops-column">停车站</th>}
              </tr></thead>
              <tbody>
                {filteredBoardEvents.map((event) => (
                  <tr key={event.key} style={{ "--service-color": event.color } as CSSProperties}>
                    <td><span className={`board-status ${event.status}`}>
                      {event.status === "dwelling" ? "停泊中" : event.status === "passing" ? "通过" : "即将到达"}
                    </span></td>
                    {fields.category && <td><strong className="category-chip">{event.category}</strong></td>}
                    {fields.trainId && <td><strong className="board-train-id">{event.trainId}</strong></td>}
                    {fields.origin && <td>{event.origin}</td>}
                    {fields.destination && <td>{event.destination}</td>}
                    {fields.arrival && <td className="board-time">{event.arrival === undefined ? "通过" : formatTime(event.arrival)}</td>}
                    {fields.departure && <td className="board-time">{event.departure === undefined ? "—" : formatTime(event.departure)}</td>}
                    {fields.countdown && <td><div className="countdown-cell"><span>{event.status === "dwelling" ? "距发车" : event.status === "passing" ? "距通过" : "距到达"}</span><strong>{formatDuration(event.countdown)}</strong></div></td>}
                    {fields.stops && <td><div className="stops-marquee"><span>{event.stoppingStations.join("　→　") || "不停站"}</span></div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredBoardEvents.length && <div className="display-empty">未来两小时没有符合筛选条件的列车</div>}
          </div>
        </div>
      ) : (
        <div className="japanese-timetable-view">
          <div className="timetable-title-row">
            <div><span>DEPARTURE TIMETABLE</span><h1>{station?.name} · 发车时刻表</h1><p>时间取本站发车时刻，颜色代表 Service</p></div>
            <div className="precision-toggle" aria-label="时间精度">
              <button className={precision === "minute" ? "active" : ""} onClick={() => setPrecision("minute")}>精确到分钟</button>
              <button className={precision === "second" ? "active" : ""} onClick={() => setPrecision("second")}>精确到秒</button>
            </div>
          </div>
          <div className="timetable-legend">
            {Array.from(new Map(filteredTimetable.map((item) => [item.serviceId, item])).values()).map((item) => (
              <span key={item.serviceId}><i style={{ background: item.color }} />{item.category} · {item.serviceName}</span>
            ))}
            {showPassing && <span><i className="pass-legend" />下划线表示通过</span>}
          </div>
          <div className="timetable-columns">
            {[Array.from({ length: 12 }, (_, index) => index), Array.from({ length: 12 }, (_, index) => index + 12)].map((hours, columnIndex) => (
              <div className="timetable-column" key={columnIndex}>
                <div className="timetable-period">{columnIndex === 0 ? "午前 AM" : "午後 PM"}</div>
                {hours.map((hour) => {
                  const hourDepartures = filteredTimetable.filter((item) => Math.floor(item.time / 3600) === hour);
                  return (
                    <div className="timetable-hour" key={hour}>
                      <strong>{hour}</strong>
                      <div className="hour-departures">
                        {hourDepartures.map((departure) => {
                          const minute = Math.floor((departure.time % 3600) / 60);
                          const second = Math.floor(departure.time % 60);
                          return (
                            <span
                              key={departure.key}
                              className={`timetable-minute ${departure.passing ? "is-passing" : ""}`}
                              style={{ color: departure.color }}
                              title={`${departure.category} ${departure.trainId} → ${departure.destination} · ${formatTime(departure.time)}`}
                            >
                              {String(minute).padStart(2, "0")}
                              {precision === "second" && <sup>{String(second).padStart(2, "0")}</sup>}
                            </span>
                          );
                        })}
                        {!hourDepartures.length && <span className="no-departure">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
