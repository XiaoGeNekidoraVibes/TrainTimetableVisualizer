"use client";

import { useState } from "react";
import type {
  CompiledRoute,
  RailLine,
  RouteLeg,
  Service,
  ServiceGroup,
  Station,
  TimingRule,
} from "../domain/types";
import { validateSchedule } from "../domain/simulation";
import { createUniformSchedule, getTimingIntervals } from "../domain/schedule";
import {
  createDepartureRange,
  formatDuration,
  formatTime,
  parseClock,
  parseDepartureList,
  parseDuration,
} from "../lib/time";

type ServiceEditorProps = {
  service: Service;
  serviceGroups: ServiceGroup[];
  stations: Station[];
  lines: RailLine[];
  route: CompiledRoute;
  onChange: (service: Service) => void;
  onDelete: () => void;
  onDuplicate: (reverse: boolean) => void;
};

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function durationInput(value: number, onChange: (value: number) => void, label: string) {
  return (
    <input
      key={`${label}:${value}`}
      className="time-offset"
      type="text"
      inputMode="numeric"
      aria-label={label}
      defaultValue={formatDuration(value)}
      placeholder="00:00:00"
      onBlur={(event) => {
        const parsed = parseDuration(event.target.value);
        if (parsed === null) event.target.value = formatDuration(value);
        else {
          event.target.value = formatDuration(parsed);
          onChange(parsed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function ServiceEditor({
  service,
  serviceGroups,
  stations,
  lines,
  route,
  onChange,
  onDelete,
  onDuplicate,
}: ServiceEditorProps) {
  const [departureText, setDepartureText] = useState(
    service.departures.map((time) => formatTime(time)).join(", "),
  );
  const [rangeStart, setRangeStart] = useState("06:00:00");
  const [rangeEnd, setRangeEnd] = useState("23:00:00");
  const [rangeInterval, setRangeInterval] = useState("00:30:00");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [quickSpeed, setQuickSpeed] = useState("80");
  const [quickDwell, setQuickDwell] = useState("00:01:00");
  const [preservePassRules, setPreservePassRules] = useState(true);
  const [quickMessage, setQuickMessage] = useState<string | null>(null);

  const stationMap = new Map(stations.map((station) => [station.id, station]));
  const error = validateSchedule(service, route);
  const timingIntervals = route.valid ? getTimingIntervals(service, route) : new Map();

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

  const addDepartureRange = () => {
    const start = parseClock(rangeStart);
    const end = parseClock(rangeEnd);
    const interval = parseDuration(rangeInterval);
    if (start === null || end === null || interval === null || interval <= 0 || end < start) {
      setRangeError("请检查开始、结束和间隔时间；结束时间不能早于开始时间");
      return;
    }
    const departures = Array.from(new Set([
      ...service.departures,
      ...createDepartureRange(start, end, interval),
    ])).sort((a, b) => a - b);
    onChange({ ...service, departures });
    setDepartureText(departures.map((time) => formatTime(time)).join(", "));
    setRangeError(null);
  };

  const applyUniformSchedule = () => {
    const speed = Number(quickSpeed);
    const dwell = parseDuration(quickDwell);
    if (!Number.isFinite(speed) || speed <= 0 || dwell === null) {
      setQuickMessage("请输入有效的均速和停车时长");
      return;
    }
    onChange({
      ...service,
      timings: createUniformSchedule(service, route, speed, dwell, preservePassRules),
    });
    setQuickMessage(`已按 ${speed} km/h 配置；停车 ${formatDuration(dwell)}`);
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

      <div className="service-copy-actions">
        <button type="button" onClick={() => onDuplicate(false)}>⧉ 复制 Service</button>
        <button type="button" onClick={() => onDuplicate(true)}>⇄ 复制并反转</button>
      </div>

      <section className="form-section">
        <label>
          <span>列车名称</span>
          <input value={service.name} onChange={(event) => onChange({ ...service, name: event.target.value })} />
        </label>
        <div className="service-identity-grid">
          <label>
            <span>种别</span>
            <input
              value={service.category ?? "普通"}
              list="service-category-options"
              onChange={(event) => onChange({ ...service, category: event.target.value })}
              placeholder="普通 / 快速 / 高速"
            />
            <datalist id="service-category-options">
              <option value="普通" /><option value="快速" /><option value="高速" /><option value="特急" />
            </datalist>
          </label>
          <label>
            <span>Service 颜色</span>
            <div className="color-field service-color-field">
              <input type="color" value={service.color} onChange={(event) => onChange({ ...service, color: event.target.value })} />
              <code>{service.color}</code>
            </div>
          </label>
        </div>
        <div className="service-organization-grid">
          <label>
            <span>Service 组</span>
            <select
              value={service.groupId ?? ""}
              onChange={(event) => onChange({ ...service, groupId: event.target.value || undefined })}
            >
              <option value="">未分组</option>
              {serviceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="service-library-hidden-toggle">
            <input
              type="checkbox"
              checked={Boolean(service.libraryHidden)}
              onChange={(event) => onChange({ ...service, libraryHidden: event.target.checked })}
            />
            <span><strong>从管理列表隐藏</strong><small>不会影响运行模拟</small></span>
          </label>
        </div>
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
        <div className="departure-generator">
          <div className="departure-generator-title">
            <strong>按时间范围批量添加</strong>
            <span>包含结束时刻</span>
          </div>
          <div className="departure-range-grid">
            <label><span>开始</span><input type="time" step={1} value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label>
            <label><span>结束</span><input type="time" step={1} value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label>
            <label><span>间隔</span><input type="text" inputMode="numeric" value={rangeInterval} onChange={(event) => setRangeInterval(event.target.value)} placeholder="00:30:00" /></label>
          </div>
          <div className="departure-generator-actions">
            <button type="button" onClick={addDepartureRange}>＋ 添加班次</button>
            <button type="button" className="secondary" onClick={() => {
              onChange({ ...service, departures: [] });
              setDepartureText("");
              setRangeError(null);
            }}>清空</button>
          </div>
          {rangeError && <p className="range-error">{rangeError}</p>}
        </div>
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
            <span className="unit-badge">相对发车时间 · HH:MM:SS</span>
          </div>
          <div className="quick-schedule-card">
            <div className="quick-schedule-heading">
              <div><strong>均速快速配置</strong><span>按线路几何距离自动生成基础时刻</span></div>
              <div className="timing-icon-legend"><span><b>●</b>停靠</span><span><b>◆</b>定时通过</span><span><b>◇</b>自由通过</span></div>
            </div>
            <div className="quick-schedule-controls">
              <label><span>均速 km/h</span><input type="number" min="1" step="1" value={quickSpeed} onChange={(event) => setQuickSpeed(event.target.value)} /></label>
              <label><span>停车时长</span><input type="text" inputMode="numeric" value={quickDwell} onChange={(event) => setQuickDwell(event.target.value)} /></label>
              <label className="preserve-pass-toggle"><input type="checkbox" checked={preservePassRules} onChange={(event) => setPreservePassRules(event.target.checked)} /><span>保留现有通过站</span></label>
              <button type="button" onClick={applyUniformSchedule}>应用到全线</button>
            </div>
            {quickMessage && <p>{quickMessage}</p>}
          </div>
          <div className="timing-table-head">
            <span>站点</span><span>模式</span><span>时间</span>
          </div>
          <div className="timing-list">
            {route.stations.map((routeStation, index) => {
              const rule = service.timings[routeStation.occurrenceKey] ?? { mode: "pass-flexible" as const };
              const defaultTime = Math.round((index / Math.max(1, route.stations.length - 1)) * 1800);
              const interval = timingIntervals.get(routeStation.occurrenceKey);
              const nextIntervalStation = interval
                ? route.stations.find((station) => station.occurrenceKey === interval.nextOccurrenceKey)
                : undefined;
              const setMode = (mode: TimingRule["mode"]) => {
                if (mode === "stop") setTiming(routeStation.occurrenceKey, { mode, arrival: defaultTime, departure: defaultTime + (index ? 60 : 0) });
                else if (mode === "pass-exact") setTiming(routeStation.occurrenceKey, { mode, pass: defaultTime });
                else setTiming(routeStation.occurrenceKey, { mode });
              };
              return (
                <div className="timing-row" key={routeStation.occurrenceKey}>
                  <div className="timing-station">
                    <span className="route-node" />
                    <strong>{stationMap.get(routeStation.stationId)?.name ?? "已删除"}</strong>
                    <small>{Math.round(routeStation.distance)} m</small>
                  </div>
                  <div className="timing-mode-group" role="group" aria-label={`${stationMap.get(routeStation.stationId)?.name}停靠模式`}>
                    <button type="button" aria-pressed={rule.mode === "stop"} className={rule.mode === "stop" ? "active" : ""} title="停靠" aria-label="停靠" onClick={() => setMode("stop")}>●</button>
                    <button type="button" aria-pressed={rule.mode === "pass-exact"} className={rule.mode === "pass-exact" ? "active" : ""} title="定时通过" aria-label="定时通过" onClick={() => setMode("pass-exact")}>◆</button>
                    <button type="button" aria-pressed={rule.mode === "pass-flexible"} className={rule.mode === "pass-flexible" ? "active" : ""} title="自由通过" aria-label="自由通过" onClick={() => setMode("pass-flexible")}>◇</button>
                  </div>
                  <div className="timing-inputs">
                    {rule.mode === "stop" && (
                      <>
                        {durationInput(rule.arrival, (arrival) => setTiming(routeStation.occurrenceKey, { ...rule, arrival }), "相对到达时间")}
                        <span>/</span>
                        {durationInput(rule.departure, (departure) => setTiming(routeStation.occurrenceKey, { ...rule, departure }), "相对发车时间")}
                      </>
                    )}
                    {rule.mode === "pass-exact" && durationInput(rule.pass, (pass) => setTiming(routeStation.occurrenceKey, { ...rule, pass }), "相对通过时间")}
                    {rule.mode === "pass-flexible" && <span className="free-time">自动求解</span>}
                  </div>
                  {interval && nextIntervalStation && (
                    <div className="interval-speed">
                      <span>下一定时区间</span>
                      <strong>至 {stationMap.get(nextIntervalStation.stationId)?.name}</strong>
                      <b>{interval.speedKmh.toFixed(1)} km/h</b>
                    </div>
                  )}
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
