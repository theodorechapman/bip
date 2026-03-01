import React from "react";

interface Props {
  productCount: number;
  agentCount: number;
  activeCount: number;
  findings: any[];
}

export function MemoryPanel({ productCount, agentCount, activeCount, findings }: Props) {
  const recentFindings = findings
    .filter((f) => f.type === "product" || f.type === "insight")
    .slice(-10)
    .reverse();

  return (
    <div className="border-b border-border px-4 py-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Shared Memory
      </h3>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-surface rounded px-2 py-1.5 text-center">
          <div className="text-lg font-bold text-white">{productCount}</div>
          <div className="text-[10px] text-gray-500">Products</div>
        </div>
        <div className="bg-surface rounded px-2 py-1.5 text-center">
          <div className="text-lg font-bold text-white">{agentCount}</div>
          <div className="text-[10px] text-gray-500">Agents</div>
        </div>
        <div className="bg-surface rounded px-2 py-1.5 text-center">
          <div className="text-lg font-bold text-accent">{activeCount}</div>
          <div className="text-[10px] text-gray-500">Active</div>
        </div>
      </div>

      {/* Recent findings */}
      {recentFindings.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {recentFindings.map((f, i) => (
            <div key={f.id ?? i} className="text-xs text-gray-400 truncate">
              <span className="text-gray-600">[{f.agentId?.split("-")[1] ?? "?"}]</span>{" "}
              {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
