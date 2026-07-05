// Robust parsing of the model's final JSON decision.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

// Parse the model's final JSON decision — robustly. The model is told to emit
// JSON only, but in practice it wraps it in ```json fences or (most often) puts
// a literal newline inside the "reply" string, which is invalid JSON and used
// to make JSON.parse throw → a false "AI output unparseable" ticket on a reply
// that was actually fine. We try hard before giving up: strip fences, isolate
// the object, repair the common breakage, and as a last resort pull the reply
// text out directly so the customer is always answered.
export function parseDecision(s: string): any {
  if (!s) return null;
  // strip ```json ... ``` / ``` ... ``` fences the model sometimes adds
  let t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const open = t.indexOf("{");
  const close = t.lastIndexOf("}");
  if (open === -1 || close <= open) return looseReply(s);
  const body = t.slice(open, close + 1);

  return tryJson(body) ?? tryJson(repairJson(body)) ?? looseReply(body);
}

function tryJson(s: string): any {
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

// Repair almost-JSON: escape raw newlines/tabs that sit INSIDE a string literal
// (the model's #1 mistake — multi-line replies), then drop trailing commas.
function repairJson(s: string): string {
  let res = "";
  let inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { res += ch; esc = false; continue; }
    if (ch === "\\") { res += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; res += ch; continue; }
    if (inStr && (ch === "\n" || ch === "\r")) { res += "\\n"; continue; }
    if (inStr && ch === "\t") { res += "\\t"; continue; }
    res += ch;
  }
  return res.replace(/,\s*([}\]])/g, "$1");
}

// Last resort: pull just the "reply" out of broken output so we never go silent
// and never raise a spurious "unparseable" ticket when a real reply was present.
function looseReply(s: string): any {
  const m = s.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  const reply = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return { reply, handoff: /"handoff"\s*:\s*true/.test(s), ticket: null };
}
