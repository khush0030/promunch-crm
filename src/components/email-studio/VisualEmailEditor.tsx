"use client";

// Click-to-edit email canvas for automation emails. The email body (inline
// styled HTML from brand-blocks.ts) is shown as it looks; staff click text to
// type, click a button or link to change its words and where it goes, click a
// photo to swap it, and use the bar on each section to move, copy, delete or
// add a section. Merge tags are locked chips. All conversion lives in
// src/lib/email-studio/visual-edit.ts (unit-tested round trip).

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bold, Copy, Image as ImageIcon, Italic, Link2, Plus, Redo2, Trash2, Undo2, UserRound, X } from "lucide-react";
import { EMAIL_COLORS, EMAIL_FONT, EMAIL_FONT_LINK } from "@/lib/email/brand-tokens";
import { BLOCK_TAGS, QUICK_LINKS, STORE_IMAGES, decorate, loadCanvas, markEditable, safeHref, sectionKindsFor, serialize, specialLinkLabel, specialLinks, tagLabel } from "@/lib/email-studio/visual-edit";
import s from "./studio.module.css";

type Props = {
  html: string;
  trigger: string;
  /** Inline tags staff can insert (from mergeTagsFor). */
  tags: { tag: string; label: string }[];
  disabled?: boolean;
  onChange: (html: string) => void;
};

// The clicked element lives in a ref (panelTarget), not in state: React state
// must not hold something we then mutate.
type Panel =
  | { kind: "link"; label: string; href: string; isButton: boolean }
  | { kind: "image"; src: string; alt: string }
  | { kind: "add"; below: boolean }
  | null;

const CANVAS_CSS = `
  html,body{margin:0;padding:0;background:${EMAIL_COLORS.panel};}
  #pm-root{max-width:600px;margin:18px auto 40px;background:#fff;border-radius:14px;padding:28px;box-sizing:border-box;font-family:${EMAIL_FONT};color:${EMAIL_COLORS.ink};}
  #pm-root > *{position:relative;}
  [data-pm-edit]{border-radius:4px;transition:outline-color .1s;}
  [data-pm-edit]:hover{outline:1.5px dashed rgba(175,39,47,.45);outline-offset:3px;cursor:text;}
  [data-pm-edit]:focus{outline:2px solid #AF272F;outline-offset:3px;}
  a{cursor:pointer;}
  img{cursor:pointer;}
  img:hover{outline:3px solid #AF272F;outline-offset:2px;}
  .pm-hover{box-shadow:0 0 0 2px rgba(175,39,47,.25);border-radius:6px;}
  span[data-pm-tag]{background:#FBE9EA;color:#AF272F;border-radius:6px;padding:1px 7px;font-weight:700;font-size:.92em;white-space:nowrap;user-select:all;}
  div[data-pm-tag]{border:2px dashed #AF272F;background:#FFF7F7;color:#AF272F;border-radius:12px;padding:22px 16px;margin:6px 0 20px;text-align:center;font-weight:700;font-size:14px;}
  @media (max-width:640px){#pm-root{margin:0;border-radius:0;padding:20px;}}
`;

const SRC_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${EMAIL_FONT_LINK}"><style>${CANVAS_CSS}</style></head><body><div id="pm-root"></div></body></html>`;

