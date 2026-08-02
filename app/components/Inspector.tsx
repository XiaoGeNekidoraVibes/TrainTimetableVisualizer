"use client";

import type {
  CompiledRoute,
  RailLine,
  Selection,
  Service,
  Station,
} from "../domain/types";
import { ServiceEditor } from "./ServiceEditor";

type InspectorProps = {
  selection: Selection;
  stations: Station[];
  lines: RailLine[];
  services: Service[];
  routes: Map<string, CompiledRoute>;
  onStationChange: (station: Station) => void;
  onLineChange: (line: RailLine) => void;
  onServiceChange: (service: Service) => void;
  onDeleteStation: (id: string) => void;
  onDeleteLine: (id: string) => void;
  onDeleteService: (id: string) => void;
  onOpenStationDisplay: (stationId: string, view: "board" | "timetable") => void;
};

export function Inspector({
  selection,
  stations,
  lines,
  services,
  routes,
  onStationChange,
  onLineChange,
  onServiceChange,
  onDeleteStation,
  onDeleteLine,
  onDeleteService,
  onOpenStationDisplay,
}: InspectorProps) {
  if (!selection) {
    return (
      <div className="empty-inspector">
        <span className="empty-mark">↗</span>
        <h2>选择一个对象</h2>
        <p>点击画布中的列车、站点或线路，查看并编辑详细信息。</p>
        <div className="shortcut-list">
          <span><kbd>V</kbd> 选择</span>
          <span><kbd>S</kbd> 站点</span>
          <span><kbd>L</kbd> 线路</span>
        </div>
      </div>
    );
  }

  if (selection.type === "service") {
    const service = services.find((item) => item.id === selection.id);
    if (!service) return null;
    return (
      <ServiceEditor
        key={service.id}
        service={service}
        stations={stations}
        lines={lines}
        route={routes.get(service.id)!}
        onChange={onServiceChange}
        onDelete={() => onDeleteService(service.id)}
      />
    );
  }

  if (selection.type === "station") {
    const station = stations.find((item) => item.id === selection.id);
    if (!station) return null;
    const memberships = lines.filter((line) => line.stationIds.includes(station.id));
    return (
      <div className="inspector-scroll">
        <div className="inspector-heading">
          <div><span className="eyebrow">STATION</span><h2>{station.name}</h2></div>
          <span className="object-index">{station.id.slice(-4).toUpperCase()}</span>
        </div>
        <section className="form-section">
          <label><span>站点名称</span><input value={station.name} onChange={(event) => onStationChange({ ...station, name: event.target.value })} /></label>
          <div className="coordinate-grid">
            <label><span>X</span><input type="number" value={Math.round(station.position.x)} onChange={(event) => onStationChange({ ...station, position: { ...station.position, x: Number(event.target.value) } })} /></label>
            <label><span>Y</span><input type="number" value={Math.round(station.position.y)} onChange={(event) => onStationChange({ ...station, position: { ...station.position, y: Number(event.target.value) } })} /></label>
          </div>
        </section>
        <section className="form-section station-display-launcher">
          <span className="eyebrow">STATION DISPLAY</span>
          <h3>车站信息显示</h3>
          <p className="field-note">基于当前模拟时钟显示本站动态和全天发车时刻。</p>
          <div>
            <button type="button" onClick={() => onOpenStationDisplay(station.id, "board")}>打开车站大屏</button>
            <button type="button" onClick={() => onOpenStationDisplay(station.id, "timetable")}>打开日式时刻表</button>
          </div>
        </section>
        <section className="form-section">
          <span className="eyebrow">MEMBERSHIP</span>
          <h3>所属线路</h3>
          <div className="membership-list">
            {memberships.length ? memberships.map((line) => (
              <div key={line.id}><span style={{ background: line.color }} />{line.name}</div>
            )) : <p className="muted-copy">暂未加入线路</p>}
          </div>
        </section>
        <button className="delete-button" type="button" onClick={() => onDeleteStation(station.id)}>删除此站点</button>
      </div>
    );
  }

  if (selection.type === "line") {
    const line = lines.find((item) => item.id === selection.id);
    if (!line) return null;
    return (
      <div className="inspector-scroll">
        <div className="inspector-heading">
          <div><span className="eyebrow">LINE</span><h2>{line.name}</h2></div>
          <span className="line-swatch" style={{ background: line.color }} />
        </div>
        <section className="form-section">
          <label><span>线路名称</span><input value={line.name} onChange={(event) => onLineChange({ ...line, name: event.target.value })} /></label>
          <label><span>线路颜色</span><div className="color-field"><input type="color" value={line.color} onChange={(event) => onLineChange({ ...line, color: event.target.value })} /><code>{line.color}</code></div></label>
        </section>
        <section className="form-section">
          <div className="section-title-row"><div><span className="eyebrow">STATIONS</span><h3>站点顺序</h3></div><span className="unit-badge">{line.stationIds.length} 站</span></div>
          <div className="line-station-list">
            {line.stationIds.map((stationId, index) => (
              <div key={`${stationId}-${index}`}>
                <span className="station-order">{index + 1}</span>
                <strong>{stations.find((station) => station.id === stationId)?.name ?? "已删除站点"}</strong>
                <div className="row-actions">
                  <button disabled={index === 0} onClick={() => {
                    const stationIds = [...line.stationIds];
                    [stationIds[index - 1], stationIds[index]] = [stationIds[index], stationIds[index - 1]];
                    onLineChange({ ...line, stationIds });
                  }}>↑</button>
                  <button disabled={index === line.stationIds.length - 1} onClick={() => {
                    const stationIds = [...line.stationIds];
                    [stationIds[index + 1], stationIds[index]] = [stationIds[index], stationIds[index + 1]];
                    onLineChange({ ...line, stationIds });
                  }}>↓</button>
                  <button disabled={line.stationIds.length <= 2} onClick={() => onLineChange({ ...line, stationIds: line.stationIds.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
                </div>
              </div>
            ))}
          </div>
          <label className="inline-add-field">
            <select defaultValue="">
              <option value="" disabled>选择站点…</option>
              {stations.filter((station) => !line.stationIds.includes(station.id)).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
            </select>
            <button type="button" onClick={(event) => {
              const select = event.currentTarget.previousElementSibling as HTMLSelectElement;
              if (select.value) onLineChange({ ...line, stationIds: [...line.stationIds, select.value] });
              select.value = "";
            }}>添加</button>
          </label>
          <p className="field-note">增删站点后，Service 路径会按稳定站点 ID 自动重新展开。</p>
        </section>
        <button className="delete-button" type="button" onClick={() => onDeleteLine(line.id)}>删除此线路</button>
      </div>
    );
  }

  const service = services.find((item) => item.id === selection.serviceId);
  return (
    <div className="inspector-scroll train-inspector">
      <div className="train-hero">
        <span className="eyebrow">LIVE TRAIN</span>
        <div className="train-number">{selection.id}</div>
        <p>{service?.name ?? "未知 Service"}</p>
      </div>
      <div className="live-status"><span className="pulse-dot" />正在运行</div>
      <section className="form-section info-grid">
        <div><span>所属 Service</span><strong>{service?.name ?? "—"}</strong></div>
        <div><span>编号规则</span><strong>{service?.idFormula ?? "—"}</strong></div>
        <div><span>运行路径</span><strong>{service?.routeLegs.length ?? 0} 个区段</strong></div>
        <div><span>当日班次</span><strong>{service?.departures.length ?? 0} 列</strong></div>
      </section>
      {service && <button className="primary-wide" type="button" onClick={() => window.dispatchEvent(new CustomEvent("open-service", { detail: service.id }))}>编辑 Service</button>}
    </div>
  );
}
