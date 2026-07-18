import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@sparticuz/chromium"],
  // Vercel's file tracer needs the compressed Chromium binaries explicitly.
  outputFileTracingIncludes: {
    "/api/inngest": ["./node_modules/@sparticuz/chromium/bin/**"]
  }
};

export default nextConfig;
