"use client";

import { useState } from "react";
import type {
  CompiledRoute,
  RailLine,
  RouteLeg,
  Service,
  Station,
  TimingRule,
} from "../domain/types";
import { validateSchedule } from "../domain/simulation";
import { formatTime, parseDepartureList } from "../lib/time";

type ServiceEditorProps = {
  service: Service;
  stations: Station[];
  lines: RailLine[];
  route: CompiledRoute;
  onChange: (service: Service) => void;
  onDelete: () => void;
};

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function secondsInput(value: number, onChange: (value: number) => void, label: string) {
  return (
    <input
      className="time-offset"
      type="number"
      min={0}
      step={1}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
    />
  );
}

export function ServiceEditor({
  service,
  stations,
  lines,
  route,
  onChange,
  onDelete,
}: ServiceEditorProps) {
  const [departureText, setDepartureText] = useState(
    service.departures.map((time) => formatTime(time)).join(", "),
  );

  const stationMap = new Map(stations.map((station) => [station.id, station]));
  const error = validateSchedule(service, route);

  const updateLeg = (legId: string, patch: Partial<RouteLeg>) => {
    const nextLegs = service.routeLegs.map((leg) => {
      if (leg.id !== legId) return leg;
      const next = { ...leg, ...patch };
      if (patch.lineId) {
        const line = lines.find((candidate) => candidate.id === patch.lineId);
        if (line && line.stationIds.length >= 2) {
          next.fromStationId = line.stationIds[0];
          next.toStationId = line.stationIds.at(-1)!;
        }
      }
      return next;
    });
    onChange({ ...service, routeLegs: nextLegs });
  };

  const appendLeg = () => {
    const previousEnd = service.routeLegs.at(-1)?.toStationId;
    const matching = lines.find(
      (line) => previousEnd && line.stationIds.includes(previousEnd) && line.stationIds.length >= 2,
    );
    const line = matching ?? lines.find((candidate) => candidate.stationIds.length >= 2);
    if (!line) return;
    const from = previousEnd && line.stationIds.includes(previousEnd) ? previousEnd : line.stationIds[0];
    const fromIndex = line.stationIds.indexOf(from);
    const to = fromIndex < line.stationIds.length - 1 ? line.stationIds.at(-1)! : line.stationIds[0];
    onChange({
      ...service,
      routeLegs: [
        ...service.routeLegs,
        { id: `leg-${makeId()}`, lineId: line.id, fromStationId: from, toStationId: to },
      ],
    });
  };

  const setTiming = (key: string, timing: TimingRule) => {
    onChange({ ...service, timings: { ...service.timings, [key]: timing } });
  };

  return (
    <div className="inspector-scroll service-editor">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">SERVICE</span>
          <h2>{service.name}</h2>
        </div>
        <span className={`validation-dot ${error ? "is-error" : "is-valid"}`} title={error ?? "时刻有效"} />
      </div>

      <section className="form-section">
        <label>
          <span>列车名称</span>
          <input value={service.name} onChange={(event) => onChange({ ...service, name: event.target.value })} />
        </label>
        <label>
          <span>编号公式</span>
          <input
            className="mono-input"
            value={service.idFormula}
            onChange={(event) => onChange({ ...service, idFormula: event.target.value })}
            placeholder="G{100+n*2}"
          />
          <small>在花括号中使用 n，例如 G&#123;100+n*2&#125;</small>
        </label>
        <label>
          <span>当日发车时间</span>
          <textarea
            rows={2}
            value={departureText}
            onChange={(event) => setDepartureText(event.target.value)}
            onBlur={() => {
              const departures = parseDepartureList(departureText);
              onChange({ ...service, departures });
              setDepartureText(departures.map((time) => formatTime(time)).join(", "));
            }}
          />
          <small>用逗号或空格分隔，精确到秒</small>
        </label>
      </section>

      <section className="form-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">ROUTE</span>
            <h3>运行路径</h3>
          </div>
          <button className="text-button" type="button" onClick={appendLeg}>＋ 跨线区段</button>
        </div>
        <div className="route-legs">
          {service.routeLegs.map((leg, index) => {
            const line = lines.find((candidate) => candidate.id === leg.lineId);
            const options = line?.stationIds ?? [];
            return (
              <div className="route-leg" key={leg.id}>
                <span className="leg-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="leg-fields">
                  <select value={leg.lineId} onChange={(event) => updateLeg(leg.id, { lineId: event.target.value })}>
                    {lines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                  </select>
                  <div className="paired-selects">
                    <select value={leg.fromStationId} onChange={(event) => updateLeg(leg.id, { fromStationId: event.target.value })}>
                      {options.map((id) => <option key={id} value={id}>{stationMap.get(id)?.name ?? "已删除站点"}</option>)}
                    </select>
                    <span>→</span>
                    <select value={leg.toStationId} onChange={(event) => updateLeg(leg.id, { toStationId: event.target.value })}>
                      {options.map((id) => <option key={id} value={id}>{stationMap.get(id)?.name ?? "已删除站点"}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  className="icon-button danger-subtle"
                  type="button"
                  aria-label="删除运行区段"
                  disabled={service.routeLegs.length === 1}
                  onClick={() => onChange({ ...service, routeLegs: service.routeLegs.filter((item) => item.id !== leg.id) })}
                >×</button>
              </div>
            );
          })}
        </div>
        {!route.valid && <p className="inline-error">{route.error}</p>}
      </section>

      {route.valid && (
        <section className="form-section timing-section">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">TIMING</span>
              <h3>停靠与通过</h3>
            </div>
            <span className="unit-badge">单位：秒</span>
          </div>
          <div className="timing-table-head">
            <span>站点</span><span>模式</span><span>时间</span>
          </div>
          <div className="timing-list">
            {route.stations.map((routeStation, index) => {
              const rule = service.timings[routeStation.occurrenceKey] ?? { mode: "pass-flexible" as const };
              const defaultTime = Math.round((index / Math.max(1, route.stations.length - 1)) * 1800);
              return (
                <div className="timing-row" key={routeStation.occurrenceKey}>
                  <div className="timing-station">
                    <span className="route-node" />
                    <strong>{stationMap.get(routeStation.stationId)?.name ?? "已删除"}</strong>
                    <small>{Math.round(routeStation.distance)} m</small>
                  </div>
                  <select
                    value={rule.mode}
                    onChange={(event) => {
                      const mode = event.target.value as TimingRule["mode"];
                      if (mode === "stop") setTiming(routeStation.occurrenceKey, { mode, arrival: defaultTime, departure: defaultTime + (index ? 60 : 0) });
                      else if (mode === "pass-exact") setTiming(routeStation.occurrenceKey, { mode, pass: defaultTime });
                      else setTiming(routeStation.occurrenceKey, { mode });
                    }}
                  >
                    <option value="stop">停靠</option>
                    <option value="pass-exact">定时通过</option>
                    <option value="pass-flexible">自由通过</option>
                  </select>
                  <div className="timing-inputs">
                    {rule.mode === "stop" && (
                      <>
                        {secondsInput(rule.arrival, (arrival) => setTiming(routeStation.occurrenceKey, { ...rule, arrival }), "到达秒数")}
                        <span>/</span>
                        {secondsInput(rule.departure, (departure) => setTiming(routeStation.occurrenceKey, { ...rule, departure }), "发车秒数")}
                      </>
                    )}
                    {rule.mode === "pass-exact" && secondsInput(rule.pass, (pass) => setTiming(routeStation.occurrenceKey, { ...rule, pass }), "通过秒数")}
                    {rule.mode === "pass-flexible" && <span className="free-time">自动求解</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`validation-message ${error ? "error" : "success"}`}>
            <span>{error ? "!" : "✓"}</span>
            {error ?? "路径与全部时间约束有效"}
          </div>
        </section>
      )}

      <button className="delete-button" type="button" onClick={onDelete}>删除此 Service</button>
    </div>
  );
}
