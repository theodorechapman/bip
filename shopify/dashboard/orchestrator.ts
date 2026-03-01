/**
 * Agent Orchestrator
 * Manages multi-agent lifecycle — launches, tracks, and stops BrowserUse agents.
 */

import { EventEmitter } from "node:events";
import { SharedMemory } from "./memory";
import { createProductScout, type ScoutConfig } from "./agents/product-scout";
import { createPriceComparator } from "./agents/price-comparator";

export interface ManagedAgent {
  id: string;
  type: "product-scout" | "price-comparator";
  supplier: string;
  searchTerm: string;
  status: "initializing" | "running" | "completed" | "error" | "stopped";
  screenshot?: string; // latest base64 PNG
  stepCount: number;
  startedAt: string;
  logs: string[];
  cleanup?: () => Promise<void>;
}

export interface SwarmConfig {
  niche: string;
  suppliers: string[];
  searchTerms: string[];
  limit: number;
}

export interface AgentSummary {
  id: string;
  type: string;
  supplier: string;
  searchTerm: string;
  status: string;
  stepCount: number;
  startedAt: string;
  hasScreenshot: boolean;
}

export class AgentOrchestrator extends EventEmitter {
  private agents = new Map<string, ManagedAgent>();
  private memory: SharedMemory;
  private comparator: ReturnType<typeof createPriceComparator> | null = null;

  constructor(memory: SharedMemory) {
    super();
    this.memory = memory;

    // Re-emit memory events
    memory.on("product:found", (product) => {
      this.emit("products:found", product);
    });
    memory.on("finding:posted", (finding) => {
      this.emit("memory:update", finding);
    });
  }

  async startSwarm(config: SwarmConfig): Promise<string[]> {
    const agentIds: string[] = [];

    // Start price comparator
    if (!this.comparator) {
      this.comparator = createPriceComparator(this.memory, {
        onUpdate: (comparisons) => this.emit("comparison:update", comparisons),
        onLog: (msg) => this.emit("agent:log", { agentId: "price-comparator", message: msg }),
      });
      this.comparator.start();
    }

    // Launch one scout per supplier × searchTerm combination
    for (const supplier of config.suppliers) {
      for (const searchTerm of config.searchTerms) {
        const agentId = `scout-${supplier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const managed: ManagedAgent = {
          id: agentId,
          type: "product-scout",
          supplier,
          searchTerm,
          status: "initializing",
          stepCount: 0,
          startedAt: new Date().toISOString(),
          logs: [],
        };

        this.agents.set(agentId, managed);
        this.emit("agent:status", this.agentSummary(managed));
        agentIds.push(agentId);

        // Fire and forget — each agent runs independently
        this.launchScout(agentId, managed, {
          supplier,
          searchTerm,
          limit: config.limit,
        }).catch((err) => {
          managed.status = "error";
          managed.logs.push(`Launch error: ${err.message}`);
          this.emit("agent:status", this.agentSummary(managed));
        });
      }
    }

    this.memory.addFinding({
      agentId: "orchestrator",
      type: "status",
      message: `Swarm launched: ${agentIds.length} agents for "${config.niche}"`,
      data: config,
    });

    return agentIds;
  }

  private async launchScout(
    agentId: string,
    managed: ManagedAgent,
    config: ScoutConfig,
  ): Promise<void> {
    const scout = await createProductScout(config, this.memory, {
      onScreenshot: (base64, stepNum) => {
        managed.screenshot = base64;
        managed.stepCount = stepNum;
        this.emit("agent:screenshot", {
          agentId,
          screenshot: base64,
          stepCount: stepNum,
        });
      },
      onLog: (message) => {
        managed.logs.push(message);
        if (managed.logs.length > 200) managed.logs = managed.logs.slice(-100);
        this.emit("agent:log", { agentId, message });
      },
      onStatus: (status) => {
        managed.status = status as ManagedAgent["status"];
        this.emit("agent:status", this.agentSummary(managed));
      },
      onComplete: (result) => {
        managed.status = "completed";
        this.emit("agent:status", this.agentSummary(managed));
        this.emit("agent:log", { agentId, message: `Completed: ${result ?? "no result"}` });
      },
      shouldStop: () => managed.status === "stopped",
    });

    managed.cleanup = scout.cleanup;
    managed.status = "running";
    this.emit("agent:status", this.agentSummary(managed));

    await scout.run();
    await scout.cleanup();
  }

  async stopAgent(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.status = "stopped";
    if (managed.cleanup) await managed.cleanup();
    this.emit("agent:status", this.agentSummary(managed));
    this.emit("agent:log", { agentId, message: "Agent stopped by user" });
  }

  async stopAll(): Promise<void> {
    if (this.comparator) {
      this.comparator.stop();
      this.comparator = null;
    }
    const promises = [...this.agents.values()]
      .filter((a) => a.status === "running" || a.status === "initializing")
      .map((a) => this.stopAgent(a.id));
    await Promise.allSettled(promises);
    this.emit("agent:log", { agentId: "orchestrator", message: "All agents stopped" });
  }

  getAgents(): AgentSummary[] {
    return [...this.agents.values()].map((a) => this.agentSummary(a));
  }

  getScreenshot(agentId: string): string | undefined {
    return this.agents.get(agentId)?.screenshot;
  }

  private agentSummary(a: ManagedAgent): AgentSummary {
    return {
      id: a.id,
      type: a.type,
      supplier: a.supplier,
      searchTerm: a.searchTerm,
      status: a.status,
      stepCount: a.stepCount,
      startedAt: a.startedAt,
      hasScreenshot: !!a.screenshot,
    };
  }
}
