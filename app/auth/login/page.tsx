"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

export default function LoginPage() {
  const [message, setMessage] = useState("");
  async function signIn() {
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { error } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) setMessage(error.message);
  }
  return <main style={{ maxWidth: 560, margin: "10vh auto", padding: 24 }}><p className="eyebrow">PRGATE ACCOUNT</p><h1>Sign in with GitHub</h1><p className="lede">Connect your identity before starting an accessibility remediation run.</p><button onClick={signIn}>Continue with GitHub</button>{message ? <p role="alert">{message}</p> : null}</main>;
}
