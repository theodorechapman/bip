import React from "react";
import { useAgentSocket } from "../hooks/useAgentSocket";
import { AgentGrid } from "./AgentGrid";
import { ProductTable } from "./ProductTable";
import { MemoryPanel } from "./MemoryPanel";
import { Timeline } from "./Timeline";
import { Controls } from "./Controls";

async function apiPost(path: string, body?: any) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function Dashboard() {
  const { state, send } = useAgentSocket();

  const activeCount = state.agents.filter(
    (a) => a.status === "running" || a.status === "initializing",
  ).length;
  const productCount = Object.values(state.products).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  async function handleStart(config: any) {
    // Use REST API — more reliable than WS for commands
    await apiPost("/api/agents/start", config);
  }

  async function handleStopAll() {
    await apiPost("/api/agents/stop-all");
  }

  async function handleStopAgent(agentId: string) {
    await apiPost(`/api/agents/${agentId}/stop`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Shopify Multi-Agent Dashboard</h1>
          <span
            className={`inline-block w-2 h-2 rounded-full ${state.connected ? "bg-green-500" : "bg-red-500"}`}
          />
          <span className="text-xs text-gray-500">
            {state.connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{activeCount} agent{activeCount !== 1 ? "s" : ""} running</span>
          <span className="text-gray-600">|</span>
          <span>{productCount} product{productCount !== 1 ? "s" : ""} found</span>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 65px)" }}>
        {/* Main area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {state.agents.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500">
              <div className="text-center">
                <p className="text-lg mb-2">No agents running</p>
                <p className="text-sm">Configure and launch a swarm from the sidebar</p>
              </div>
            </div>
          ) : (
            <AgentGrid agents={state.agents} onStop={handleStopAgent} />
          )}

          {state.comparisons.length > 0 && (
            <ProductTable comparisons={state.comparisons} />
          )}
        </main>

        {/* Sidebar */}
        <aside className="w-96 border-l border-border flex flex-col overflow-hidden shrink-0">
          <Controls
            onStart={handleStart}
            onStopAll={handleStopAll}
            isRunning={activeCount > 0}
          />

          <MemoryPanel
            productCount={productCount}
            agentCount={state.agents.length}
            activeCount={activeCount}
            findings={state.findings}
          />

          <Timeline logs={state.logs} />
        </aside>
      </div>
    </div>
  );
}
