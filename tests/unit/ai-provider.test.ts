import assert from "node:assert/strict";
import test from "node:test";
import { aiProvider, modelFor } from "../../lib/ai-provider";
import { runtimeConfiguration } from "../../lib/config";

function withEnvironment(values: Record<string, string | undefined>, action: () => void) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Gemini test adapter selects Gemini defaults and requires its own key", () => {
  withEnvironment({
    ACCESSAGENT_AI_PROVIDER: "gemini",
    GEMINI_API_KEY: undefined,
    GEMINI_VISION_MODEL: undefined,
    GEMINI_PATCH_MODEL: undefined,
    OPENAI_API_KEY: "production-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "secret-key",
    INNGEST_EVENT_KEY: "event-key",
    INNGEST_SIGNING_KEY: "signing-key"
  }, () => {
    assert.equal(aiProvider(), "gemini");
    assert.equal(modelFor("vision"), "gemini-3.5-flash");
    assert.equal(modelFor("patch"), "gemini-3.5-flash");
    assert.deepEqual(runtimeConfiguration(), { ready: false, missing: ["GEMINI_API_KEY"] });
  });
});

test("OpenAI remains the default production adapter", () => {
  withEnvironment({
    ACCESSAGENT_AI_PROVIDER: undefined,
    OPENAI_VISION_MODEL: undefined,
    OPENAI_PATCH_MODEL: undefined
  }, () => {
    assert.equal(aiProvider(), "openai");
    assert.equal(modelFor("vision"), "gpt-5-mini");
    assert.equal(modelFor("patch"), "gpt-5-mini");
  });
});
