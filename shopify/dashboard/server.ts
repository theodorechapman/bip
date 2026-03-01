/**
 * Dashboard Server
 * Bun.serve() with HTML import, REST API, and WebSocket for live agent events.
 */

import index from "./index.html";
import { SharedMemory } from "./memory";
import { AgentOrchestrator } from "./orchestrator";

const PORT = parseInt(process.env.DASHBOARD_PORT ?? "3456");

const memory = new SharedMemory();
const orchestrator = new AgentOrchestrator(memory);

// Track connected WebSocket clients
const wsClients = new Set<any>();

function broadcast(type: string, data: any) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of wsClients) {
    try {
      ws.send(msg);
    } catch {
      wsClients.delete(ws);
    }
  }
}

// Wire orchestrator events to WebSocket broadcasts
orchestrator.on("agent:status", (data) => broadcast("agent:status", data));
orchestrator.on("agent:screenshot", (data) => broadcast("agent:screenshot", data));
orchestrator.on("agent:log", (data) => broadcast("agent:log", data));
orchestrator.on("products:found", (data) => broadcast("products:found", data));
orchestrator.on("memory:update", (data) => broadcast("memory:update", data));
orchestrator.on("comparison:update", (data) => broadcast("comparison:update", data));

const server = Bun.serve({
  port: PORT,
  routes: {
    "/": index,

    "/api/agents": {
      GET: () => Response.json(orchestrator.getAgents()),
    },

    "/api/memory": {
      GET: () => Response.json(memory.snapshot()),
    },

    "/api/agents/start": {
      POST: async (req) => {
        const body = await req.json();
        const config = {
          niche: body.niche ?? "general",
          suppliers: body.suppliers ?? ["aliexpress"],
          searchTerms: body.searchTerms ?? [body.niche ?? "general"],
          limit: body.limit ?? 5,
        };
        const agentIds = await orchestrator.startSwarm(config);
        return Response.json({ started: agentIds.length, agentIds });
      },
    },

    "/api/agents/stop-all": {
      POST: async () => {
        await orchestrator.stopAll();
        return Response.json({ stopped: true });
      },
    },

    "/api/memory/clear": {
      POST: () => {
        memory.clear();
        return Response.json({ cleared: true });
      },
    },

    "/api/products": {
      GET: () => Response.json(memory.exportProducts()),
    },
  },

  // Handle WebSocket upgrades + dynamic routes
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade — must be handled here for Bun
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req);
      if (ok) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Dynamic API routes
    const stopMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
    if (stopMatch && req.method === "POST") {
      const agentId = stopMatch[1];
      orchestrator.stopAgent(agentId);
      return Response.json({ stopped: agentId });
    }

    const screenshotMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/screenshot$/);
    if (screenshotMatch && req.method === "GET") {
      const screenshot = orchestrator.getScreenshot(screenshotMatch[1]);
      if (screenshot) {
        return Response.json({ screenshot });
      }
      return Response.json({ screenshot: null }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
      // Send initial state
      ws.send(
        JSON.stringify({
          type: "init",
          data: {
            agents: orchestrator.getAgents(),
            memory: memory.snapshot(),
          },
          ts: Date.now(),
        }),
      );
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(String(message));
        switch (msg.type) {
          case "agents:start":
            orchestrator.startSwarm(msg.data);
            break;
          case "agents:stop":
            orchestrator.stopAll();
            break;
          case "agent:stop":
            orchestrator.stopAgent(msg.data.agentId);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    },
    close(ws) {
      wsClients.delete(ws);
    },
  },

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`\n  Shopify Multi-Agent Dashboard`);
console.log(`  → http://localhost:${server.port}\n`);
