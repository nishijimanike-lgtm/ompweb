/**
 * Pure-Node model-list discovery helpers for custom providers in models.yml.
 *
 * These functions mirror pi-web's lib/model-discovery.ts but contain no
 * @earendil-works / @oh-my-pi imports — they are safe to call from any Next.js
 * server route.
 *
 * Server-side auth resolution is done by the caller (route.ts) via an isolated
 * omp utility process so that apiKey env-name / !cmd / agent.db tokens are all
 * handled by omp itself without ompweb having to reimplement the credential chain.
 */

/** One model returned by the provider's model-list endpoint. */
export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

/**
 * Build the URL to query for the provider's model list.
 *
 * Protocol → endpoint:
 *   openai-completions / openai-responses / openai-codex-responses
 *   azure-openai-responses
 *   google-gemini-cli  → {baseUrl}/models                (standard OpenAI path)
 *   anthropic-messages → {baseUrl}/v1/models?limit=1000  (Anthropic list API)
 *   google-generative-ai → {baseUrl}/v1beta/models?pageSize=1000
 *   google-vertex      → {baseUrl}/v1beta/models?pageSize=1000
 *   (anything else)    → {baseUrl}/models
 *
 * Trailing slash on baseUrl is normalised away.
 */
export function buildModelsListUrl(baseUrl: string, api?: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  switch (api) {
    case "anthropic-messages":
      return `${base}/v1/models?limit=1000`;
    case "google-generative-ai":
    case "google-vertex":
      return `${base}/v1beta/models?pageSize=1000`;
    default:
      // For openai-* and everything else, append /models unless already there.
      if (base.endsWith("/models")) return base;
      return `${base}/models`;
  }
}

/**
 * Build the HTTP request headers needed to authenticate against the
 * provider's model-list endpoint.
 *
 * @param api    Provider protocol (openai-completions, anthropic-messages, …)
 * @param apiKey Resolved token value (already looked up from env or literal).
 *               Pass undefined / empty string for no-auth providers.
 * @param extraHeaders Extra headers from models.yml `headers:` map.
 */
export function buildDiscoveryHeaders(
  api?: string,
  apiKey?: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };

  if (!apiKey) return headers;

  switch (api) {
    case "anthropic-messages":
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
      break;
    case "google-generative-ai":
    case "google-vertex":
      headers["x-goog-api-key"] = apiKey;
      break;
    default:
      headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
}

// ── Response parsers ──────────────────────────────────────────────────────────

function entry(id: string, name?: string): DiscoveredModel {
  return name !== undefined && name !== "" ? { id, name } : { id };
}

/** Parse an OpenAI-compatible /v1/models response. */
function parseOpenAiResponse(json: unknown): DiscoveredModel[] {
  if (!isRecord(json)) return [];
  const data = json["data"];
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown): DiscoveredModel[] => {
    if (!isRecord(item)) return [];
    const id = item["id"];
    if (typeof id !== "string" || !id) return [];
    return [entry(id, typeof item["name"] === "string" ? (item["name"] as string) : undefined)];
  });
}

/** Parse an Anthropic /v1/models response. */
function parseAnthropicResponse(json: unknown): DiscoveredModel[] {
  if (!isRecord(json)) return [];
  const data = json["data"];
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown): DiscoveredModel[] => {
    if (!isRecord(item)) return [];
    const id = item["id"];
    if (typeof id !== "string" || !id) return [];
    const name = typeof item["display_name"] === "string" ? (item["display_name"] as string) : undefined;
    return [entry(id, name)];
  });
}

/** Parse a Google /v1beta/models response.
 *  Model names come as "models/gemini-1.5-pro" — strip the prefix. */
function parseGoogleResponse(json: unknown): DiscoveredModel[] {
  if (!isRecord(json)) return [];
  const models = json["models"];
  if (!Array.isArray(models)) return [];
  return models.flatMap((item: unknown): DiscoveredModel[] => {
    if (!isRecord(item)) return [];
    const raw = item["name"];
    if (typeof raw !== "string" || !raw) return [];
    const id = raw.replace(/^models\//, "");
    const name = typeof item["displayName"] === "string" ? (item["displayName"] as string) : undefined;
    return [entry(id, name)];
  });
}

/** Parse a bare string-array response (some minimal OpenAI proxies). */
function parseStringArrayResponse(json: unknown): DiscoveredModel[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item: unknown): DiscoveredModel[] => {
    if (typeof item === "string" && item) return [entry(item)];
    if (isRecord(item) && typeof item["id"] === "string" && item["id"]) {
      return [entry(item["id"] as string)];
    }
    return [];
  });
}

/**
 * Parse a raw JSON response from the provider's model-list endpoint.
 *
 * Handles:
 *  - OpenAI   { data: [{ id, name? }] }
 *  - Anthropic { data: [{ id, display_name? }] }
 *  - Google   { models: [{ name: "models/...", displayName? }] }
 *  - Bare array of strings / { id } objects
 */
export function parseDiscoveredModels(json: unknown, api?: string): DiscoveredModel[] {
  if (!isRecord(json) && !Array.isArray(json)) return [];

  if (api === "google-generative-ai" || api === "google-vertex") {
    return parseGoogleResponse(json);
  }
  if (api === "anthropic-messages") {
    return parseAnthropicResponse(json);
  }

  // For OpenAI-compatible endpoints try the standard format first
  if (isRecord(json)) {
    if (Array.isArray(json["data"])) return parseOpenAiResponse(json);
    if (Array.isArray(json["models"])) {
      // Some Ollama-style proxies wrap in { models: [...] }
      const result = (json["models"] as unknown[]).flatMap((item: unknown): DiscoveredModel[] => {
        if (!isRecord(item)) return [];
        const id = item["id"] ?? item["name"];
        if (typeof id !== "string" || !id) return [];
        return [{ id }];
      });
      if (result.length > 0) return result;
    }
  }
  return parseStringArrayResponse(json);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
