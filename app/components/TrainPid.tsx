"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { resolveStationTimes, serviceLineIdsAtStation } from "../domain/schedule";
import { buildPidRoutePages } from "../domain/trainPid";
import type { PidPassGroup } from "../domain/trainPid";
import type { CompiledRoute, RailLine, Service, Station } from "../domain/types";
import { DisplayMarquee } from "./DisplayMarquee";

type TrainPidProps = {
  trainId: string;
  departureIndex: number;
  service: Service;
  route: CompiledRoute;
  stations: Station[];
  lines: RailLine[];
  clockSeconds: number;
  focusMode?: boolean;
  onToggleFocus?: () => void;
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
  focusMode = false,
  onToggleFocus,
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

  const screenRef = useRef<HTMLElement>(null);
  const [capacity, setCapacity] = useState(8);
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const measure = () => setCapacity(Math.max(4, Math.min(8, Math.floor(screen.clientWidth / 92))));
    const observer = new ResizeObserver(measure);
    observer.observe(screen);
    measure();
    return () => observer.disconnect();
  }, []);
  const pages = useMemo(() => buildPidRoutePages(service, route, model.focusIndex, capacity), [service, route, model.focusIndex, capacity]);
  const pageCount = pages.length;
  const focusKey = `${service.id}:${departureIndex}:${model.focusIndex}:${model.currentIndex >= 0 ? "stopped" : "moving"}`;
  const [routePage, setRoutePage] = useState({ focusKey, index: 0 });
  if (routePage.focusKey !== focusKey) setRoutePage({ focusKey, index: 0 });
  const pageIndex = routePage.focusKey === focusKey ? routePage.index % Math.max(1, pageCount) : 0;
  const pageContext = `${focusKey}:${pageIndex}:${capacity}`;
  const [expandedGroup, setExpandedGroup] = useState<{ context: string; group: PidPassGroup } | null>(null);
  const routePageModel = pages[pageIndex];
  const routeItems = routePageModel?.items ?? [];
  const activeGroup = expandedGroup?.context === pageContext && routeItems.includes(expandedGroup.group) ? expandedGroup.group : null;
  if (expandedGroup && !activeGroup) setExpandedGroup(null);
  // Allow a complete vertical marquee cycle before advancing to another route page.
  const pageHoldMs = Math.max(8000, ...routeItems.map((item) => item.kind === "station"
    ? ((Array.from(model.stationMap.get(item.station.stationId)?.name ?? "").length * 24 + 24) / 20 + 2) * 1000
    : 0));
  useEffect(() => {
    if (pageCount <= 1 || activeGroup) return;
    const timer = window.setTimeout(() => {
      setRoutePage((current) => ({ focusKey, index: current.focusKey === focusKey ? current.index + 1 : 1 }));
    }, pageHoldMs);
    return () => window.clearTimeout(timer);
  }, [focusKey, pageCount, pageIndex, pageHoldMs, activeGroup]);

  if (!route.valid || !route.stations.length) return null;
  const etaSeconds = model.nextIndex < 0
    ? 0
    : Math.max(0, model.resolved[model.nextIndex].arrival - model.relativeTime);
  const etaMinutes = Math.ceil(etaSeconds / 60);
  const isDwelling = model.currentIndex >= 0;
  const isFinished = model.nextIndex < 0 && !isDwelling;
  const focusPlatform = service.timings[route.stations[model.focusIndex].occurrenceKey]?.platform;
  const stationName = (stationId: string) => model.stationMap.get(stationId)?.name ?? "已删除";

  return (
    <aside
      className={`train-pid ${focusMode ? "is-compact" : ""}`}
      ref={screenRef}
      style={{
        "--pid-color": service.color,
        "--pid-name-size": `${Math.max(22, Math.min(52, 340 / Math.max(1, Array.from(model.focusName).length)))}px`,
        "--pid-category-size": `${Math.max(14, Math.min(22, 84 / Math.max(1, Array.from(service.category || "普通").length)))}px`,
      } as CSSProperties}
      aria-label={`${trainId} 车内旅客信息显示器`}
    >
      <div className="pid-bezel-label"><span>车内案内 <small>PASSENGER INFORMATION</small></span>
        <div className="pid-window-controls">
          {onToggleFocus && <button type="button" className="pid-focus-toggle" onClick={onToggleFocus} aria-pressed={focusMode} title={focusMode ? "退出跟随并还原 LCD" : "居中跟随列车，将 LCD 缩至角落"}>{focusMode ? "还原 LCD" : "⌖ Focus Mode"}</button>}
          <button type="button" onClick={onClose} aria-label="关闭列车 LCD">×</button>
        </div>
      </div>
      <div className="pid-screen">
        <header className="pid-header">
          <div className="pid-service-block"><strong className="pid-category"><DisplayMarquee text={service.category || "普通"} /></strong><DisplayMarquee className="pid-service-name" text={service.name} /></div>
          <div className="pid-destination"><span>开往 <small>FOR</small></span><strong title={model.destination}><DisplayMarquee text={model.destination} /></strong></div>
          <div className="pid-train-number"><small>车次 / TRAIN</small><strong><DisplayMarquee text={trainId} /></strong></div>
        </header>
        <div className={`pid-next-row ${isDwelling ? "is-dwelling" : ""}`}>
          <div className="pid-next-label"><span>{isDwelling ? "现在停靠" : isFinished ? "终点站" : etaSeconds <= 45 ? "即将到达" : "下一站"}</span><small>{isDwelling ? "NOW AT" : isFinished ? "TERMINUS" : etaSeconds <= 45 ? "ARRIVING" : "NEXT"}</small></div>
          <strong className="pid-focus-name" key={model.focusName} title={model.focusName}><DisplayMarquee text={model.focusName} /></strong>
          <div className="pid-eta">{isDwelling ? <><strong><DisplayMarquee text={focusPlatform ?? "—"} /></strong><span>站台 / PLATFORM</span></> : isFinished ? <span>运行结束<br />END OF SERVICE</span> : <><span>约 <strong>{etaMinutes < 1 ? "即将" : etaMinutes}</strong>{etaMinutes >= 1 && " 分"}</span><small>{etaMinutes < 1 ? "ARRIVING SOON" : "min to arrival"}</small></>}</div>
        </div>
        <div className="pid-map-caption">
          <div className="pid-route-legend"><span><i className="legend-stop" />停靠</span><span><i className="legend-pass" />通过</span></div>
          <div className="pid-page-controls">
            {pageCount > 1 && <><button type="button" aria-label="上一页沿途站点" onClick={() => setRoutePage({ focusKey, index: (pageIndex + pageCount - 1) % pageCount })}>‹</button><span aria-live="polite">{pageIndex + 1} / {pageCount}</span><button type="button" aria-label="下一页沿途站点" onClick={() => setRoutePage({ focusKey, index: (pageIndex + 1) % pageCount })}>›</button></>}
            <span>{isFinished ? "已到终点" : routePageModel?.continued ? "后续线路 →" : "运行方向 →"}</span>
          </div>
        </div>
        <div className="pid-route-window">
          <div className={`pid-route-track ${routePageModel?.gapAfterFocus ? "is-continuation" : ""}`} key={pageContext} style={{ "--pid-stop-count": Math.max(2, routeItems.length) } as CSSProperties}>
              {routeItems.map((item) => {
                if (item.kind === "pass-group") {
                  const first = item.stations[0];
                  const last = item.stations.at(-1)!;
                  const passedCount = item.stations.filter(({ index }) => model.resolved[index].departure < model.relativeTime).length;
                  return <div className={`pid-route-stop is-pass-group ${passedCount === item.stations.length ? "is-passed" : ""}`} key={`pass:${first.station.occurrenceKey}`}>
                    <span className="pid-stop-minutes">通过 <b>{item.stations.length}</b> 站</span>
                    <span className="pid-pass-segment" aria-hidden="true">〃</span>
                    <button type="button" className="pid-pass-group-button" aria-label={`查看连续通过的 ${item.stations.length} 个车站`} aria-expanded={activeGroup === item} aria-controls={activeGroup === item ? "pid-pass-details" : undefined} onClick={() => setExpandedGroup(activeGroup === item ? null : { context: pageContext, group: item })}>
                      <DisplayMarquee text={stationName(first.station.stationId)} />
                      <span className="pid-pass-ellipsis" aria-hidden="true">⋮</span>
                      <DisplayMarquee text={stationName(last.station.stationId)} />
                      <small>{passedCount ? `已过 ${passedCount}/${item.stations.length}` : "展开站名"}</small>
                    </button>
                  </div>;
                }
                const { station, index, isPass } = item;
                const upcomingMinutes = Math.max(0, Math.ceil((model.resolved[index].arrival - model.relativeTime) / 60));
                const isPassed = model.resolved[index].departure < model.relativeTime;
                const name = stationName(station.stationId);
                return (
                  <div
                    className={`pid-route-stop ${isPass ? "is-pass" : ""} ${isPassed ? "is-passed" : ""} ${index === model.focusIndex && !isFinished ? "is-next" : ""}`}
                    key={station.occurrenceKey}
                    data-occurrence={station.occurrenceKey}
                    title={`${name} · ${isPass ? "通过" : "停靠"}${isPassed ? " · 已过" : ` · ${upcomingMinutes} 分钟`}`}
                  >
                    <span className="pid-stop-minutes">{isPass ? isPassed ? "已过 · 通过" : "通过" : isPassed ? "已过" : isDwelling && index === model.focusIndex ? "停靠中" : <>{upcomingMinutes}<small>分</small></>}</span>
                    <span className="pid-route-node" aria-hidden="true" />
                    <strong className="pid-station-name" style={{ "--pid-station-font-size": `${Math.max(15, Math.min(21, 106 / (Array.from(name).length * 1.12)))}px` } as CSSProperties}><DisplayMarquee text={name} vertical /></strong>
                    {index === route.stations.length - 1 && <small className="pid-terminus-label">终点</small>}
                  </div>
                );
              })}
          </div>
          {activeGroup && <section className="pid-pass-details" id="pid-pass-details" aria-label="连续通过车站明细">
            <header><strong>连续通过 {activeGroup.stations.length} 站</strong><button type="button" onClick={() => setExpandedGroup(null)}>收起 ×</button></header>
            <ol>{activeGroup.stations.map(({ station, index }) => <li key={station.occurrenceKey} className={model.resolved[index].departure < model.relativeTime ? "is-passed" : ""}><span>{model.resolved[index].departure < model.relativeTime ? "已过" : "通过"}</span><strong>{stationName(station.stationId)}</strong></li>)}</ol>
          </section>}
        </div>
        <footer className="pid-information-row">
          {model.transfers.length ? <><strong>换乘<span>TRANSFER</span></strong><DisplayMarquee text={model.transfers.map((line) => line.name).join(" / ")}><span className="pid-transfer-list">{model.transfers.map((line) => <span key={line.id} style={{ "--transfer-color": line.color } as CSSProperties}>{line.name}</span>)}</span></DisplayMarquee></> : <><strong>乘车提示<span>INFORMATION</span></strong><DisplayMarquee text={isDwelling ? "请先下后上，注意站台间隙。　Please mind the gap between the train and the platform." : isFinished ? "本次列车运行结束。感谢您的乘坐。　Thank you for travelling with us." : "请留意车内广播，提前做好下车准备。　Please listen for announcements and prepare to alight."} /></>}
        </footer>
      </div>
    </aside>
  );
}
