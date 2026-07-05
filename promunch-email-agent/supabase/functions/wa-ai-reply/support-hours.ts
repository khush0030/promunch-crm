// Support-hours prompt note.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

// ---- Support hours --------------------------------------------------------
// Returns a prompt note when the human team is OFFLINE (so the bot can set
// follow-up expectations when it escalates), or null when open. Configurable:
//   WA_BUSINESS_TZ (default Asia/Kolkata), WA_BUSINESS_OPEN/CLOSE ("HH:MM"),
//   WA_BUSINESS_DAYS (CSV, 0=Sun..6=Sat; default Mon–Sat).
export function supportHoursNote(): string | null {
  try {
    const tz = Deno.env.get("WA_BUSINESS_TZ") ?? "Asia/Kolkata";
    const open = Deno.env.get("WA_BUSINESS_OPEN") ?? "10:00";
    const close = Deno.env.get("WA_BUSINESS_CLOSE") ?? "19:00";
    const days = (Deno.env.get("WA_BUSINESS_DAYS") ?? "1,2,3,4,5,6")
      .split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = wd[get("weekday")] ?? 1;
    const nowMin = Number(get("hour")) * 60 + Number(get("minute"));
    const toMin = (s: string) => { const [a, b] = s.split(":").map(Number); return a * 60 + (b || 0); };

    const isOpen = days.includes(dow) && nowMin >= toMin(open) && nowMin < toMin(close);
    if (isOpen) return null;

    const label = `${fmtHour(open)}–${fmtHour(close)} ${tzAbbr(tz)}, ${dayRange(days)}`;
    return `SUPPORT HOURS: The human team is currently OFFLINE (hours: ${label}). You STILL fully help the customer now using the knowledge base and tools. But if you raise a ticket or hand off, gently let them know the team is offline and will follow up when they're back (${label}) — one short line, don't over-apologise.`;
  } catch {
    return null;
  }
}
function fmtHour(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}
function tzAbbr(tz: string): string {
  return tz === "Asia/Kolkata" ? "IST" : tz;
}
function dayRange(days: number[]): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const key = [...new Set(days)].sort((a, b) => a - b).join(",");
  if (key === "1,2,3,4,5,6") return "Mon–Sat";
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "0,1,2,3,4,5,6") return "every day";
  return key.split(",").map((d) => names[Number(d)]).join(", ");
}