export function VisualEmailEditor({ html, trigger, tags, disabled, onChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(600);
  const [hover, setHover] = useState<{ el: Element; top: number; height: number } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [tagMenu, setTagMenu] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const panelTarget = useRef<Element | null>(null);
  const doc = useCallback(() => frame.current?.contentDocument ?? null, []);
  const root = useCallback(() => frame.current?.contentDocument?.getElementById("pm-root") ?? null, []);
  const openPanel = (p: NonNullable<Panel>, target: Element | null) => {
    panelTarget.current = target;
    setPanel(p);
  };

  const resize = useCallback(() => {
    const d = doc();
    if (d) setHeight(Math.max(400, d.documentElement.scrollHeight));
  }, [doc]);

  const emit = useCallback(() => {
    const r = root();
    if (!r) return;
    const out = serialize(r);
    if (out !== lastEmitted.current) {
      lastEmitted.current = out;
      onChangeRef.current(out);
    }
    resize();
  }, [resize, root]);

  // (Re)load the canvas when the email changes from outside (another email
  // picked, HTML edited in Advanced, reset). Our own edits are skipped.
  useEffect(() => {
    if (!ready) return;
    const r = root();
    if (!r || html === lastEmitted.current) return;
    loadCanvas(r, html);
    if (disabled) r.querySelectorAll("[contenteditable]").forEach((e) => e.setAttribute("contenteditable", "false"));
    lastEmitted.current = serialize(r);
    // A hover bar or open panel on the old content is ignored at render
    // (its element is no longer connected), so no state reset is needed here.
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
  }, [html, ready, disabled, resize, root]);

  // Wire the canvas once the iframe document exists (once per document).
  const wired = useRef<Document | null>(null);
  const onLoad = () => {
    const d = doc();
    const r = root();
    if (!d || !r || wired.current === d) return;
    wired.current = d;
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new (d.defaultView as typeof window).MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(emit, 250);
    });
    mo.observe(r, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "src", "alt"] });

    d.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        d.execCommand("insertLineBreak");
      }
    });
    d.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      d.execCommand("insertText", false, text);
    });
    d.addEventListener("click", (e) => {
      const target = e.target as Element;
      const a = target.closest("a");
      const img = target.closest("img");
      if (a || img) e.preventDefault();
      if (r.getAttribute("data-locked") === "1") return;
      if (img && !a?.closest("[data-pm-edit]")) {
        openPanel({ kind: "image", src: img.getAttribute("src") ?? "", alt: img.getAttribute("alt") ?? "" }, img);
      } else if (a) {
        const isButton = !!a.closest("table") && /display:\s*(block|inline-block)/.test(a.getAttribute("style") ?? "");
        openPanel({ kind: "link", label: a.textContent ?? "", href: a.getAttribute("href") ?? "", isButton }, a);
      }
    });
    d.addEventListener("mouseover", (e) => {
      const sec = topSection(r, e.target as Node);
      if (!sec) return;
      const rect = sec.getBoundingClientRect();
      setHover((h) => (h?.el === sec && h.top === rect.top ? h : { el: sec, top: rect.top, height: rect.height }));
    });
    setReady(true);
  };

  // The iframe can finish loading before React attaches onLoad (server-
  // rendered markup), so also wire on mount when it is already there.
  useEffect(() => {
    const d = doc();
    if (d?.readyState !== "complete" || !root()) return;
    const raf = requestAnimationFrame(onLoad);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = root();
    if (r) r.setAttribute("data-locked", disabled ? "1" : "0");
  }, [disabled, ready, root]);

  // --- formatting (acts on the selection inside the canvas) ---
  const cmd = (name: string) => {
    doc()?.execCommand(name);
    emit();
  };
  const insertTag = (tag: string) => {
    const d = doc();
    const sel = d?.getSelection();
    setTagMenu(false);
    if (!d || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const host = (range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement)?.closest("[data-pm-edit]");
    if (!host) return;
    const wrap = d.createElement("span");
    wrap.textContent = `{{${tag}}}`;
    decorate(wrap);
    const chip = wrap.firstChild!;
    range.deleteContents();
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    emit();
  };

  // --- sections ---
  const move = (el: Element, dir: -1 | 1) => {
    const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    if (dir < 0) sib.before(el);
    else sib.after(el);
    setHover(null);
    emit();
  };
  const duplicate = (el: Element) => {
    el.after(el.cloneNode(true));
    setHover(null);
    emit();
  };
  const remove = (el: Element) => {
    el.remove();
    setHover(null);
    emit();
  };
  const addSection = (after: Element | null, markup: string) => {
    const d = doc();
    const r = root();
    if (!d || !r) return;
    const holder = d.createElement("div");
    holder.innerHTML = markup;
    decorate(holder);
    markEditable(holder);
    const nodes = Array.from(holder.childNodes);
    if (after) after.after(...nodes);
    else r.append(...nodes);
    setPanel(null);
    emit();
    const first = nodes.find((n) => n.nodeType === 1) as HTMLElement | undefined;
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const locked = !!disabled;
  return (
    <div className={s.vee}>
      {!locked && (
        <div className={s.veeBar}>
          <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")}><Bold size={15} /></button>
          <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")}><Italic size={15} /></button>
          <span className={s.veeSep} />
          <div className={s.veeMenuWrap}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTagMenu((v) => !v)}><UserRound size={15} /> Personal detail</button>
            {tagMenu && (
              <div className={s.veeMenu}>
                <span className={s.hint}>Click in the text first, then pick:</span>
                {tags.filter((t) => !(t.tag in BLOCK_TAGS) && !/url$/.test(t.tag)).map((t) => (
                  <button key={t.tag} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertTag(t.tag)}>{t.label}</button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => openPanel({ kind: "add", below: false }, null)}><Plus size={15} /> Add section</button>
          <span className={s.grow} />
          <button type="button" title="Undo" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("undo")}><Undo2 size={15} /></button>
          <button type="button" title="Redo" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("redo")}><Redo2 size={15} /></button>
        </div>
      )}
      {!locked && <div className={s.veeTip}>Click any text to change it. Click a button, link or photo to change it. Hover a section to move, copy or delete it.</div>}

      {panel && (
        <PanelCard panel={panel} trigger={trigger} onClose={() => setPanel(null)}
          onLink={(label, href) => {
            const el = panelTarget.current;
            if (panel.kind !== "link" || !el) return;
            const safe = safeHref(href);
            if (!safe) return "Use a full link starting with https://";
            if (label.trim()) el.textContent = label.trim();
            el.setAttribute("href", safe);
            setPanel(null);
            emit();
            return null;
          }}
          onUnlink={() => {
            const el = panelTarget.current;
            if (panel.kind !== "link" || !el) return;
            el.replaceWith(doc()!.createTextNode(el.textContent ?? ""));
            setPanel(null);
            emit();
          }}
          onImage={(src, alt) => {
            const el = panelTarget.current;
            if (panel.kind !== "image" || !el) return;
            const safe = safeHref(src);
            if (!safe || safe.startsWith("{{")) return "Use a full image link starting with https://";
            el.setAttribute("src", safe);
            el.setAttribute("alt", alt.trim() || "PROMUNCH");
            setPanel(null);
            emit();
            return null;
          }}
          onAdd={(markup) => addSection(panel.kind === "add" && panel.below ? panelTarget.current : null, markup)}
        />
      )}

      <div className={s.veeStage}>
        <iframe ref={frame} title="Email editor" srcDoc={SRC_DOC} onLoad={onLoad} className={s.veeFrame} style={{ height }} />
        {hover && hover.el.isConnected && !locked && (
          <div className={s.veeSection} style={{ top: hover.top, height: hover.height }}>
            <div className={s.veeSectionBar}>
              <button type="button" title="Move up" onClick={() => move(hover.el, -1)}><ArrowUp size={14} /></button>
              <button type="button" title="Move down" onClick={() => move(hover.el, 1)}><ArrowDown size={14} /></button>
              <button type="button" title="Copy" onClick={() => duplicate(hover.el)}><Copy size={14} /></button>
              <button type="button" title="Add a section below" onClick={() => openPanel({ kind: "add", below: true }, hover.el)}><Plus size={14} /></button>
              <button type="button" title="Delete section" className={s.veeDanger} onClick={() => remove(hover.el)}><Trash2 size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function topSection(root: Element, n: Node | null): Element | null {
  let cur: Node | null = n;
  while (cur && cur.parentNode && cur.parentNode !== root) cur = cur.parentNode;
  return cur && cur.parentNode === root && cur.nodeType === 1 ? (cur as Element) : null;
}

function PanelCard({ panel, trigger, onClose, onLink, onUnlink, onImage, onAdd }: {
  panel: NonNullable<Panel>;
  trigger: string;
  onClose: () => void;
  onLink: (label: string, href: string) => string | null | undefined;
  onUnlink: () => void;
  onImage: (src: string, alt: string) => string | null | undefined;
  onAdd: (markup: string) => void;
}) {
  const [label, setLabel] = useState(panel.kind === "link" ? panel.label : "");
  const [href, setHref] = useState(panel.kind === "link" ? panel.href : "");
  const [src, setSrc] = useState(panel.kind === "image" ? panel.src : "");
  const [alt, setAlt] = useState(panel.kind === "image" ? panel.alt : "");
  const [err, setErr] = useState<string | null>(null);

  const special = specialLinks(trigger);
  return (
    <div className={s.veePanel}>
      <div className={s.row} style={{ justifyContent: "space-between" }}>
        <b>{panel.kind === "link" ? (panel.isButton ? "Button" : "Link") : panel.kind === "image" ? "Photo" : "Add a section"}</b>
        <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><X /></button>
      </div>

      {panel.kind === "link" && (
        <>
          <label className={s.field}><span>{panel.isButton ? "Button words" : "Link words"}</span>
            <input className={s.input} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className={s.field}><span>Opens</span>
            <input className={s.input} value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://promunch.in/..." />
          </label>
          <div className={s.veeChips}>
            {special.map((l) => <button key={l.href} type="button" className={href === l.href ? s.on : ""} onClick={() => setHref(l.href)}>{l.label}</button>)}
            {QUICK_LINKS.map((l) => <button key={l.href} type="button" className={href === l.href ? s.on : ""} onClick={() => setHref(l.href)}>{l.label}</button>)}
          </div>
          {/^\{\{/.test(href) && <span className={s.hint}>Goes to: {specialLinkLabel(href) ?? tagLabel(href.replace(/[{}\s]/g, ""))}, different for each customer.</span>}
          {err && <span className={s.veeErr}>{err}</span>}
          <div className={s.row}>
            <button type="button" className="pm2-btn pri" onClick={() => setErr(onLink(label, href) ?? null)}>Done</button>
            {!panel.isButton && <button type="button" className="pm2-btn ghost" onClick={onUnlink}>Remove link</button>}
          </div>
        </>
      )}

      {panel.kind === "image" && (
        <>
          <div className={s.veeImages}>
            {STORE_IMAGES.map((im) => (
              <button key={im.src} type="button" title={im.label} className={src === im.src ? s.on : ""} onClick={() => { setSrc(im.src); setAlt(im.label); }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- store CDN thumbnail */}
                <img src={im.src.replace(/width=\d+/, "width=160")} alt={im.label} />
              </button>
            ))}
          </div>
          <label className={s.field}><span>Or paste an image link</span>
            <input className={s.input} value={src} onChange={(e) => setSrc(e.target.value)} placeholder="https://cdn.shopify.com/..." />
          </label>
          <label className={s.field}><span>Describe the photo <em>shown if images are off</em></span>
            <input className={s.input} value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
          {err && <span className={s.veeErr}>{err}</span>}
          <div className={s.row}><button type="button" className="pm2-btn pri" onClick={() => setErr(onImage(src, alt) ?? null)}><ImageIcon size={14} /> Use this photo</button></div>
        </>
      )}

      {panel.kind === "add" && (
        <div className={s.veeAdd}>
          {sectionKindsFor(trigger).map((k) => (
            <button key={k.key} type="button" onClick={() => onAdd(k.html())}>
              <b>{k.label}</b>
              <span>{k.hint}</span>
            </button>
          ))}
        </div>
      )}
      {panel.kind === "link" && <span className={s.hint}><Link2 size={12} /> Links must start with https://</span>}
    </div>
  );
}
