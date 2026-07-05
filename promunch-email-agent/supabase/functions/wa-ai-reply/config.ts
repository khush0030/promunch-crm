// Env-driven constants shared by the wa-ai-reply modules.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

export const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
export const MODEL = Deno.env.get("WA_AI_MODEL") ?? "gpt-4o-mini";
// 12K chars ≈ 3K tokens. The agent re-sends the KB on every tool-loop turn,
// so this is the single biggest input-cost lever for this function — was
// 60K, dropped to 12K (~5× cheaper per conversation).
export const KB_CHAR_BUDGET = 12_000;
export const MAX_TOOL_TURNS = 4;
export const CATALOG_ID = Deno.env.get("WHATSAPP_CATALOG_ID") ?? "";
// Meta limits a product_list to 30 products across 10 sections.
export const MAX_CATALOG_ITEMS = 30;
export const MAX_CATALOG_SECTIONS = 10;
