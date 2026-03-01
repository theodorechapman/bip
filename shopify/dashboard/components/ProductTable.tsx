import React from "react";
import type { ProductComparison } from "../hooks/useAgentSocket";

interface Props {
  comparisons: ProductComparison[];
}

export function ProductTable({ comparisons }: Props) {
  // Collect all suppliers across all comparisons
  const allSuppliers = Array.from(
    new Set(comparisons.flatMap((c) => c.findings.map((f) => f.supplier))),
  );

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Price Comparison
      </h2>
      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 text-gray-400 font-medium">Product</th>
              {allSuppliers.map((s) => (
                <th key={s} className="px-4 py-3 text-gray-400 font-medium capitalize">
                  {s}
                </th>
              ))}
              <th className="px-4 py-3 text-gray-400 font-medium">Savings</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Best</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comp) => (
              <tr key={comp.normalizedTitle} className="border-b border-border/50 hover:bg-white/5">
                <td className="px-4 py-3 max-w-[200px]">
                  <div className="truncate text-gray-200" title={comp.normalizedTitle}>
                    {comp.normalizedTitle}
                  </div>
                  <div className="text-xs text-gray-500">
                    {comp.findings.length} source{comp.findings.length !== 1 ? "s" : ""}
                  </div>
                </td>
                {allSuppliers.map((supplier) => {
                  const finding = comp.findings.find((f) => f.supplier === supplier);
                  const isBest = finding && finding.price === comp.bestPrice && comp.findings.length > 1;
                  return (
                    <td key={supplier} className="px-4 py-3">
                      {finding ? (
                        <a
                          href={finding.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`font-mono ${isBest ? "text-green-400 font-semibold" : "text-gray-300"} hover:underline`}
                        >
                          ${finding.price.toFixed(2)}
                        </a>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3">
                  {comp.savingsPercent > 0 ? (
                    <span className="text-green-400 font-mono">{comp.savingsPercent}%</span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="capitalize text-accent font-medium">{comp.bestSupplier}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {comparisons.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500 text-sm">
            No products to compare yet
          </div>
        )}
      </div>
    </div>
  );
}
