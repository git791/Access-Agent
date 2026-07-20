import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { required } from "./config";

export type AiProvider = "openai" | "gemini";
export type AiRole = "vision" | "patch";

// A proof audit must fail visibly rather than pin an Inngest run indefinitely.
const PROVIDER_TIMEOUT_MS = 75_000;

type VisionRequest = {
  prompt: string;
  screenshots: Buffer[];
  schema: Record<string, unknown>;
};

const patchDiffSchema = {
  type: "object",
  additionalProperties: false,
  required: ["diff"],
  properties: { diff: { type: "string" } }
} as const;

/** OpenAI is the production default. Gemini is an explicit, isolated proof provider. */
export function aiProvider(): AiProvider {
  const provider = process.env.ACCESSAGENT_AI_PROVIDER || "openai";
  if (provider === "openai" || provider === "gemini") return provider;
  throw new Error("ACCESSAGENT_AI_PROVIDER must be either 'openai' or 'gemini'.");
}

function openAiClient() {
  return new OpenAI({ apiKey: required("OPENAI_API_KEY"), timeout: PROVIDER_TIMEOUT_MS, maxRetries: 1 });
}

function geminiClient() {
  return new GoogleGenAI({ apiKey: required("GEMINI_API_KEY") });
}

export function modelFor(role: AiRole): string {
  if (aiProvider() === "gemini") {
    return role === "vision"
      ? process.env.GEMINI_VISION_MODEL || "gemini-3.5-flash"
      : process.env.GEMINI_PATCH_MODEL || "gemini-3.5-flash";
  }
  return role === "vision"
    ? process.env.OPENAI_VISION_MODEL || "gpt-5-mini"
    : process.env.OPENAI_PATCH_MODEL || "gpt-5-mini";
}

// Gemini proof runs deliberately send a bounded screenshot and smaller DOM excerpt.
// OpenAI production runs retain full-page, high-detail evidence inspection.
export function accessibilityContextLimit(): number {
  return aiProvider() === "gemini" ? 2_000 : 12_000;
}

/** Generates a text response for the patch-authoring role through the selected adapter. */
export async function generateText(prompt: string, role: AiRole): Promise<string> {
  if (aiProvider() === "gemini") {
    const response = await geminiClient().interactions.create({
      model: modelFor(role),
      input: prompt,
      store: false,
      generation_config: { max_output_tokens: 4_000 }
    }, { timeout_ms: PROVIDER_TIMEOUT_MS });
    return response.output_text ?? "";
  }

  const response = await openAiClient().responses.create({ model: modelFor(role), input: prompt });
  return response.output_text;
}

/** Returns a machine-extracted unified diff, never conversational prose. */
export async function generatePatchDiff(prompt: string): Promise<string> {
  let output: string;
  if (aiProvider() === "gemini") {
    const response = await geminiClient().interactions.create({
      model: modelFor("patch"),
      input: prompt,
      store: false,
      response_format: { type: "text", mime_type: "application/json", schema: patchDiffSchema },
      generation_config: { max_output_tokens: 6_000 }
    }, { timeout_ms: PROVIDER_TIMEOUT_MS });
    output = response.output_text ?? "";
  } else {
    const response = await openAiClient().responses.create({
      model: modelFor("patch"),
      input: prompt,
      text: { format: { type: "json_schema", name: "patch_diff", strict: true, schema: patchDiffSchema } }
    });
    output = response.output_text;
  }

  const parsed = JSON.parse(output) as { diff?: unknown };
  if (typeof parsed.diff !== "string") throw new Error("Patch role did not return a diff field.");
  return parsed.diff.trim();
}

/**
 * Produces schema-constrained multimodal output. Both adapters receive the same
 * prompt, screenshots, and JSON schema; callers validate the result with Zod.
 */
export async function generateVisionJson({ prompt, screenshots, schema }: VisionRequest): Promise<string> {
  if (aiProvider() === "gemini") {
    const response = await geminiClient().interactions.create({
      model: modelFor("vision"),
      input: [
        { type: "text", text: prompt },
        ...screenshots.map((screenshot) => ({
          type: "image" as const,
          mime_type: "image/png",
          data: screenshot.toString("base64")
        }))
      ],
      store: false,
      response_format: { type: "text", mime_type: "application/json", schema },
      generation_config: { max_output_tokens: 2_000 }
    }, { timeout_ms: PROVIDER_TIMEOUT_MS });
    return response.output_text ?? "";
  }

  const encoded = screenshots.map((screenshot) => `data:image/png;base64,${screenshot.toString("base64")}`);
  const response = await openAiClient().responses.create({
    model: modelFor("vision"),
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...encoded.map((image_url) => ({ type: "input_image" as const, image_url, detail: "high" as const }))
      ]
    }],
    text: { format: { type: "json_schema", name: "accessibility_audit", strict: true, schema } }
  });
  return response.output_text;
}
