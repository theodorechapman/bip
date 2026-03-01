/**
 * ChatCodex — browser-use compatible LLM adapter for gpt-5.3-codex via ChatGPT Pro/Plus auth.
 * Uses the Codex Responses API (streaming) at chatgpt.com/backend-api/codex/responses.
 * Free with your ChatGPT subscription — no API credits needed.
 *
 * Port of bip-bu/codex_llm.py.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { BaseChatModel, ChatInvokeOptions } from "browser-use/llm/base";
import {
  ChatInvokeCompletion,
  type ChatInvokeUsage,
} from "browser-use/llm/views";
import {
  type Message,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ContentPartTextParam,
  ContentPartImageParam,
} from "browser-use/llm/messages";

/**
 * Recursively fix 0-indexed element references in Codex output.
 * browser-use validates index >= 1, but Codex sometimes outputs index: 0.
 */
function fixZeroIndices(obj: unknown): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) fixZeroIndices(item);
    return;
  }
  const record = obj as Record<string, unknown>;
  if ("index" in record && record.index === 0) {
    record.index = 1;
  }
  for (const val of Object.values(record)) {
    fixZeroIndices(val);
  }
}

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const TOKEN_REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes

type CodexAuth = {
  tokens: {
    access_token: string;
    refresh_token: string;
  };
  account_id?: string;
  [key: string]: unknown;
};

function loadCodexAuth(authPath: string): CodexAuth {
  if (!existsSync(authPath)) {
    throw new Error(
      `Codex auth not found at ${authPath}. Run 'codex auth login' first.`
    );
  }
  return JSON.parse(readFileSync(authPath, "utf-8")) as CodexAuth;
}

async function refreshToken(
  auth: CodexAuth,
  authPath: string
): Promise<CodexAuth> {
  console.log("   Refreshing Codex token...");
  const resp = await fetch(TOKEN_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: auth.tokens.refresh_token,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
  };
  auth.tokens.access_token = data.access_token;
  auth.tokens.refresh_token = data.refresh_token;
  writeFileSync(authPath, JSON.stringify(auth, null, 2), "utf-8");
  console.log("   Token refreshed.");
  return auth;
}

/**
 * Convert browser-use Message[] to Codex Responses API format.
 * Returns [instructions, inputMessages].
 */
function serializeMessages(
  messages: Message[]
): [string, Record<string, unknown>[]] {
  let instructions = "";
  const input: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg instanceof SystemMessage) {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content.map((p: { text: string }) => p.text).join("\n");
      instructions = instructions ? `${instructions}\n${text}` : text;
    } else if (msg instanceof UserMessage) {
      if (typeof msg.content === "string") {
        input.push({ role: "user", content: msg.content });
      } else {
        const parts: Record<string, unknown>[] = [];
        for (const part of msg.content) {
          if (part instanceof ContentPartTextParam) {
            parts.push({ type: "input_text", text: part.text });
          } else if (part instanceof ContentPartImageParam) {
            parts.push({
              type: "input_image",
              image_url: part.image_url.url,
            });
          }
        }
        input.push({ role: "user", content: parts });
      }
    } else if (msg instanceof AssistantMessage) {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const tc = msg.tool_calls[0]!;
        input.push({
          type: "function_call",
          id: tc.id,
          call_id: tc.id,
          name: tc.functionCall.name,
          arguments: tc.functionCall.arguments,
        });
      } else {
        const text =
          typeof msg.content === "string" ? msg.content : "";
        if (text) {
          input.push({ role: "assistant", content: text });
        }
      }
    }
  }

  return [instructions || "You are a helpful assistant.", input];
}

export interface ChatCodexOptions {
  model?: string;
  authPath?: string;
}

export class ChatCodex implements BaseChatModel {
  model: string;
  _verified_api_keys = false;

  private authPath: string;
  private auth: CodexAuth;
  private lastRefresh: number;

  constructor(options: ChatCodexOptions = {}) {
    this.model = options.model ?? "gpt-5.3-codex";
    this.authPath =
      options.authPath ?? join(homedir(), ".codex", "auth.json");
    this.auth = loadCodexAuth(this.authPath);
    this.lastRefresh = Date.now();
  }

  get provider(): string {
    return "codex";
  }
  get name(): string {
    return this.model;
  }
  get model_name(): string {
    return this.model;
  }

  private async ensureFreshToken(): Promise<void> {
    if (Date.now() - this.lastRefresh > TOKEN_REFRESH_INTERVAL_MS) {
      this.auth = await refreshToken(this.auth, this.authPath);
      this.lastRefresh = Date.now();
    }
  }

