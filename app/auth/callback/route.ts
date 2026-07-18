import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code");
  const redirect = new URL("/", url.origin); const jar = await cookies();
  const response = NextResponse.redirect(redirect);
  if (!code) return response;
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) }
  });
  await client.auth.exchangeCodeForSession(code);
  return response;
}
