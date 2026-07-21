import { expect, test } from "@playwright/test";

test("dashboard shows an empty evidence workspace before a run", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Evidence and findings will appear here")).toBeVisible();
  await expect(page.getByText("How verification works")).toBeVisible();
  await expect(page.getByLabel("Public preview URL")).toHaveValue("https://access-agent-sable.vercel.app/demo-target");
  await expect(page.getByText("SAFE BRANCH", { exact: true })).toBeVisible();
});

test("controlled demo target exposes seeded accessibility defects", async ({ page }) => {
  await page.goto("/demo-target");
  await expect(page.getByRole("heading", { name: "Acme Store" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Checkout" })).toBeVisible();
});

test("controlled demo target provides five crawlable pages", async ({ page }) => {
  const routes = [
    ["/demo-target", "Acme Store"],
    ["/demo-target/catalog", "Browse the collection"],
    ["/demo-target/product", "Field jacket"],
    ["/demo-target/checkout", "Checkout"],
    ["/demo-target/support", "Support"],
  ] as const;
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});
