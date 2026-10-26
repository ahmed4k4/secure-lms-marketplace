import { test, expect } from "@playwright/test";
test("Arabic landing page loads with course navigation", async ({ page }) => { await page.goto("/ar"); await expect(page.getByRole("heading", { name: /مهارات جديدة/ })).toBeVisible(); await expect(page.getByRole("link", { name: "استكشف الكورسات" })).toBeVisible(); });
