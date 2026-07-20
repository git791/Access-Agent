import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { required } from "./config";

export type AiProvider = "openai" | "gemini";
export type AiRole = "vision" | "patch";

type VisionRequest = {
  prompt: string;
  screenshots: Buffer[];
  schema: Record<string, unknown>;
};

/** OpenAI is the production default. Gemini is an explicit, isolated proof provider. */
export function aiProvider(): AiProvider {
  const provider = process.env.ACCESSAGENT_AI_PROVIDER || "openai";
  if (provider === "openai" || provider === "gemini") return provider;
  throw new Error("ACCESSAGENT_AI_PROVIDER must be either 'openai' or 'gemini'.");
}

function openAiClient() {
  return new OpenAI({ apiKey: required("OPENAI_API_KEY") });
}

function geminiClient() {
  return new GoogleGenAI({ apiKey: required("GEMINI_API_KEY") });
}

export function modelFor(role: AiRole): string {
  if (aiProvider() === "gemini") {
    return role === "vision"
      ? process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash"
      : process.env.GEMINI_PATCH_MODEL || "gemini-2.5-flash";
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
    const response = await geminiClient().models.generateContent({
      model: modelFor(role),
      contents: prompt,
      config: { maxOutputTokens: 4_000 }
    });
    return response.text ?? "";
  }

  const response = await openAiClient().responses.create({ model: modelFor(role), input: prompt });
  return response.output_text;
}

/**
 * Produces schema-constrained multimodal output. Both adapters receive the same
 * prompt, screenshots, and JSON schema; callers validate the result with Zod.
 */
export async function generateVisionJson({ prompt, screenshots, schema }: VisionRequest): Promise<string> {
  if (aiProvider() === "gemini") {
    const response = await geminiClient().models.generateContent({
      model: modelFor("vision"),
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          ...screenshots.map((screenshot) => ({
            inlineData: { mimeType: "image/png", data: screenshot.toString("base64") }
          }))
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        maxOutputTokens: 2_000
      }
    });
    return response.text ?? "";
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
