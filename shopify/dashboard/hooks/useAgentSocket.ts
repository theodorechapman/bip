import { useState, useEffect, useRef, useCallback } from "react";

export interface AgentState {
  id: string;
  type: string;
  supplier: string;
  searchTerm: string;
  status: string;
  stepCount: number;
  startedAt: string;
  hasScreenshot: boolean;
  screenshot?: string;
}

export interface ProductFinding {
  title: string;
  normalizedTitle: string;
  supplier: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
  rating?: number;
  orders?: number;
  shippingTime?: string;
  foundBy: string;
  foundAt: string;
}

export interface ProductComparison {
  normalizedTitle: string;
  findings: ProductFinding[];
  bestPrice: number;
  bestSupplier: string;
  priceSpread: number;
  savingsPercent: number;
}

export interface LogEntry {
  agentId: string;
  message: string;
  timestamp: number;
}

export interface DashboardState {
  connected: boolean;
  agents: AgentState[];
  products: Record<string, ProductFinding[]>;
  comparisons: ProductComparison[];
  findings: any[];
  logs: LogEntry[];
}

export function useAgentSocket() {
  const [state, setState] = useState<DashboardState>({
    connected: false,
    agents: [],
    products: {},
    comparisons: [],
    findings: [],
    logs: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        // Ignore
      }
    };
  }, []);

  function handleMessage(msg: { type: string; data: any; ts: number }) {
    switch (msg.type) {
      case "init":
        setState((s) => ({
          ...s,
          agents: msg.data.agents ?? [],
          products: msg.data.memory?.products ?? {},
          comparisons: msg.data.memory?.comparisons ?? [],
          findings: msg.data.memory?.findings ?? [],
        }));
        break;

      case "agent:status":
        setState((s) => {
          const agents = [...s.agents];
          const idx = agents.findIndex((a) => a.id === msg.data.id);
          if (idx >= 0) {
            agents[idx] = { ...agents[idx], ...msg.data };
          } else {
            agents.push(msg.data);
          }
          return { ...s, agents };
        });
        break;

      case "agent:screenshot":
        setState((s) => {
          const agents = s.agents.map((a) =>
            a.id === msg.data.agentId
              ? { ...a, screenshot: msg.data.screenshot, stepCount: msg.data.stepCount, hasScreenshot: true }
              : a,
          );
          return { ...s, agents };
        });
        break;

      case "agent:log":
        setState((s) => ({
          ...s,
          logs: [...s.logs.slice(-200), { ...msg.data, timestamp: msg.ts }],
        }));
        break;

      case "products:found":
        setState((s) => {
          const products = { ...s.products };
          const key = msg.data.normalizedTitle;
          products[key] = [...(products[key] ?? []), msg.data];
          return { ...s, products };
        });
        break;

      case "comparison:update":
        setState((s) => ({ ...s, comparisons: msg.data }));
        break;

      case "memory:update":
        setState((s) => ({
          ...s,
          findings: [...s.findings.slice(-100), msg.data],
        }));
        break;
    }
  }

  const send = useCallback((type: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { state, send };
}
