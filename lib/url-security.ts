import { lookup } from "node:dns/promises";
import net from "node:net";

function privateAddress(address: string) {
  if (net.isIPv4(address)) return /^(10\.|127\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(address);
  return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

/** Blocks SSRF targets, while allowing local preview URLs during development only. */
export async function assertAuditableUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Use a plain http(s) URL without embedded credentials.");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (local && process.env.NODE_ENV !== "development") throw new Error("Local preview URLs are permitted only in development.");
  if (!local) {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.some((item) => privateAddress(item.address))) throw new Error("Private-network targets cannot be audited.");
  }
  return url;
}
