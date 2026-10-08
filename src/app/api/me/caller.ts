import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowedEmail } from "@/lib/auth-domains";

// The signed-in teammate (session cookie). /api/me/* only ever acts on this
// user's own record, never on an id from the request.
export async function meOrNull() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) return null;
  return user;
}
