// Support-hours prompt note.
//
// Returns a prompt note when the human team is OFFLINE (so the bot can set
// call-back expectations when it escalates), or null when open. Hours (Khush,
// 2026-09-05): Mon to Fri 10:00 to 18:00, Sat 10:00 to 17:00, Sun closed.
// Configurable: WA_BUSINESS_TZ, WA_BUSINESS_OPEN, WA_BUSINESS_CLOSE,
// WA_BUSINESS_SAT_CLOSE ("HH:MM"), WA_BUSINESS_DAYS (CSV, 0=Sun..6=Sat).
export function supportHoursNote(): string | null {
  try {
    const tz = Deno.env.get("WA_BUSINESS_TZ") ?? "Asia/Kolkata";
    const open = Deno.env.get("WA_BUSINESS_OPEN") ?? "10:00";
    const close = Deno.env.get("WA_BUSINESS_CLOSE") ?? "18:00";
    const satClose = Deno.env.get("WA_BUSINESS_SAT_CLOSE") ?? "17:00";
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
    const todayClose = dow === 6 ? satClose : close;

    const isOpen = days.includes(dow) && nowMin >= toMin(open) && nowMin < toMin(todayClose);
    if (isOpen) return null;

    return `SUPPORT HOURS: The team is offline right now (${supportHoursLabel()}). Still help fully now. If you raise a ticket or hand off, say in one short line that the team will call back within those hours.`;
  } catch {
    return null;
  }
}

// Human-readable hours, used in the prompt note and the KB. Kept here so the
// number lives in one place.
export function supportHoursLabel(): string {
  const open = Deno.env.get("WA_BUSINESS_OPEN") ?? "10:00";
  const close = Deno.env.get("WA_BUSINESS_CLOSE") ?? "18:00";
  const satClose = Deno.env.get("WA_BUSINESS_SAT_CLOSE") ?? "17:00";
  return `Mon to Fri ${fmtHour(open)} to ${fmtHour(close)}, Sat ${fmtHour(open)} to ${fmtHour(satClose)} IST, Sun closed`;
}

function fmtHour(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}
