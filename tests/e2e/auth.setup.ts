import { test as setup } from "@playwright/test";
import { STORAGE_STATE } from "../../playwright.config";
import { loginAsTestUser } from "./auth-helper";

setup("authenticate as test user", async ({ page }) => {
  await loginAsTestUser(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
