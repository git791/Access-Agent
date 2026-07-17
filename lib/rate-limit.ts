import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { required } from "./config";

export async function enforceAuditRateLimit(request: Request) {
  const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const bucket = createHash("sha256").update(source).digest("hex");
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));
  const { data, error } = await client.rpc("consume_audit_rate_limit", { p_bucket: bucket, p_limit: Number(process.env.ACCESSAGENT_AUDITS_PER_HOUR ?? 5) });
  if (error) throw error;
  if (!data) throw new Error("Audit rate limit reached. Try again in an hour.");
}
