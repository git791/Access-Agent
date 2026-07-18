import { expect, test } from "@playwright/test";

test("dashboard does not display fabricated findings before a run", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No findings yet")).toBeVisible();
  await expect(page.getByText("Verified is reserved for a completed re-render and verification verdict.")).toBeVisible();
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
