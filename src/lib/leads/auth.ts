// Session gate for lead-gen API routes. Middleware does not protect /api/*,
// and these routes can trigger sends, so they verify the dashboard session.

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function requireSession(): Promise<NextResponse | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
