// "My profile" rules (Settings → My profile, /dashboard/profile). Pure, no
// Supabase here, so the validation is unit-tested and shared by the routes
// (src/app/api/me/**) and the client panel.
//
// A member edits ONLY their own auth user_metadata: full_name (the name
// resolveTeamDisplayName shows everywhere) and avatar_url (a photo in the
// public email-assets bucket, path avatars/<user id>.<ext>).

export const PROFILE_NAME_MAX = 60;
export const AVATAR_BUCKET = "email-assets";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Window event the shell listens for so the sidebar footer updates at once.
export const PROFILE_EVENT = "pm:profile-updated";
export type ProfileEventDetail = { name: string; avatarUrl: string | null };

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

// Trimmed, inner whitespace collapsed, 1..60 characters, no control chars.
export function validateProfileName(raw: unknown): Checked<string> {
  if (typeof raw !== "string") return { ok: false, error: "Enter your name." };
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > PROFILE_NAME_MAX) return { ok: false, error: `Use ${PROFILE_NAME_MAX} characters or fewer.` };
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return { ok: false, error: "Use letters, spaces and simple punctuation only." };
  return { ok: true, value: name };
}

// The file the browser is about to upload: JPG, PNG or WebP, at most 2 MB.
// Returns the file extension used in the storage path.
export function validateAvatarUpload(mime: unknown, size: unknown): Checked<string> {
  const ext = typeof mime === "string" ? AVATAR_TYPES[mime] : undefined;
  if (!ext) return { ok: false, error: "Use a JPG, PNG or WebP image." };
  const n = Number(size);
  if (!(n > 0) || n > AVATAR_MAX_BYTES) return { ok: false, error: "Photos must be under 2 MB." };
  return { ok: true, value: ext };
}

export function avatarPath(userId: string, ext: string): string {
  return `avatars/${userId}.${ext}`;
}

// avatar_url must be null (remove the photo) or this user's own photo in the
// public bucket: .../storage/v1/object/public/email-assets/avatars/<id>.<ext>,
// optionally with a ?v= cache buster. Anything else (another user's photo, an
// outside URL) is refused, so a profile can never point at arbitrary content.
export function validateAvatarUrl(raw: unknown, userId: string, supabaseUrl?: string): Checked<string | null> {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || raw.length > 500) return { ok: false, error: "Invalid photo." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid photo." };
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return { ok: false, error: "Invalid photo." };
  if (supabaseUrl) {
    try {
      if (u.host !== new URL(supabaseUrl).host) return { ok: false, error: "Invalid photo." };
    } catch {
      return { ok: false, error: "Invalid photo." };
    }
  }
  const exts = Object.values(AVATAR_TYPES).join("|");
  const re = new RegExp(`^/storage/v1/object/public/${AVATAR_BUCKET}/avatars/([^/]+)\\.(${exts})$`);
  const m = u.pathname.match(re);
  if (!m || m[1] !== userId) return { ok: false, error: "Invalid photo." };
  if ([...u.searchParams.keys()].some((k) => k !== "v")) return { ok: false, error: "Invalid photo." };
  return { ok: true, value: u.toString() };
}

// user_metadata.avatar_url when it is a usable string, else null.
export function avatarUrlOf(meta: Record<string, unknown> | null | undefined): string | null {
  const v = meta?.avatar_url;
  return typeof v === "string" && /^https?:\/\//.test(v) ? v : null;
}
