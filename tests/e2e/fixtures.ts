import { test as base, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_USER_ID } from "./auth-helper";

type Fixtures = {
  testUserId: string;
  supabaseAdmin: SupabaseClient;
};

export const test = base.extend<Fixtures>({
  testUserId: async ({}, use) => {
    await use(TEST_USER_ID);
  },

  supabaseAdmin: async ({}, use) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        "Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local (or GitHub secrets) to run DB-touching tests"
      );
    }
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await use(client);
  },
});

export { expect };
