/**
 * Shared Memory Store
 * Cross-agent shared context with event emission and file persistence.
 */

import { EventEmitter } from "node:events";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = join(__dirname, "..", "config", "memory.json");
const PRODUCTS_PATH = join(__dirname, "..", "config", "products.json");

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
  foundBy: string; // agentId
  foundAt: string; // ISO timestamp
}

export interface Finding {
  id: string;
  agentId: string;
  type: "product" | "insight" | "error" | "status";
  message: string;
  data?: any;
  timestamp: string;
}

export interface ProductComparison {
  normalizedTitle: string;
  findings: ProductFinding[];
  bestPrice: number;
  bestSupplier: string;
  priceSpread: number;
  savingsPercent: number;
}

export interface MemorySnapshot {
  products: Record<string, ProductFinding[]>;
  findings: Finding[];
  comparisons: ProductComparison[];
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple fuzzy match — checks if two titles share enough words */
function fuzzyMatch(a: string, b: string, threshold = 0.6): boolean {
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const similarity = overlap / Math.max(wordsA.size, wordsB.size);
  return similarity >= threshold;
}

export class SharedMemory extends EventEmitter {
  private products = new Map<string, ProductFinding[]>();
  private findings: Finding[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.load();
  }

  addProduct(product: ProductFinding): void {
    const key = this.findMatchingKey(product.normalizedTitle) ?? product.normalizedTitle;
    const existing = this.products.get(key) ?? [];

    // Dedupe by supplier + similar title
    const dupe = existing.find(
      (p) => p.supplier === product.supplier && p.url === product.url,
    );
    if (dupe) return;

    existing.push(product);
    this.products.set(key, existing);
    this.emit("product:found", product);
    this.emit("update", this.snapshot());
    this.schedulePersist();
  }

  addFinding(finding: Omit<Finding, "id" | "timestamp">): Finding {
    const full: Finding = {
      ...finding,
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.findings.push(full);
    if (this.findings.length > 500) this.findings = this.findings.slice(-300);
    this.emit("finding:posted", full);
    this.emit("update", this.snapshot());
    this.schedulePersist();
    return full;
  }

  getProducts(): Map<string, ProductFinding[]> {
    return this.products;
  }

  getFindings(): Finding[] {
    return this.findings;
  }

  getProductComparisons(): ProductComparison[] {
    const comparisons: ProductComparison[] = [];
    for (const [key, findings] of this.products) {
      if (findings.length === 0) continue;
      const prices = findings.map((f) => f.price).filter((p) => p > 0);
      const bestPrice = Math.min(...prices);
      const worstPrice = Math.max(...prices);
      const bestSupplier = findings.find((f) => f.price === bestPrice)?.supplier ?? "unknown";
      comparisons.push({
        normalizedTitle: key,
        findings,
        bestPrice,
        bestSupplier,
        priceSpread: worstPrice - bestPrice,
        savingsPercent: worstPrice > 0 ? Math.round(((worstPrice - bestPrice) / worstPrice) * 100) : 0,
      });
    }
    return comparisons.sort((a, b) => b.findings.length - a.findings.length);
  }

  snapshot(): MemorySnapshot {
    return {
      products: Object.fromEntries(this.products),
      findings: this.findings.slice(-100),
      comparisons: this.getProductComparisons(),
    };
  }

  /** Export all products in the SourcedProduct format for downstream pipeline (product-lister, etc.) */
  exportProducts(): any[] {
    const out: any[] = [];
    for (const [, findings] of this.products) {
      // Pick best price per product group
      const sorted = [...findings].sort((a, b) => a.price - b.price);
      for (const f of sorted) {
        out.push({
          title: f.title,
          supplierUrl: f.url,
          supplierPrice: f.price,
          shippingTime: f.shippingTime ?? "unknown",
          rating: f.rating ?? 0,
          imageUrls: f.imageUrl ? [f.imageUrl] : [],
          supplier: f.supplier,
          sourcedAt: f.foundAt,
        });
      }
    }
    return out;
  }

  private persistProducts(): void {
    try {
      const dir = dirname(PRODUCTS_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(PRODUCTS_PATH, JSON.stringify(this.exportProducts(), null, 2));
    } catch (e) {
      console.error("[Memory] products persist error:", e);
    }
  }

  clear(): void {
    this.products.clear();
    this.findings = [];
    this.emit("update", this.snapshot());
    this.schedulePersist();
  }

  private findMatchingKey(normalized: string): string | undefined {
    for (const key of this.products.keys()) {
      if (fuzzyMatch(key, normalized)) return key;
    }
    return undefined;
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 2000);
  }

  private persist(): void {
    try {
      const dir = dirname(MEMORY_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(MEMORY_PATH, JSON.stringify(this.snapshot(), null, 2));
      this.persistProducts();
    } catch (e) {
      console.error("[Memory] persist error:", e);
    }
  }

  private load(): void {
    try {
      if (existsSync(MEMORY_PATH)) {
        const data = JSON.parse(readFileSync(MEMORY_PATH, "utf-8")) as MemorySnapshot;
        for (const [key, findings] of Object.entries(data.products)) {
          this.products.set(key, findings);
        }
        this.findings = data.findings ?? [];
      }
    } catch {
      // Start fresh
    }
  }
}
