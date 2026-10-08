"use client";
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_TYPES, PROFILE_EVENT, PROFILE_NAME_MAX, validateProfileName, type ProfileEventDetail } from "@/lib/profile";
import css from "./Settings.module.css";

type Profile = { id: string; email: string | null; full_name: string; display_name: string; avatar_url: string | null };

// Square-crop and shrink to 256px so every photo is small and the same shape.
// Falls back to the original file when the browser can't decode it.
async function squareResize(file: File, px = 256): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px);
    bmp.close?.();
    const as = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.88));
    const webp = await as("image/webp");
    if (webp && webp.type === "image/webp") return webp;
    return (await as("image/jpeg")) ?? file;
  } catch {
    return file;
  }
}

export function ProfilePanel() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    fetch("/api/me/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: Profile) => {
        setProfile(p);
        setName(p.full_name || p.display_name || "");
      })
      .catch(() => setLoadErr(true));
  }, []);

  // Push the change to the shell now and refresh the session so every other
  // screen reading user_metadata sees it too.
  function announce(p: Profile) {
    window.dispatchEvent(new CustomEvent<ProfileEventDetail>(PROFILE_EVENT, { detail: { name: p.display_name, avatarUrl: p.avatar_url } }));
    createSupabaseBrowserClient().auth.refreshSession().catch(() => {});
  }

  async function patch(body: Record<string, unknown>): Promise<Profile> {
    const r = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "Save failed.");
    const next = { ...(profile as Profile), full_name: d.full_name, display_name: d.display_name, avatar_url: d.avatar_url };
    setProfile(next);
    announce(next);
    return next;
  }

  const check = validateProfileName(name);
  const dirty = !!profile && name.replace(/\s+/g, " ").trim() !== (profile.full_name || "");

  async function saveName() {
    if (!check.ok) {
      toast.push({ kind: "error", text: check.error });
      return;
    }
    setSaving(true);
    try {
      const p = await patch({ full_name: check.value });
      setName(p.full_name);
      toast.push({ kind: "success", text: "Name saved. It now shows across the CRM." });
    } catch (e) {
      toast.push({ kind: "error", text: `Couldn't save your name: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!AVATAR_TYPES[file.type]) {
      toast.push({ kind: "error", text: "Use a JPG, PNG or WebP image." });
      return;
    }
    setPhotoBusy(true);
    try {
      const blob = await squareResize(file);
      if (blob.size > AVATAR_MAX_BYTES) throw new Error("Photos must be under 2 MB.");
      const r = await fetch("/api/me/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: blob.type, size: blob.size }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) throw new Error(j.error || "Photo upload isn't available right now.");
      const { error } = await createSupabaseBrowserClient()
        .storage.from(AVATAR_BUCKET)
        .uploadToSignedUrl(j.path, j.token, blob, { contentType: blob.type, upsert: true });
      if (error) throw new Error(error.message);
      await patch({ avatar_url: `${j.publicUrl}?v=${Date.now()}` });
      toast.push({ kind: "success", text: "Photo updated." });
    } catch (e) {
      toast.push({ kind: "error", text: `${e instanceof Error ? e.message : "Upload failed."} Your initials are shown instead.` });
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await patch({ avatar_url: null });
      toast.push({ kind: "success", text: "Photo removed. Your initials are shown instead." });
    } catch (e) {
      toast.push({ kind: "error", text: `Couldn't remove the photo: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setPhotoBusy(false);
    }
  }

  if (loadErr) return <div className={css.card}><div className={css.empty}>Couldn&apos;t load your profile. Refresh to try again.</div></div>;
  if (!profile) return <div className={css.card}><div className={css.empty}>Loading your profile…</div></div>;

  const shownName = check.ok ? check.value : profile.display_name;

  return (
    <div className={css.card}>
      <div className={css.profTop}>
        <Avatar name={shownName} src={profile.avatar_url} size={72} />
        <div className={css.tx}>
          <b>{profile.display_name}</b>
          {profile.email && <span>{profile.email}</span>}
        </div>
      </div>

      <div className={css.profRow}>
        <span className={css.lab}>Photo</span>
        <div className={css.profBody}>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            title="Upload a photo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadPhoto(f);
            }}
          />
          <div className={css.btnRow} style={{ marginTop: 0 }}>
            <button type="button" className="pm2-btn" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
              <Camera /> {photoBusy ? "Working…" : profile.avatar_url ? "Change photo" : "Upload photo"}
            </button>
            {profile.avatar_url && (
              <button type="button" className={css.link} onClick={removePhoto} disabled={photoBusy}>
                Remove photo
              </button>
            )}
          </div>
          <span className={css.hintTx}>JPG, PNG or WebP, up to 2 MB. Cropped to a square. Without a photo your initials are shown.</span>
        </div>
      </div>

      <form
        className={css.profRow}
        onSubmit={(e) => {
          e.preventDefault();
          saveName();
        }}
      >
        <label className={css.lab} htmlFor="profile-name">Your name</label>
        <div className={css.profBody}>
          <div className={css.profName}>
            <input
              id="profile-name"
              className={css.in}
              value={name}
              maxLength={PROFILE_NAME_MAX + 10}
              autoComplete="name"
              placeholder="Priya Sharma"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!check.ok}
            />
            <button type="submit" className="pm2-btn pri" disabled={saving || !dirty || !check.ok}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <span className={css.hintTx}>
            {!check.ok && name.trim() ? check.error : "Shown in the sidebar, the team list, ticket assignments and the Assign menu."}
          </span>
        </div>
      </form>
    </div>
  );
}
