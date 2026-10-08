"use client";

import { useEffect, useRef, useState } from "react";
import type { DealStage, PortalView } from "@/lib/influencers/types";
import { MAX_DRAFT_BYTES, canRequestChange } from "@/lib/influencers/portal-rules";
import { deliverablesLine } from "@/lib/influencers/brief-content";
import { PortalFooter, PortalHero } from "./PortalChrome";
import s from "./portal.module.css";

type Post = (path: string, body?: Record<string, unknown>) => Promise<boolean>;
type SetMsg = (m: string | null) => void;

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
    : null;

/** The four creator-facing steps (Brief, Box, Draft, Go live) each stage belongs to. */
const STEP_OF: Partial<Record<DealStage, number>> = {
  agreed: 1,
  brief_draft: 1,
  brief_sent: 1,
  brief_acknowledged: 2,
  dispatched: 2,
  delivered: 3,
  changes_requested: 3,
  draft_submitted: 3,
  draft_approved: 4,
  posted: 4,
  completed: 4,
};

export default function CreatorPortal({ initialView }: { initialView: PortalView }) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // A success note fades on its own; errors stay until dismissed or the next action.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const post: Post = async (path, body = {}) => {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const r = await fetch(`/api/public/collab/${view.code}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Something went wrong. Please try again.");
        return false;
      }
      if (j.view) setView(j.view as PortalView);
      return true;
    } catch {
      setError("Could not reach us. Check your internet and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const first = view.creator_name.replace(/^@/, "").split(/\s+/)[0] || "there";
  const closed = view.stage === "cancelled" || view.stage === "ghosted";
  const step = closed ? null : (STEP_OF[view.stage] ?? 1);
  const allDone = view.stage === "posted" || view.stage === "completed";
  const briefNeedsAck = !!view.brief && !view.brief.acknowledged_at && view.stage !== "brief_sent" && !closed;
  const hero = heroCopy(view, first);
  const showChange = !!view.brief && canRequestChange(view.stage);
  const briefIsMain = view.stage === "brief_sent";
  const briefOpen =
    briefIsMain || briefNeedsAck || view.stage === "delivered" || view.stage === "changes_requested";

  return (
    <div className={s.page}>
      <PortalHero step={step} allDone={allDone} title={hero.title} sub={hero.sub} meta={view.handle ? `@${view.handle}` : undefined} />

      <main className={s.body}>
        {briefNeedsAck && (
          <section className={s.card}>
            <p className={`${s.eyebrow} ${s.eyebrowRed}`}>★ We updated your brief</p>
            <p className={s.p}>Have a quick read of the new version below, then let us know it works for you.</p>
            <button className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={() => post("ack")}>
              Got it, looks good
            </button>
          </section>
        )}

        <StagePanel view={view} busy={busy} post={post} setError={setError} setFlash={setFlash} />

        {view.kit && !briefIsMain && !["brief_acknowledged", "dispatched"].includes(view.stage) && <KitCard view={view} />}

        {view.brief ? (
          briefIsMain ? (
            <>
              <BriefCards view={view} />
              {view.kit && <KitCard view={view} />}
              <div className={s.ctaGroup}>
                <button className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} disabled={busy} onClick={() => post("ack")}>
                  I&apos;ve read it, I&apos;m in
                </button>
                {showChange && <ChangeRequest busy={busy} post={post} setFlash={setFlash} />}
              </div>
            </>
          ) : (
            <details className={s.briefFold} open={briefOpen}>
              <summary className={s.briefSummary}>
                <span>
                  <span className={s.eyebrow}>★ Your brief</span>
                  <span className={s.briefMeta}>
                    Version {view.brief.version}
                    {view.brief.sent_at ? ` · sent ${fmtDate(view.brief.sent_at)}` : ""}
                  </span>
                </span>
                <Chevron />
              </summary>
              <div className={s.briefCards}>
                <BriefCards view={view} />
                {showChange && <ChangeRequest busy={busy} post={post} setFlash={setFlash} />}
              </div>
            </details>
          )
        ) : (
          !closed &&
          view.stage !== "agreed" &&
          view.stage !== "brief_draft" && (
            <section className={s.card}>
              <p className={s.eyebrow}>★ Your brief</p>
              <p className={s.p}>We are putting your brief together. We will WhatsApp you the moment it is ready.</p>
            </section>
          )
        )}

        {view.drafts.length > 0 && <DraftHistory view={view} />}

        <PortalFooter />
      </main>

      <div className={s.toastWrap} aria-live="polite">
        {error && (
          <div className={`${s.toast} ${s.toastBad}`} role="alert">
            <span className={s.toastDot} aria-hidden="true" />
            <span className={s.toastText}>{error}</span>
            <button className={s.toastX} onClick={() => setError(null)} aria-label="Dismiss message">
              <XIcon />
            </button>
          </div>
        )}
        {flash && (
          <div className={`${s.toast} ${s.toastGood}`} role="status">
            <span className={s.toastDot} aria-hidden="true" />
            <span className={s.toastText}>{flash}</span>
            <button className={s.toastX} onClick={() => setFlash(null)} aria-label="Dismiss message">
              <XIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero copy per stage
// ---------------------------------------------------------------------------
function heroCopy(view: PortalView, first: string): { title: string[]; sub: React.ReactNode } {
  const due = fmtDate(view.draft_due_at);
  const live = fmtDate(view.go_live_at);
  switch (view.stage) {
    case "agreed":
    case "brief_draft":
      return {
        title: [`Hey ${first},`, "welcome aboard."],
        sub: "Thanks for teaming up with us. We are writing a brief made for your page and will WhatsApp you the link.",
      };
    case "brief_sent":
      return {
        title: [`Hey ${first},`, "let's crunch."],
        sub: "Here's your brief. Read it, tap “I'm in” at the bottom, and we pack your box.",
      };
    case "brief_acknowledged":
      return { title: ["We're packing", "your box."], sub: "Your brief is locked in. We will ship your box soon and share tracking here." };
    case "dispatched":
      return { title: ["Your box", "is coming."], sub: "It has shipped. Tap “My box arrived” the moment it reaches you so your timeline starts." };
    case "delivered":
      return {
        title: ["Show us", "the draft."],
        sub: due ? `Due ${due}. We review every draft within a day.` : "We review every draft within a day.",
      };
    case "changes_requested":
      return { title: ["Nearly there.", "Small tweaks."], sub: "Read our note below, then send the new version here." };
    case "draft_submitted":
      return { title: ["Draft in.", "Hang tight."], sub: "Thank you! The team is watching it now." };
    case "draft_approved":
      return {
        title: ["Approved.", "Go crunch it."],
        sub: live ? `Please go live on ${live}. Quick checklist below.` : "Please go live in the next few days. Quick checklist below.",
      };
    case "posted":
    case "completed":
      return { title: [`Thank you,`, `${first}!`], sub: "Your post is live and we love it. Thanks for crunching with us." };
    default:
      return { title: ["This collab", "is closed."], sub: "If this looks wrong, reply to our WhatsApp message and we will sort it out." };
  }
}

// ---------------------------------------------------------------------------
// Status-aware main panel
// ---------------------------------------------------------------------------
function StagePanel({
  view,
  busy,
  post,
  setError,
  setFlash,
}: {
  view: PortalView;
  busy: boolean;
  post: Post;
  setError: SetMsg;
  setFlash: SetMsg;
}) {
  const due = fmtDate(view.draft_due_at);
  const lastReview = [...view.drafts].reverse().find((d) => d.review_note);

  switch (view.stage) {
    case "agreed":
    case "brief_draft":
      return (
        <section className={s.card}>
          <p className={s.eyebrow}>★ How this works</p>
          <ol className={s.howList}>
            <li>Read your brief here and tap &ldquo;I&apos;m in&rdquo;.</li>
            <li>We ship your PROMUNCH box.</li>
            <li>Make your content and send us the draft on this page.</li>
            <li>Once we approve it, post and paste the link here.</li>
          </ol>
        </section>
      );
    case "brief_sent":
      return null; // the brief itself is the main content, with the CTA under it
    case "brief_acknowledged":
    case "dispatched":
      return (
        <>
          {view.kit ? (
            <KitCard view={view} />
          ) : (
            <section className={s.card}>
              <p className={s.eyebrow}>★ Your PROMUNCH box</p>
              <p className={s.p}>{view.stage === "dispatched" ? "Your box has shipped." : "We are packing it now."}</p>
            </section>
          )}
          <div className={s.ctaGroup}>
            <button className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} disabled={busy} onClick={() => post("received")}>
              My box arrived
            </button>
            <p className={s.ctaHint}>Tap this once the box is in your hands.</p>
          </div>
        </>
      );
    case "delivered":
    case "changes_requested":
      return (
        <>
          {view.stage === "changes_requested" && lastReview?.review_note && (
            <section className={s.card}>
              <p className={`${s.eyebrow} ${s.eyebrowRed}`}>★ Our note on draft {lastReview.version}</p>
              <blockquote className={s.quote}>{lastReview.review_note}</blockquote>
              <p className={s.small}>From Team PROMUNCH</p>
            </section>
          )}
          <section className={s.card}>
            <p className={s.eyebrow}>★ {view.stage === "changes_requested" ? "Send the new version" : "Send your draft"}</p>
            {due && (
              <p className={s.p}>
                Please send it by <strong>{due}</strong>. We review every draft within a day.
              </p>
            )}
            <DraftForm view={view} busy={busy} post={post} setError={setError} setFlash={setFlash} />
          </section>
        </>
      );
    case "draft_submitted":
      return (
        <section className={s.card}>
          <p className={s.status}>
            <span className={`${s.dot} ${s.dotInfo}`} aria-hidden="true" />
            In review
          </p>
          <p className={s.p}>
            We will WhatsApp you within a day, either a go ahead or a small tweak.
          </p>
          <p className={s.strongNote}>Please do not post yet. Wait for our approval.</p>
        </section>
      );
    case "draft_approved":
      return (
        <section className={s.card}>
          <p className={s.eyebrow}>★ Before you hit share</p>
          {view.brief?.content.checklist?.length ? (
            <ul className={s.checks}>
              {view.brief.content.checklist.map((c, i) => (
                <li key={i}>
                  <span className={`${s.check} ${s.checkOn}`} aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.p}>Post it the way we approved it, and tag us so we can cheer you on.</p>
          )}
          <PostForm busy={busy} post={post} />
        </section>
      );
    case "posted":
    case "completed":
      return (
        <section className={s.card}>
          <p className={s.status}>
            <span className={`${s.dot} ${s.dotGood}`} aria-hidden="true" />
            Post received
          </p>
          <p className={s.p}>We will share the numbers with you once it settles.</p>
          {view.post_url && (
            <a className={`${s.btn} ${s.btnLg}`} href={view.post_url} target="_blank" rel="noreferrer">
              View your post
            </a>
          )}
        </section>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Box
// ---------------------------------------------------------------------------
const PACK_TONES: [RegExp, string][] = [
  [/masala/i, "#EF5B31"],
  [/himalayan|rock salt/i, "#1F8E9C"],
  [/crunch/i, "#AF272F"],
  [/chip/i, "#D99A00"],
  [/hamper|gift/i, "#6B3FA0"],
];
const packTone = (title: string) => PACK_TONES.find(([re]) => re.test(title))?.[1] ?? "#4A423C";
const packInitials = (title: string) =>
  title
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "PM";

function KitCard({ view }: { view: PortalView }) {
  const kit = view.kit!;
  const shipping = view.stage === "brief_acknowledged" || view.stage === "dispatched";
  return (
    <section className={s.card}>
      <p className={s.eyebrow}>★ Your PROMUNCH box</p>
      <h2 className={s.h3}>{kit.name}</h2>
      <ul className={s.kit}>
        {kit.items.map((it, i) => (
          <li key={i}>
            <span className={s.pack} style={{ background: packTone(it.title) }} aria-hidden="true">
              {packInitials(it.title)}
            </span>
            <span>
              <span className={s.qty}>{it.qty}×</span> {it.title}
            </span>
          </li>
        ))}
      </ul>
      {view.order_status_url && (
        <a
          className={shipping ? `${s.btn} ${s.btnBlock}` : s.link}
          href={view.order_status_url}
          target="_blank"
          rel="noreferrer"
        >
          Track my box
        </a>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Draft upload / link
// ---------------------------------------------------------------------------
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function DraftForm({
  view,
  busy,
  post,
  setError,
  setFlash,
}: {
  view: PortalView;
  busy: boolean;
  post: Post;
  setError: SetMsg;
  setFlash: SetMsg;
}) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const clearFile = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitLink = async () => {
    if (!url.trim()) return setError("Upload your video or paste the link to your draft first.");
    if (await post("draft", { url: url.trim(), note: note.trim() || null })) setFlash("Draft received. Thank you!");
  };

  const submitUpload = async () => {
    if (!file) return setError("Pick your video first.");
    if (!file.type.startsWith("video/")) return setError("Only video files can be uploaded. For anything else, paste a link.");
    if (file.size > MAX_DRAFT_BYTES) return setError("That video is over 200 MB. Upload it to Google Drive and paste the link instead.");
    setError(null);
    try {
      const r = await fetch(`/api/public/collab/${view.code}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.signedUrl || !j.path) return setError(j.error ?? "Could not start the upload. Please paste a link instead.");
      setProgress(0);
      await putWithProgress(j.signedUrl, file, setProgress);
      setProgress(100);
      if (await post("draft", { storage_path: j.path, note: note.trim() || null })) setFlash("Draft received. Thank you!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload stopped. Check your internet and try again.");
    } finally {
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  return (
    <div className={s.form}>
      {file ? (
        <div className={s.filePicked}>
          <span className={s.fileIcon} aria-hidden="true">
            <VideoIcon />
          </span>
          <span className={s.fileText}>
            <strong>{file.name}</strong>
            <span>{fmtSize(file.size)}</span>
          </span>
          <button className={`${s.btn} ${s.btnSm}`} onClick={clearFile} disabled={uploading}>
            Remove
          </button>
        </div>
      ) : (
        <label className={s.drop}>
          <input
            ref={fileRef}
            className={s.srOnly}
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <UploadIcon />
          <strong>Upload video</strong>
          <span>Up to 200 MB, straight from your phone</span>
        </label>
      )}

      {!file && (
        <>
          <p className={s.or} aria-hidden="true">
            <span>or</span>
          </p>
          <label className={s.field}>
            <span className={s.label}>Paste a link</span>
            <input
              className={s.input}
              type="url"
              inputMode="url"
              placeholder="Google Drive, Instagram or YouTube (unlisted)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={1000}
            />
          </label>
        </>
      )}

      <label className={s.field}>
        <span className={s.label}>Note for us (optional)</span>
        <textarea className={s.textarea} rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>

      {uploading && (
        <div
          className={s.bar}
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? 0}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
      )}
      <button
        className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`}
        disabled={busy || uploading}
        onClick={file ? submitUpload : submitLink}
      >
        {uploading ? `Uploading ${progress}%` : "Send my draft"}
      </button>
    </div>
  );
}

/** PUT the file to the Supabase signed upload URL with upload progress. */
function putWithProgress(signedUrl: string, file: File, onProgress: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              xhr.status === 413
                ? "That video is too big for our storage. Upload it to Google Drive and paste the link instead."
                : "The upload did not finish. Please try again or paste a link.",
            ),
          );
    xhr.onerror = () => reject(new Error("The upload stopped. Check your internet and try again."));
    xhr.send(file);
  });
}

// ---------------------------------------------------------------------------
// Post link
// ---------------------------------------------------------------------------
function PostForm({ busy, post }: { busy: boolean; post: Post }) {
  const [url, setUrl] = useState("");
  return (
    <div className={s.form}>
      <label className={s.field}>
        <span className={s.label}>Posted? Paste the link</span>
        <input
          className={s.input}
          type="url"
          inputMode="url"
          placeholder="https://www.instagram.com/reel/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={500}
        />
      </label>
      <button
        className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`}
        disabled={busy || !url.trim()}
        onClick={() => post("post", { post_url: url.trim() })}
      >
        Submit post link
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change request (modal dialog)
// ---------------------------------------------------------------------------
function ChangeRequest({ busy, post, setFlash }: { busy: boolean; post: Post; setFlash: SetMsg }) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();

  return (
    <>
      <button className={`${s.btn} ${s.btnBlock}`} onClick={() => ref.current?.showModal()}>
        Request a change
      </button>
      <dialog
        ref={ref}
        className={s.dialog}
        aria-labelledby="pm-change-title"
        onClick={(e) => {
          if (e.target === ref.current) close(); // tap on the backdrop
        }}
      >
        <div className={s.dialogIn}>
          <div className={s.dialogHead}>
            <div>
              <h2 id="pm-change-title" className={s.h2}>
                What should change?
              </h2>
              <p className={s.small}>The PROMUNCH team gets this right away and replies on WhatsApp.</p>
            </div>
            <button className={s.iconBtn} onClick={close} aria-label="Close">
              <XIcon />
            </button>
          </div>
          <label className={s.field}>
            <span className={s.label}>Your message</span>
            <textarea
              className={s.textarea}
              rows={5}
              maxLength={1000}
              value={msg}
              placeholder="For example: can I post on the 14th instead?"
              onChange={(e) => setMsg(e.target.value)}
            />
          </label>
          <div className={s.dialogFoot}>
            <button className={s.btn} onClick={close}>
              Cancel
            </button>
            <button
              className={`${s.btn} ${s.btnPrimary}`}
              disabled={busy || !msg.trim()}
              onClick={async () => {
                if (await post("request-change", { message: msg.trim() })) {
                  setMsg("");
                  close();
                  setFlash("Got it. The team will get back to you on WhatsApp.");
                }
              }}
            >
              Send
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Drafts history
// ---------------------------------------------------------------------------
const REVIEW_LABEL = {
  pending: { text: "In review", dot: "dotInfo" },
  approved: { text: "Approved", dot: "dotGood" },
  changes_requested: { text: "Changes asked", dot: "dotWarn" },
} as const;

function DraftHistory({ view }: { view: PortalView }) {
  return (
    <section className={s.card}>
      <p className={s.eyebrow}>★ Your drafts</p>
      <ul className={s.drafts}>
        {[...view.drafts].reverse().map((d) => {
          const st = REVIEW_LABEL[d.review_status] ?? REVIEW_LABEL.pending;
          return (
            <li key={d.version} className={s.draftRow}>
              <div className={s.draftHead}>
                <strong>Draft {d.version}</strong>
                <span className={s.status}>
                  <span className={`${s.dot} ${s[st.dot]}`} aria-hidden="true" />
                  {st.text}
                </span>
              </div>
              <p className={s.small}>
                Sent {fmtDate(d.submitted_at)}
                {d.url ? (
                  <>
                    {" · "}
                    <a className={s.link} href={d.url} target="_blank" rel="noreferrer">
                      Open link
                    </a>
                  </>
                ) : (
                  " · Uploaded video"
                )}
              </p>
              {d.note && <p className={s.small}>Your note: {d.note}</p>}
              {d.review_note && <blockquote className={s.quote}>From Team PROMUNCH: {d.review_note}</blockquote>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------
function BriefCards({ view }: { view: PortalView }) {
  const b = view.brief!;
  const c = b.content;
  const fmt = [
    c.format?.length_sec ? `${c.format.length_sec} sec` : null,
    c.format?.aspect ?? null,
    c.format?.stories ? `${c.format.stories} ${c.format.stories === 1 ? "Story" : "Stories"}` : null,
  ].filter(Boolean);
  const draftDue = c.dates?.draft_due ? (fmtDate(view.draft_due_at) ?? c.dates.draft_due) : null;
  const goLive = view.go_live_at || c.dates?.go_live ? (fmtDate(view.go_live_at) ?? c.dates?.go_live ?? "") : null;

  return (
    <>
      <BriefCard title="The idea">
        <p className={s.lead}>{c.concept}</p>
      </BriefCard>

      <BriefCard title="The details">
        <dl className={s.kv}>
          <dt>Deliverables</dt>
          <dd>{deliverablesLine(view.deliverables)}</dd>
          {fmt.length > 0 && (
            <>
              <dt>Format</dt>
              <dd>{fmt.join(" · ")}</dd>
            </>
          )}
          {draftDue && (
            <>
              <dt>Draft due</dt>
              <dd>{draftDue}</dd>
            </>
          )}
          {goLive && (
            <>
              <dt>Go live</dt>
              <dd>{goLive}</dd>
            </>
          )}
        </dl>
      </BriefCard>

      {c.hooks?.length > 0 && (
        <BriefCard title="Pick a hook for the first 3 seconds">
          <ol className={s.hooks}>
            {c.hooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </BriefCard>
      )}

      {c.script && (
        <BriefCard title="Script, in your own words">
          <div className={s.script}>{c.script}</div>
        </BriefCard>
      )}

      {c.talking_points?.length > 0 && (
        <BriefCard title="Talking points">
          <ul className={s.bullets}>
            {c.talking_points.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </BriefCard>
      )}

      {c.must_say?.length > 0 && (
        <BriefCard title="Say this">
          <ul className={`${s.bullets} ${s.bulletsStrong}`}>
            {c.must_say.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </BriefCard>
      )}

      {c.checklist?.length > 0 && (
        <BriefCard title="Checklist">
          <ul className={s.checks}>
            {c.checklist.map((t, i) => (
              <li key={i}>
                <span className={s.check} aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </BriefCard>
      )}

      {c.donts?.length > 0 && (
        <BriefCard title="Please don't">
          <ul className={s.donts}>
            {c.donts.map((t, i) => (
              <li key={i}>
                <XIcon />
                {t}
              </li>
            ))}
          </ul>
        </BriefCard>
      )}

      {c.usage_rights_text && (
        <BriefCard title="Usage rights">
          <p className={s.p}>{c.usage_rights_text}</p>
        </BriefCard>
      )}

      {b.acknowledged_at && (
        <p className={`${s.status} ${s.ackLine}`}>
          <span className={`${s.dot} ${s.dotGood}`} aria-hidden="true" />
          You confirmed this brief on {fmtDate(b.acknowledged_at)}
        </p>
      )}
    </>
  );
}

function BriefCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={s.card}>
      <h2 className={s.eyebrow}>★ {title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline, Lucide-style 1.75 stroke)
// ---------------------------------------------------------------------------
const ico = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function XIcon() {
  return (
    <svg className={s.ico} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...ico}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function Chevron() {
  return (
    <svg className={s.chev} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...ico}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg className={s.icoLg} viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...ico}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...ico}>
      <path d="m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}
