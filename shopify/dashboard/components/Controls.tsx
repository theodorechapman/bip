import React, { useState } from "react";

interface SwarmConfig {
  niche: string;
  suppliers: string[];
  searchTerms: string[];
  limit: number;
}

interface Props {
  onStart: (config: SwarmConfig) => void;
  onStopAll: () => void;
  isRunning: boolean;
}

const SUPPLIERS = [
  { id: "aliexpress", label: "AliExpress" },
  { id: "amazon", label: "Amazon" },
  { id: "temu", label: "Temu" },
  { id: "cj", label: "CJ Dropshipping" },
];

export function Controls({ onStart, onStopAll, isRunning }: Props) {
  const [niche, setNiche] = useState("");
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>(["aliexpress"]);
  const [searchTerms, setSearchTerms] = useState("");
  const [limit, setLimit] = useState(5);

  function toggleSupplier(id: string) {
    setSelectedSuppliers((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function handleStart() {
    if (!niche.trim()) return;
    const terms = searchTerms
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length === 0) terms.push(niche.trim());

    onStart({
      niche: niche.trim(),
      suppliers: selectedSuppliers,
      searchTerms: terms,
      limit,
    });
  }

  return (
    <div className="border-b border-border px-4 py-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Swarm Controls
      </h3>

      {/* Niche */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Niche</label>
        <input
          type="text"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder="e.g. wireless earbuds"
          className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-accent focus:outline-none"
        />
      </div>

      {/* Suppliers */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Suppliers</label>
        <div className="flex flex-wrap gap-2">
          {SUPPLIERS.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleSupplier(s.id)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                selectedSuppliers.includes(s.id)
                  ? "bg-accent text-white"
                  : "bg-surface text-gray-400 border border-border hover:border-gray-500"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search terms */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Search Terms <span className="text-gray-600">(one per line)</span>
        </label>
        <textarea
          value={searchTerms}
          onChange={(e) => setSearchTerms(e.target.value)}
          placeholder={`e.g.\nbluetooth earbuds\nnoise cancelling headphones`}
          rows={3}
          className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-accent focus:outline-none resize-none"
        />
      </div>

      {/* Limit */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Products per agent: <span className="text-white font-medium">{limit}</span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          value={limit}
          onChange={(e) => setLimit(parseInt(e.target.value))}
          className="w-full accent-accent"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleStart}
          disabled={!niche.trim() || selectedSuppliers.length === 0}
          className="flex-1 bg-accent hover:bg-accent/80 disabled:bg-gray-700 disabled:text-gray-500 text-white py-2 rounded text-sm font-medium transition-colors"
        >
          Launch Swarm
        </button>
        {isRunning && (
          <button
            onClick={onStopAll}
            className="px-4 py-2 bg-red-500/20 text-red-400 rounded text-sm font-medium hover:bg-red-500/30 transition-colors"
          >
            Stop All
          </button>
        )}
      </div>
    </div>
  );
}
