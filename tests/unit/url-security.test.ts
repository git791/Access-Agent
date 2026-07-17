import assert from "node:assert/strict";
import test from "node:test";
import { assertAuditableUrl } from "../../lib/url-security";

test("URL policy rejects embedded credentials before any request is made", async () => {
  await assert.rejects(() => assertAuditableUrl("https://user:secret@example.com"), /embedded credentials/);
});

test("URL policy rejects localhost outside development", async () => {
  await assert.rejects(() => assertAuditableUrl("http://localhost:3000"), /Local preview URLs/);
});
