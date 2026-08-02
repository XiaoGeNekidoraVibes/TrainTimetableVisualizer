"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { resolveStationTimes, serviceLineIdsAtStation } from "../domain/schedule";
import type { CompiledRoute, RailLine, Service, Station } from "../domain/types";

type TrainPidProps = {
  trainId: string;
  departureIndex: number;
  service: Service;
  route: CompiledRoute;
  stations: Station[];
  lines: RailLine[];
  clockSeconds: number;
  onClose: () => void;
};

function relativeClockTime(clockSeconds: number, departure: number) {
  let relative = clockSeconds - departure;
  if (relative < -43200) relative += 86400;
  return relative;
}

export function TrainPid({
  trainId,
  departureIndex,
  service,
  route,
  stations,
  lines,
  clockSeconds,
  onClose,
}: TrainPidProps) {
  const model = useMemo(() => {
    const stationMap = new Map(stations.map((station) => [station.id, station]));
    const resolved = resolveStationTimes(service, route);
    const relativeTime = relativeClockTime(clockSeconds, service.departures[departureIndex] ?? 0);
    const currentIndex = route.stations.findIndex((station, index) => {
      const rule = service.timings[station.occurrenceKey];
      return rule?.mode === "stop"
        && relativeTime >= resolved[index].arrival
        && relativeTime <= resolved[index].departure;
    });
    const nextIndex = currentIndex >= 0
      ? currentIndex
      : route.stations.findIndex((station, index) => {
        const rule = service.timings[station.occurrenceKey];
        return rule?.mode === "stop" && resolved[index].arrival >= relativeTime;
      });
    const focusIndex = nextIndex >= 0 ? nextIndex : route.stations.length - 1;
    const focusStation = route.stations[focusIndex];
    const usedLineIds = focusStation
      ? serviceLineIdsAtStation(service, lines, focusStation.stationId)
      : new Set<string>();
    const transfers = focusStation
      ? lines.filter((line) => line.stationIds.includes(focusStation.stationId) && !usedLineIds.has(line.id))
      : [];

    return {
      relativeTime,
      resolved,
      currentIndex,
      nextIndex,
      focusIndex,
      focusName: focusStation ? stationMap.get(focusStation.stationId)?.name ?? "未知站" : "运行结束",
      destination: stationMap.get(route.stations.at(-1)?.stationId ?? "")?.name ?? "未知终点",
      transfers,
      stationMap,
    };
  }, [clockSeconds, departureIndex, lines, route, service, stations]);

  if (!route.valid || !route.stations.length) return null;
  const etaSeconds = model.nextIndex < 0
    ? 0
    : Math.max(0, model.resolved[model.nextIndex].arrival - model.relativeTime);
  const etaMinutes = Math.ceil(etaSeconds / 60);
  const isDwelling = model.currentIndex >= 0;

  return (
    <aside
      className="train-pid"
      style={{ "--pid-color": service.color } as CSSProperties}
      aria-label={`${trainId} 车内旅客信息显示器`}
    >
      <header className="pid-header">
        <div className="pid-service-block">
          <span className="pid-category">{service.category || "普通"}</span>
          <strong>{trainId}</strong>
          <small>{service.name}</small>
        </div>
        <div className="pid-destination">
          <span>开往 · DESTINATION</span>
          <strong>{model.destination}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭列车 LCD">×</button>
      </header>

      {isDwelling ? (
        <div className="pid-arrival-state">
          <span>现在停靠 · NOW STOPPING</span>
          <strong>{model.focusName}</strong>
          <p>{model.transfers.length
            ? <>换乘 {model.transfers.map((line) => line.name).join(" · ")}</>
            : "请从右侧车门下车"}</p>
        </div>
      ) : (
        <>
          <div className="pid-next-row">
            <div><span>下一站 · NEXT</span><strong>{model.focusName}</strong></div>
            <div className="pid-transfer-list">
              <span>换乘</span>
              {model.transfers.length ? model.transfers.map((line) => (
                <i key={line.id} style={{ "--transfer-color": line.color } as CSSProperties}>{line.name}</i>
              )) : <small>无换乘线路</small>}
            </div>
            <div className="pid-eta"><strong>{etaMinutes}</strong><span>分钟后到达</span></div>
          </div>
          <div className="pid-route-window">
            <div className={`pid-route-track ${route.stations.length > 7 ? "is-long" : ""}`}>
              {route.stations.map((station, index) => {
                const rule = service.timings[station.occurrenceKey];
                const isPass = rule?.mode === "pass-exact" || rule?.mode === "pass-flexible";
                const passed = model.resolved[index].departure < model.relativeTime;
                const upcomingMinutes = Math.max(0, Math.ceil((model.resolved[index].arrival - model.relativeTime) / 60));
                return (
                  <div
                    className={`pid-route-stop ${passed ? "is-passed" : ""} ${isPass ? "is-pass" : ""} ${index === model.focusIndex ? "is-next" : ""}`}
                    key={station.occurrenceKey}
                  >
                    <strong>{model.stationMap.get(station.stationId)?.name ?? "已删除"}</strong>
                    <span className="pid-route-node">{passed ? "✓" : !isPass && index >= model.focusIndex ? upcomingMinutes : ""}</span>
                    <small>{isPass ? "通过" : index === model.focusIndex ? "下一站" : "停靠"}</small>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="pid-direction"><span>列车运行方向</span><b>→</b></div>
        </>
      )}
    </aside>
  );
}
