"use client";

import { useRef, useState } from "react";
import type { PortalView } from "@/lib/influencers/types";
import { MAX_DRAFT_BYTES, canRequestChange } from "@/lib/influencers/portal-rules";
import { deliverablesLine } from "@/lib/influencers/brief-content";
import s from "./portal.module.css";

type Post = (path: string, body?: Record<string, unknown>) => Promise<boolean>;

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
    : null;

const STEPS = [
  { key: "brief", label: "Brief", stages: ["agreed", "brief_draft", "brief_sent"] },
  { key: "box", label: "Box", stages: ["brief_acknowledged", "dispatched"] },
  { key: "draft", label: "Draft", stages: ["delivered", "changes_requested"] },
  { key: "review", label: "Review", stages: ["draft_submitted"] },
  { key: "live", label: "Go live", stages: ["draft_approved"] },
  { key: "done", label: "Done", stages: ["posted", "completed"] },
];

export default function CreatorPortal({ initialView }: { initialView: PortalView }) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

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
  const stepIdx = STEPS.findIndex((st) => st.stages.includes(view.stage));
  const briefNeedsAck = !!view.brief && !view.brief.acknowledged_at && view.stage !== "brief_sent" && !closed;

  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.brand}>PROMUNCH</div>
        <div className={s.tag}>Your Munchy Pal</div>
      </header>

      <main className={s.main}>
        <section className={s.hero}>
          <p className={s.eyebrow}>Creator collab{view.handle ? ` · @${view.handle}` : ""}</p>
          <h1 className={s.h1}>Hi {first}, welcome to your PROMUNCH collab</h1>
          <p className={s.lede}>
            Everything you need lives on this page: your brief, your box and your posting checklist. Bookmark it, we will
            WhatsApp you whenever something changes.
          </p>
          {!closed && (
            <ol className={s.steps} aria-label="Collab progress">
              {STEPS.map((st, i) => (
                <li
                  key={st.key}
                  className={`${s.step} ${i < stepIdx ? s.stepDone : ""} ${i === stepIdx ? s.stepNow : ""}`}
                  aria-current={i === stepIdx ? "step" : undefined}
                >
                  <span className={s.dot}>{i < stepIdx ? <Tick /> : i + 1}</span>
                  <span className={s.stepLabel}>{st.label}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}
        {flash && (
          <div className={s.flash} role="status">
            {flash}
          </div>
        )}

        {briefNeedsAck && (
          <section className={`${s.card} ${s.action}`}>
            <h2 className={s.h2}>We updated your brief</h2>
            <p className={s.p}>Have a quick read of the new version below, then let us know it works for you.</p>
            <button className={s.btn} disabled={busy} onClick={() => post("ack")}>
              Got it, looks good
            </button>
          </section>
        )}

        <ActionCard view={view} busy={busy} post={post} setError={setError} setFlash={setFlash} />

        {view.kit && (
          <section className={s.card}>
            <h2 className={s.h2}>Your PROMUNCH box</h2>
            <p className={s.muted}>{view.kit.name}</p>
            <ul className={s.kit}>
              {view.kit.items.map((it, i) => (
                <li key={i}>
                  <span className={s.qty}>{it.qty}×</span> {it.title}
                </li>
              ))}
            </ul>
            {view.order_status_url && (
              <a className={s.link} href={view.order_status_url} target="_blank" rel="noreferrer">
                Track your box
              </a>
            )}
          </section>
        )}

        {view.brief ? (
          <BriefView view={view} />
        ) : (
          !closed && (
            <section className={s.card}>
              <h2 className={s.h2}>Your brief</h2>
              <p className={s.p}>We are putting your brief together. We will WhatsApp you the moment it is ready.</p>
            </section>
          )
        )}

        {view.brief && canRequestChange(view.stage) && (
          <ChangeRequest busy={busy} post={post} setFlash={setFlash} />
        )}

        {view.drafts.length > 0 && (
          <section className={s.card}>
            <h2 className={s.h2}>Your drafts</h2>
            <ul className={s.drafts}>
              {[...view.drafts].reverse().map((d) => (
                <li key={d.version} className={s.draftRow}>
                  <div className={s.draftHead}>
                    <strong>Draft {d.version}</strong>
                    <span className={`${s.chip} ${s[`chip_${d.review_status}`]}`}>
                      {d.review_status === "pending" ? "In review" : d.review_status === "approved" ? "Approved" : "Changes asked"}
                    </span>
                  </div>
                  <div className={s.muted}>
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
                  </div>
                  {d.note && <p className={s.small}>Your note: {d.note}</p>}
                  {d.review_note && <p className={s.review}>From Team PROMUNCH: {d.review_note}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className={s.foot}>
          <p>Questions? Just reply to our WhatsApp message, a real person reads every one.</p>
          <p className={s.sign}>Team PROMUNCH, Your Munchy Pal</p>
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status-aware action card
// ---------------------------------------------------------------------------
function ActionCard({
  view,
  busy,
  post,
  setError,
  setFlash,
}: {
  view: PortalView;
  busy: boolean;
  post: Post;
  setError: (e: string | null) => void;
  setFlash: (e: string | null) => void;
}) {
  const due = fmtDate(view.draft_due_at);
  const live = fmtDate(view.go_live_at);
  const lastReview = [...view.drafts].reverse().find((d) => d.review_note);

  switch (view.stage) {
    case "agreed":
    case "brief_draft":
      return (
        <Card title="Your brief is on its way" tone="calm">
          <p className={s.p}>Thanks for teaming up with us. We are writing a brief made for your page. Watch WhatsApp for the link.</p>
        </Card>
      );
    case "brief_sent":
      return (
        <Card title="Step 1: read your brief" tone="act">
          <p className={s.p}>
            Scroll down for the idea, hooks and script. If it all works for you, tap below and we will pack your box.
          </p>
          <button className={s.btn} disabled={busy} onClick={() => post("ack")}>
            I have read the brief and I am in
          </button>
          <p className={s.hint}>Want something changed? Use &ldquo;Ask for a change&rdquo; under the brief.</p>
        </Card>
      );
    case "brief_acknowledged":
    case "dispatched":
      return (
        <Card title={view.stage === "dispatched" ? "Your box is on the way" : "We are packing your box"} tone="calm">
          <p className={s.p}>
            {view.stage === "dispatched"
              ? "Your PROMUNCH box has shipped. Tap below the moment it reaches you so your timeline starts."
              : "Your brief is locked in. We will ship your box soon and share tracking here."}
          </p>
          {view.order_status_url && (
            <a className={s.btnGhost} href={view.order_status_url} target="_blank" rel="noreferrer">
              Track my box
            </a>
          )}
          <button className={s.btn} disabled={busy} onClick={() => post("received")}>
            My box arrived
          </button>
        </Card>
      );
    case "delivered":
    case "changes_requested":
      return (
        <Card title={view.stage === "changes_requested" ? "Small tweaks, then send it again" : "Time to create"} tone="act">
          {view.stage === "changes_requested" && lastReview?.review_note && (
            <p className={s.review}>From Team PROMUNCH: {lastReview.review_note}</p>
          )}
          {due && (
            <p className={s.p}>
              Please send your draft by <strong>{due}</strong>. We review every draft within a day.
            </p>
          )}
          <DraftForm view={view} busy={busy} post={post} setError={setError} setFlash={setFlash} />
        </Card>
      );
    case "draft_submitted":
      return (
        <Card title="We are reviewing your draft" tone="calm">
          <p className={s.p}>Thank you! The team is watching it now and will WhatsApp you within a day, either a go ahead or a small tweak.</p>
          <p className={s.hint}>Please do not post yet. Wait for our approval.</p>
        </Card>
      );
    case "draft_approved":
      return (
        <Card title="Approved! You are good to post" tone="act">
          <p className={s.p}>{live ? <>Please go live on <strong>{live}</strong>.</> : "Please go live in the next few days."} Quick checklist before you hit share:</p>
          {view.brief?.content.checklist?.length ? (
            <ul className={s.checks}>
              {view.brief.content.checklist.map((c, i) => (
                <li key={i}>
                  <Tick /> {c}
                </li>
              ))}
            </ul>
          ) : null}
          <PostForm busy={busy} post={post} />
        </Card>
      );
    case "posted":
    case "completed":
      return (
        <Card title="Thank you, you are a star" tone="done">
          <p className={s.p}>
            Your post is live and we love it. We will share the numbers with you once it settles. Thanks for crunching with
            us!
          </p>
          {view.post_url && (
            <a className={s.link} href={view.post_url} target="_blank" rel="noreferrer">
              View your post
            </a>
          )}
        </Card>
      );
    default:
      return (
        <Card title="This collab is closed" tone="calm">
          <p className={s.p}>If this looks wrong, reply to our WhatsApp message and we will sort it out.</p>
        </Card>
      );
  }
}

function Card({ title, tone, children }: { title: string; tone: "act" | "calm" | "done"; children: React.ReactNode }) {
  return (
    <section className={`${s.card} ${s.action} ${s[`tone_${tone}`]}`}>
      <h2 className={s.h2}>{title}</h2>
      {children}
    </section>
  );
}

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
  setError: (e: string | null) => void;
  setFlash: (e: string | null) => void;
}) {
  const [mode, setMode] = useState<"link" | "upload">("link");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submitLink = async () => {
    if (!url.trim()) return setError("Paste the link to your draft first.");
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
      <div className={s.seg} role="tablist">
        <button role="tab" aria-selected={mode === "link"} className={mode === "link" ? s.segOn : ""} onClick={() => setMode("link")}>
          Paste a link
        </button>
        <button role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? s.segOn : ""} onClick={() => setMode("upload")}>
          Upload video
        </button>
      </div>
      {mode === "link" ? (
        <label className={s.field}>
          <span>Link to your draft</span>
          <input
            type="url"
            inputMode="url"
            placeholder="Google Drive, unlisted YouTube or Instagram draft link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={1000}
          />
        </label>
      ) : (
        <label className={s.field}>
          <span>Your video (up to 200 MB)</span>
          <input ref={fileRef} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      )}
      <label className={s.field}>
        <span>Anything we should know? (optional)</span>
        <textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      {uploading && (
        <div className={s.bar} aria-label="Upload progress">
          <div style={{ width: `${progress}%` }} />
        </div>
      )}
      <button className={s.btn} disabled={busy || uploading} onClick={mode === "link" ? submitLink : submitUpload}>
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

function PostForm({ busy, post }: { busy: boolean; post: Post }) {
  const [url, setUrl] = useState("");
  return (
    <div className={s.form}>
      <label className={s.field}>
        <span>Once it is live, paste your post link</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://www.instagram.com/reel/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={500}
        />
      </label>
      <button className={s.btn} disabled={busy || !url.trim()} onClick={() => post("post", { post_url: url.trim() })}>
        Submit post link
      </button>
    </div>
  );
}

function ChangeRequest({ busy, post, setFlash }: { busy: boolean; post: Post; setFlash: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  if (!open) {
    return (
      <button className={s.textBtn} onClick={() => setOpen(true)}>
        Ask for a change to the brief
      </button>
    );
  }
  return (
    <section className={s.card}>
      <h2 className={s.h2}>Ask for a change</h2>
      <p className={s.p}>Tell us what you would like to tweak. The team will get back to you on WhatsApp.</p>
      <label className={s.field}>
        <span>Your message</span>
        <textarea rows={4} maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} />
      </label>
      <div className={s.row}>
        <button className={s.btnGhost} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className={s.btn}
          disabled={busy || !msg.trim()}
          onClick={async () => {
            if (await post("request-change", { message: msg.trim() })) {
              setMsg("");
              setOpen(false);
              setFlash("Got it. The team will get back to you on WhatsApp.");
            }
          }}
        >
          Send request
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------
function BriefView({ view }: { view: PortalView }) {
  const b = view.brief!;
  const c = b.content;
  const fmt = [
    c.format?.length_sec ? `${c.format.length_sec} sec` : null,
    c.format?.aspect ?? null,
    c.format?.stories ? `${c.format.stories} ${c.format.stories === 1 ? "Story" : "Stories"}` : null,
  ].filter(Boolean);
  return (
    <section className={`${s.card} ${s.brief}`}>
      <div className={s.briefHead}>
        <h2 className={s.h2}>Your brief</h2>
        <span className={s.muted}>
          Version {b.version}
          {b.sent_at ? ` · ${fmtDate(b.sent_at)}` : ""}
        </span>
      </div>

      <div className={s.facts}>
        <Fact label="Deliverables" value={deliverablesLine(view.deliverables)} />
        {c.dates?.draft_due && <Fact label="Draft due" value={fmtDate(view.draft_due_at) ?? c.dates.draft_due} />}
        {(view.go_live_at || c.dates?.go_live) && <Fact label="Go live" value={fmtDate(view.go_live_at) ?? c.dates.go_live ?? ""} />}
        {fmt.length > 0 && <Fact label="Format" value={fmt.join(" · ")} />}
      </div>

      <Block title="The idea">
        <p className={s.p}>{c.concept}</p>
      </Block>

      {c.hooks?.length > 0 && (
        <Block title="Pick a hook for the first 3 seconds">
          <ol className={s.hooks}>
            {c.hooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </Block>
      )}

      {c.script && (
        <Block title="Script, in your own words">
          <div className={s.script}>{c.script}</div>
        </Block>
      )}

      {c.talking_points?.length > 0 && (
        <Block title="Talking points">
          <ul className={s.bullets}>
            {c.talking_points.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Block>
      )}

      {c.must_say?.length > 0 && (
        <Block title="Must say or show">
          <ul className={s.mustSay}>
            {c.must_say.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Block>
      )}

      {c.checklist?.length > 0 && (
        <Block title="Posting checklist">
          <ul className={s.checks}>
            {c.checklist.map((t, i) => (
              <li key={i}>
                <Tick /> {t}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.donts?.length > 0 && (
        <Block title="Please avoid">
          <ul className={s.donts}>
            {c.donts.map((t, i) => (
              <li key={i}>
                <Cross /> {t}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.usage_rights_text && (
        <Block title="Usage rights">
          <p className={s.p}>{c.usage_rights_text}</p>
        </Block>
      )}

      {b.acknowledged_at && <p className={s.ack}><Tick /> You confirmed this brief on {fmtDate(b.acknowledged_at)}</p>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.block}>
      <h3 className={s.h3}>{title}</h3>
      {children}
    </div>
  );
}

function Tick() {
  return (
    <svg className={s.icoTick} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Cross() {
  return (
    <svg className={s.icoCross} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
