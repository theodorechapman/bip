export type MappedTask = {
  normalizedTask: string;
  rail: "auto" | "x402" | "bitrefill" | "card";
  tags: string[];
  confidence: number;
};

const KEYWORD_SETS = {
  openrouter: ["openrouter", "open router"],
  elevenlabs: ["elevenlabs", "eleven labs"],
  giftcard: ["gift card", "giftcard", "bitrefill"],
};

export function mapNaturalLanguageTask(input: string): MappedTask {
  const raw = input.trim();
  const normalized = raw.toLowerCase();

  if (KEYWORD_SETS.openrouter.some((k) => normalized.includes(k))) {
    return {
      normalizedTask: "buy openrouter api key",
      rail: "x402",
      tags: ["openrouter", "api-key"],
      confidence: 0.95,
    };
  }

  if (KEYWORD_SETS.elevenlabs.some((k) => normalized.includes(k))) {
    return {
      normalizedTask: "buy elevenlabs api key",
      rail: "x402",
      tags: ["elevenlabs", "api-key"],
      confidence: 0.95,
    };
  }

  if (KEYWORD_SETS.giftcard.some((k) => normalized.includes(k))) {
    return {
      normalizedTask: "buy gift card on bitrefill",
      rail: "bitrefill",
      tags: ["gift-card", "bitrefill"],
      confidence: 0.9,
    };
  }

  return {
    normalizedTask: raw,
    rail: "auto",
    tags: ["generic"],
    confidence: 0.5,
  };
}
