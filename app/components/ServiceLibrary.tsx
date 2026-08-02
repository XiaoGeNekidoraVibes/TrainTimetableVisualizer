"use client";

import { useState } from "react";
import type { Selection, Service, ServiceGroup } from "../domain/types";

type ServiceLibraryProps = {
  groups: ServiceGroup[];
  services: Service[];
  selection: Selection;
  onSelect: (serviceId: string) => void;
  onCreateService: () => void;
  onCreateGroup: () => void;
  onRenameGroup: (group: ServiceGroup) => void;
  onDeleteGroup: (group: ServiceGroup) => void;
  onSetServiceHidden: (serviceId: string, hidden: boolean) => void;
  onSetGroupHidden: (groupId: string | undefined, hidden: boolean) => void;
};

const UNGROUPED_KEY = "__ungrouped__";

export function ServiceLibrary({
  groups,
  services,
  selection,
  onSelect,
  onCreateService,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onSetServiceHidden,
  onSetGroupHidden,
}: ServiceLibraryProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const ungrouped = services.filter((service) => !service.groupId || !knownGroupIds.has(service.groupId));
  const buckets = [
    ...groups.map((group) => ({ group, key: group.id, services: services.filter((service) => service.groupId === group.id) })),
    ...(ungrouped.length ? [{ group: undefined, key: UNGROUPED_KEY, services: ungrouped }] : []),
  ];
  const hiddenCount = services.filter((service) => service.libraryHidden).length;

  const toggleCollapsed = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="library-section service-library">
      <div className="library-title service-library-title">
        <span>Services</span>
        <div>
          <button type="button" onClick={onCreateGroup}>＋ 分组</button>
          <button type="button" onClick={onCreateService}>＋ 新建</button>
        </div>
      </div>
      <button
        type="button"
        className={`hidden-services-toggle ${showHidden ? "active" : ""}`}
        disabled={!hiddenCount}
        onClick={() => setShowHidden((current) => !current)}
      >
        <span>{showHidden ? "隐藏已隐藏项" : "显示已隐藏项"}</span>
        <small>{hiddenCount}</small>
      </button>
      <div className="service-group-list">
        {buckets.map(({ group, key, services: groupServices }) => {
          const collapsed = collapsedGroups.has(key);
          const visibleServices = showHidden
            ? groupServices
            : groupServices.filter((service) => !service.libraryHidden);
          const allHidden = groupServices.length > 0 && groupServices.every((service) => service.libraryHidden);
          return (
            <div className="service-group" key={key}>
              <div className="service-group-heading">
                <button type="button" className="service-group-toggle" onClick={() => toggleCollapsed(key)}>
                  <i>{collapsed ? "›" : "⌄"}</i>
                  <span>{group?.name ?? "未分组"}</span>
                  <small>{visibleServices.length}/{groupServices.length}</small>
                </button>
                <div className="service-group-actions">
                  <button
                    type="button"
                    title={allHidden ? "显示本组全部 Service" : "隐藏本组全部 Service"}
                    aria-label={allHidden ? "显示本组全部 Service" : "隐藏本组全部 Service"}
                    onClick={() => onSetGroupHidden(group?.id, !allHidden)}
                  >{allHidden ? "◉" : "○"}</button>
                  {group && <button type="button" title="重命名分组" aria-label="重命名分组" onClick={() => onRenameGroup(group)}>✎</button>}
                  {group && <button type="button" title="删除分组" aria-label="删除分组" onClick={() => onDeleteGroup(group)}>×</button>}
                </div>
              </div>
              {!collapsed && (
                <div className="service-group-entries">
                  {visibleServices.map((service) => (
                    <div className={`service-entry ${service.libraryHidden ? "is-hidden" : ""}`} key={service.id}>
                      <button
                        type="button"
                        className={`service-entry-main ${selection?.type === "service" && selection.id === service.id ? "selected" : ""}`}
                        onClick={() => onSelect(service.id)}
                      >
                        <span className="service-monogram" style={{ borderColor: service.color }}>{service.name.slice(0, 1)}</span>
                        <span><strong>{service.name}</strong><small>{service.departures.length} 个班次</small></span>
                        <i>›</i>
                      </button>
                      <button
                        type="button"
                        className="service-visibility-button"
                        title={service.libraryHidden ? "恢复到管理列表" : "从管理列表隐藏"}
                        aria-label={service.libraryHidden ? `显示 ${service.name}` : `隐藏 ${service.name}`}
                        onClick={() => onSetServiceHidden(service.id, !service.libraryHidden)}
                      >{service.libraryHidden ? "◉" : "○"}</button>
                    </div>
                  ))}
                  {!visibleServices.length && (
                    <p className="service-group-empty">{groupServices.length ? "本组 Service 已隐藏" : "本组暂无 Service"}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!buckets.length && <p className="service-group-empty standalone">尚未创建 Service</p>}
      </div>
    </section>
  );
}
