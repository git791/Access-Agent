import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { required } from "./config";

/** Verifies a browser bearer token with Supabase Auth before privileged API actions. */
export async function authenticatedUser(request: Request) {
  const header = request.headers.get("authorization");
  const url = required("NEXT_PUBLIC_SUPABASE_URL"); const key = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (header?.startsWith("Bearer ")) {
    const client = createClient(url, key); const { data, error } = await client.auth.getUser(header.slice(7));
    return error ? null : data.user;
  }
  const jar = await cookies();
  const client = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => undefined } });
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}
