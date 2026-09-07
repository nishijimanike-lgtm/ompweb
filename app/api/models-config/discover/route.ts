import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { type ProviderConfig, serializeModelsConfig } from "@/lib/omp/models-config";
import { runIsolatedUtilityCommand } from "@/lib/omp/rpc-utility";
import { isRecord } from "@/lib/type-guards";
import { buildModelsListUrl, type DiscoveredModel } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

/**
 * POST /api/models-config/discover
 *
 * Given a provider name + its models.yml config object (as edited in the UI),
 * spin up an isolated omp utility process with a throwaway agent dir containing
 * that provider's config and a `discovery: { type }` block, then call
 * get_available_models.  omp resolves auth itself (env-var names, !cmd secrets,
 * agent.db) so ompweb never has to reconstruct the credential chain.
 *
 * Body:
 *   { providerName: string; provider: ProviderConfig; discoveryType?: string }
 *
 * Response (200):
 *   { ok: true; models: DiscoveredModel[]; endpoint: string }
 *
 * Error:
 *   { ok: false; error: string; code?: string }
 */

const DISCOVERY_TIMEOUT_MS = 60_000;

// The omp-supported discovery types (set mirrors the models.yml schema).
const TYPED_DISCOVERY = new Set([
  "openai-models-list",
  "ollama",
  "llama.cpp",
  "lm-studio",
  "litellm",
  "proxy",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Strip the throwaway agent dir from omp's error text (it leaks a temp path). */
function sanitizeError(message: string, tempDir: string | undefined): string {
  if (tempDir && message.includes(tempDir)) message = message.replace(new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<temp dir>");
  return message;
}

export async function POST(req: Request) {
  let tempDir: string | undefined;
  let providerName = "";

  try {
    const body = await req.json() as {
      providerName?: unknown;
      provider?: unknown;
      discoveryType?: unknown;
    };

    providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) {
      return NextResponse.json(
        { ok: false, error: "providerName is required", code: "provider_name_required" },
        { status: 400 },
      );
    }

    if (!isRecord(body.provider)) {
      return NextResponse.json(
        { ok: false, error: "provider is required", code: "provider_required" },
        { status: 400 },
      );
    }

    const provider = body.provider as ProviderConfig;

    if (!provider.baseUrl) {
      return NextResponse.json(
        { ok: false, error: "Provider baseUrl is required for model discovery", code: "base_url_required" },
        { status: 400 },
      );
    }

    // Pick discovery type: prefer an explicit body value, then any discovery
    // type already configured on the provider, then openai-models-list as a
    // sensible default for an OpenAI-compatible endpoint.
    const rawType = typeof body.discoveryType === "string" ? body.discoveryType.trim() : "";
    const configuredType =
      isRecord(provider.discovery) && typeof provider.discovery["type"] === "string"
        ? (provider.discovery["type"] as string)
        : "";
    const discoveryType =
      TYPED_DISCOVERY.has(rawType) ? rawType : TYPED_DISCOVERY.has(configuredType) ? configuredType : "openai-models-list";

    // Build a throwaway models.yml that enables discovery on this provider.
    // omp will resolve all auth (env names, !cmd, stored creds) and run the
    // probe against the real endpoint.
    const discoveryConfig: ProviderConfig & { discovery?: Record<string, unknown> } = {
      ...provider,
      discovery: { type: discoveryType },
    };

    const modelsYmlConfig = {
      providers: { [providerName]: discoveryConfig },
    };

    tempDir = mkdtempSync(join(tmpdir(), "omp-web-discover-"));
    writeFileSync(
      join(tempDir, "models.yml"),
      serializeModelsConfig(modelsYmlConfig),
      "utf8",
    );

    const { models: rawModels } = await runIsolatedUtilityCommand<{ models?: unknown[] }>(
      { type: "get_available_models" },
      {
        env: {
          PI_CODING_AGENT_DIR: tempDir,
          OMP_PROFILE: "",
          PI_PROFILE: "",
          XDG_DATA_HOME: "",
        },
        timeoutMs: DISCOVERY_TIMEOUT_MS,
        signal: req.signal,
      },
    );

    const discoveredRaw: Array<{ id: string; name?: string; contextWindow?: number; reasoning?: boolean }> = (Array.isArray(rawModels) ? rawModels : [])
      .filter((m): m is Record<string, unknown> => isRecord(m))
      .filter((m) => m["provider"] === providerName)
      .map((m) => {
        const id = m["id"];
        const name = m["name"];
        const ctx = m["contextWindow"];
        const reasoning = m["reasoning"];
        return {
          id: typeof id === "string" ? id : String(id),
          name: typeof name === "string" && name && name !== id ? name : undefined,
          contextWindow: typeof ctx === "number" ? ctx : undefined,
          reasoning: typeof reasoning === "boolean" ? reasoning : undefined,
        };
      });
    const discovered: DiscoveredModel[] = discoveredRaw.filter(
      (m): m is DiscoveredModel => typeof m.id === "string" && m.id.length > 0,
    );

    if (discovered.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No models discovered for provider "${providerName}". Check that baseUrl is reachable and the API key is set correctly.`,
        code: "no_models_discovered",
      });
    }

    // Report the endpoint omp would have probed (best-effort, informational only)
    const endpoint = buildModelsListUrl(provider.baseUrl, provider.api);

    return NextResponse.json({ ok: true, models: discovered, endpoint });
  } catch (error) {
    const raw = errorMessage(error);
    // omp exits non-zero when discovery finds nothing it can probe; surface that
    // as a friendly failure instead of a raw process error.
    const noModels = /No models available|No models discovered|model .* not found|unresolved/i.test(raw);
    return NextResponse.json(
      {
        ok: false,
        error: noModels
          ? `No models discovered for provider "${providerName}". Check that baseUrl is reachable and the API key is set correctly.`
          : sanitizeError(raw, tempDir),
        code: noModels ? "no_models_discovered" : "discovery_failed",
      },
      { status: noModels ? 200 : 500 },
    );
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
