// Keep browser, server and refresh cookies consistent. No Domain attribute:
// sessions belong to the individual CRM hostname, not the storefront.
export const authCookieOptions = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function safeAuthNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) {
    return "/dashboard";
  }
  return value;
}
