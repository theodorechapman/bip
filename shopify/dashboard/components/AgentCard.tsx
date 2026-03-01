import React from "react";
import type { AgentState } from "../hooks/useAgentSocket";

interface Props {
  agent: AgentState;
  onStop: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  initializing: "bg-yellow-500",
  running: "bg-green-500",
  completed: "bg-blue-500",
  error: "bg-red-500",
  stopped: "bg-gray-500",
};

export function AgentCard({ agent, onStop }: Props) {
  const isRunning = agent.status === "running" || agent.status === "initializing";

  return (
    <div
      className={`bg-card rounded-lg border ${
        isRunning ? "border-accent agent-running" : "border-border"
      } overflow-hidden fade-in`}
    >
      {/* Screenshot area */}
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {agent.screenshot ? (
          <img
            src={`data:image/png;base64,${agent.screenshot}`}
            alt={`${agent.supplier} browser`}
            className="w-full h-full object-contain screenshot-img"
          />
        ) : (
          <div className="text-gray-600 text-sm">
            {isRunning ? "Waiting for screenshot..." : "No screenshot"}
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 rounded-full px-2 py-1">
          <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[agent.status] ?? "bg-gray-500"}`} />
          <span className="text-xs text-gray-200">{agent.status}</span>
        </div>

        {/* Step count */}
        <div className="absolute top-2 right-2 bg-black/70 rounded-full px-2 py-1">
          <span className="text-xs text-gray-300">Step {agent.stepCount}</span>
        </div>
      </div>

      {/* Info bar */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white truncate capitalize">
            {agent.supplier}
          </div>
          <div className="text-xs text-gray-400 truncate">
            {agent.searchTerm}
          </div>
        </div>

        {isRunning && (
          <button
            onClick={onStop}
            className="shrink-0 ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
