import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildModelsListUrl, buildDiscoveryHeaders, parseDiscoveredModels } = await jiti.import("./model-discovery.ts");

test("buildModelsListUrl appends /models for OpenAI-compatible endpoints", () => {
  assert.equal(buildModelsListUrl("https://api.example.com/v1", "openai-completions"), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.example.com/v1/", "openai-completions"), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.example.com/v1", "openai-responses"), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.example.com/v1", "azure-openai-responses"), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.example.com/v1", undefined), "https://api.example.com/v1/models");
});

test("buildModelsListUrl keeps an existing /models path", () => {
  assert.equal(buildModelsListUrl("https://api.example.com/models", "openai-completions"), "https://api.example.com/models");
});

test("buildModelsListUrl routes Anthropic and Google to their list APIs", () => {
  assert.equal(buildModelsListUrl("https://api.anthropic.com", "anthropic-messages"), "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-generative-ai"), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-vertex"), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
});

test("buildDiscoveryHeaders picks the auth scheme for each API", () => {
  assert.deepEqual(buildDiscoveryHeaders("openai-completions", "sk-123", {}), { Authorization: "Bearer sk-123" });
  assert.deepEqual(buildDiscoveryHeaders("anthropic-messages", "ant-123"), {
    "x-api-key": "ant-123",
    "anthropic-version": "2023-06-01",
  });
  assert.deepEqual(buildDiscoveryHeaders("google-generative-ai", "goog-123"), { "x-goog-api-key": "goog-123" });
  assert.deepEqual(buildDiscoveryHeaders("google-vertex", "goog-123"), { "x-goog-api-key": "goog-123" });
});

test("buildDiscoveryHeaders returns no auth headers without a key", () => {
  assert.deepEqual(buildDiscoveryHeaders("openai-completions", undefined, {}), {});
  assert.deepEqual(buildDiscoveryHeaders("openai-completions", "", {}), {});
  assert.deepEqual(buildDiscoveryHeaders("anthropic-messages", "", {}), {});
});

test("buildDiscoveryHeaders merges user headers and keeps a version override", () => {
  assert.deepEqual(
    buildDiscoveryHeaders("anthropic-messages", "ant-123", { "anthropic-version": "2023-01-01", "X-Custom": "yes" }),
    { "x-api-key": "ant-123", "anthropic-version": "2023-01-01", "X-Custom": "yes" },
  );
});

test("parseDiscoveredModels handles OpenAI data arrays", () => {
  const models = parseDiscoveredModels(
    { data: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-4o-mini" }, { nope: true }] },
    "openai-completions",
  );
  assert.deepEqual(models, [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini" },
  ]);
});

test("parseDiscoveredModels handles Anthropic data arrays", () => {
  const models = parseDiscoveredModels(
    { data: [{ id: "claude-3-5-sonnet", display_name: "Claude 3.5 Sonnet" }, { id: "claude-3-haiku" }] },
    "anthropic-messages",
  );
  assert.deepEqual(models, [
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-haiku" },
  ]);
});

test("parseDiscoveredModels strips the models/ prefix from Google names", () => {
  const models = parseDiscoveredModels(
    {
      models: [
        { name: "models/gemini-1.5-pro", displayName: "Gemini 1.5 Pro" },
        { name: "models/gemini-1.5-flash" },
      ],
    },
    "google-generative-ai",
  );
  assert.deepEqual(models, [
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash" },
  ]);
});

test("parseDiscoveredModels falls back to bare string/object arrays", () => {
  assert.deepEqual(parseDiscoveredModels(["llama-3.1-8b", "llama-3.1-70b"]), [
    { id: "llama-3.1-8b" },
    { id: "llama-3.1-70b" },
  ]);
  assert.deepEqual(parseDiscoveredModels([{ id: "model-a" }, "model-b"]), [
    { id: "model-a" },
    { id: "model-b" },
  ]);
});

test("parseDiscoveredModels handles { models: [...] } wrappers and rejects garbage", () => {
  assert.deepEqual(parseDiscoveredModels({ models: [{ id: "wrapped-1" }, { name: "wrapped-2" }] }, "openai-completions"), [
    { id: "wrapped-1" },
    { id: "wrapped-2" },
  ]);
  assert.deepEqual(parseDiscoveredModels(42), []);
  assert.deepEqual(parseDiscoveredModels(null), []);
  assert.deepEqual(parseDiscoveredModels("string"), []);
  assert.deepEqual(parseDiscoveredModels({}), []);
});
