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

// Groq's OpenAI-compatible Responses examples use automatic image detail.
export function imageDetail(): "auto" | "high" {
  return aiProvider() === "groq" ? "auto" : "high";
}

/**
 * Groq's vision-capable Qwen model supports JSON Object Mode, but not strict
 * JSON Schema. We still validate every response with Zod before using it.
 */
export function outputFormat(name: string, schema: any) {
  if (aiProvider() === "groq") return { type: "json_object" as const };
  return { type: "json_schema" as const, name, strict: true as const, schema };
}
