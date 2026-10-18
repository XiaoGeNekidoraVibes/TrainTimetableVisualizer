"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_RANGE_DEPARTURES, parseDepartureRanges } from "../domain/departures";
import { formatDuration } from "../lib/time";

type DepartureRangeEditorProps = {
  serviceName: string;
  initialText: string;
  individualDepartures: number[];
  onApply: (text: string) => void;
  onClose: () => void;
};

const EXAMPLE = "06:30:00, 09:00:00, 00:15:00";
const PREVIEW_PAGE_SIZE = 60;

export function DepartureRangeEditor({
  serviceName, initialText, individualDepartures, onApply, onClose,
}: DepartureRangeEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [page, setPage] = useState(0);
  const parsed = useMemo(() => parseDepartureRanges(text), [text]);
  const departures = useMemo(() => [...new Set([
    ...individualDepartures, ...parsed.departures,
  ])].sort((a, b) => a - b), [individualDepartures, parsed.departures]);
  const pageCount = Math.max(1, Math.ceil(departures.length / PREVIEW_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const hasErrors = parsed.errors.length > 0;
  const overlapCount = individualDepartures.length + parsed.departures.length - departures.length;

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    inputRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="departure-range-dialog"
      aria-labelledby="departure-range-title"
      aria-describedby="departure-range-description"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
      }}
    >
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!hasErrors) onApply(text);
      }}>
        <header className="range-dialog-heading">
          <div>
            <span className="eyebrow">SERVICE / DEPARTURE PLAN</span>
            <h2 id="departure-range-title">按时间范围批量添加</h2>
            <p id="departure-range-description">{serviceName} · 编辑范围，实时预览发车计划</p>
          </div>
          <button type="button" className="range-dialog-close" aria-label="关闭范围编辑器" onClick={onClose}>×</button>
        </header>

        <div className="range-dialog-body">
          <section className="range-source-pane" aria-label="范围输入">
            <div className="range-pane-heading">
              <label htmlFor="departure-range-source">时间范围</label>
              <button type="button" onClick={() => {
                setText((current) => current.trim() ? `${current.trimEnd()}\n${EXAMPLE}` : EXAMPLE);
                setPage(0);
              }}>插入示例</button>
            </div>
            <div className="range-format-key"><span>首班时刻</span><span>末班上限</span><span>发车间隔</span></div>
            <textarea
              id="departure-range-source"
              ref={inputRef}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              wrap="off"
              value={text}
              placeholder={`${EXAMPLE}\n17:00:00, 19:00:00, 00:10:00`}
              aria-invalid={hasErrors}
              aria-describedby={`range-format-help${hasErrors ? " range-input-errors" : ""}`}
              onChange={(event) => { setText(event.target.value); setPage(0); }}
            />
            <div className="range-format-help" id="range-format-help">
              <p>每行一个范围，以逗号分隔。首班起按间隔发车，时刻 ≤ 末班上限；仅当间隔恰好到达上限时包含该班。</p>
              <p>示例：06:30 首发，09:00 末发，每 15 分钟一班，共 11 班。</p>
              <p>支持空行和中文逗号；跨午夜可用 24–47 时。最多展开 {MAX_RANGE_DEPARTURES.toLocaleString("en-US")} 班。</p>
            </div>
            {hasErrors && (
              <ul className="range-input-errors" id="range-input-errors" role="alert">
                {parsed.errors.map((error) => <li key={error.line}><strong>第 {error.line} 行</strong>{error.message}</li>)}
              </ul>
            )}
          </section>

          <section className="range-preview-pane" aria-label="班次预览">
            <div className="range-pane-heading">
              <h3>班次预览</h3>
              <span aria-live="polite">{hasErrors ? "请修正输入" : `${departures.length} 个班次`}</span>
            </div>
            {hasErrors ? <div className="range-preview-empty">输入有误，修正后显示完整发车计划。</div> : <>
              <div className="range-preview-totals">
                <span>范围 <strong>{parsed.departures.length}</strong></span>
                <span>单独 <strong>{individualDepartures.length}</strong></span>
                <span>合计 <strong>{departures.length}</strong></span>
              </div>
              {parsed.ranges.length > 0 && <div className="range-summary-scroll">
                <table className="range-summary-table">
                  <thead><tr><th>行</th><th>首班 → 实际末班</th><th>间隔</th><th>班数</th></tr></thead>
                  <tbody>{parsed.ranges.map((range) => <tr key={range.line}>
                    <td>{range.line}</td>
                    <td>{formatDuration(range.start)}<span> → </span>{formatDuration(range.last)}</td>
                    <td>{formatDuration(range.interval)}</td>
                    <td>{range.count}</td>
                  </tr>)}</tbody>
                </table>
              </div>}
              {(parsed.duplicateCount > 0 || overlapCount > 0) && <p className="range-dedup-note">重叠时刻已合并，每个时刻只发一班。</p>}
              <div className="range-departure-list" aria-label="全部发车时刻">
                {departures.slice(currentPage * PREVIEW_PAGE_SIZE, (currentPage + 1) * PREVIEW_PAGE_SIZE).map((time, index) => (
                  <div key={time}><span>{String(currentPage * PREVIEW_PAGE_SIZE + index + 1).padStart(2, "0")}</span><time>{formatDuration(time)}</time></div>
                ))}
                {!departures.length && <p className="range-preview-empty">输入一个时间范围以生成班次。</p>}
              </div>
              {pageCount > 1 && <nav className="range-preview-pagination" aria-label="预览分页">
                <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
                <span>{currentPage + 1} / {pageCount}</span>
                <button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
              </nav>}
            </>}
          </section>
        </div>

        <footer className="range-dialog-footer">
          <p>保存后更新范围班次，保留单独班次。范围原文随项目保存，可再次编辑。</p>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" className="range-apply-button" disabled={hasErrors}>保存并更新班次</button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
