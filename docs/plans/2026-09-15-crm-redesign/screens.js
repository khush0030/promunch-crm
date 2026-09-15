/* PROMUNCH CRM redesign prototype. All figures are sample data. */
(function () {
  "use strict";

  /* ───────── icons ───────── */
  const I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h8l-1 8 11-13h-8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 8H7"/><circle cx="10" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l2 3h4l2-3h5"/></svg>',
    mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10v4l11 4V6z"/><path d="M14 8a4 4 0 0 1 0 8M7 14v5h3l1-4"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12l3 3 5-5"/><circle cx="12" cy="12" r="9"/></svg>',
    cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h5l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/></svg>',
    ref: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
  };

  const NAV = [
    { hub: "Today", hc: "#1D1517", hc2: "#AF272F", ic: I.home, items: ["Home", "Needs attention", "Ask Maya"] },
    { hub: "Sales", hc: "#AF272F", ic: I.cart, items: ["Overview", "Web store", "Amazon", "Orders & COD"] },
    { hub: "Inbox", hc: "#0A9CB8", ic: I.inbox, items: ["Conversations", "Tickets", "Email drafts"] },
    { hub: "Marketing", hc: "#FFC905", ic: I.mega, items: ["Campaigns", "Automations", "Audience", "Templates", "Sign-up popup"] },
    { hub: "Partners", hc: "#E86A24", ic: I.hand, items: ["B2B leads", "Deals", "Creators"] },
    { hub: "System", hc: "#8A7F83", ic: I.cog, items: ["Bot knowledge", "Health", "Settings", "Activity"] },
  ];
  const BADGES = { "Needs attention": 7, Conversations: 12, Tickets: 3, "Orders & COD": 4 };

  /* ───────── helpers ───────── */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
  const pill = (k, t, tp) => `<span class="pill ${k}"${tip(tp)}>${t}</span>`;
  const dl = (v, tp) => {
    const k = v === 0 ? "flat" : v > 0 ? "good" : "bad";
    const s = v === 0 ? "±0%" : (v > 0 ? "▲ " : "▼ ") + Math.abs(v) + "%";
    return `<span class="dl ${k}"${tip(tp || "Change vs the previous period of the same length")}>${s}</span>`;
  };
  const kpi = (l, v, d, s, tp) => `<div class="kpi"${tip(tp)}><div class="l">${l}</div><div class="v num">${v}</div><div class="s">${d !== null && d !== undefined ? dl(d) : ""}${s ? `<span>${s}</span>` : ""}</div></div>`;
  const btn = (t, k = "", ic = "") => `<span class="btn ${k}">${ic}${t}</span>`;
  const seg = (opts, on) => `<span class="seg">${opts.map((o) => `<span class="${o === on ? "on" : ""}">${o}</span>`).join("")}</span>`;
  const chips = (arr, on) => `<div class="chips">${arr.map((c) => { const [t, n] = Array.isArray(c) ? c : [c]; return `<span class="chip ${t === on ? "on" : ""}">${t}${n != null ? `<em>${n}</em>` : ""}</span>`; }).join("")}</div>`;
  const panel = (title, body, o = {}) => `<div class="panel${o.cls ? " " + o.cls : ""}"><div class="p-head"><h3>${title}</h3>${o.basis ? `<span class="basis">${o.basis}</span>` : ""}${o.right ? `<span class="r">${o.right}</span>` : ""}</div><div class="p-body">${body}</div>${o.foot ? `<div class="p-foot">${o.foot}</div>` : ""}</div>`;
  const rupee = (n) => "₹" + n.toLocaleString("en-IN");
  const L = (n) => (n >= 100000 ? "₹" + (n / 100000).toFixed(n >= 1000000 ? 1 : 2).replace(/\.?0+$/, "") + "L" : n >= 1000 ? "₹" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : "₹" + n);

  function tbl(cols, rows, card) {
    const t = `<div class="tbl-wrap ${card ? "swap" : ""}"><table class="tbl"><thead><tr>${cols.map((c) => `<th class="${c.n ? "n" : ""}">${c.h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr class="${r.hl ? "hl" : ""}">${r.c.map((x, i) => `<td class="${cols[i].n ? "n" : ""}">${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    if (!card) return t;
    return t + `<div class="cards">${rows.map((r) => { const c = card(r); return `<div class="rowc"><div class="t">${c.t}</div><div class="v">${c.v || ""}</div><div class="m">${c.m || ""}</div></div>`; }).join("")}</div>`;
  }
  const hbars = (items, max) => `<div class="hb">${items.map((x) => `<span class="lab" title="${esc(x.l)}">${x.l}</span><span class="trk"${tip(x.tp)}><span class="fill" style="width:${(x.v / max) * 100}%;background:${x.c || "var(--cyan)"}"></span></span><span class="val">${x.t}${x.s ? `<small>${x.s}</small>` : ""}</span>`).join("")}</div>`;
  const stack = (parts) => `<div class="stack">${parts.map((p) => `<div style="flex:${p.v};background:${p.c}"${tip(p.l + ": " + p.t)}></div>`).join("")}</div><div class="legend">${parts.map((p) => `<span><i style="background:${p.c}"></i>${p.l} <b class="num">${p.t}</b></span>`).join("")}</div>`;
  const funnel = (steps) => { const max = steps[0].v; return `<div class="funnel">${steps.map((s, i) => `<div class="fn"><span>${s.l}</span><span class="bar"${tip(s.tp)}><div style="width:${(s.v / max) * 100}%;background:${s.c || "var(--cyan)"}"></div><span>${s.t}</span></span><span class="rate">${i ? `<b>${Math.round((s.v / steps[i - 1].v) * 100)}%</b> of previous` : "&nbsp;"}</span></div>`).join("")}</div>`; };
  const meter = (pct, c) => `<div class="meter"><div style="width:${pct}%;${c ? "background:" + c : ""}"></div></div>`;
  const uptime = (arr) => `<div class="uptime">${arr.map((k) => `<i class="${k}"></i>`).join("")}</div>`;
  const grade = (g) => `<span class="grade ${g.toLowerCase()}">${g}</span>`;

  function linechart(series, xlab, o = {}) {
    const W = 640, H = o.h || 220, pl = 46, pr = 90, pt = 14, pb = 26;
    const all = series.flatMap((s) => s.v);
    const max = Math.max(...all) * 1.12, n = series[0].v.length;
    const x = (i) => pl + (i / (n - 1)) * (W - pl - pr), y = (v) => pt + (1 - v / max) * (H - pt - pb);
    const ticks = 4; let g = "";
    for (let t = 0; t <= ticks; t++) { const v = (max / ticks) * t; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${pl - 6}" y="${y(v) + 3.5}" text-anchor="end">${o.fmt ? o.fmt(v) : Math.round(v)}</text>`; }
    const xl = xlab.map((l, i) => (i % Math.ceil(n / 6) === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>` : "")).join("");
    const paths = series.map((s) => { const d = s.v.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" "); const last = s.v[n - 1]; return `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.dash ? 1.5 : 2}" ${s.dash ? 'stroke-dasharray="4 4"' : ""} stroke-linejoin="round"/>${s.dash ? "" : `<circle cx="${x(n - 1)}" cy="${y(last)}" r="3.5" fill="${s.c}" stroke="var(--surface)" stroke-width="2"/>`}<text class="lbl" x="${W - pr + 8}" y="${y(last) + 4}" style="fill:${s.dash ? "var(--ink-3)" : "var(--ink)"}">${s.n}${s.dash ? "" : " " + (o.fmt ? o.fmt(last) : last)}</text>`; }).join("");
    const hits = xlab.map((l, i) => `<rect class="hit" x="${x(i) - (W - pl - pr) / n / 2}" y="${pt}" width="${(W - pl - pr) / n}" height="${H - pt - pb}"${tip(l + ": " + series.map((s) => s.n + " " + (o.fmt ? o.fmt(s.v[i]) : s.v[i])).join(" · "))}/>`).join("");
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "line chart")}">${g}${xl}${paths}${hits}</svg></div>`;
  }
  function barchart(cats, series, o = {}) {
    const W = 640, H = o.h || 200, pl = 46, pr = 12, pt = 14, pb = 26;
    const max = Math.max(...cats.map((_, i) => series.reduce((a, s) => a + s.v[i], 0))) * 1.1;
    const bw = (W - pl - pr) / cats.length, y = (v) => pt + (1 - v / max) * (H - pt - pb);
    let g = ""; for (let t = 0; t <= 4; t++) { const v = (max / 4) * t; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${pl - 6}" y="${y(v) + 3.5}" text-anchor="end">${o.fmt ? o.fmt(v) : Math.round(v)}</text>`; }
    const bars = cats.map((c, i) => { let acc = 0; const segs = series.map((s) => { const v = s.v[i], top = y(acc + v), h = y(acc) - top; acc += v; return `<rect x="${pl + i * bw + bw * 0.22}" y="${top}" width="${bw * 0.56}" height="${Math.max(h - 2, 0)}" fill="${s.c}" rx="${o.r || 0}"/>`; }).join(""); const tot = acc; return segs + `<text x="${pl + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${c}</text>` + (o.labels ? `<text class="lbl" x="${pl + i * bw + bw / 2}" y="${y(tot) - 5}" text-anchor="middle">${o.fmt ? o.fmt(tot) : tot}</text>` : "") + `<rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}"${tip(c + ": " + series.map((s) => s.n + " " + (o.fmt ? o.fmt(s.v[i]) : s.v[i])).join(" · "))}/>`; }).join("");
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "bar chart")}">${g}${bars}</svg></div>${series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.c}"></i>${s.n}</span>`).join("")}</div>` : ""}`;
  }

  /* ───────── app shell ───────── */
  function shell(o) {
    const hub = NAV.find((h) => h.hub === o.hub);
    const side = NAV.map((h) => {
      const on = h === hub;
      const head = `<div class="a-grp" style="--hc:${h.hc}"><i></i>${h.hub}${on ? "" : `<span style="margin-left:auto;opacity:.6">${h.items.length}</span>`}</div>`;
      if (!on) return head;
      return head + h.items.map((it) => `<div class="a-item ${it === o.item ? "on" : ""}" style="--hc2:${h.hc2 || h.hc}">${h.ic}${it}${BADGES[it] ? `<span class="bd">${BADGES[it]}</span>` : ""}</div>`).join("");
    }).join("");
    const tabs = o.tabs ? `<div class="a-tabs">${o.tabs.map((t) => { const [name, on, n] = t; return `<span class="${on ? "on" : ""}">${name}${n != null ? `<em>${n}</em>` : ""}</span>`; }).join("")}</div>` : "";
    const mnav = ["Today", "Sales", "Inbox", "Marketing", "More"].map((m) => { const h = NAV.find((x) => x.hub === m) || { ic: I.more }; const on = m === o.hub || (m === "More" && ["Partners", "System"].includes(o.hub)); const b = m === "Inbox" ? 12 : m === "Today" ? 7 : 0; return `<span class="${on ? "on" : ""}">${h.ic}${m}${b ? `<span class="bd">${b}</span>` : ""}</span>`; }).join("");
    return `<div class="app" style="--hc:${hub.hc}">
      <aside class="a-side"><div class="a-logo"><img src="logo.png" alt=""><b>PROMUNCH</b></div><div class="a-search">${I.search}Search or jump to<kbd>⌘K</kbd></div>${side}<div class="a-me"><span class="av" style="background:#FFC905">KM</span><span>Khush<br><span style="color:var(--side-ink-2);font-size:12px">Owner</span></span></div></aside>
      <div class="a-main">
        <div class="mtop"><img src="logo.png" alt=""><b>${o.hub === "Today" ? "PROMUNCH" : o.hub}</b><span class="ic">${I.search}${I.bell}</span></div>
        <div class="a-top"><div><div class="a-crumb"><i></i>${o.crumb || hub.hub + " · " + o.item}</div><h1 class="a-h1">${o.title}</h1></div><div class="a-actions">${o.actions || ""}</div></div>
        ${tabs}
        <div class="a-body">${o.body}</div>
      </div>
      <nav class="mnav">${mnav}</nav>
      ${o.overlay || ""}
    </div>`;
  }

  /* ───────── sample data ───────── */
  const days = Array.from({ length: 30 }, (_, i) => (i + 1) + " Sep".replace("Sep", i < 15 ? "Aug" : "Sep")).map((_, i) => { const d = new Date(2026, 7, 17 + i); return d.getDate() + " " + ["Aug", "Sep"][d.getMonth() - 7]; });
  const rev30 = [21, 19, 24, 26, 22, 31, 28, 25, 23, 27, 34, 30, 26, 29, 33, 38, 31, 27, 30, 35, 41, 37, 33, 29, 36, 44, 39, 35, 38, 42].map((v) => v * 1000);
  const prev30 = rev30.map((v, i) => Math.round(v * (0.82 + Math.sin(i / 3) * 0.08)));
  const amz30 = rev30.map((v, i) => Math.round(v * 0.34 + (i % 5) * 900));

  /* ───────── screens ───────── */
  const S = [];
  const add = (s) => S.push(s);

  /* 1 Home */
  add({ id: "home", hub: "Today", item: "Home", title: "Home", route: "/dashboard",
    was: ["Sine-wave revenue chart and decorative sparklines", "11 blocks mixing 30-day, 24-hour and all-time numbers", "Action items at the bottom of the page"],
    now: ["Four numbers, then what needs doing, then one honest chart. Nothing else", "Every number obeys the period picker and shows change vs previous period", "Attention items are one line each; detail is one tap away"],
    render: () => shell({ hub: "Today", item: "Home", title: "Tuesday, 15 September", crumb: "Today · Good afternoon, Khush",
      actions: seg(["7d", "30d", "90d"], "30d") + `<span class="cmp">vs previous 30</span>`,
      body: `
      <div class="kpis">${kpi("Sales", "₹9.4L", 18, "926 orders", "Web store + Amazon + HYPD. Excludes ₹0.01 creator seed orders and refunds.")}${kpi("Web store", "₹6.4L", 24, "612 orders")}${kpi("Amazon payout", "₹1.9L", -6, "after fees", "What Amazon pays out after referral, FBA and closing fees. Before your product cost.")}${kpi("Repeat buyers", "31%", 4, "of orders")}</div>
      ${panel("Needs a decision · 7", `<div style="margin:-12px -16px -16px">
          <div class="att"><span class="ic crit">₹</span><div><div class="t">Masala Mania out of stock on Amazon</div><div class="c">Losing ₹2.1k profit a day · 120 units arrive in ~6 days</div></div><span class="amt d-only">&nbsp;</span>${btn("Restock", "sm")}</div>
          <div class="att"><span class="ic crit">4</span><div><div class="t">4 COD orders need a confirmation call</div><div class="c">₹3,596 on hold · oldest 19 hours</div></div><span class="amt d-only">&nbsp;</span>${btn("Call list", "sm pri")}</div>
          <div class="att"><span class="ic warn">3</span><div><div class="t">3 tickets open over 4 hours</div><div class="c">With Narendra · 2 damaged packs, 1 wrong flavour</div></div><span class="amt d-only">&nbsp;</span>${btn("Tickets", "sm")}</div>
          <div class="att"><span class="ic info">?</span><div><div class="t">Bot couldn't answer 6 questions</div><div class="c">"Is it keto?" ×3 · delivery to Assam ×2</div></div><span class="amt d-only">&nbsp;</span>${btn("Answer", "sm")}</div>
        </div>`, { foot: `<span class="lnk">All 7 →</span><span class="sp faint">Edamame launch paused by Meta cap, resumes 10:00 · 8 carts unreachable</span>` })}
      <div class="g21">
      ${panel("Daily sales", linechart([{ n: "This period", c: "var(--s-web)", v: rev30 }, { n: "Previous", c: "var(--ink-3)", v: prev30, dash: true }], days, { fmt: L, aria: "Daily sales, last 30 days vs previous 30" }), { basis: "₹ per day · all channels" })}
      ${panel("By channel", stack([{ l: "Web", v: 64, t: "₹6.0L", c: "var(--s-web)" }, { l: "Amazon", v: 24, t: "₹2.3L", c: "var(--s-amz)" }, { l: "HYPD", v: 12, t: "₹1.1L", c: "var(--s-hypd)" }]) + `<div class="row" style="margin-top:16px;font-size:13.5px;gap:14px"><span><b class="num">38</b> <span class="muted">chats today</span></span><span><b class="num">92%</b> <span class="muted">by bot</span></span><span><b class="num">11 min</b> <span class="muted">human reply</span></span></div>`, { basis: "30 days · gross" })}
      </div>` }) });

  /* 2 Needs attention */
  add({ id: "attention", hub: "Today", item: "Needs attention", title: "Needs attention", route: "/dashboard/attention",
    was: ["Attention items scattered: sidebar badges, Home panel, per-module banners", "No money attached, so nothing is prioritised"],
    now: ["One list sorted by rupees at stake, then age. One line each, one button each", "On phone: icon, title, one line of context, button. Nothing else", "Snoozed and done stay visible for the day"],
    render: () => shell({ hub: "Today", item: "Needs attention", title: "7 to decide", crumb: "Today · Needs attention",
      actions: chips([["Open", 7], ["Snoozed", 2], ["Done today", 11]], "Open"),
      body: `${panel("Money at risk · ₹14.5k", `<div style="margin:-12px -16px -16px">
        <div class="att"><span class="ic crit">₹</span><div><div class="t">Masala Mania out of stock on Amazon</div><div class="c">₹2.1k profit lost per day · 120 units arrive ~6 days</div></div><span class="amt d-only">&nbsp;</span>${btn("Restock", "sm")}</div>
        <div class="att"><span class="ic crit">4</span><div><div class="t">4 COD orders need a call</div><div class="c">₹3,596 on hold · oldest 19h</div></div><span class="amt d-only">&nbsp;</span>${btn("Call list", "sm pri")}</div>
        <div class="att"><span class="ic warn">8</span><div><div class="t">8 abandoned carts can't be reached</div><div class="c">₹8,760 · not on WhatsApp, no email</div></div><span class="amt d-only">&nbsp;</span>${btn("Review", "sm")}</div></div>`)}
      ${panel("Customers waiting", `<div style="margin:-12px -16px -16px">
        <div class="att"><span class="ic warn">3</span><div><div class="t">3 tickets past the 4-hour target</div><div class="c">#118, #119 damaged pack · #121 wrong flavour · Narendra</div></div><span class="amt d-only">&nbsp;</span>${btn("Tickets", "sm")}</div>
        <div class="att"><span class="ic info">2</span><div><div class="t">2 email replies ready to approve</div><div class="c">Wholesale, Nashik · Return #2198</div></div><span class="amt d-only">&nbsp;</span>${btn("Review", "sm")}</div></div>`)}
      ${panel("Marketing", `<div style="margin:-12px -16px -16px">
        <div class="att"><span class="ic info">!</span><div><div class="t">Edamame launch paused by Meta's daily cap</div><div class="c">Resumes 10:00 · 1,180 still to reach</div></div><span class="amt d-only">&nbsp;</span>${btn("Snooze", "sm ghost")}</div>
        <div class="att"><span class="ic info">?</span><div><div class="t">Bot couldn't answer 6 questions</div><div class="c">"Is it keto?" ×3 · Assam delivery ×2 · bulk ×1</div></div><span class="amt d-only">&nbsp;</span>${btn("Answer", "sm")}</div></div>`)}` }) });

  /* 3 Ask Maya */
  add({ id: "maya", hub: "Today", item: "Ask Maya", title: "Ask Maya", route: "/dashboard/assistant",
    was: ["Generic chat window with 4 suggestion cards; answers are text only", "No link from an answer to the screen that has the detail"],
    now: ["A single centred column, no boxes around boxes. Your question in ink, Maya's answer as prose with one card of numbers", "Every answer names its source and links to the screen behind it", "Suggestions are the questions the business asks weekly"],
    render: () => shell({ hub: "Today", item: "Ask Maya", title: "Ask Maya", crumb: "Today · Ask Maya", actions: btn("New conversation", "ghost d-only", I.plus),
      body: `<div class="maya-wrap">
        <div class="maya-q"><div>Which campaign made the most money last month, and what did it cost?</div></div>
        <div class="maya-ans"><span class="who">M</span><div>
          <p><b>Rakhi Hamper reminder</b> made the most: <b class="num">₹1,42,300</b> from 96 orders, for <b class="num">₹2,310</b> in WhatsApp fees. That's ₹62 back for every ₹1 spent.</p>
          <div class="card">${hbars([{ l: "Rakhi Hamper", v: 142300, t: "₹1.42L", s: "96 orders", c: "var(--s-wa)" }, { l: "Edamame launch", v: 38400, t: "₹38k", s: "41", c: "var(--s-wa)" }, { l: "Restock nudge", v: 21800, t: "₹22k", s: "22", c: "var(--s-wa)" }, { l: "Review ask", v: 9200, t: "₹9k", s: "3", c: "var(--s-wa)" }], 142300)}<div class="row" style="margin-top:12px;font-size:12.5px"><span class="faint">Revenue through campaign links · August</span><span class="lnk sp">Open campaigns →</span></div></div>
        </div></div>
        <div class="maya-q"><div>Should I run it again for Diwali?</div></div>
        <div class="maya-ans"><span class="who">M</span><div>
          <p>Yes, to a warmer list. 71% of Rakhi orders came from people who bought in the last 90 days. The cold half delivered at 38% and bought almost nothing.</p>
          <p>I can draft a Diwali version to the 1,240 people in <b>Loyal + Recent buyers</b>. Want me to?</p>
          <div class="row">${btn("Draft it", "pri sm")}${btn("Show the segment", "sm")}</div>
        </div></div>
        <div class="composer"><span class="inp">Ask about sales, customers, stock, campaigns or the bot…</span><div class="row"><span class="chip">Amazon vs last month</span><span class="chip">Top 20 customers</span><span class="chip">Anything broken?</span>${btn("", "pri sm sp", I.send)}</div></div>
      </div>` }) });

  /* 4 Sales overview */
  add({ id: "sales", hub: "Sales", item: "Overview", title: "Sales overview", route: "/dashboard/sales",
    was: ["No cross-channel sales view. Home, Shopify and Amazon each compute revenue their own way", "Channel logic differs between pages (UTM first vs source first)", "No previous-period comparison anywhere"],
    now: ["One place for total sales, by channel, with one definition used everywhere", "Period picker drives every number; each one shows change", "New vs returning revenue and average order, which the API already returns"],
    render: () => shell({ hub: "Sales", item: "Overview", title: "Sales overview", actions: seg(["7d", "30d", "90d", "12m"], "30d") + `<span class="cmp">vs previous 30</span>` + btn("Export", "ghost d-only", I.dl),
      body: `<div class="kpis">${kpi("Total sales", "₹9.4L", 18, "926 orders")}${kpi("Average order", "₹1,014", 3, "per order")}${kpi("New customers", "418", 22, "first order ever")}${kpi("Returning revenue", "₹3.1L", 9, "33% of sales")}</div>
      <div class="g21">${panel("Sales by channel per week", barchart(["Wk 34", "Wk 35", "Wk 36", "Wk 37"], [{ n: "Web store", c: "var(--s-web)", v: [138000, 152000, 161000, 189000] }, { n: "Amazon", c: "var(--s-amz)", v: [58000, 61000, 54000, 57000] }, { n: "HYPD", c: "var(--s-hypd)", v: [22000, 31000, 28000, 29000] }], { fmt: L, labels: true, aria: "Weekly sales by channel" }), { basis: "gross · ₹ per week" })}
      ${panel("Channel scorecard", tbl([{ h: "Channel" }, { h: "Sales", n: 1 }, { h: "Change", n: 1 }, { h: "Orders", n: 1 }, { h: "AOV", n: 1 }], [
        { c: [`<span class="legend" style="margin:0"><span><i style="background:var(--s-web)"></i>Web store</span></span>`, "₹6.0L", dl(24), "612", "₹980"] },
        { c: [`<span class="legend" style="margin:0"><span><i style="background:var(--s-amz)"></i>Amazon</span></span>`, "₹2.3L", dl(-6), "204", "₹1,127"] },
        { c: [`<span class="legend" style="margin:0"><span><i style="background:var(--s-hypd)"></i>HYPD</span></span>`, "₹1.1L", dl(31), "110", "₹1,000"] },
      ], (r) => ({ t: r.c[0], v: r.c[1], m: r.c[2] + " · " + r.c[3] + " orders · AOV " + r.c[4] })), { basis: "30 days" })}</div>
      ${panel("Top products", tbl([{ h: "Product" }, { h: "Units", n: 1 }, { h: "Sales", n: 1 }, { h: "Share", n: 1 }, { h: "Trend", n: 1 }], [
        { c: ["Edamame Beans Masala Mania 100g", "1,842", "₹2.9L", "31%", dl(41)] }, { c: ["Soya Sticks Peri Peri 80g", "1,310", "₹1.7L", "18%", dl(6)] }, { c: ["Crunchies Cheese 60g", "1,105", "₹1.2L", "13%", dl(-4)] }, { c: ["Protein Chips Tangy Tomato", "980", "₹1.1L", "12%", dl(12)] }, { c: ["Rakhi Hamper", "210", "₹1.0L", "11%", dl(0)] },
      ], (r) => ({ t: r.c[0], v: r.c[2], m: r.c[1] + " units · " + r.c[3] + " of sales · " + r.c[4] })), { basis: "30 days · all channels" })}` }) });

  /* 5 Web store */
  add({ id: "web", hub: "Sales", item: "Web store", title: "Web store", route: "/dashboard/shopify-attribution",
    was: ["10 KPI cards: revenue and AOV each shown twice; snapshot row ignores the period picker", "'Medium', 'first-touch', 'utm_campaign' jargon"],
    now: ["4 numbers, then one bar chart answering 'where did orders come from', then one on new vs returning", "On phone each bar gets its own line: name above, bar and rupees below, nothing truncated", "Untracked orders shown as their own bar, so the gap is honest"],
    render: () => shell({ hub: "Sales", item: "Web store", title: "Web store", actions: seg(["7d", "30d", "90d"], "30d") + `<span class="cmp">vs previous 30</span>`,
      body: `<div class="kpis">${kpi("Web sales", "₹6.0L", 24, "612 orders")}${kpi("Average order", "₹980", 2, "")}${kpi("Repeat buyers", "34%", 5, "of orders")}${kpi("Untracked", "28%", -7, "orders with no source", "Orders where Shopify recorded no traffic source. Lower is better.")}</div>
      ${panel("Where orders came from", hbars([{ l: "Instagram ads", v: 168000, t: "₹1.68L", s: "171 orders", c: "var(--s-web)" }, { l: "WhatsApp", v: 142000, t: "₹1.42L", s: "139 orders", c: "var(--s-wa)" }, { l: "Direct", v: 96000, t: "₹96k", s: "104 orders", c: "var(--ink-2)" }, { l: "Google", v: 61000, t: "₹61k", s: "58 orders", c: "var(--ink-2)" }, { l: "Creators", v: 44000, t: "₹44k", s: "42 orders", c: "var(--s-hypd)" }, { l: "Email", v: 21000, t: "₹21k", s: "24 orders", c: "var(--ink-2)" }, { l: "Not tracked", v: 68000, t: "₹68k", s: "74 orders", c: "var(--line)" }], 168000), { basis: "30 days · first source that brought the customer" })}
      <div class="g2">${panel("New vs returning", stack([{ l: "New", v: 66, t: "₹3.9L", c: "var(--s-web)" }, { l: "Returning", v: 34, t: "₹2.1L", c: "var(--orange)" }]) + `<div class="row" style="margin-top:14px;gap:20px"><div><div class="eyebrow">Returning pay</div><div class="big" style="font-size:26px;margin-top:4px">₹1,140</div></div><div><div class="eyebrow">New pay</div><div class="big" style="font-size:26px;margin-top:4px">₹890</div></div></div>`, { basis: "30 days · per order" })}
      ${panel("Best campaigns", tbl([{ h: "Campaign" }, { h: "Orders", n: 1 }, { h: "Sales", n: 1 }], [{ c: ["Rakhi Hamper reminder<span class=sub>WhatsApp</span>", "96", "₹1.42L"] }, { c: ["Edamame launch reel<span class=sub>Instagram</span>", "88", "₹86k"] }, { c: ["Masala Mania retarget<span class=sub>Instagram</span>", "51", "₹49k"] }], (r) => ({ t: r.c[0].replace(/<span class=sub>(.*)<\/span>/, ""), v: r.c[2], m: r.c[0].replace(/.*<span class=sub>(.*)<\/span>/, "$1") + " · " + r.c[1] + " orders" })), { basis: "30 days" })}</div>` }) });

  /* 6 Amazon overview */
  const amzShell = (tab, title, body, actions) => shell({ hub: "Sales", item: "Amazon", title, crumb: "Sales · Amazon", actions: actions || seg(["7d", "30d", "90d"], "30d") + `<span class="cmp">synced 8 min ago</span>`, tabs: [["Overview", tab === 0], ["Stock", tab === 1, 2], ["Product profit", tab === 2], ["Payouts", tab === 3], ["Orders", tab === 4]], body });
  const moneyRow = (k, v, pct, c, sub) => `<span class="k">${k}</span><span class="bar" style="width:${pct}%;background:${c}"></span><span class="v">${v}</span>${sub ? `<span class="sub">${sub}</span>` : ""}`;
  add({ id: "amazon", hub: "Sales", item: "Amazon", title: "Amazon · Overview", route: "/dashboard/amazon",
    was: ["4 KPIs, 3 wide tables, a settlement chart and a pill list on one scroll", "Period switch changes only the top cards", "'Finance events', 'MFN', 'Variance', 'Net kept' jargon"],
    now: ["One chart: customers paid → Amazon kept → paid to you → your profit. Four bars, read top to bottom", "Stock alert as one line with a button; detail on the Stock tab", "Three short facts at the bottom. No daily line chart here"],
    render: () => amzShell(0, "Amazon", `
      <div class="callout crit"><div><div class="t">Masala Mania is out of stock. Losing ₹2.1k profit a day.</div><div class="c">120 units arrive in about 6 days</div></div>${btn("Stock", "sm")}</div>
      <div class="kpis">${kpi("Customers paid", "₹2.3L", -6, "204 orders")}${kpi("Paid to you", "₹1.52L", -8, "after Amazon's fees")}${kpi("Your profit", "₹61k", -11, "after product cost")}${kpi("Profit margin", "26%", -2, "of sales")}</div>
      ${panel("Where the money went", `<div class="money">
        ${moneyRow("Customers paid", "₹2,30,000", 100, "var(--ink-2)")}
        ${moneyRow("Amazon kept", "−₹78,000", 34, "var(--s-amz)", "referral 15% · FBA shipping 13% · closing and promos 6%")}
        ${moneyRow("Paid to you", "₹1,52,000", 66, "var(--cyan)")}
        ${moneyRow("Product cost", "−₹91,000", 40, "var(--ink-3)", "from the cost prices you entered")}
        ${moneyRow("Your profit", "₹61,000", 26, "var(--good)")}
      </div>`, { basis: "30 days" })}
      <div class="g3">${panel("Stock", `<div class="row"><span class="big">2</span><span class="muted">of 8 products<br>at risk</span></div>`, { foot: `<span class="lnk">Stock →</span>` })}${panel("Refunds", `<div class="row"><span class="big">3.1%</span>${dl(-1)}</div><div class="muted" style="font-size:13px;margin-top:4px">6 refunds · ₹6,800</div>`)}${panel("Last payout", `<div class="row"><span class="big">₹71k</span>${pill("good", "Matched")}</div><div class="muted" style="font-size:13px;margin-top:4px">12 Sep · next 26 Sep</div>`, { foot: `<span class="lnk">Payouts →</span>` })}</div>`) });

  /* 7 Amazon stock */
  add({ id: "amz-stock", hub: "Sales", item: "Amazon", title: "Amazon · Stock", route: "/dashboard/amazon#stock",
    was: ["Stock in three places; 'days cover' as a bare number", "No link to the Amazon listing"],
    now: ["One list, worst first. A coloured stripe and one big number: days of stock left", "Every product links to its Amazon listing and to Seller Central", "Same layout on phone: stripe, name, days, one line of detail"],
    render: () => {
      const rows = [
        ["var(--crit)", "Edamame Masala Mania 100g", "0", "d", "Out of stock", "0 available · sells 3.4/day · 120 arriving ~6d", "B0CX41", btn("Restock", "sm pri")],
        ["var(--warn)", "Soya Sticks Peri Peri 80g", "9", "days", "", "31 available · sells 3.5/day · none inbound", "B0CX88", btn("Restock", "sm")],
        ["var(--good)", "Protein Chips Tangy Tomato", "46", "days", "", "96 available · sells 2.1/day", "B0CX07", ""],
        ["var(--good)", "Crunchies Cheese 60g", "53", "days", "", "148 available · sells 2.8/day", "B0CX12", ""],
        ["var(--line)", "Gift Hamper (Diwali)", "—", "", "No sales yet", "40 available · new listing", "B0D133", ""],
        ["var(--line)", "Soya Sticks Chilli Lime 80g", "?", "", "Ships from you", "Stock not tracked by Amazon · sells 1.2/day", "B0CX90", ""],
      ];
      const list = rows.map((r) => `<div class="stock-row"><i style="background:${r[0]}"></i><div><div class="t">${r[1]}</div><div class="m"><span>${r[5]}</span><span class="amz-link">amazon.in/dp/${r[6]} ↗</span><span class="amz-link d-only">Seller Central ↗</span></div></div><div class="days">${r[2] === "—" || r[2] === "?" ? `<small>${r[4]}</small>` : `<b style="color:${r[0]}">${r[2]}</b><small>${r[2] === "0" ? r[4] : "days left"}</small>`}${r[7] ? `<div style="margin-top:6px">${r[7]}</div>` : ""}</div></div>`).join("");
      return amzShell(1, "Amazon · Stock", `<div class="kpis k3">${kpi("Out of stock", "1", null, "product")}${kpi("Under 14 days", "1", null, "product")}${kpi("Profit lost", "₹2.1k", null, "per day, right now")}</div>
      <div class="legend" style="margin:0"><span><i style="background:var(--crit)"></i>Under 7 days</span><span><i style="background:var(--warn)"></i>7 to 21</span><span><i style="background:var(--good)"></i>Over 21</span><span class="faint">from the last 30 days of sales</span></div>
      <div class="panel">${list}</div>`);
    } });

  /* 8 Amazon SKU economics */
  add({ id: "amz-profit", hub: "Sales", item: "Amazon", title: "Amazon · Product profit", route: "/dashboard/amazon#profit",
    was: ["8-column table with fee breakdown hidden in a hover tooltip; cost price editable inline"],
    now: ["One question per product: of ₹199 the customer pays, how much do you keep? One bar shows it", "Ranked by total profit. Products without a cost price say so", "Tap a product for its ₹ split; edit cost price there"],
    render: () => {
      const rows = [["Edamame Masala Mania 100g", 199, 77, 60, 62, 412, "₹25,540"], ["Crunchies Cheese 60g", 139, 48, 38, 53, 261, "₹13,830"], ["Soya Sticks Peri Peri 80g", 179, 71, 60, 48, 298, "₹14,300"], ["Protein Chips Tangy Tomato", 209, 84, 86, 39, 190, "₹7,410"]];
      const list = rows.map((r) => `<div class="stock-row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t">${r[0]}</div><div class="stack" style="height:14px;margin:6px 0 4px"><div style="flex:${r[2]};background:var(--s-amz)"${tip("Amazon keeps ₹" + r[2])}></div><div style="flex:${r[3]};background:var(--ink-3)"${tip("Product cost ₹" + r[3])}></div><div style="flex:${r[4]};background:var(--good)"${tip("You keep ₹" + r[4])}></div></div><div class="m"><span>Customer pays <b>₹${r[1]}</b></span><span>Amazon ₹${r[2]}</span><span>Cost ₹${r[3]}</span><span style="color:var(--good);font-weight:600">You keep ₹${r[4]}</span></div></div><div class="days"><b>${r[6]}</b><small>${r[5]} sold · 30d</small></div></div>`).join("");
      return amzShell(2, "Amazon · Product profit", `<div class="kpis k3">${kpi("Profit, all products", "₹61k", -11, "30 days")}${kpi("Best", "₹62 / pack", null, "Masala Mania")}${kpi("Missing cost price", "2", null, "products", "Profit can't be calculated until you enter a cost price")}</div>
      <div class="legend" style="margin:0"><span><i style="background:var(--s-amz)"></i>Amazon keeps</span><span><i style="background:var(--ink-3)"></i>Product cost</span><span><i style="background:var(--good)"></i>You keep</span></div>
      <div class="panel">${list}<div class="stock-row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t">Gift Hamper (Diwali)</div><div class="m"><span>Customer pays <b>₹1,299</b></span>${pill("warn", "Enter cost price to see profit")}</div></div><div class="days">${btn("Set cost", "sm")}</div></div></div>`);
    } });

  /* 9 Amazon payouts */
  add({ id: "amz-payouts", hub: "Sales", item: "Amazon", title: "Amazon · Payouts", route: "/dashboard/amazon#payouts",
    was: ["Same 12 settlements in a chart and a table", "'Variance' with no explanation; deposit date and notes returned but hidden"],
    now: ["One question: did Amazon pay what it should? Each payout is Matched or needs a look", "Chart shows what you kept per payout, mismatch amounts are the only red"],
    render: () => amzShell(3, "Amazon · Payouts", `<div class="kpis k3">${kpi("Paid out, 90 days", "₹4.3L", 4, "6 payouts")}${kpi("Matched", "5 of 6", null, "reconcile within ₹50")}${kpi("Needs a look", "₹1,190", null, "short on 29 Aug")}</div>
      ${panel("What you kept per payout", barchart(["15 Jun", "29 Jun", "13 Jul", "27 Jul", "13 Aug", "29 Aug", "12 Sep"], [{ n: "Paid out", c: "var(--s-amz)", v: [58200, 61400, 66800, 71900, 69300, 74100, 71240] }], { fmt: L, labels: true, h: 190 }), { basis: "₹ deposited · fortnightly" })}
      ${panel("Payouts", tbl([{ h: "Deposited" }, { h: "Period" }, { h: "Sales", n: 1 }, { h: "Amazon kept", n: 1 }, { h: "Refunds", n: 1 }, { h: "Paid to bank", n: 1 }, { h: "Check" }], [
        { c: ["12 Sep", "29 Aug to 11 Sep", "₹1,08,900", "−₹34,860", "−₹2,800", "₹71,240", pill("good", "Matched")] },
        { hl: 1, c: ["29 Aug", "15 to 28 Aug", "₹1,12,400", "−₹35,100", "−₹3,200", "₹74,100", pill("warn", "₹1,190 short", "Amazon's line items add to ₹75,290 but the deposit was ₹74,100. Usually a reserve held for returns.")] },
        { c: ["13 Aug", "1 to 14 Aug", "₹1,05,200", "−₹33,400", "−₹2,500", "₹69,300", pill("good", "Matched")] },
        { c: ["27 Jul", "18 to 31 Jul", "₹1,09,800", "−₹34,700", "−₹3,200", "₹71,900", pill("good", "Matched")] },
      ], (r) => ({ t: r.c[0] + " · " + r.c[5], v: r.c[6], m: r.c[1] + " · sales " + r.c[2] })), { basis: "from Amazon settlement reports" })}`) });

  /* 10 Orders & COD */
  add({ id: "orders", hub: "Sales", item: "Orders & COD", title: "Orders & COD", route: "/dashboard/order-confirmations",
    was: ["Emoji status counts, 500-row unfiltered table, missing orders not pinned to the top", "COD gate window fixed at 14 days while the page period can be 6 hours", "'Send all missing' bulk-sends WhatsApp with no confirmation"],
    now: ["Calls to make are first, with phone numbers and one-tap outcomes", "Orders list filters by what's wrong, and shows delivery of the confirmation message as ticks", "Bulk sends need a confirm step that states how many people will get a message"],
    render: () => shell({ hub: "Sales", item: "Orders & COD", title: "Orders & COD", actions: seg(["24h", "7d", "30d"], "7d") + btn("Resend 3 missing", "d-only", I.send), tabs: [["Needs a call", true, 4], ["All orders", false, 212], ["Confirmation coverage", false]],
      body: `<div class="callout sun"><div><div class="t">4 cash-on-delivery orders haven't been confirmed by the customer</div><div class="c">They got the WhatsApp Confirm / Cancel buttons and didn't tap either within 6 hours. Shipping is on hold until someone confirms.</div></div></div>
      ${panel("Call list · ₹3,596 on hold", tbl([{ h: "Order" }, { h: "Customer" }, { h: "Amount", n: 1 }, { h: "Waiting" }, { h: "WhatsApp" }, { h: "" }], [
        { c: ["#2231", "Priya Sharma<span class=sub>Indore · 2nd order</span>", "₹1,198", pill("crit", "19 hours"), "Read ✓✓", btn("Call", "sm pri") + " " + btn("Confirm", "sm") + " " + btn("Cancel", "sm ghost")] },
        { c: ["#2236", "Rahul Mehta<span class=sub>Pune · first order</span>", "₹799", pill("warn", "11 hours"), "Delivered ✓✓", btn("Call", "sm pri") + " " + btn("Confirm", "sm") + " " + btn("Cancel", "sm ghost")] },
        { c: ["#2240", "Anita Kulkarni<span class=sub>Mumbai · 4th order</span>", "₹999", pill("warn", "8 hours"), "Read ✓✓", btn("Call", "sm pri") + " " + btn("Confirm", "sm") + " " + btn("Cancel", "sm ghost")] },
        { c: ["#2241", "Dev Patel<span class=sub>Surat · first order</span>", "₹600", pill("neu", "6 hours"), "Not on WhatsApp", btn("Call", "sm pri") + " " + btn("Confirm", "sm") + " " + btn("Cancel", "sm ghost")] },
      ], (r) => ({ t: r.c[0] + " · " + r.c[1].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[2], m: r.c[3] + " " + r.c[4] + `<span style="width:100%"></span>` + r.c[5] })))}
      <div class="g2">${panel("Confirmation coverage", `<div class="row"><span class="big">98.6%</span><span class="muted">of 212 orders got a<br>WhatsApp confirmation</span></div>${meter(98.6, "var(--good)")}<div class="muted" style="font-size:13px;margin-top:8px">3 missing: 2 numbers not on WhatsApp, 1 failed twice (will retry). 0 duplicates.</div>`, { basis: "7 days" })}${panel("COD outcomes", stack([{ l: "Confirmed by tap", v: 61, t: "61", c: "var(--good)" }, { l: "Confirmed by call", v: 9, t: "9", c: "var(--cyan)" }, { l: "Cancelled", v: 6, t: "6", c: "var(--crit)" }, { l: "Waiting", v: 4, t: "4", c: "var(--warn)" }]) + `<p class="muted" style="font-size:13px;margin:10px 0 0">6 cancellations caught before shipping saved about ₹1,400 in return costs.</p>`, { basis: "7 days · 80 COD orders" })}</div>` }) });

  /* 11 Conversations */
  const inboxRows = [
    ["wa", "PS", "#FFC905", "Priya Sharma", "And can you confirm my order, I don't see the button", "2m", "sel", pill("info plain", "Bot"), "2"],
    ["ig", "FR", "#E86A24", "@fit.with.riya", "Would love to collab for a reel, what are the terms?", "9m", "", pill("neu plain", "Creator"), ""],
    ["wa", "RM", "#0A9CB8", "Rahul Mehta", "Pack came damaged, see photo", "14m", "", pill("crit plain", "Ticket #121"), "1"],
    ["em", "NT", "#5C5155", "Nashik Traders", "Wholesale rates for 50 cartons monthly", "31m", "", pill("warn plain", "Draft ready"), ""],
    ["wa", "AK", "#AF272F", "Anita Kulkarni", "confirm", "1h", "", pill("good plain", "COD confirmed"), ""],
    ["ig", "SR", "#6E4FB0", "@snackreviewsindia", "Sent you a DM about the giveaway", "2h", "", pill("neu plain", "Creator"), ""],
    ["wa", "KR", "#1E7F55", "Kiran Rao", "Where's my order #2219", "3h", "", pill("info plain", "Bot"), ""],
  ];
  const listHtml = (rows) => rows.map((r) => `<div class="list-row ${r[6]}"><span style="position:relative;width:34px;height:34px"><span class="av" style="background:${r[2]};color:#fff">${r[1]}</span><span class="ch-ic ch-${r[0]} ch">${r[0][0].toUpperCase()}</span></span><div class="t"><span>${r[3]}</span>${r[7]}</div><div class="s">${r[4]}</div><div class="r"><span class="when">${r[5]}</span>${r[8] ? `<span style="background:var(--crimson);color:#fff;border-radius:8px;padding:0 6px;font-family:var(--mono);font-size:11px">${r[8]}</span>` : ""}</div></div>`).join("");
  const threadBody = `<div class="thread-h"><span class="av" style="background:#FFC905;width:34px;height:34px">PS</span><div><b>Priya Sharma</b><div class="faint" style="font-size:12.5px">WhatsApp · Indore · 4 orders · ₹4,790</div></div><span class="sp">${pill("info", "Bot replying")}</span>${btn("Take over", "sm")}</div>
    <div class="convo" style="flex:1"><span class="sysline">Today</span><div class="bub in">Thanks! Will the Diwali hamper have the masala one?<small>14:03</small></div><div class="bub bot">Yes! The Diwali hamper has Masala Mania edamame, Peri Peri sticks and Cheese crunchies. It's ₹1,299 with free shipping.<small>Bot · from Master KB · read</small></div><div class="bub in">And can you confirm my order, I don't see the button<small>14:05</small></div><span class="sysline">Bot handed off: customer asked to confirm a COD order</span></div>
    <div class="composer" style="margin:0 12px 12px;border-radius:12px;box-shadow:none"><span class="inp">Reply as Khush…</span><div class="row">${btn("Confirm COD #2231", "sm")}${btn("Template", "sm ghost")}${btn("AI draft", "sm ghost")}${btn("Send", "pri sm sp", I.send)}</div></div>`;
  add({ id: "inbox", hub: "Inbox", item: "Conversations", title: "Conversations", route: "/dashboard/inbox",
    was: ["Three separate inboxes with different layouts; 8 filter chips in 2 rows; up to 5 pills per row", "No count, no pagination, no response-time indicator"],
    now: ["One inbox for WhatsApp, Instagram and email. Avatar with a small channel badge, one status pill, one line of preview", "Laptop opens with the top conversation already showing, so the screen is never empty", "Filter by who should act; channel filter is a single dropdown"],
    render: () => shell({ hub: "Inbox", item: "Conversations", title: "Conversations", actions: chips([["Needs a human", 12], ["Mine", 3], ["Bot", 41], ["All", 56]], "Needs a human") + `<span class="seg d-only"><span class="on">All channels ▾</span></span>`,
      body: `<div class="g12 inbox-grid" style="gap:0">
        <div class="panel" style="border-radius:0;border-width:0 1px 0 0"><div class="p-body" style="padding:12px 14px 6px"><div class="inp">${I.search} Search name, phone, order…</div></div>${listHtml(inboxRows)}<div class="p-foot">56 conversations <span class="lnk sp">Next 20 →</span></div></div>
        <div class="d-only" style="display:flex;flex-direction:column;background:var(--bg)">${threadBody}</div>
      </div>` }) });

  /* 12 Conversation */
  add({ id: "thread", hub: "Inbox", item: "Conversations", title: "Conversation", route: "/dashboard/inbox/[id]",
    was: ["3 fixed columns under a header, status pill and 9 tabs; customer panel lists 12 things"],
    now: ["Conversation gets the space; customer facts are one strip on top", "Reply box is a proper multi-line field with the actions under it, on both devices", "Bot messages look different from human ones"],
    render: () => shell({ hub: "Inbox", item: "Conversations", title: "Priya Sharma", crumb: "Inbox · WhatsApp · +91 98230 41xxx", actions: pill("info", "Bot is replying") + btn("Take over", "d-only") + btn("Resolve", "ghost d-only"),
      body: `<div class="row" style="font-size:13.5px;gap:14px"><span><b>Indore</b></span><span><b class="num">4</b> orders · <b class="num">₹4,790</b></span><span>#2231 · COD · <b>waiting</b></span><span class="lnk sp">Profile →</span></div>
      <div class="panel" style="display:flex;flex-direction:column;min-height:420px"><div class="convo" style="flex:1">
        <span class="sysline">Yesterday</span>
        <div class="bub in">Hi, I ordered the edamame combo, when will it ship?<small>18:42</small></div>
        <div class="bub bot">Hi Priya! Your order #2231 is cash on delivery, so it ships as soon as you confirm. Tap Confirm below and it's on its way.<small>Bot · 18:42 · read</small></div>
        <span class="sysline">Today</span>
        <div class="bub in">Thanks! Will the Diwali hamper have the masala one?<small>14:03</small></div>
        <div class="bub bot">Yes! The Diwali hamper has Masala Mania edamame, Peri Peri sticks and Cheese crunchies. It's ₹1,299 with free shipping.<small>Bot · 14:03 · from Master KB · read</small></div>
        <div class="bub in">And can you confirm my order, I don't see the button<small>14:05</small></div>
        <span class="sysline">Bot handed off: customer asked to confirm a COD order</span>
      </div></div>
      <div class="composer"><span class="inp">Reply as Khush… <span class="faint" style="font-size:12px;margin-left:auto">bot pauses while you type</span></span><div class="row">${btn("Confirm COD #2231", "sm")}${btn("Template", "sm ghost")}${btn("AI draft", "sm ghost")}${btn("Photo", "sm ghost")}${btn("Send", "pri sm sp", I.send)}</div></div>` }) });

  /* 13 Tickets */
  add({ id: "tickets", hub: "Inbox", item: "Tickets", title: "Tickets", route: "/dashboard/inbox/tickets",
    was: ["Tickets are a filter on the WhatsApp inbox list, with status hidden in pills", "Ops closes tickets by replying 'done #N' on WhatsApp, nothing shows SLA"],
    now: ["A board by status, cards sorted by age, with a colour when the 4-hour target is missed", "Each card shows the customer, the problem in their words, the order value and who owns it", "Closing a card here or replying 'done #N' both work"],
    render: () => shell({ hub: "Inbox", item: "Tickets", title: "Tickets", actions: chips([["Open", 6], ["Waiting on customer", 2], ["Resolved this week", 19]], "Open") + `<span class="cmp d-only">target: first human reply within 4h</span>`,
      body: `<div class="kpis k3">${kpi("Open", "6", null, "3 past target")}${kpi("Median time to resolve", "3.2h", -18, "this week", "Lower is better")}${kpi("Damaged pack complaints", "4", 2, "this week · check packaging")}</div>
      <div class="kan">
        <div class="kcol"><h4>New <span>2</span></h4><div class="kc"><div class="t">#123 Wrong flavour received</div><div class="m">Kiran Rao · #2219 · ₹799</div><div class="m">${pill("warn", "2h 10m")}<span>unassigned</span></div></div><div class="kc"><div class="t">#124 Refund for cancelled COD</div><div class="m">Dev Patel · #2210 · ₹600</div><div class="m">${pill("neu", "40m")}<span>unassigned</span></div></div></div>
        <div class="kcol"><h4>With Narendra <span>3</span></h4><div class="kc"><div class="t">#118 Pack arrived crushed</div><div class="m">Rahul Mehta · #2201 · ₹1,198</div><div class="m">${pill("crit", "6h 40m · past target")}<span class="av" style="width:18px;height:18px;font-size:8px;background:#0A9CB8;color:#fff">N</span></div></div><div class="kc"><div class="t">#119 Pack arrived crushed</div><div class="m">S. Iyer · #2204 · ₹999</div><div class="m">${pill("crit", "5h 05m · past target")}<span class="av" style="width:18px;height:18px;font-size:8px;background:#0A9CB8;color:#fff">N</span></div></div><div class="kc"><div class="t">#121 Damaged, photo attached</div><div class="m">Rahul Mehta · #2231</div><div class="m">${pill("warn", "3h 30m")}<span class="av" style="width:18px;height:18px;font-size:8px;background:#0A9CB8;color:#fff">N</span></div></div></div>
        <div class="kcol"><h4>Waiting on customer <span>2</span></h4><div class="kc"><div class="t">#116 Asked for address photo</div><div class="m">M. Joshi · #2190</div><div class="m">${pill("neu", "1 day")}</div></div><div class="kc"><div class="t">#117 Replacement offered</div><div class="m">A. Bose · #2188</div><div class="m">${pill("neu", "2 days")}</div></div></div>
        <div class="kcol"><h4>Resolved today <span>4</span></h4><div class="kc" style="opacity:.7"><div class="t">#120 Order status</div><div class="m">resolved by bot · 12 min</div></div><div class="kc" style="opacity:.7"><div class="t">#115 Coupon not working</div><div class="m">Khush · 1h 20m</div></div></div>
      </div>` }) });

  /* 14 Email drafts */
  add({ id: "drafts", hub: "Inbox", item: "Email drafts", title: "Email drafts", route: "/dashboard/inbox/email",
    was: ["7-column table + 5 status chips + N category chips; detail page shows model name and revisions"],
    now: ["Laptop: queue on the left, one email and its draft on the right", "Phone: no side list. A '1 of 2' stepper on top, the email full width, Approve / Edit / Skip fixed at the bottom", "Category and urgency in words; history behind 'how this was drafted'"],
    render: () => shell({ hub: "Inbox", item: "Email drafts", title: "2 drafts waiting", crumb: "Inbox · Email drafts", actions: chips([["To approve", 2], ["Sent", 84], ["Skipped", 12]], "To approve"),
      body: `<div class="drafts-step m-only" style="align-items:center;gap:10px;font-size:13.5px"><b>1 of 2</b><span class="muted">Nashik Traders · Wholesale</span><span class="lnk sp">Next →</span></div>
      <div class="g12">
        <div class="panel drafts-list"><div class="list-row sel"><span class="av" style="background:#5C5155;color:#fff">NT</span><div class="t"><span>Nashik Traders</span>${pill("warn plain", "Wholesale")}</div><div class="s">Wholesale rates for 50 cartons monthly</div><div class="r"><span class="when">31m</span></div></div><div class="list-row"><span class="av" style="background:#0A9CB8;color:#fff">MD</span><div class="t"><span>Meera D.</span>${pill("neu plain", "Return")}</div><div class="s">Return request for order #2198</div><div class="r"><span class="when">2h</span></div></div></div>
        <div class="panel"><div class="p-head"><h3>Wholesale rates for 50 cartons monthly</h3><span class="basis">ops@nashiktraders.in · 31 min ago</span></div><div class="p-body">
        <div class="bub in" style="max-width:100%;margin-bottom:12px">Hello, we run 14 retail outlets in Nashik district. Please share wholesale pricing for 50 cartons per month of the soya sticks and edamame, and your payment terms.</div>
        <div class="row" style="margin-bottom:10px">${pill("warn", "Worth a call: 14 outlets")}<span class="lnk sp" style="font-size:13px">Create a deal</span></div>
        <div style="border-left:3px solid var(--crimson);background:var(--surface-2);border-radius:0 8px 8px 0;padding:12px 14px;font-size:14.5px;line-height:1.55"><div class="eyebrow" style="margin-bottom:6px">Draft · sends as Parth · grounded in Master KB</div>Hi, thanks for reaching out. For 50 cartons a month we can offer our distributor tier: Soya Sticks 80g at ₹58 per pack and Edamame 100g at ₹142 per pack, with 30-day credit after the first two prepaid orders. Free delivery to Nashik on orders over 20 cartons. Are you free for a quick call this week?<br><br>Parth<br>Founder, PROMUNCH</div>
        <div class="row" style="margin-top:12px">${btn("Approve & send", "pri")}${btn("Edit")}${btn("Skip", "ghost")}<span class="lnk sp d-only" style="font-size:13px">How this was drafted</span></div></div></div></div>` }) });

  /* 15 Customer profile */
  add({ id: "customer", hub: "Marketing", item: "Audience", title: "Customer profile", route: "/dashboard/contacts/[id]",
    was: ["Contact page: 4 KPIs, orders table, timeline, audience, custom properties, 4 destructive buttons in a row", "WhatsApp conversation, orders, tickets and campaign sends live on different screens"],
    now: ["One person, one timeline: orders, messages, tickets and campaigns in order", "Value at the top, consent state as a clear pill, and what they buy", "Dangerous actions (anonymise, delete) behind a menu"],
    render: () => shell({ hub: "Marketing", item: "Audience", title: "Priya Sharma", crumb: "Audience · Customer", actions: pill("good", "WhatsApp opted in") + pill("neu", "No email") + btn("Message", "pri d-only") + btn("", "ghost d-only", I.more),
      body: `<div class="kpis">${kpi("Lifetime value", "₹4,790", null, "4 orders")}${kpi("Average order", "₹1,198", null, "")}${kpi("Last order", "3 days", null, "#2231 · COD waiting")}${kpi("Segment", "Loyal", null, "buys every ~5 weeks")}</div>
      <div class="g12"><div style="display:flex;flex-direction:column;gap:16px">${panel("About", `<div class="fld"><span>Phone</span><b style="color:var(--ink)">+91 98230 41xxx</b></div><div class="fld" style="margin-top:8px"><span>City</span><b style="color:var(--ink)">Indore, Madhya Pradesh</b></div><div class="fld" style="margin-top:8px"><span>First came from</span><b style="color:var(--ink)">Instagram ad · Rakhi 2026</b></div><div class="chips" style="margin-top:10px"><span class="tag">rfm: loyal</span><span class="tag">Rakhi buyer</span><span class="tag">COD</span></div>`)}
        ${panel("Buys", hbars([{ l: "Edamame Masala", v: 6, t: "6 packs", c: "var(--s-web)" }, { l: "Peri Peri sticks", v: 3, t: "3", c: "var(--s-web)" }, { l: "Rakhi Hamper", v: 1, t: "1", c: "var(--s-web)" }], 6))}</div>
        ${panel("Timeline", `<div class="timeline">
          <div class="tl"><span class="when">Today 14:05</span><span class="dot" style="--hc:var(--s-wa)"></span><div><b>WhatsApp</b> · asked to confirm COD order, bot handed off to a human</div></div>
          <div class="tl"><span class="when">Sun 18:40</span><span class="dot" style="--hc:var(--s-web)"></span><div><b>Order #2231</b> · ₹1,198 · COD · <span class="pill warn plain" style="padding:0 6px">waiting for confirmation</span></div></div>
          <div class="tl"><span class="when">Sun 18:41</span><span class="dot" style="--hc:var(--s-wa)"></span><div><b>Confirmation sent</b> · read at 18:42</div></div>
          <div class="tl"><span class="when">2 Sep</span><span class="dot" style="--hc:var(--sun)"></span><div><b>Campaign</b> · Restock nudge · read, no reply</div></div>
          <div class="tl"><span class="when">9 Aug</span><span class="dot" style="--hc:var(--s-web)"></span><div><b>Order #2077</b> · ₹1,299 · Rakhi Hamper · delivered</div></div>
          <div class="tl"><span class="when">6 Aug</span><span class="dot" style="--hc:var(--sun)"></span><div><b>Campaign</b> · Rakhi Hamper reminder · replied "yes 2" · ordered 3 days later</div></div>
          <div class="tl"><span class="when">12 Jul</span><span class="dot" style="--hc:var(--crit)"></span><div><b>Ticket #88</b> · pack arrived open · replacement sent · resolved in 2h</div></div>
          <div class="tl"><span class="when">3 Jul</span><span class="dot" style="--hc:var(--s-web)"></span><div><b>First order #1903</b> · ₹1,097 · from Instagram ad</div></div>
        </div>`)}</div>` }) });

  /* 16 Campaigns */
  add({ id: "campaigns", hub: "Marketing", item: "Campaigns", title: "Campaigns", route: "/dashboard/marketing/campaigns",
    was: ["WhatsApp campaigns: about 18 stat cards and 2 banners before the first campaign", "Email campaigns are a separate sidebar page; nothing says which channel", "Campaign cards show sent/delivered/read counts; revenue and grade exist in the API but aren't shown"],
    now: ["One list across WhatsApp and email. Each row: revenue, orders, cost, return, delivery, and a grade", "Meta's daily cap explained in one calm banner with a countdown, not a wall of stats", "Audience health and segments move to the Audience page where they belong"],
    render: () => shell({ hub: "Marketing", item: "Campaigns", title: "Campaigns", actions: seg(["30d", "90d", "All"], "90d") + btn("New campaign", "pri", I.plus), tabs: [["All", true, 14], ["WhatsApp", false, 9], ["Email", false, 5], ["Scheduled", false, 2], ["Drafts", false, 1]],
      body: `<div class="kpis">${kpi("Revenue from campaigns", "₹3.8L", 44, "312 orders", "Orders placed through a campaign link (UTM). One definition, everywhere.")}${kpi("Spent on sends", "₹9,140", 12, "11,300 messages")}${kpi("Return", "42×", null, "per ₹1 spent")}${kpi("WhatsApp budget today", "163 / 250", null, "sends used · resets 10:00", "Meta allows about 250 marketing messages a day at your current tier")}</div>
      <div class="callout"><div><div class="t">Edamame launch is pacing against Meta's daily cap</div><div class="c">1,180 of 2,705 people still to reach. About 5 more days at 250 a day. This is normal, not a failure.</div></div>${btn("Shrink audience", "sm")}</div>
      ${panel("All campaigns", tbl([{ h: "" }, { h: "Campaign" }, { h: "Sent" }, { h: "Reached", n: 1 }, { h: "Orders", n: 1 }, { h: "Revenue", n: 1 }, { h: "Cost", n: 1 }, { h: "Return", n: 1 }], [
        { c: [grade("A"), `<span class="ch-ic ch-wa">W</span> Rakhi Hamper reminder<span class=sub>6 Aug · 2,090 people · buyers 90d</span>`, "Done", "94%", "96", "₹1.42L", "₹2,310", "62×"] },
        { c: [grade("B"), `<span class="ch-ic ch-wa">W</span> Edamame launch<span class=sub>started 9 Sep · 2,705 people · all opted in</span>`, pill("info", "Sending · 56%"), "38%", "41", "₹38k", "₹1,680", "23×"] },
        { c: [grade("B"), `<span class="ch-ic ch-em">@</span> September newsletter<span class=sub>3 Sep · 1,402 emails</span>`, "Done", "97%", "18", "₹19k", "₹0", "—"] },
        { c: [grade("C"), `<span class="ch-ic ch-wa">W</span> Restock nudge<span class=sub>2 Sep · 640 people · bought 30 to 60d ago</span>`, "Done", "81%", "22", "₹22k", "₹710", "31×"] },
        { c: [grade("D"), `<span class="ch-ic ch-wa">W</span> Review ask<span class=sub>20 Aug · 880 people</span>`, "Done", "44%", "3", "₹3k", "₹960", "3×"] },
        { c: [pill("neu plain", "Sched"), `<span class="ch-ic ch-wa">W</span> Diwali hamper pre-order<span class=sub>1 Oct 10:00 · 1,240 people · loyal + buyers</span>`, "Scheduled", "—", "—", "—", "est ₹1,370", "—"] },
      ], (r) => ({ t: r.c[1].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[5], m: r.c[0] + " " + r.c[2] + " · reached " + r.c[3] + " · " + r.c[4] + " orders · " + r.c[7] })), { basis: "90 days · revenue = orders through the campaign link" })}` }) });

  /* 17 Campaign report */
  add({ id: "campaign", hub: "Marketing", item: "Campaigns", title: "Campaign report", route: "/dashboard/marketing/campaigns/[id]",
    was: ["Campaign card with sent/delivered/read counts and a 'Why did N fail?' expander showing raw Meta text", "Revenue lives on a separate Analytics tab with a paragraph explaining two revenue definitions"],
    now: ["One report: money first, then the funnel from sent to ordered, then who it worked on", "Failure reasons translated: 'Number not on WhatsApp', 'Meta daily cap', 'Customer blocked us'", "Segment comparison shows where the next campaign should go"],
    render: () => shell({ hub: "Marketing", item: "Campaigns", title: "Rakhi Hamper reminder", crumb: "Campaigns · WhatsApp · sent 6 Aug 10:00", actions: grade("A") + pill("good", "Done") + btn("Duplicate", "d-only") + btn("Export", "ghost d-only", I.dl),
      body: `<div class="kpis">${kpi("Revenue", "₹1,42,300", 210, "vs Restock nudge", "Orders placed through this campaign's link within 7 days")}${kpi("Orders", "96", null, "4.6% of people reached")}${kpi("Cost", "₹2,310", null, "2,090 × ₹1.10")}${kpi("Return", "62×", null, "per ₹1 spent")}</div>
      <div class="g21">${panel("From sent to ordered", funnel([{ l: "Sent", v: 2090, t: "2,090" }, { l: "Delivered", v: 1965, t: "1,965" }, { l: "Read", v: 1540, t: "1,540" }, { l: "Tapped link", v: 412, t: "412" }, { l: "Ordered", v: 96, t: "96", c: "var(--good)" }]), { basis: "7 days after send" })}
      ${panel("Why 125 weren't delivered", hbars([{ l: "Not on WhatsApp", v: 71, t: "71", c: "var(--ink-3)" }, { l: "Meta daily cap", v: 38, t: "38", c: "var(--warn)", tp: "Meta limits marketing messages per day. These were sent the next morning." }, { l: "Blocked us", v: 11, t: "11", c: "var(--crit)" }, { l: "Other", v: 5, t: "5", c: "var(--ink-3)" }], 71) + `<p class="muted" style="font-size:13px;margin:10px 0 0">71 numbers should leave the WhatsApp list. <span class="lnk">Clean them up</span></p>`)}</div>
      ${panel("Who it worked on", tbl([{ h: "Segment" }, { h: "Sent", n: 1 }, { h: "Read", n: 1 }, { h: "Ordered", n: 1 }, { h: "Revenue", n: 1 }, { h: "Per person", n: 1 }], [{ c: ["Loyal (3+ orders)", "410", "88%", "9.8%", "₹58k", "₹141"] }, { c: ["Bought in last 90 days", "960", "79%", "5.1%", "₹64k", "₹67"] }, { c: ["Bought 90 to 365 days ago", "520", "61%", "2.1%", "₹16k", "₹31"] }, { c: ["Never bought (leads)", "200", "38%", "0.5%", "₹4k", "₹20"] }], (r) => ({ t: r.c[0], v: r.c[4], m: r.c[1] + " sent · read " + r.c[2] + " · ordered " + r.c[3] + " · " + r.c[5] + " per person" })), { basis: "next time: skip the leads segment, it cost ₹220 and made ₹4k", foot: `<span class="lnk">Run again to Loyal + Bought 90d →</span>` })}` }) });

  /* 18 New campaign wizard */
  add({ id: "newcampaign", hub: "Marketing", item: "Campaigns", title: "New campaign", route: "/dashboard/marketing/campaigns/new",
    was: ["One tall modal with template, variables, test send, AI brief, audience, schedule, repeat and pre-flight all at once"],
    now: ["4 numbered steps with names visible on phone too: Who → What → When → Check", "Audience, cost and finish date sit under the form so you can see them while you fill in the message", "Next button at the bottom, where your thumb is"],
    render: () => shell({ hub: "Marketing", item: "Campaigns", title: "New WhatsApp campaign", crumb: "Campaigns · New · step 2 of 4", actions: btn("Save draft", "ghost d-only") + btn("Next: When", "pri d-only"),
      body: `<div class="steps"><span class="done"><b>1</b>Who</span><span class="on"><b>2</b>What</span><span><b>3</b>When</span><span><b>4</b>Check</span></div>
      <div class="g21"><div style="display:flex;flex-direction:column;gap:16px">
        ${panel("Message", `<div class="fld">Template<span class="inp">Diwali hamper pre-order <span class="faint">approved</span> ${I.chev}</span></div>
        <div class="fld" style="margin-top:10px">Header image<span class="inp">diwali-hamper-2026.jpg <span class="faint">1200×628</span></span></div>
        <div class="fld" style="margin-top:10px">First name goes in {{1}}<span class="inp">Customer's first name <span class="faint">or "there"</span></span></div>
        <div class="fld" style="margin-top:10px">Button link<span class="inp">trypromunch.in/diwali <span class="faint">tracked</span></span></div>
        <div class="row" style="margin-top:12px">${btn("Send test to my phone", "sm")}${btn("Write with AI", "sm ghost")}</div>`)}
        ${panel("Who gets it", `<div class="kpis k3" style="border:0;margin:-4px -8px"><div class="kpi"><div class="l">People</div><div class="v">1,240</div><div class="s">Loyal + Recent</div></div><div class="kpi"><div class="l">Cost</div><div class="v">₹1,370</div><div class="s">₹1.10 each</div></div><div class="kpi"><div class="l">Finishes in</div><div class="v">5 days</div><div class="s">250 a day cap</div></div></div><p class="muted" style="font-size:13px;margin:8px 0 0">Expected return ₹40k to ₹80k, based on Rakhi.</p>`, { basis: "from step 1" })}
        <div class="m-only">${btn("Next: When", "pri")}</div>
      </div>
      <div><div class="eyebrow" style="margin-bottom:8px">On the customer's phone</div><div class="phone-prev"><div class="wab"><div class="media">DIWALI HAMPER</div><div style="padding:6px 4px">Hi Priya, Diwali hampers are open for pre-order! Masala Mania edamame, Peri Peri sticks and Cheese crunchies in a gift box. ₹1,299, free shipping, ships 12 Oct.<br><br>Your Munchy Pal<div class="faint" style="font-size:12px;margin-top:6px">Reply STOP to unsubscribe</div></div></div><div class="wbtn">Pre-order now</div></div></div></div>` }) });

  /* 19 Automations */
  add({ id: "automations", hub: "Marketing", item: "Automations", title: "Automations", route: "/dashboard/marketing/automations",
    was: ["WhatsApp Flows tab: 7 flow cards with node diagrams, ~25 stat chips, settings mixed with results", "Email Flows on a separate page"],
    now: ["Making one is the first thing on the page: pick a recipe, it's ready with sensible timings, switch it on", "Running automations listed underneath with what each one made", "Each opens as a flowchart (next screen)"],
    render: () => shell({ hub: "Marketing", item: "Automations", title: "Automations", actions: seg(["30d", "90d"], "30d"),
      body: `<div class="kpis k3">${kpi("Revenue from automations", "₹1.9L", 12, "186 orders")}${kpi("Carts recovered", "₹68k", 31, "58 of 412")}${kpi("Reviews collected", "44", 8, "of 310 asked")}</div>
      <div><div class="eyebrow" style="margin-bottom:8px">Start a new one</div><div class="recipes">
        <div class="recipe"><span class="ic">🛒</span><b>Win back a left cart</b><span>WhatsApp nudge after 1 hour, retry for 3 days</span>${btn("Use", "sm")}</div>
        <div class="recipe"><span class="ic">👋</span><b>Welcome new sign-ups</b><span>Discount code now, a nudge in 3 days</span>${btn("Use", "sm")}</div>
        <div class="recipe"><span class="ic">🔁</span><b>Bring back past buyers</b><span>Message when they've probably run out</span>${btn("Use", "sm")}</div>
        <div class="recipe"><span class="ic">⭐</span><b>Ask for a review</b><span>7 days after delivery, with the link</span>${btn("Use", "sm")}</div>
        <div class="recipe"><span class="ic">🎁</span><b>Birthday or festival offer</b><span>One message on a date you pick</span>${btn("Use", "sm")}</div>
        <div class="recipe"><span class="ic">✏️</span><b>Build your own</b><span>Trigger, wait, message, branch</span>${btn("Start blank", "sm ghost")}</div>
      </div></div>
      ${panel("Running", tbl([{ h: "Automation" }, { h: "Went through", n: 1 }, { h: "Result", n: 1 }, { h: "Revenue", n: 1 }, { h: "" }], [
        { c: [`<span class="ch-ic ch-wa">W</span> Abandoned cart rescue<span class=sub>cart left 1h → WhatsApp → retry → call</span>`, "412", "58 recovered · 14%", "₹68k", pill("good", "On")] },
        { c: [`<span class="ch-ic ch-wa">W</span> Order confirmation + COD gate<span class=sub>new order → confirm → hold if COD</span>`, "926", "98.6% delivered", "—", pill("good", "On")] },
        { c: [`<span class="ch-ic ch-wa">W</span> Restock reminder<span class=sub>28 days after delivery</span>`, "540", "71 ordered · 13%", "₹74k", pill("good", "On")] },
        { c: [`<span class="ch-ic ch-wa">W</span> Review request<span class=sub>7 days after delivery</span>`, "310", "44 reviews · 14%", "—", pill("good", "On")] },
        { c: [`<span class="ch-ic ch-em">@</span> Welcome series<span class=sub>popup sign-up → 3 emails</span>`, "188", "31 ordered · 16%", "₹28k", pill("good", "On")] },
        { c: [`<span class="ch-ic ch-em">@</span> Abandoned cart email<span class=sub>only when no WhatsApp</span>`, "96", "6 recovered · 6%", "₹5k", pill("good", "On")] },
      ], (r) => ({ t: r.c[0].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[3], m: r.c[4] + " · " + r.c[1] + " through · " + r.c[2] })), { basis: "30 days" })}` }) });

  /* 20 Automation detail */
  add({ id: "automation", hub: "Marketing", item: "Automations", title: "Automation · Abandoned cart rescue", route: "/dashboard/marketing/automations/[id]",
    was: ["Flow card with pickers and number fields, stat chips like 'assisted (WA + call, can't tell which)'"],
    now: ["The automation is drawn as a flowchart: trigger → wait → message → branch → call → done, with how many people passed each arrow", "Tap a node to change its timing or template", "Results and reasons for drop-off sit beside the chart"],
    render: () => shell({ hub: "Marketing", item: "Automations", title: "Abandoned cart rescue", crumb: "Automations · WhatsApp", actions: pill("good", "On") + btn("Pause", "ghost d-only") + btn("Save", "pri d-only"), tabs: [["Flow", true], ["Results", false], ["History", false]],
      body: `<div class="kpis">${kpi("Carts left", "412", 9, "worth ₹4.6L")}${kpi("Reached", "84%", 3, "346 people")}${kpi("Recovered", "58", 31, "14% · ₹68k")}${kpi("Cost", "₹410", null, "mostly free text")}</div>
      <div class="g21">${panel("What happens", `<div class="flow">
        <div class="fnode trig"><span class="ic">🛒</span><b>Customer leaves checkout</b><span>with items in the cart</span></div>
        <div class="fedge"><span class="n">412 people · 30 days</span></div>
        <div class="fnode wait"><span class="ic">⏱</span><b>Wait 60 min</b><span>in case they come back on their own · tap to change</span></div>
        <div class="fedge"><span>318 still hadn't ordered</span></div>
        <div class="fnode msg"><span class="ic">💬</span><b>WhatsApp: cart reminder</b><span>free text inside 24h window, else template cart_reminder_v3</span></div>
        <div class="fedge"><span>delivered to 252 · read by 197</span></div>
        <div class="fbranch">
          <div><h5>Ordered within 24h</h5><div class="fnode end"><span class="ic">✓</span><b>Done</b><span>41 recovered · ₹49k</span></div></div>
          <div><h5>No order after 24h</h5><div class="fnode call"><span class="ic">📞</span><b>Voice rescue call</b><span>off · needs a Sarvam number</span></div><div class="fedge"><span>17 recovered later on their own</span></div><div class="fnode end"><span class="ic">✓</span><b>Done</b></div></div>
        </div>
        <div class="fedge" style="margin-top:8px"><span>66 never reached</span></div>
        <div class="fnode stop"><span class="ic">✕</span><b>Stops on its own</b><span>when they order, reply STOP, or after 72h</span></div>
      </div>`, { basis: "tap any step to edit it" })}
      <div style="display:flex;flex-direction:column;gap:16px">${panel("Why 66 weren't reached", hbars([{ l: "Not on WhatsApp", v: 41, t: "41", c: "var(--ink-3)" }, { l: "Meta daily cap", v: 19, t: "19", c: "var(--warn)" }, { l: "Unsubscribed", v: 6, t: "6", c: "var(--ink-3)" }], 41) + `<p class="muted" style="font-size:13px;margin:10px 0 0">The 41 with an email got the email version instead.</p>`)}
      ${panel("Recovered carts", tbl([{ h: "Customer" }, { h: "Cart", n: 1 }, { h: "Ordered", n: 1 }], [{ c: ["Anita Kulkarni", "₹1,497", "₹1,497"] }, { c: ["S. Menon", "₹999", "₹1,198"] }, { c: ["+91 97…2201", "₹799", "₹799"] }], (r) => ({ t: r.c[0], v: r.c[2], m: "cart " + r.c[1] })), { basis: "latest 3 of 58" })}</div></div>` }) });

  /* 21 Audience */
  add({ id: "audience", hub: "Marketing", item: "Audience", title: "Audience", route: "/dashboard/marketing/audience",
    was: ["Contacts: search + 5 chips + More filters + sort + 14 segment chips in a row, then a 7-column table", "Segments (rfm:*), lists and tags are three different concepts; WhatsApp audience quality lives on the Campaigns tab", "Status mixes VIP/At risk with subscription state"],
    now: ["Segments are the page: each one is a card with people, reach on each channel and value, and a 'message them' button", "Consent (WhatsApp / email) is separate from behaviour (Loyal / At risk)", "The contacts table is one tab, with phone-friendly cards"],
    render: () => shell({ hub: "Marketing", item: "Audience", title: "Audience", actions: btn("Import", "ghost d-only") + btn("Add person", "d-only", I.plus), tabs: [["Segments", true], ["All people", false, "2,140"], ["Lists", false, 6], ["Sign-up popup", false]],
      body: `<div class="kpis">${kpi("People", "2,140", 6, "30 days")}${kpi("Reachable on WhatsApp", "1,612", 4, "75% · opted in", "Opted in and not marked 'not on WhatsApp'")}${kpi("Reachable by email", "640", 11, "30% · verified")}${kpi("Engaged with us", "48%", -2, "replied or bought in 90 days", "Meta rates your number partly on this. Cold blasts push it down.")}</div>
      <div class="g3">
        ${["Loyal", "412", "3+ orders, bought in 90 days", "₹2,380", 96, 61, "var(--good)"].concat([]).length ? [["Loyal", "412", "3+ orders, bought in 90 days", "₹2,380", 96, 61], ["Recent buyers", "960", "1 to 2 orders in the last 90 days", "₹1,140", 91, 34], ["At risk", "520", "Used to buy, nothing in 90 to 365 days", "₹1,020", 82, 29], ["Lapsed", "180", "Over a year since last order", "₹890", 70, 22], ["Leads", "68", "Signed up, never bought", "—", 100, 88], ["Creators", "44", "HYPD seed orders · excluded from revenue", "—", 60, 40]].map((s) => `<div class="panel"><div class="p-head"><h3>${s[0]}</h3><span class="basis">${s[2]}</span></div><div class="p-body"><div class="row"><span class="big">${s[1]}</span><span class="muted" style="font-size:13px">people<br>avg value ${s[3]}</span></div><div class="hb" style="margin-top:10px;grid-template-columns:70px 1fr auto"><span class="lab">WhatsApp</span><span class="trk"><span class="fill" style="width:${s[4]}%;background:var(--s-wa)"></span></span><span class="val">${s[4]}%</span><span class="lab">Email</span><span class="trk"><span class="fill" style="width:${s[5]}%;background:var(--ink-3)"></span></span><span class="val">${s[5]}%</span></div></div><div class="p-foot">${btn("Message", "sm")}<span class="lnk sp">See people</span></div></div>`).join("") : ""}
      </div>` }) });

  /* 22 Templates */
  add({ id: "templates", hub: "Marketing", item: "Templates", title: "Templates", route: "/dashboard/marketing/templates",
    was: ["Card grid printing every template's full body; Meta rejection reason shown verbatim", "No search, no status filter, no usage or read rate per template"],
    now: ["A list with status, when it was last used, how many sends and its read rate", "Preview on the right as it looks on a phone", "Rejections explained with the fix ('Meta saw this as promotional; use the Marketing category')"],
    render: () => shell({ hub: "Marketing", item: "Templates", title: "Templates", actions: chips([["All", 14], ["Approved", 11], ["In review", 2], ["Rejected", 1]], "All") + btn("New template", "pri d-only", I.plus),
      body: `<div class="g21">${panel("WhatsApp templates", tbl([{ h: "Template" }, { h: "Kind" }, { h: "Status" }, { h: "Sends 90d", n: 1 }, { h: "Read", n: 1 }], [
        { c: ["order_confirmed_v4<span class=sub>Order confirmation · last used today</span>", "Utility", pill("good", "Approved"), "2,810", "91%"] },
        { c: ["cod_gate_v2<span class=sub>Confirm / Cancel buttons · today</span>", "Utility", pill("good", "Approved"), "640", "88%"] },
        { c: ["cart_reminder_v3<span class=sub>Abandoned cart · today</span>", "Marketing", pill("good", "Approved"), "1,120", "62%"] },
        { c: ["diwali_hamper_preorder<span class=sub>Campaign · submitted 13 Sep</span>", "Marketing", pill("warn", "In review · 2 days"), "—", "—"] },
        { c: ["bulk_discount_offer<span class=sub>submitted 11 Sep</span>", "Utility", pill("crit", "Rejected", "Meta saw this as promotional. Resubmit as Marketing."), "—", "—"] },
        { c: ["review_request_v2<span class=sub>Review ask · 4 Sep</span>", "Marketing", pill("good", "Approved"), "310", "48%"] },
      ], (r) => ({ t: r.c[0].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[2], m: r.c[1] + " · " + r.c[3] + " sends · read " + r.c[4] })))}
      <div><div class="eyebrow" style="margin-bottom:8px">bulk_discount_offer</div><div class="callout crit" style="margin-bottom:10px;flex-direction:column;align-items:flex-start;gap:4px"><div class="t">Meta rejected this as promotional content in a Utility template</div><div class="c">Fix: change the category to Marketing and add the STOP footer. Utility is only for order and account updates.</div>${btn("Fix and resubmit", "sm")}</div><div class="phone-prev"><div class="wab"><div style="padding:6px 4px">Hi {{1}}, buying for a party or office? Get 15% off on 10 packs or more with code BULK15 this week.<br><br>Your Munchy Pal</div></div><div class="wbtn">Shop now</div></div></div></div>` }) });

  /* 23 Sign-up popup */
  add({ id: "popup", hub: "Marketing", item: "Sign-up popup", title: "Sign-up popup", route: "/dashboard/marketing/popup",
    was: ["Growth tab: 2 lifetime counts, a Shopify install card, 6 config sections and a preview", "Fix hints show 'write_script_tags' and 'SHOPIFY_ACCESS_TOKEN'"],
    now: ["The question is 'is the popup earning its place?': shown → signed up → first order, with revenue", "Editing stays visual, but results come first", "Install problems say what to click in Shopify, never a scope name"],
    render: () => shell({ hub: "Marketing", item: "Sign-up popup", title: "Sign-up popup", actions: seg(["30d", "90d"], "30d") + pill("good", "Live on trypromunch.in") + btn("Edit popup", "pri d-only"), tabs: [["Results", true], ["Popup", false], ["Chat button", false]],
      body: `<div class="kpis">${kpi("Shown", "18,400", 14, "unique visitors")}${kpi("Signed up", "612", 22, "3.3% · WhatsApp 540 · email 72")}${kpi("First orders", "94", 30, "15% of sign-ups · within 30 days")}${kpi("Revenue", "₹89k", 27, "from those first orders")}</div>
      <div class="g21">${panel("Sign-ups per day", barchart(days.filter((_, i) => i % 3 === 0), [{ n: "WhatsApp", c: "var(--s-wa)", v: [14, 18, 22, 17, 25, 31, 24, 28, 33, 29] }, { n: "Email", c: "var(--ink-3)", v: [2, 3, 2, 4, 3, 2, 3, 4, 2, 3] }], { h: 190, aria: "Sign-ups per day by channel" }), { basis: "30 days" })}
      ${panel("What signed-up people did", funnel([{ l: "Signed up", v: 612, t: "612" }, { l: "Got welcome msg", v: 590, t: "590" }, { l: "Used code", v: 118, t: "118" }, { l: "Ordered", v: 94, t: "94", c: "var(--good)" }]))}</div>
      <div class="g2">${panel("Popup", `<div class="phone-prev" style="max-width:100%;background:var(--surface-2)"><div class="wab" style="text-align:center;padding:14px"><div style="font-family:var(--display);font-size:16px;color:#AF272F">10% OFF YOUR FIRST MUNCH</div><div class="muted" style="font-size:13px;margin:4px 0 10px">Drop your WhatsApp number, get the code instantly.</div><div class="inp" style="margin-bottom:6px">+91 </div><div class="wbtn" style="background:#AF272F;color:#fff">Send me the code</div></div></div>`, { foot: `Shows after 8 seconds on product pages · mobile and desktop <span class="lnk sp">Edit</span>` })}${panel("Chat button", `<div class="row"><span class="big">1,140</span><span class="muted" style="font-size:13px">taps in 30 days<br>388 started a chat</span></div><p class="muted" style="font-size:13.5px;margin:10px 0 0">Bottom-right, green, "Chat with your Munchy Pal". Opens WhatsApp with a pre-filled hello.</p>`, { foot: `<span class="lnk">Edit</span>` })}</div>` }) });

  /* 24 B2B leads */
  add({ id: "b2b", hub: "Partners", item: "B2B leads", title: "B2B leads", route: "/dashboard/leads",
    was: ["6 header buttons, a 4-step strip, 4 KPIs and 5 tabs before content", "'Campaigns' = sequences, 'Saved emails' = templates, plus a separate 'New email campaign' wizard", "Jargon: Fit, unverified, Suppressed, Crawling, pts"],
    now: ["The page is the pipeline: Found → Emailed → Replied → In talks, with counts and a conversion rate", "One action button: Email a list. Finding companies is a tab", "Each lead row says why it fits in a sentence"],
    render: () => shell({ hub: "Partners", item: "B2B leads", title: "B2B leads", actions: btn("Find companies", "d-only", I.search) + btn("Email a list", "pri", I.send), tabs: [["Pipeline", true], ["Lists", false, 6], ["Email sequences", false, 3], ["Replies", false, 4]],
      body: `<div class="callout"><div><div class="t">Sending as Parth, 40 a day · 18 sent today · next batch at 15:30</div><div class="c">Replies land in Inbox › Email drafts with a suggested answer.</div></div>${btn("Pause", "sm ghost")}</div>
      ${panel("Pipeline", funnel([{ l: "Found", v: 1240, t: "1,240 companies", c: "var(--orange)" }, { l: "Have an email", v: 812, t: "812", c: "var(--orange)" }, { l: "Emailed", v: 604, t: "604", c: "var(--orange)" }, { l: "Opened", v: 301, t: "301", c: "var(--orange)" }, { l: "Replied", v: 41, t: "41", c: "var(--orange)" }, { l: "In talks (deal)", v: 9, t: "9 deals", c: "var(--good)" }]), { basis: "all time · 90 days: 41 replies from 604 emails = 6.8%" })}
      <div class="g2">${panel("Replies to act on", tbl([{ h: "Company" }, { h: "Why it fits" }, { h: "" }], [{ c: ["Nashik Traders<span class=sub>14 outlets · Nashik</span>", "Retail chain asking wholesale rates for 50 cartons a month", btn("Reply", "sm pri")] }, { c: ["Fitfuel Gyms<span class=sub>6 gyms · Pune</span>", "Wants protein snacks at reception, asked for samples", btn("Reply", "sm pri")] }, { c: ["Café Bloom<span class=sub>2 cafés · Indore</span>", "Interested in Crunchies for the counter, price sensitive", btn("Reply", "sm")] }], (r) => ({ t: r.c[0].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[2], m: r.c[1] })))}
      ${panel("Lists", tbl([{ h: "List" }, { h: "Companies", n: 1 }, { h: "Emailed", n: 1 }, { h: "Replied", n: 1 }], [{ c: ["Gyms · Pune & Mumbai", "240", "198", "18 · 9%"] }, { c: ["Cafés · MP", "310", "204", "11 · 5%"] }, { c: ["Modern trade · West", "84", "60", "7 · 12%"] }, { c: ["Corporate pantries", "140", "102", "3 · 3%"] }], (r) => ({ t: r.c[0], v: r.c[3], m: r.c[1] + " companies · " + r.c[2] + " emailed" })))}</div>` }) });

  /* 25 B2B sequence */
  add({ id: "sequence", hub: "Partners", item: "B2B leads", title: "Email sequence", route: "/dashboard/leads/sequences/[id]",
    was: ["Sequence editor with steps, settings and enrolled leads on one form", "Analytics on a separate tab with a 'sequence report card'"],
    now: ["The sequence reads as a timeline with results at each step", "Which email gets replies is obvious; the weak step is called out", "Enrolled companies in one list with where each one is"],
    render: () => shell({ hub: "Partners", item: "B2B leads", title: "Gym outreach · 3 emails", crumb: "B2B leads · Email sequence · sends as Parth", actions: pill("good", "Running · 198 enrolled") + btn("Edit emails", "d-only") + btn("Pause", "ghost d-only"),
      body: `<div class="kpis">${kpi("Emailed", "198", null, "companies")}${kpi("Opened", "52%", 4, "vs last 30 days")}${kpi("Replied", "9.1%", 2, "18 replies")}${kpi("Became deals", "4", null, "1 closed · ₹48k first order")}</div>
      ${panel("Steps and what each one did", `<div class="timeline">
        <div class="tl"><span class="when">Day 0</span><span class="dot" style="--hc:var(--orange)"></span><div><b>Email 1 · "Protein snacks for your members"</b><div class="muted" style="font-size:13px">198 sent · 58% opened · 11 replied</div>${meter(58, "var(--orange)")}</div></div>
        <div class="tl"><span class="when">Day 3</span><span class="dot" style="--hc:var(--orange)"></span><div><b>Email 2 · "Free sample box"</b><div class="muted" style="font-size:13px">187 sent · 41% opened · 6 replied</div>${meter(41, "var(--orange)")}</div></div>
        <div class="tl"><span class="when">Day 8</span><span class="dot" style="--hc:var(--orange)"></span><div><b>Email 3 · "Last one from me"</b> ${pill("warn", "Weak: 1 reply from 160")}<div class="muted" style="font-size:13px">160 sent · 22% opened · 1 replied</div>${meter(22, "var(--warn)")}<div class="row" style="margin-top:6px">${btn("Rewrite with AI", "sm")}${btn("Drop this step", "sm ghost")}</div></div></div></div>`)}
      ${panel("Companies in this sequence", tbl([{ h: "Company" }, { h: "Contact" }, { h: "Where" }, { h: "Last activity" }], [{ c: ["Fitfuel Gyms", "Rohan · owner", pill("good", "Replied"), "Asked for samples · 2h ago"] }, { c: ["Iron Temple", "info@", pill("info", "Email 2 sent"), "Opened twice · yesterday"] }, { c: ["Cult Andheri", "manager", pill("neu", "Email 3 sent"), "No opens · 6 days"] }, { c: ["Gold's Koregaon", "—", pill("neu", "No email found"), "Skipped"] }], (r) => ({ t: r.c[0], v: r.c[2], m: r.c[1] + " · " + r.c[3] })))}` }) });

  /* 26 Deals */
  add({ id: "deals", hub: "Partners", item: "Deals", title: "Deals", route: "/dashboard/deals",
    was: ["Board with 6 stages and list with 4 buckets: two different stage models", "No deal value anywhere; no pipeline total", "HoReCa, q-comm, 'willing' jargon; drag-drop board is fixed 262px columns"],
    now: ["One set of 5 stages, used by board and list. Each column shows its total ₹", "Every card has a value, next step and when it's due; overdue turns red", "Kinds in plain words: Restaurants & cafés, Quick commerce, Distributors, Corporate"],
    render: () => shell({ hub: "Partners", item: "Deals", title: "Deals", actions: seg(["Board", "List"], "Board") + chips(["All kinds", "Distributors", "Restaurants & cafés", "Quick commerce", "Corporate"], "All kinds") + btn("New deal", "pri d-only", I.plus),
      body: `<div class="kpis k3">${kpi("Open pipeline", "₹8.4L", null, "17 deals · first-order value")}${kpi("Won this quarter", "₹1.9L", 40, "4 deals")}${kpi("Overdue next steps", "3", null, "oldest 6 days")}</div>
      <div class="kan">
        <div class="kcol"><h4>New <span>₹1.6L · 5</span></h4><div class="kc"><div class="t">Nashik Traders</div><div class="m">Distributor · ₹60k/mo</div><div class="m">${pill("warn plain", "Reply due today")}</div></div><div class="kc"><div class="t">Café Bloom</div><div class="m">Restaurants & cafés · ₹8k</div><div class="m"><span class="faint">Send price list · Thu</span></div></div></div>
        <div class="kcol"><h4>Samples sent <span>₹2.1L · 4</span></h4><div class="kc"><div class="t">Fitfuel Gyms</div><div class="m">Corporate · ₹48k</div><div class="m">${pill("crit plain", "Follow-up 6 days overdue")}</div></div><div class="kc"><div class="t">Zepto (Pune)</div><div class="m">Quick commerce · ₹1.2L</div><div class="m"><span class="faint">Buyer tasting · 19 Sep</span></div></div></div>
        <div class="kcol"><h4>Negotiating <span>₹3.9L · 5</span></h4><div class="kc"><div class="t">Metro Cash & Carry</div><div class="m">Modern trade · ₹2.5L</div><div class="m">${pill("info plain", "AI read: likely, price is the sticking point")}</div></div><div class="kc"><div class="t">Blinkit (Indore)</div><div class="m">Quick commerce · ₹90k</div><div class="m"><span class="faint">Listing fee counter · Fri</span></div></div></div>
        <div class="kcol"><h4>Won <span>₹1.9L · 4</span></h4><div class="kc"><div class="t">Iron Temple Gyms</div><div class="m">₹48k · first order shipped</div></div></div>
        <div class="kcol"><h4>Lost <span>3</span></h4><div class="kc" style="opacity:.7"><div class="t">Big Basket</div><div class="m">margin too low</div></div></div>
      </div>` }) });

  /* 27 Deal detail */
  add({ id: "deal", hub: "Partners", item: "Deals", title: "Deal", route: "/dashboard/deals/[id]",
    was: ["Drawer with stage stepper, AI read (willingness 0 to 100, drivers, risks), commercials, notes, edit form and email thread, ~70 inline styles", "Confidence and email count returned but hidden"],
    now: ["Next step at the top with a date and one button", "Value, terms and the AI read in one strip; the AI read says what it's based on", "The email thread is the body; notes attach to it"],
    render: () => shell({ hub: "Partners", item: "Deals", title: "Metro Cash & Carry", crumb: "Deals · Modern trade · Negotiating", actions: seg(["New", "Samples", "Negotiating", "Won"], "Negotiating") + btn("Mark won", "pri d-only"),
      body: `<div class="callout sun"><div><div class="t">Next: send revised price sheet at ₹52/pack with 45-day credit</div><div class="c">Due Thursday · Parth · buyer asked for it on 12 Sep</div></div>${btn("Done", "sm pri")}${btn("Snooze", "sm ghost")}</div>
      <div class="kpis">${kpi("First order value", "₹2.5L", null, "12 stores × 40 cartons")}${kpi("Monthly if it lands", "₹1.8L", null, "their estimate")}${kpi("AI read", "Likely", null, "72% · based on 9 emails", "Read from the email thread: buyer is engaged and asks for specifics; price is the only open objection.")}${kpi("Emails", "9", null, "last from them · 3 days ago")}</div>
      <div class="g21">${panel("Thread", `<div class="convo" style="padding:0"><div class="bub in" style="max-width:90%"><b>Sunil, Metro</b> · 12 Sep<br>The range works for our snack aisle. Your ₹58 lands us at 22% margin; we need 28% or ₹52. Also 45 days credit, not 30.</div><div class="bub out" style="max-width:90%"><b>Parth</b> · 12 Sep<br>Understood. Let me run ₹52 with 45 days and come back with a revised sheet by Thursday.</div><div class="bub in" style="max-width:90%"><b>Sunil</b> · 12 Sep<br>Thanks. Category review is 24 Sep, so Thursday works.</div></div><div style="border-top:1px solid var(--line);padding:10px 0 0;margin-top:12px" class="row"><span class="inp" style="flex:1;color:var(--ink-3)">Reply as Parth…</span>${btn("Draft with AI", "sm")}</div>`)}
      <div style="display:flex;flex-direction:column;gap:16px">${panel("AI read", `<div class="row" style="margin-bottom:6px">${pill("good", "Likely · 72%")}</div><ul style="margin:0;padding-left:16px;font-size:13.5px;color:var(--ink-2)"><li>Buyer replies within a day and names dates</li><li>Objection is price only; ₹52 is 10% off, still 24% margin for us</li><li>Risk: category review on 24 Sep, miss it and it slips a quarter</li></ul>`, { basis: "from 9 emails" })}${panel("Terms", `<div class="fld">Price per pack<span class="inp">₹58 → ₹52 proposed</span></div><div class="fld" style="margin-top:8px">Credit<span class="inp">45 days</span></div><div class="fld" style="margin-top:8px">Stores<span class="inp">12 · Pune, Mumbai</span></div>`)}</div></div>` }) });

  /* 28 Creators */
  add({ id: "creators", hub: "Partners", item: "Creators", title: "Creators", route: "/dashboard/creators",
    was: ["Instagram page with 7 tabs (Inbox, Collabs, Discovery, Tasks, Needs human, Spam, Settings), 'ER' and 'Fit' unexplained", "Stage counts returned by the API but never shown, so no pipeline view"],
    now: ["Creators are a pipeline: Found → Pitched → Agreed → Posted → Sales, with sales from HYPD seed orders", "Discovery is one tab with filters in words (followers, engagement, niche)", "DMs live in the shared Inbox"],
    render: () => shell({ hub: "Partners", item: "Creators", title: "Creators", actions: seg(["30d", "90d"], "90d") + btn("Find creators", "pri d-only", I.search), tabs: [["Pipeline", true], ["Find creators", false], ["Agreements", false, 12]],
      body: `<div class="kpis">${kpi("Posted about us", "31", 24, "reels & stories · 90d")}${kpi("Sales from creators", "₹2.9L", 38, "HYPD + coupon codes")}${kpi("Cost", "₹74k", null, "product sent + fees")}${kpi("Return", "3.9×", null, "per ₹1")}</div>
      ${panel("Pipeline", funnel([{ l: "Found", v: 640, t: "640", c: "var(--orange)" }, { l: "Pitched by DM", v: 210, t: "210", c: "var(--orange)" }, { l: "Replied", v: 84, t: "84", c: "var(--orange)" }, { l: "Agreed", v: 42, t: "42", c: "var(--orange)" }, { l: "Posted", v: 31, t: "31", c: "var(--good)" }]), { basis: "90 days" })}
      ${panel("Top creators by sales", tbl([{ h: "Creator" }, { h: "Followers", n: 1 }, { h: "Engagement", n: 1 }, { h: "Deal" }, { h: "Posts", n: 1 }, { h: "Sales", n: 1 }], [{ c: ["@fit.with.riya<span class=sub>fitness · Mumbai</span>", "84k", "4.1%", "Barter + 10% code", "3", "₹48k"] }, { c: ["@snackreviewsindia<span class=sub>food · Delhi</span>", "210k", "1.9%", "₹15k fee", "1", "₹41k"] }, { c: ["@homegymhitesh<span class=sub>fitness · Pune</span>", "31k", "6.2%", "Barter", "4", "₹29k"] }, { c: ["@mumbaifoodie_", "146k", "2.4%", "Barter", "1", "₹6k"] }], (r) => ({ t: r.c[0].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[5], m: r.c[1] + " followers · " + r.c[2] + " engagement · " + r.c[3] })), { basis: "90 days · sales via HYPD links and coupon codes" })}` }) });

  /* 29 Bot knowledge */
  add({ id: "kb", hub: "System", item: "Bot knowledge", title: "Bot knowledge", route: "/dashboard/system/knowledge",
    was: ["Knowledge Base tab: document cards with 'chunks', 'mime_type', 'Re-ingest' and raw ingest errors", "No sign of whether the bot ever uses a document"],
    now: ["Documents listed by what they cover and how often the bot used them this month", "Stale documents flagged (raw text changed, bot still on the old version)", "Knowledge gaps are the first tab, because that's where the work is"],
    render: () => shell({ hub: "System", item: "Bot knowledge", title: "Bot knowledge", actions: btn("Add document", "pri d-only", I.plus) + btn("Paste text", "ghost d-only"), tabs: [["Documents", true, 9], ["Gaps", false, 6], ["Test the bot", false]],
      body: `<div class="kpis k3">${kpi("Questions answered from KB", "94%", 2, "30 days · 1,840 replies")}${kpi("Couldn't answer", "6", null, "this week · see Gaps")}${kpi("Needs update", "1", null, "document changed, bot not updated")}</div>
      ${panel("Documents", tbl([{ h: "Document" }, { h: "Covers" }, { h: "Used by bot", n: 1 }, { h: "Updated" }, { h: "Status" }], [
        { c: ["Products & pack labels", "6 products, ingredients, protein per 100g, allergens", "1,210 times", "5 Sep", pill("good", "Up to date")] },
        { hl: 1, c: ["Shipping & payment", "Free over ₹599, ₹99 below, COD +₹50, prepaid 5% off", "640", "14 Sep · text changed", pill("warn", "Bot is on the 5 Sep version", "The raw text was edited but the bot's index wasn't rebuilt. One tap fixes it.") + " " + btn("Update bot", "sm")] },
        { c: ["Diwali hamper 2026", "Contents, price, ship date", "88", "12 Sep", pill("good", "Up to date")] },
        { c: ["Returns & damaged packs", "What to do, replacement policy", "142", "20 Aug", pill("good", "Up to date")] },
        { c: ["Wholesale & partnerships", "Who to route to, what to say", "96", "20 Aug", pill("good", "Up to date")] },
        { c: ["Brand voice", "Tone rules, tagline use, banned words", "always", "5 Sep", pill("good", "Up to date")] },
      ], (r) => ({ t: r.c[0], v: r.c[4], m: r.c[1] + " · used " + r.c[2] })))}` }) });

  /* 30 Knowledge gaps */
  add({ id: "gaps", hub: "System", item: "Bot knowledge", title: "Bot knowledge · Gaps", route: "/dashboard/system/knowledge#gaps",
    was: ["Nothing. Missed questions are only findable by reading transcripts", "The audit found lead-chat loops and a canned fallback on a food-safety complaint this way"],
    now: ["Every time the bot fell back to 'let me check with the team', the question is grouped here", "Answer once, in a box, and it becomes a KB document", "Complaints and safety issues are separated from missing facts (needs new data: log bot fallbacks)"],
    render: () => shell({ hub: "System", item: "Bot knowledge", title: "Bot knowledge", actions: btn("Add document", "pri d-only", I.plus), tabs: [["Documents", false, 9], ["Gaps", true, 6], ["Test the bot", false]],
      body: `<p class="muted" style="margin:0;font-size:14px;max-width:70ch">When the bot can't find an answer in the knowledge base it says it will check with the team. Those questions land here. Answer one and it becomes a document the bot uses from then on.</p>
      ${panel("Is it keto / low carb?", `<div class="muted" style="font-size:13.5px;margin-bottom:8px">Asked 3 times this week · last: "is the edamame ok for keto diet" · Priya S, +91 97…, +91 98…</div><div class="fld">Answer<span class="inp" style="min-height:64px;align-items:flex-start;color:var(--ink-3)">e.g. Edamame Masala Mania has 8g net carbs per 30g serving…</span></div><div class="row" style="margin-top:8px">${btn("Save as document", "pri sm")}${btn("Tell these 3 customers", "sm")}${btn("Not a gap", "ghost sm")}</div>`, { cls: "", right: pill("info", "3 asks") })}
      ${panel("Delivery to Assam / North East", `<div class="muted" style="font-size:13.5px;margin-bottom:8px">Asked 2 times · "do you deliver to Guwahati" · "shipping to Assam how many days"</div><div class="fld">Answer<span class="inp" style="min-height:44px;align-items:flex-start;color:var(--ink-3)">Type the answer…</span></div><div class="row" style="margin-top:8px">${btn("Save as document", "pri sm")}${btn("Not a gap", "ghost sm")}</div>`, { right: pill("info", "2 asks") })}
      ${panel("Bulk discount for 20+ packs", `<div class="muted" style="font-size:13.5px;margin-bottom:8px">Asked once · the bot routed it to wholesale, which was right for a shop but this was a family order</div><div class="row">${btn("Add to Shipping & payment", "sm")}${btn("Not a gap", "ghost sm")}</div>`, { right: pill("neu", "1 ask") })}
      ${panel("Complaints the bot handled alone", `<div class="muted" style="font-size:13.5px">1 this week: "found a hair in the pack" got the standard damaged-pack reply. Food safety complaints should always open a ticket to a human.</div><div class="row" style="margin-top:8px">${btn("Add a rule: food safety → human", "sm pri")}</div>`, { right: pill("crit", "Review") })}` }) });

  /* 31 Health */
  add({ id: "health", hub: "System", item: "Health", title: "Health", route: "/dashboard/system/health",
    was: ["Health scattered: WhatsApp status pill on every WhatsApp tab, 'Channel health' pills on Home, Settings › Connections with hardcoded 'Connected'", "'Cloud API', 'Uptime 7d', 'checks24h' shown to non-engineers"],
    now: ["One page: is every pipeline moving? Each row shows the last time something real happened and the last 24 hours as a strip", "Words: 'Shopify orders are arriving', 'WhatsApp bot is replying', 'Amazon sync last ran 8 min ago'", "Sync gaps (the most common real problem) are obvious"],
    render: () => shell({ hub: "System", item: "Health", title: "Everything is running", crumb: "System · Health", actions: pill("good", "All 9 pipelines healthy") + `<span class="cmp">checked 40s ago</span>` + btn("Refresh", "ghost d-only", I.ref),
      body: `${panel("Pipelines", tbl([{ h: "" }, { h: "Pipeline" }, { h: "Last real event" }, { h: "Last 24 hours" }, { h: "" }], [
        { c: [pill("good plain", "OK"), "WhatsApp bot is replying<span class=sub>Meta webhook → bot → send</span>", "2 min ago · reply to Priya S", uptime(Array(24).fill("")), "38 in · 41 out · 0 failed"] },
        { c: [pill("good plain", "OK"), "Shopify orders are arriving<span class=sub>webhook + confirmation</span>", "9 min ago · #2244", uptime(Array(24).fill("")), "31 orders · 100% confirmed"] },
        { c: [pill("good plain", "OK"), "Amazon sync<span class=sub>orders, stock, payouts · every 30 min</span>", "8 min ago", uptime(Array(24).fill("")), "48 runs"] },
        { c: [pill("warn plain", "Slow"), "Gmail intake<span class=sub>support emails → drafts</span>", "52 min ago", uptime(Array(24).fill("").map((_, i) => (i === 21 ? "w" : ""))), "1 retry at 13:10 · Google blip"] },
        { c: [pill("good plain", "OK"), "Campaign sender<span class=sub>every 2 min while sending</span>", "1 min ago · Edamame launch", uptime(Array(24).fill("")), "163 sent today · 250 cap"] },
        { c: [pill("good plain", "OK"), "Automations tick<span class=sub>cart, restock, review journeys</span>", "40s ago", uptime(Array(24).fill("")), "1,440 runs"] },
        { c: [pill("good plain", "OK"), "Instagram DMs", "16 min ago", uptime(Array(24).fill("")), "12 in · 9 out"] },
        { c: [pill("good plain", "OK"), "B2B email sender<span class=sub>as Parth · 40/day</span>", "13:30 · batch of 20", uptime(Array(24).fill("")), "18 sent · 0 bounced"] },
        { c: [pill("neu plain", "Off"), "Voice rescue calls", "never", uptime(Array(24).fill("")), "waiting for a Sarvam number"] },
      ], (r) => ({ t: r.c[1].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[0], m: r.c[2] + " · " + r.c[4] })))}
      <div class="g2">${panel("Last incident", `<div style="font-size:14px"><b>12 Sep 11:50</b> · false "no heartbeat" pages · fixed the same day. The watchdog read a failed database query as silence. <span class="lnk">Details</span></div>`)}${panel("Budgets", `<div class="hb" style="grid-template-columns:130px 1fr auto"><span class="lab">WhatsApp marketing</span><span class="trk"><span class="fill" style="width:65%;background:var(--s-wa)"></span></span><span class="val">163 / 250 today</span><span class="lab">Email (Resend)</span><span class="trk"><span class="fill" style="width:22%;background:var(--ink-3)"></span></span><span class="val">1,102 / 5,000 mo</span><span class="lab">OpenAI</span><span class="trk"><span class="fill" style="width:38%;background:var(--ink-3)"></span></span><span class="val">$19 / $50 mo</span></div>`)}</div>` }) });

  /* 32 Settings */
  add({ id: "settings", hub: "System", item: "Settings", title: "Settings", route: "/dashboard/settings",
    was: ["'Shopify: Connected' and email SPF/DKIM/DMARC badges hardcoded", "Brand and Email forms load fixed defaults, so Save can overwrite real values", "Invite modal uses the old design system"],
    now: ["Connections show a real check with the time it ran and a Test button", "Forms load what's saved; the old accent colour default goes away", "Team, API keys, brand and messaging defaults as clear sections, owner-only ones marked"],
    render: () => shell({ hub: "System", item: "Settings", title: "Settings", tabs: [["Connections", true], ["Team", false, 5], ["Brand & messaging", false], ["API keys", false, "owner"], ["Notifications", false]],
      body: `${panel("Connected services", tbl([{ h: "Service" }, { h: "Account" }, { h: "Last checked" }, { h: "Status" }, { h: "" }], [
        { c: ["Shopify<span class=sub>orders, customers, checkout links</span>", "a1e4f4-2.myshopify.com", "2 min ago", pill("good", "Working"), btn("Test", "sm ghost")] },
        { c: ["WhatsApp (Meta)<span class=sub>bot, campaigns, confirmations</span>", "+91 ••• 4410 · quality: High", "2 min ago", pill("good", "Working · token never expires"), btn("Test", "sm ghost")] },
        { c: ["Amazon Seller<span class=sub>orders, stock, payouts</span>", "PROMUNCH · IN", "8 min ago", pill("good", "Working"), btn("Test", "sm ghost")] },
        { c: ["Email sending (Resend)<span class=sub>hello@trypromunch.in · parth@trypromunch.in</span>", "trypromunch.in", "1 hour ago", pill("good", "Domain verified · SPF, DKIM, DMARC pass"), btn("Test", "sm ghost")] },
        { c: ["Support inbox (Gmail)", "support@trypromunch.in", "52 min ago", pill("warn", "Slow · 1 retry today"), btn("Test", "sm ghost")] },
        { c: ["Instagram", "@promunch.in", "16 min ago", pill("good", "Working"), btn("Test", "sm ghost")] },
        { c: ["Voice calls (Sarvam)", "—", "—", pill("neu", "Not set up"), btn("Set up", "sm")] },
      ], (r) => ({ t: r.c[0].replace(/<span class=sub>.*<\/span>/, ""), v: r.c[3], m: r.c[1] + " · checked " + r.c[2] })))}
      <div class="g2">${panel("Team", `<div class="row" style="font-size:13.5px;gap:8px"><span class="av" style="background:#FFC905">KM</span>Khush · Owner<span class="av" style="background:#0A9CB8;color:#fff">N</span>Narendra · Support<span class="av" style="background:#E86A24;color:#fff">P</span>Parth · Sales<span class="faint">+2</span></div>`, { foot: `${btn("Invite", "sm")}<span class="lnk sp">Manage roles</span>` })}${panel("Brand & messaging", `<div class="fld">Brand name<span class="inp">PROMUNCH</span></div><div class="fld" style="margin-top:8px">Tagline<span class="inp">Your Munchy Pal <span class="faint">on: WhatsApp bot, email · off: order updates</span></span></div>`, { foot: `<span class="lnk">Edit</span>` })}</div>` }) });

  /* 33 Activity */
  add({ id: "activity", hub: "System", item: "Activity", title: "Activity", route: "/dashboard/system/activity",
    was: ["Audit log: raw action codes in <code>, fixed column widths, a filter dropdown that traps you after one pick", "No search, date filter or paging"],
    now: ["Sentences: who did what, to whom, when. Codes stay behind 'details'", "Filter by person, by kind (sends, settings, money) and by date", "Customer-facing sends are flagged so you can answer 'did we message this person?'"],
    render: () => shell({ hub: "System", item: "Activity", title: "Activity", actions: chips([["All", 412], ["Customer messages", 208], ["Settings changes", 9], ["Team", 4]], "All") + seg(["Today", "7d", "30d"], "Today") + btn("Export", "ghost d-only", I.dl),
      body: `<div class="panel"><div class="p-body" style="padding-top:8px"><div class="inp" style="margin-bottom:8px">${I.search} Search a name, phone, order or setting…</div><div class="timeline">
        <div class="tl"><span class="when">14:05</span><span class="dot" style="--hc:var(--s-wa)"></span><div><b>Bot</b> handed Priya Sharma's chat to a human · COD confirmation request <span class="faint">· details</span></div></div>
        <div class="tl"><span class="when">13:58</span><span class="dot" style="--hc:var(--ink-2)"></span><div><b>Khush</b> changed the WhatsApp daily budget from 200 to 250</div></div>
        <div class="tl"><span class="when">13:30</span><span class="dot" style="--hc:var(--orange)"></span><div><b>B2B sender</b> emailed 20 companies in "Gyms · Pune & Mumbai" as Parth</div></div>
        <div class="tl"><span class="when">12:41</span><span class="dot" style="--hc:var(--s-wa)"></span><div><b>Narendra</b> resolved ticket #120 for Kiran Rao ("done #120" on WhatsApp)</div></div>
        <div class="tl"><span class="when">11:15</span><span class="dot" style="--hc:var(--sun)"></span><div><b>Campaign sender</b> sent Edamame launch to 163 people · 38 not delivered: daily cap</div></div>
        <div class="tl"><span class="when">10:02</span><span class="dot" style="--hc:var(--s-web)"></span><div><b>Shopify</b> order #2241 from Dev Patel · ₹600 COD · confirmation sent, not on WhatsApp</div></div>
        <div class="tl"><span class="when">09:40</span><span class="dot" style="--hc:var(--ink-2)"></span><div><b>Parth</b> moved Metro Cash & Carry to Negotiating</div></div>
        <div class="tl"><span class="when">08:00</span><span class="dot" style="--hc:var(--ink-3)"></span><div><b>System</b> nightly: customer segments refreshed · 2,140 people · 12 moved to At risk</div></div>
      </div></div><div class="p-foot">Showing 8 of 412 today <span class="lnk sp">Load more</span></div></div>` }) });

  /* 34 Command palette */
  add({ id: "cmdk", hub: "Today", item: "Home", title: "Search & jump (⌘K)", route: "global",
    was: ["No global search. Finding a customer means going to Contacts, an order means Orders, a chat means WhatsApp inbox"],
    now: ["One box from anywhere: type a name, phone, order number or a page. Results grouped by kind", "Quick actions: message a customer, snooze an alert, start a campaign", "On phone it's the search icon in the top bar"],
    render: () => shell({ hub: "Today", item: "Home", title: "Tuesday, 15 September", crumb: "Today", actions: seg(["7d", "30d", "90d"], "30d"), body: `<div class="kpis">${kpi("Sales, all channels", "₹9.4L", 18, "926 orders")}${kpi("Web store", "₹6.4L", 24, "612 orders")}${kpi("Amazon net payout", "₹1.9L", -6, "after fees")}${kpi("Repeat customers", "31%", 4, "of orders")}</div>`,
      overlay: `<div class="overlay"><div class="cmdk"><div class="q">${I.search}<span>priya</span><span style="flex:1;border-left:1.5px solid var(--ink);height:18px"></span><kbd class="faint" style="font-family:var(--mono);font-size:12px">esc</kbd></div>
        <h6>Customers</h6><div class="it sel"><span class="av" style="background:#FFC905">PS</span><span>Priya Sharma <small>· Indore · 4 orders · ₹4,790</small></span><small>Open profile ↵</small></div><div class="it"><span class="av" style="background:var(--surface-2)">PK</span><span>Priya Krishnan <small>· Chennai · 1 order</small></span></div>
        <h6>Conversations</h6><div class="it"><span class="ch-ic ch-wa">W</span><span>Priya Sharma · "And can you confirm my order…" <small>2 min ago</small></span></div>
        <h6>Orders</h6><div class="it"><span class="ch-ic ch-web" style="background:var(--s-web)">#</span><span>#2231 · Priya Sharma · ₹1,198 · COD waiting</span><small>Confirm</small></div>
        <h6>Actions</h6><div class="it"><span>→</span><span>Message Priya Sharma on WhatsApp</span></div><div class="it"><span>→</span><span>Go to Sales › Amazon › Stock</span></div>
      </div></div>` }) });

  /* ───────── studio ───────── */
  const $ = (s, r = document) => r.querySelector(s);
  const rail = $("#rail"), stage = $("#stage"), progress = $("#progress");
  let cur = 0, device = "both";
  const reviews = {};
  let dbRef = null, storeMode = "local";
  const LS = "pm-redesign-reviews";
  try { Object.assign(reviews, JSON.parse(localStorage.getItem(LS) || "{}")); } catch (e) { /* no storage */ }

  function saveReview(id, patch) {
    reviews[id] = Object.assign({}, reviews[id] || {}, patch, { updatedAt: new Date().toISOString() });
    try { localStorage.setItem(LS, JSON.stringify(reviews)); } catch (e) { /* ignore */ }
    if (dbRef) dbRef.collection("reviews").doc(id).set(reviews[id]).catch(() => { });
    renderRail(); renderProgress(); renderReviewBox();
  }
  function renderProgress() {
    const n = S.filter((s) => reviews[s.id] && (reviews[s.id].laptop || reviews[s.id].phone)).length;
    progress.innerHTML = `<b>${n}</b> of ${S.length} reviewed · ${storeMode === "db" ? "saved to this page" : "saved in this browser"}`;
  }
  function renderRail() {
    let html = "";
    NAV.forEach((h) => {
      const list = S.filter((s) => s.hub === h.hub);
      html += `<h4 style="--hc:${h.hc}"><i></i>${h.hub}</h4>` + list.map((s) => { const i = S.indexOf(s); const r = reviews[s.id] || {}; const st = r.laptop === "ch" || r.phone === "ch" ? "ch" : r.laptop === "ok" && r.phone === "ok" ? "ok" : r.laptop || r.phone ? "ok" : ""; return `<button data-i="${i}" aria-current="${i === cur}"><span class="no">${String(i + 1).padStart(2, "0")}</span>${s.title}<span class="rs ${st}"></span></button>`; }).join("");
    });
    rail.innerHTML = html;
  }
  function renderReviewBox() {
    const s = S[cur], r = reviews[s.id] || {};
    const box = $("#rvbox"); if (!box) return;
    box.innerHTML = `<div class="rv-btns"><span class="faint" style="font-size:12px;align-self:center">Laptop</span><button class="ok" aria-pressed="${r.laptop === "ok"}" data-dev="laptop" data-v="ok">Approve</button><button class="ch" aria-pressed="${r.laptop === "ch"}" data-dev="laptop" data-v="ch">Change</button><span class="faint" style="font-size:12px;align-self:center;margin-left:8px">Phone</span><button class="ok" aria-pressed="${r.phone === "ok"}" data-dev="phone" data-v="ok">Approve</button><button class="ch" aria-pressed="${r.phone === "ch"}" data-dev="phone" data-v="ch">Change</button></div>
      <textarea id="rvnote" placeholder="What should change on this screen? (saved when you click away)">${esc(r.note || "")}</textarea>
      <div class="rv-meta">${r.updatedAt ? "saved " + new Date(r.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "not reviewed"}</div>`;
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const dev = b.dataset.dev, v = b.dataset.v; saveReview(s.id, { [dev]: r[dev] === v ? "" : v }); }));
    $("#rvnote").addEventListener("change", (e) => saveReview(s.id, { note: e.target.value }));
  }
  function renderStage() {
    const s = S[cur];
    const html = s.render();
    stage.innerHTML = `<div class="stage-head"><div><h2>${String(cur + 1).padStart(2, "0")} · ${s.title}</h2><div class="route">${s.route} · ${s.hub}</div></div><div class="row"><div class="dev">${["both", "laptop", "phone"].map((d) => `<button aria-pressed="${device === d}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join("")}</div><div class="nav-arrows"><button data-nav="-1" aria-label="Previous screen">←</button><button data-nav="1" aria-label="Next screen">→</button></div></div></div>
      <div class="why"><div class="was"><h5>Today</h5><ul>${s.was.map((x) => `<li>${x}</li>`).join("")}</ul></div><div class="now"><h5>Proposed</h5><ul>${s.now.map((x) => `<li>${x}</li>`).join("")}</ul></div></div>
      <div class="frames">${device !== "phone" ? `<div class="laptop"><div class="bezel"><div class="viewport" id="lapvp"><div class="scaler">${html}</div></div></div><div class="dev-cap">Laptop · 1280 × 800 · hover any number for its definition</div></div>` : ""}${device !== "laptop" ? `<div class="phone"><div class="bezel"><div class="viewport">${html}</div></div><div class="dev-cap" style="text-align:center">Phone · 390 wide · same screen, reflowed</div></div>` : ""}</div>
      <div class="review" id="rvbox"></div>`;
    stage.querySelectorAll(".dev button").forEach((b) => b.addEventListener("click", () => { device = b.dataset.d; renderStage(); }));
    stage.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => go(cur + Number(b.dataset.nav))));
    scaleLaptop(); renderReviewBox();
    window.scrollTo({ top: 0 });
  }
  function scaleLaptop() {
    const vp = $("#lapvp"); if (!vp) return;
    const w = vp.clientWidth, k = w / 1280;
    const sc = $(".scaler", vp); sc.style.transform = `scale(${k})`; vp.style.height = Math.round(sc.offsetHeight * k) + "px";
  }
  function go(i) { cur = (i + S.length) % S.length; renderRail(); renderStage(); }
  rail.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(Number(b.dataset.i)); });
  window.addEventListener("resize", scaleLaptop);
  document.addEventListener("keydown", (e) => { if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return; if (e.key === "ArrowRight" || e.key === "j") go(cur + 1); if (e.key === "ArrowLeft" || e.key === "k") go(cur - 1); });

  /* tabs */
  document.querySelectorAll(".st-tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".st-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
    const v = b.dataset.view; $("#view-ov").hidden = v !== "ov"; $("#view-sc").hidden = v !== "sc";
    if (v === "sc") { renderRail(); renderStage(); }
    try { localStorage.setItem("pm-redesign-view", v); } catch (e) { /* ignore */ }
  }));

  /* tooltips */
  const tipEl = $("#tip");
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]"); if (!t) { tipEl.classList.remove("on"); return; }
    tipEl.innerHTML = esc(t.dataset.tip); tipEl.classList.add("on");
  });
  document.addEventListener("mousemove", (e) => { if (!tipEl.classList.contains("on")) return; const x = Math.min(e.clientX + 14, window.innerWidth - 250), y = e.clientY + 16; tipEl.style.left = x + "px"; tipEl.style.top = y + "px"; });

  renderProgress();
  let startView = "ov"; try { startView = localStorage.getItem("pm-redesign-view") || "ov"; } catch (e) { /* ignore */ }
  if (startView === "sc") $("#tab-sc").click();

  /* shared review store */
  (async () => {
    try {
      const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
      if (!db) return;
      dbRef = db; storeMode = "db";
      db.collection("reviews").onSnapshot((snap) => {
        snap.docs.forEach((d) => { if (d.exists) reviews[d.id] = d.data(); });
        renderRail(); renderProgress(); if ($("#rvbox")) renderReviewBox();
      }, () => { });
      renderProgress();
    } catch (e) { /* stay local */ }
  })();
})();
