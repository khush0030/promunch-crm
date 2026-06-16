import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/auth-domains";

const PUBLIC_PATHS = ["/login", "/auth"];
// API routes reachable WITHOUT a browser session. Everything else under /api/*
// requires an allowed, logged-in user. These self-authenticate instead:
//   /api/cron/*     → CRON_SECRET (Vercel sends it as a Bearer token)
//   /api/webhooks/* → provider signature (Shopify HMAC / Resend secret)
// Every other /api/* route is a dashboard backend and MUST be gated here.
const PUBLIC_API_PREFIXES = ["/api/webhooks/", "/api/cron/"];

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const isApi = path.startsWith("/api/");
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
  const isProtectedApi = isApi && !isPublicApi; // dashboard backends → require session
  const isStatic =
    path.startsWith("/_next/") ||
    path.startsWith("/favicon") ||
    path.startsWith("/pm-logo");

  // Enforce allowed domains — sign out any session whose email isn't allowed.
  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    if (isProtectedApi) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    if (!isPublic && !isApi && !isStatic) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "domain");
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    // Protected API → 401 JSON (don't redirect a fetch() to the login HTML page).
    if (isProtectedApi) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (!isPublic && !isApi && !isStatic) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  if (user && path === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pm-logo.*|.*\\.svg|.*\\.png|.*\\.jpe?g).*)"],
};
