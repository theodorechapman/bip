import React, { useRef, useEffect } from "react";
import type { LogEntry } from "../hooks/useAgentSocket";

interface Props {
  logs: LogEntry[];
}

export function Timeline({ logs }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length]);

  const recent = logs.slice(-100);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Activity Log
        </h3>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {recent.length === 0 ? (
          <div className="text-xs text-gray-600 py-4 text-center">No activity yet</div>
        ) : (
          recent.map((log, i) => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            const agentTag = log.agentId?.split("-").slice(0, 2).join("-") ?? "system";
            return (
              <div key={i} className="text-xs leading-relaxed fade-in">
                <span className="text-gray-600">{time}</span>{" "}
                <span className="text-accent">[{agentTag}]</span>{" "}
                <span className="text-gray-300">{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
