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
