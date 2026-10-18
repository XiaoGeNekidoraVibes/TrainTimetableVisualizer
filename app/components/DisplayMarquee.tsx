"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/** Keep short messages still; scroll overflowing text at a constant reading speed. */
export function DisplayMarquee({ text, className = "", vertical = false, children }: {
  text: string;
  className?: string;
  vertical?: boolean;
  children?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (!frame.current || !content.current) return;
      const bounds = content.current.getBoundingClientRect();
      const size = vertical ? bounds.height : bounds.width;
      const available = vertical ? frame.current.clientHeight : frame.current.clientWidth;
      setDistance(size > available + 1 ? size + (vertical ? 24 : 48) : 0);
    };
    const observer = new ResizeObserver(measure);
    if (frame.current) observer.observe(frame.current);
    if (content.current) observer.observe(content.current);
    measure();
    return () => observer.disconnect();
  }, [text, vertical]);

  return (
    <div ref={frame} className={`display-marquee ${distance ? "is-scrolling" : ""} ${vertical ? "is-vertical" : ""} ${className}`}>
      <div className="display-marquee-track" style={{
        "--marquee-distance": `${distance}px`,
        "--marquee-duration": `${Math.max(8, distance / (vertical ? 20 : 32))}s`,
      } as CSSProperties}>
        <span ref={content}>{children ?? text}</span>
        {distance > 0 && <span aria-hidden="true">{children ?? text}</span>}
      </div>
    </div>
  );
}
