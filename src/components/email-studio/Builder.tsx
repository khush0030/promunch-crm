"use client";

// Email Studio drag-and-drop builder. Left: the email as a list of blocks
// (drag to reorder, click to edit, add from the palette) plus the email style.
// Right: a live, pixel-true preview rendered by the SAME code the sender uses
// (src/lib/email-studio/render.ts). Clicking a block in the preview selects it.
// Controlled: the parent owns the design and saves it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, Copy, GripVertical, Trash2, Monitor, Smartphone, Palette,
  Image as ImageIcon, Type, Heading1, MousePointerClick, ShoppingBag, Ticket, Minus, MoveVertical, Share2, BadgeCheck, Upload,
} from "lucide-react";
import {
  BLOCK_LABELS, makeBlock, newId,
  type Block, type BlockType, type BrandKit, type EmailDesign, type ProductInfo, type Theme,
} from "@/lib/email-studio/design";
import { renderDesign, SAMPLE_MERGE, mergeText, MERGE_TAGS } from "@/lib/email-studio/render";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getJson } from "./api";
import s from "./studio.module.css";

const ICONS: Record<BlockType, ReactNode> = {
  logo: <BadgeCheck />,
  heading: <Heading1 />,
  text: <Type />,
  image: <ImageIcon />,
  button: <MousePointerClick />,
  products: <ShoppingBag />,
  coupon: <Ticket />,
  divider: <Minus />,
  spacer: <MoveVertical />,
  social: <Share2 />,
};
const PALETTE: BlockType[] = ["heading", "text", "image", "button", "products", "coupon", "divider", "spacer", "logo", "social"];

export function useProducts() {
  return useQuery({
    queryKey: ["email-studio-products"],
    queryFn: () => getJson<{ products: ProductInfo[] }>("/api/email-studio/products").then((r) => r.products),
    staleTime: 5 * 60_000,
  });
}

function peek(b: Block, products: Record<string, ProductInfo>): string {
  switch (b.type) {
    case "heading":
    case "text":
      return b.text.replace(/[*[\]]|\(.*?\)/g, "").slice(0, 60);
    case "button":
      return b.label;
    case "image":
      return b.src ? b.alt || "Image" : "No image yet";
    case "products":
      return b.items.length ? b.items.map((i) => products[i]?.title ?? "?").join(", ") : "No products picked";
    case "coupon":
      return b.code;
    case "spacer":
      return `${b.size}px`;
    default:
      return "";
  }
}

