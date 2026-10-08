import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { AVATAR_BUCKET, avatarPath, validateAvatarUpload } from "@/lib/profile";
import { meOrNull } from "../caller";

// Signed direct-to-storage upload for the caller's own profile photo. The
// path is always avatars/<session user id>.<ext> in the public email-assets
// bucket (migration 016), so a member can only ever write their own photo.
// The browser PUTs the bytes to the signed URL, then saves the returned
// public URL with PATCH /api/me/profile.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await meOrNull();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await parseBody<{ mime?: unknown; size?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const v = validateAvatarUpload(body.mime, body.size);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const path = avatarPath(me.id, v.value);
  const { data, error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    return NextResponse.json({ error: "Photo upload isn't available right now. Your initials are shown instead." }, { status: 503 });
  }
  const { data: pub } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return NextResponse.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
}
