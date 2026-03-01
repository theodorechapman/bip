/**
 * Price Comparator
 * Non-browser agent that aggregates products from shared memory
 * and computes price comparisons across suppliers.
 */

import type { SharedMemory, ProductComparison } from "../memory";

export interface ComparatorCallbacks {
  onUpdate: (comparisons: ProductComparison[]) => void;
  onLog: (message: string) => void;
}

export function createPriceComparator(
  memory: SharedMemory,
  callbacks: ComparatorCallbacks,
): { start: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null;

  function tick() {
    const comparisons = memory.getProductComparisons();
    if (comparisons.length > 0) {
      callbacks.onUpdate(comparisons);

      const multiSupplier = comparisons.filter((c) => c.findings.length > 1);
      if (multiSupplier.length > 0) {
        const best = multiSupplier.reduce((a, b) =>
          a.savingsPercent > b.savingsPercent ? a : b,
        );
        callbacks.onLog(
          `Best deal: "${best.normalizedTitle}" — $${best.bestPrice} on ${best.bestSupplier} (save ${best.savingsPercent}%)`,
        );
      }
    }
  }

  return {
    start() {
      callbacks.onLog("Price comparator started");
      tick(); // Run immediately
      timer = setInterval(tick, 30_000);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      callbacks.onLog("Price comparator stopped");
    },
  };
}
