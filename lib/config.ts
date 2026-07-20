export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export function runtimeConfiguration() {
  const aiKey = (process.env.ACCESSAGENT_AI_PROVIDER || "openai") === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY";
  const missing = [aiKey, "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]
    .filter((name) => !process.env[name]);
  return { ready: missing.length === 0, missing };
}
