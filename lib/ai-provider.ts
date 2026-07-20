import OpenAI from "openai";
import { required } from "./config";

export type AiProvider = "openai" | "groq";
export type AiRole = "vision" | "patch";

export function aiProvider(): AiProvider {
  const provider = process.env.ACCESSAGENT_AI_PROVIDER || "openai";
  if (provider === "openai" || provider === "groq") return provider;
  throw new Error("ACCESSAGENT_AI_PROVIDER must be either 'openai' or 'groq'.");
}

export function aiClient() {
  if (aiProvider() === "groq") {
    return new OpenAI({
      apiKey: required("GROQ_API_KEY"),
      baseURL: "https://api.groq.com/openai/v1"
    });
  }
  return new OpenAI({ apiKey: required("OPENAI_API_KEY") });
}

export function modelFor(role: AiRole): string {
  if (aiProvider() === "groq") {
    return role === "vision"
      ? process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b"
      : process.env.GROQ_PATCH_MODEL || "openai/gpt-oss-120b";
  }
  return role === "vision"
    ? process.env.OPENAI_VISION_MODEL || "gpt-5.4"
    : process.env.OPENAI_PATCH_MODEL || "gpt-5.4";
}

// Keep Groq proof runs inside its lower TPM allowance. OpenAI production runs
// retain high-detail evidence inspection.
export function imageDetail(): "low" | "high" {
  return aiProvider() === "groq" ? "low" : "high";
}

// Keep the fallback's prompt below Groq's small proof-tier TPM allowance.
export function accessibilityContextLimit(): number {
  return aiProvider() === "groq" ? 2_000 : 12_000;
}

/**
 * Groq's vision-capable Qwen endpoint does not reliably accept a response
 * format option. Its prompt-only JSON output is validated with Zod locally.
 */
export function outputFormat(name: string, schema: any) {
  if (aiProvider() === "groq") return undefined;
  return { type: "json_schema" as const, name, strict: true as const, schema };
}

/** Groq's OpenAI-compatible Chat Completions endpoint is used for fallback text. */
export async function generateText(prompt: string, role: AiRole): Promise<string> {
  const client = aiClient();
  if (aiProvider() === "groq") {
    const response = await client.chat.completions.create({
      model: modelFor(role),
      messages: [{ role: "user", content: prompt }]
    });
    return response.choices[0]?.message.content ?? "";
  }
  const response = await client.responses.create({ model: modelFor(role), input: prompt });
  return response.output_text;
}
