export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export function runtimeConfiguration() {
  const missing = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]
    .filter((name) => !process.env[name]);
  return { ready: missing.length === 0, missing };
}
