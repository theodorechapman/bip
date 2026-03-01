import React from "react";
import { AgentCard } from "./AgentCard";
import type { AgentState } from "../hooks/useAgentSocket";

interface Props {
  agents: AgentState[];
  onStop: (agentId: string) => void;
}

export function AgentGrid({ agents, onStop }: Props) {
  const cols =
    agents.length <= 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Active Agents
      </h2>
      <div className={`grid ${cols} gap-4`}>
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onStop={() => onStop(agent.id)} />
        ))}
      </div>
    </div>
  );
}