  private async streamRequest(
    payload: Record<string, unknown>
  ): Promise<{ text: string; usage: ChatInvokeUsage | null }> {
    await this.ensureFreshToken();

    const resp = await fetch(CODEX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.auth.tokens.access_token}`,
        "Content-Type": "application/json",
        "OpenAI-Account-Id": this.auth.account_id ?? "",
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      this.auth = await refreshToken(this.auth, this.authPath);
      this.lastRefresh = Date.now();
      return this.streamRequest(payload);
    }

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Codex API error ${resp.status}: ${body}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body from Codex API");

    const decoder = new TextDecoder();
    let fullText = "";
    let usageData: ChatInvokeUsage | null = null;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") break;

        try {
          const event = JSON.parse(data) as Record<string, unknown>;
          const etype = event.type as string;

          if (etype === "response.output_text.delta") {
            fullText += (event.delta as string) ?? "";
          } else if (etype === "response.completed") {
            const respData = event.response as Record<string, unknown>;
            const usage = respData?.usage as Record<string, unknown>;
            if (usage) {
              const inputDetails = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
              usageData = {
                prompt_tokens: (usage.input_tokens as number) ?? 0,
                prompt_cached_tokens: (inputDetails.cached_tokens as number) ?? null,
                prompt_cache_creation_tokens: null,
                prompt_image_tokens: null,
                completion_tokens: (usage.output_tokens as number) ?? 0,
                total_tokens: (usage.total_tokens as number) ?? 0,
              };
            }
            // Grab full text from completed response if not accumulated
            if (!fullText) {
              const output = (respData?.output ?? []) as Record<string, unknown>[];
              for (const item of output) {
                const content = (item.content ?? []) as Record<string, unknown>[];
                for (const part of content) {
                  if (part.type === "output_text") {
                    fullText = (part.text as string) ?? "";
                  }
                }
              }
            }
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    return { text: fullText, usage: usageData };
  }

  async ainvoke(
    messages: Message[],
    output_format?: { parse: (input: string) => unknown } | undefined,
    options?: ChatInvokeOptions
  ): Promise<ChatInvokeCompletion<any>> {
    let [instructions, inputMsgs] = serializeMessages(messages);

    // Inject JSON schema into instructions so Codex knows the expected format.
    // We can't use text.format because Codex API is stricter than OpenAI's
    // and rejects schemas with optional fields.
    if (output_format && "safeParse" in output_format) {
      try {
        const { zodSchemaToJsonSchema } = await import("browser-use/llm/schema");
        const schema = zodSchemaToJsonSchema(output_format as any);
        instructions += `\n\n<json_schema>\n${JSON.stringify({ name: "agent_output", schema, strict: true }, null, 2)}\n</json_schema>\n\nYou MUST respond with valid JSON matching the schema above. Do not include any text outside the JSON object.`;
      } catch {
        // If schema conversion fails, continue without it
      }
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      instructions,
      input: inputMsgs,
      store: false,
      stream: true,
    };

    const result = await this.streamRequest(payload);

    if (output_format) {
      // Parse structured output
      let rawText = result.text.trim();
      // Find end of first complete JSON object (Codex sometimes appends trailing chars)
      let depth = 0;
      let endIdx = 0;
      for (let i = 0; i < rawText.length; i++) {
        if (rawText[i] === "{") depth++;
        else if (rawText[i] === "}") {
          depth--;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx > 0) rawText = rawText.slice(0, endIdx);

      try {
        // Codex sometimes outputs 0-indexed element IDs, but browser-use
        // validates index >= 1. Fix any "index": 0 to "index": 1.
        const jsonObj = JSON.parse(rawText);
        fixZeroIndices(jsonObj);
        const parsed = output_format.parse(jsonObj);
        return new ChatInvokeCompletion(
          parsed,
          result.usage,
          null,
          null,
          "end_turn"
        );
      } catch (e) {
        throw new Error(
          `Failed to parse Codex response: ${e}\nRaw: ${result.text.slice(0, 500)}`
        );
      }
    }

    return new ChatInvokeCompletion(
      result.text,
      result.usage,
      null,
      null,
      "end_turn"
    );
  }
}

/**
 * Check if Codex auth is available (i.e. ~/.codex/auth.json exists).
 */
export function isCodexAvailable(
  authPath?: string
): boolean {
  const p = authPath ?? join(homedir(), ".codex", "auth.json");
  return existsSync(p);
}