export function Builder({
  design,
  onChange,
  brand,
  subject,
  previewText,
}: {
  design: EmailDesign;
  onChange: (d: EmailDesign) => void;
  brand: BrandKit;
  subject?: string;
  previewText?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const productsQ = useProducts();
  const productMap = useMemo(() => Object.fromEntries((productsQ.data ?? []).map((p) => [p.id, p])), [productsQ.data]);

  const blocks = design.blocks;
  const setBlocks = (next: Block[]) => onChange({ ...design, blocks: next });
  const update = (id: string, patch: Partial<Block>) =>
    setBlocks(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };
  const add = (type: BlockType) => {
    const b = makeBlock(type);
    const i = selected ? blocks.findIndex((x) => x.id === selected) : -1;
    const next = [...blocks];
    next.splice(i >= 0 ? i + 1 : next.length, 0, b);
    setBlocks(next);
    setSelected(b.id);
  };
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = blocks.findIndex((b) => b.id === dragId);
    const moved = blocks[from];
    const rest = blocks.filter((b) => b.id !== dragId);
    const to = rest.findIndex((b) => b.id === targetId);
    rest.splice(to, 0, moved);
    setBlocks(rest);
  };

  const html = useMemo(
    () =>
      renderDesign(design, {
        brand,
        products: productMap,
        unsubscribeUrl: "#",
        previewText: previewText ? mergeText(previewText, SAMPLE_MERGE) : undefined,
        merge: SAMPLE_MERGE,
        annotate: { selected },
      }),
    [design, brand, productMap, previewText, selected],
  );

  return (
    <div className={s.builder}>
      <div className={s.side}>
        <div className={s.block + (selected === "theme" ? ` ${s.on}` : "")}>
          <div className={s.blockHead} onClick={() => setSelected(selected === "theme" ? null : "theme")}>
            <span className={s.grip}><Palette size={15} /></span>
            <span className={s.blockName}>Email style</span>
            <span className={s.blockPeek}>Colours and font</span>
          </div>
          {selected === "theme" && (
            <div className={s.blockBody}>
              <ThemeEditor theme={design.theme} brand={brand} onChange={(theme) => onChange({ ...design, theme })} />
            </div>
          )}
        </div>

        <div className={s.blocks}>
          {blocks.map((b, i) => (
            <div
              key={b.id}
              className={[s.block, selected === b.id ? s.on : "", dragId === b.id ? s.drag : "", overId === b.id && dragId !== b.id ? s.over : ""].join(" ")}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(b.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(b.id);
                setDragId(null);
                setOverId(null);
              }}
            >
              <div className={s.blockHead} onClick={() => setSelected(selected === b.id ? null : b.id)}>
                <span
                  className={s.grip}
                  draggable
                  onDragStart={(e) => {
                    setDragId(b.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  title="Drag to move"
                  aria-label="Drag to move"
                >
                  <GripVertical size={15} />
                </span>
                <span className={s.blockName}>{BLOCK_LABELS[b.type]}</span>
                <span className={s.blockPeek}>{peek(b, productMap)}</span>
                <button type="button" className={s.iconBtn} disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(b.id, -1); }} aria-label="Move up"><ArrowUp /></button>
                <button type="button" className={s.iconBtn} disabled={i === blocks.length - 1} onClick={(e) => { e.stopPropagation(); move(b.id, 1); }} aria-label="Move down"><ArrowDown /></button>
                <button
                  type="button"
                  className={s.iconBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    const copy = { ...b, id: newId() } as Block;
                    const next = [...blocks];
                    next.splice(i + 1, 0, copy);
                    setBlocks(next);
                    setSelected(copy.id);
                  }}
                  aria-label="Duplicate"
                >
                  <Copy />
                </button>
                <button
                  type="button"
                  className={s.iconBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBlocks(blocks.filter((x) => x.id !== b.id));
                    if (selected === b.id) setSelected(null);
                  }}
                  aria-label="Delete block"
                >
                  <Trash2 />
                </button>
              </div>
              {selected === b.id && (
                <div className={s.blockBody}>
                  <BlockEditor block={b} onChange={(p) => update(b.id, p)} products={productsQ.data ?? []} productsLoading={productsQ.isLoading} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="pm2-panel" style={{ padding: 12 }}>
          <div className={s.hint} style={{ marginBottom: 8 }}>
            Add a block{selected && selected !== "theme" ? " below the selected one" : " at the end"}:
          </div>
          <div className={s.palette}>
            {PALETTE.map((t) => (
              <button key={t} type="button" className={s.paletteItem} onClick={() => add(t)}>
                {ICONS[t]}
                {BLOCK_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={s.previewWrap}>
        <div className={s.previewBar}>
          <span>Live preview (sample name: {SAMPLE_MERGE.first_name})</span>
          <span style={{ marginLeft: "auto" }} className="pm2-seg">
            <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} aria-label="Desktop preview"><Monitor size={14} /></button>
            <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} aria-label="Mobile preview"><Smartphone size={14} /></button>
          </span>
        </div>
        {(subject !== undefined || previewText !== undefined) && (
          <div className={s.inboxLine}>
            <b>PROMUNCH</b> · <b>{mergeText(subject || "(no subject yet)", SAMPLE_MERGE)}</b>{" "}
            <span>{previewText ? `· ${mergeText(previewText, SAMPLE_MERGE)}` : ""}</span>
          </div>
        )}
        <PreviewFrame html={html} mobile={device === "mobile"} onPick={(id) => setSelected(id)} />
      </div>
    </div>
  );
}

/** Writes into the iframe document in place so editing doesn't reset scroll. */
export function PreviewFrame({ html, mobile, onPick }: { html: string; mobile?: boolean; onPick?: (id: string) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);
  const [height, setHeight] = useState(700);

  useEffect(() => {
    const frame = ref.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    const y = frame.contentWindow?.scrollY ?? 0;
    doc.open();
    doc.write(html);
    doc.close();
    frame.contentWindow?.scrollTo(0, y);
    doc.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-bid]");
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (a) e.preventDefault();
      if (el && pickRef.current) pickRef.current(el.getAttribute("data-bid") || "");
    });
    const measure = () => setHeight(Math.max(640, doc.documentElement.scrollHeight));
    measure();
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
  }, [html]);

  return <iframe ref={ref} title="Email preview" className={`${s.frame} ${mobile ? s.frameMobile : ""}`} style={{ height }} />;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="pm2-seg">
      {options.map((o) => (
        <button key={String(o.v)} type="button" className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

const ALIGN = [
  { v: "left" as const, label: "Left" },
  { v: "center" as const, label: "Centre" },
];

function RichText({ value, onChange, rows = 6 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after: string, placeholder: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || placeholder;
    onChange(value.slice(0, a) + before + sel + after + value.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  };
  const insert = (text: string) => {
    const el = ref.current;
    const a = el?.selectionStart ?? value.length;
    onChange(value.slice(0, a) + text + value.slice(el?.selectionEnd ?? a));
  };
  return (
    <div className={s.stack} style={{ gap: 6 }}>
      <div className={s.toolbar}>
        <button type="button" onClick={() => wrap("**", "**", "bold text")}><b>B</b></button>
        <button type="button" onClick={() => wrap("*", "*", "italic text")}><i>I</i></button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt("Link address (https://...)", "https://promunch.in");
            if (url) wrap("[", `](${url})`, "link text");
          }}
        >
          Link
        </button>
        {MERGE_TAGS.slice(0, 1).map((m) => (
          <button key={m.tag} type="button" onClick={() => insert(m.tag)} title={m.label}>+ First name</button>
        ))}
      </div>
      <textarea ref={ref} className={s.textarea} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className={s.hint}>Blank line = new paragraph. {"{{first_name|there}}"} shows the customer&apos;s first name, or &quot;there&quot; if we don&apos;t have it.</div>
    </div>
  );
}

async function uploadImage(file: File): Promise<string> {
  const r = await fetch("/api/email-studio/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(j.error || "Could not prepare the upload.");
  const { error } = await createSupabaseBrowserClient()
    .storage.from("email-assets")
    .uploadToSignedUrl(j.path, j.token, file, { contentType: file.type });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return j.publicUrl as string;
}

export function ImagePicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={s.stack} style={{ gap: 6 }}>
      {value && <img src={value} alt="" className={s.imgPreview} />}
      <div className={s.row}>
        <label className="pm2-btn sm" style={{ cursor: busy ? "wait" : "pointer" }}>
          <Upload size={14} /> {busy ? "Uploading…" : value ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                onChange(await uploadImage(f));
              } catch (x) {
                setErr(x instanceof Error ? x.message : "Upload failed");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <span className={s.hint}>JPG/PNG/GIF, under 5 MB, 1200px wide looks sharp.</span>
      </div>
      <input className={s.input} placeholder="…or paste an image address (https://)" value={value} onChange={(e) => onChange(e.target.value.trim())} />
      {err && <div className={s.hint} style={{ color: "var(--pm-terra)" }}>{err}</div>}
    </div>
  );
}

function ProductPicker({
  value,
  onChange,
  products,
  loading,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  products: ProductInfo[];
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const list = products.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));
  if (loading) return <div className={s.hint}>Loading products…</div>;
  return (
    <div className={s.stack} style={{ gap: 6 }}>
      <input className={s.input} placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className={s.products}>
        {list.map((p) => {
          const idx = value.indexOf(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`${s.product} ${idx >= 0 ? s.picked : ""} ${p.inStock ? "" : s.out}`}
              onClick={() => onChange(idx >= 0 ? value.filter((v) => v !== p.id) : [...value, p.id])}
              title={p.inStock ? p.title : `${p.title} (sold out, will be skipped)`}
            >
              {idx >= 0 && <span className={s.productBadge}>{idx + 1}</span>}
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div style={{ aspectRatio: 1 }} />}
              <span className={s.productName}>{p.title}</span>
              <span style={{ color: "var(--pm-hint)" }}>{p.price != null ? `₹${p.price}` : ""}{p.inStock ? "" : " · sold out"}</span>
            </button>
          );
        })}
      </div>
      <div className={s.hint}>Tap to add or remove. Numbers show the order. Prices and stock refresh from Shopify at send time; sold-out items are skipped.</div>
    </div>
  );
}

function BlockEditor({
  block: b,
  onChange,
  products,
  productsLoading,
}: {
  block: Block;
  onChange: (p: Partial<Block>) => void;
  products: ProductInfo[];
  productsLoading: boolean;
}) {
  switch (b.type) {
    case "logo":
      return (
        <>
          <div className={s.hint}>Uses the logo from Settings, Brand &amp; email (or the PROMUNCH wordmark if none is uploaded).</div>
          <div className={s.row}>
            <Seg value={b.align} options={ALIGN} onChange={(align) => onChange({ align })} />
            <label className={s.row} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={b.showTagline} onChange={(e) => onChange({ showTagline: e.target.checked })} /> Show tagline
            </label>
          </div>
        </>
      );
    case "heading":
      return (
        <>
          <Field label="Heading"><input className={s.input} value={b.text} onChange={(e) => onChange({ text: e.target.value })} /></Field>
          <div className={s.row}>
            <Seg value={b.size} options={[{ v: "xl", label: "Big" }, { v: "lg", label: "Medium" }, { v: "md", label: "Small" }]} onChange={(size) => onChange({ size })} />
            <Seg value={b.align} options={ALIGN} onChange={(align) => onChange({ align })} />
          </div>
        </>
      );
    case "text":
      return (
        <>
          <RichText value={b.text} onChange={(text) => onChange({ text })} />
          <Seg value={b.align} options={ALIGN} onChange={(align) => onChange({ align })} />
        </>
      );
    case "image":
      return (
        <>
          <ImagePicker value={b.src} onChange={(src) => onChange({ src })} />
          <Field label="Description" hint="shown if images are off"><input className={s.input} value={b.alt} onChange={(e) => onChange({ alt: e.target.value })} /></Field>
          <Field label="Link when tapped" hint="optional"><input className={s.input} placeholder="https://promunch.in/..." value={b.href} onChange={(e) => onChange({ href: e.target.value.trim() })} /></Field>
          <label className={s.row} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={!b.padded} onChange={(e) => onChange({ padded: !e.target.checked })} /> Full width (edge to edge)
          </label>
        </>
      );
    case "button":
      return (
        <>
          <Field label="Button text"><input className={s.input} value={b.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
          <Field label="Link"><input className={s.input} value={b.href} onChange={(e) => onChange({ href: e.target.value.trim() })} /></Field>
          <div className={s.row}>
            <Seg value={b.variant} options={[{ v: "solid", label: "Filled" }, { v: "outline", label: "Outline" }]} onChange={(variant) => onChange({ variant })} />
            <Seg value={b.align} options={ALIGN} onChange={(align) => onChange({ align })} />
          </div>
        </>
      );
    case "products":
      return (
        <>
          <ProductPicker value={b.items} onChange={(items) => onChange({ items })} products={products} loading={productsLoading} />
          <div className={s.row}>
            <span className={s.hint}>Per row</span>
            <Seg value={b.columns} options={[{ v: 1, label: "1" }, { v: 2, label: "2" }, { v: 3, label: "3" }]} onChange={(columns) => onChange({ columns })} />
            <label className={s.row} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={b.showPrice} onChange={(e) => onChange({ showPrice: e.target.checked })} /> Show price
            </label>
          </div>
          <Field label="Button text" hint="empty = no button"><input className={s.input} value={b.buttonLabel} onChange={(e) => onChange({ buttonLabel: e.target.value })} /></Field>
        </>
      );
    case "coupon":
      return (
        <>
          <Field label="Coupon code" hint="must exist in Shopify"><input className={s.input} value={b.code} onChange={(e) => onChange({ code: e.target.value.toUpperCase().replace(/\s/g, "") })} /></Field>
          <Field label="Headline"><input className={s.input} value={b.headline} onChange={(e) => onChange({ headline: e.target.value })} /></Field>
          <Field label="Small print"><input className={s.input} value={b.note} onChange={(e) => onChange({ note: e.target.value })} /></Field>
        </>
      );
    case "divider":
      return <div className={s.hint}>A thin line to separate sections.</div>;
    case "spacer":
      return (
        <Field label="Height" hint={`${b.size}px`}>
          <input type="range" min={8} max={96} step={4} value={b.size} onChange={(e) => onChange({ size: Number(e.target.value) })} />
        </Field>
      );
    case "social":
      return (
        <>
          <div className={s.hint}>Shows the Instagram, Facebook, YouTube and website links saved in Settings, Brand &amp; email.</div>
          <Seg value={b.align} options={ALIGN} onChange={(align) => onChange({ align })} />
        </>
      );
  }
}

const SWATCHES: { key: keyof Omit<Theme, "font">; label: string }[] = [
  { key: "background", label: "Page background" },
  { key: "content", label: "Email background" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Accent" },
  { key: "button", label: "Button" },
  { key: "buttonText", label: "Button text" },
];

function ThemeEditor({ theme, brand, onChange }: { theme: Theme; brand: BrandKit; onChange: (t: Theme) => void }) {
  return (
    <>
      <div className={s.swatches}>
        {SWATCHES.map((w) => (
          <label key={w.key} className={s.swatch}>
            <input type="color" value={theme[w.key]} onChange={(e) => onChange({ ...theme, [w.key]: e.target.value })} />
            {w.label}
          </label>
        ))}
      </div>
      <div className={s.row}>
        <span className={s.hint}>Font</span>
        <Seg value={theme.font} options={[{ v: "sans", label: "Clean" }, { v: "serif", label: "Classic" }]} onChange={(font) => onChange({ ...theme, font })} />
        <button type="button" className="pm2-btn sm ghost" onClick={() => onChange({ ...brand.theme })}>Use brand colours</button>
      </div>
    </>
  );
}
