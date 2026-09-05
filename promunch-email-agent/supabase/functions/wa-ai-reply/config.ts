// Env-driven constants shared by the wa-ai-reply modules.

export const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
// gpt-4.1 follows the brevity + never-re-ask rules far better than the mini
// tier at this volume (a few hundred turns a month). WA_AI_MODEL overrides.
export const MODEL = Deno.env.get("WA_AI_MODEL") ?? "gpt-4.1";
// KB char budget. The Master KB + the auto-synced product catalogue together
// fit under this, so retrieveKb prompt-stuffs the whole KB (no stale-chunk
// risk); semantic retrieval only kicks in once the KB outgrows it. Prompt
// caching makes the repeated KB cheap (cached_tokens ~90% in prod).
export const KB_CHAR_BUDGET = 28_000;
export const MAX_TOOL_TURNS = 4;
export const CATALOG_ID = Deno.env.get("WHATSAPP_CATALOG_ID") ?? "";
// Meta limits a product_list to 30 products across 10 sections.
export const MAX_CATALOG_ITEMS = 30;
export const MAX_CATALOG_SECTIONS = 10;
// Replies longer than this get one deterministic "shorten" pass before send.
export const MAX_REPLY_CHARS = 320;
