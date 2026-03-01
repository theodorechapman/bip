export function classifyStatusId(id: string): "run" | "intent" {
  return id.startsWith("run_") ? "run" : "intent";
}
