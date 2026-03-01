export function parseBudgetUsd(input: string | number | undefined, fallback = 5): number {
  if (typeof input === "number") {
    if (Number.isFinite(input) && input > 0) return input;
    throw new Error("budget must be a positive number");
  }

  if (typeof input === "string") {
    const parsed = Number(input);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    throw new Error("budget must be a positive number");
  }

  return fallback;
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  if (trimmed.length === 0) {
    throw new Error("base url cannot be empty");
  }
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error("base url must start with http:// or https://");
  }
  return trimmed;
}
