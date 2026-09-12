"use client";

import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/auth-options";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: authCookieOptions }
  );
}
