"""Builds report.html (visual Meta ads report) from the numbers pulled on 10 Oct 2026.

Run:  python3 build_report.py && node render_pdf.mjs
All figures are Meta-attributed (7-day click, 1-day view), Vippy Soya ad account.
"""
from pathlib import Path

OUT = Path(__file__).with_name("report.html")

# ---- palette (validated: dataviz validate_palette.js, light mode, all checks pass)
PREV = "#2a78d6"   # previous setup (Helium)
NEW = "#eb6834"    # new manager's setup (Edamame TOF)
NEUTRAL = "#c9c2b5"  # benchmarks / "needed" bars
GRID = "#ece6da"
INK, MUTED, HINT = "#1A1714", "#6E665A", "#9A9081"
SURFACE = "#FFFFFF"

# ---- data -----------------------------------------------------------------
daily = [  # date, spend, purchases
    ("16", 411, 0), ("17", 790, 0), ("18", 1072, 0), ("19", 1153, 2), ("20", 1399, 1),
    ("21", 1347, 0), ("22", 1492, 3), ("23", 1865, 1), ("24", 1260, 2), ("25", 1474, 0),
    ("26", 1862, 0), ("27", 2222, 2), ("28", 1464, 1), ("29", 2031, 1), ("30", 2011, 0),
    ("1", 1821, 2), ("2", 1842, 1), ("3", 1522, 1), ("4", 2299, 2), ("5", 2124, 2),
    ("6", 887, 0), ("7", 1823, 0), ("8", 2878, 0), ("9", 1398, 1), ("10", 631, 0),
]
# day index (0 = 16 Sep) -> short reset label
resets = {
    0: "Launched + creative swap", 5: "Targeting + budget +50%", 7: "New ad added",
    9: "Targeting + budget", 10: "Main creative swapped", 13: "Diwali ad added",
    17: "Influencer ad added", 19: "Targeting changed", 20: "Targeting + best ad off",
}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;")


def rbar_h(x, y, w, h, color, r=4):
    """Horizontal bar, square at baseline (left), 4px rounded data end (right)."""
    if w <= 0:
        return ""
    r = min(r, w, h / 2)
    return (f'<path d="M{x},{y} H{x + w - r} Q{x + w},{y} {x + w},{y + r} V{y + h - r} '
            f'Q{x + w},{y + h} {x + w - r},{y + h} H{x} Z" fill="{color}"/>')


def rbar_v(x, y_base, w, h, color, r=4):
    """Vertical column, square at baseline (bottom), rounded top."""
    if h <= 0:
        return ""
    r = min(r, h, w / 2)
    y = y_base - h
    return (f'<path d="M{x},{y_base} V{y + r} Q{x},{y} {x + r},{y} H{x + w - r} '
            f'Q{x + w},{y} {x + w},{y + r} V{y_base} Z" fill="{color}"/>')


def text(x, y, s, size=11, color=MUTED, anchor="start", weight=400):
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}" '
            f'font-weight="{weight}">{esc(s)}</text>')


def svg(w, h, body, label):
    return (f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
            f'aria-label="{esc(label)}" style="max-width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">{body}</svg>')


# ---- charts ---------------------------------------------------------------
def hbar_compare(rows, w=300, label_w=118, unit_fmt=str, vmax=None, title=""):
    """rows: [(label, value, color, value_text)] horizontal bars on one axis."""
    bar_h, gap = 22, 12
    vmax = vmax or max(r[1] for r in rows) * 1.0
    plot_w = w - label_w - 62
    h = len(rows) * (bar_h + gap) + 6
    b = [f'<line x1="{label_w}" y1="0" x2="{label_w}" y2="{h - 4}" stroke="{GRID}"/>']
    for i, (lab, v, col, vt) in enumerate(rows):
        y = 2 + i * (bar_h + gap)
        bw = plot_w * v / vmax
        b.append(text(label_w - 8, y + 15, lab, 11.5, INK, "end", 500))
        b.append(rbar_h(label_w, y, bw, bar_h, col))
        b.append(text(label_w + bw + 6, y + 15, vt, 12, INK, "start", 700))
    return svg(w, h, "".join(b), title)


def timeline_chart():
    w, h = 690, 250
    left, right = 34, 10
    n = len(daily)
    step = (w - left - right) / n
    col_w = min(16, step - 4)
    base = 168
    top = 70
    vmax = 3700
    b = []
    # gridlines + y ticks (spend)
    for v in (0, 1000, 2000, 3000):
        y = base - (base - top) * v / vmax
        b.append(f'<line x1="{left}" y1="{y:.1f}" x2="{w - right}" y2="{y:.1f}" stroke="{GRID}"/>')
        b.append(text(left - 6, y + 4, f"₹{v // 1000}K" if v else "₹0", 9.5, HINT, "end"))
    # clean windows shading (between resets)
    idx = sorted(resets)
    for a, c in zip(idx, idx[1:] + [n]):
        if c - a >= 4:
            x0 = left + a * step
            b.append(f'<rect x="{x0 + 2:.1f}" y="{top - 4}" width="{(c - a) * step - 4:.1f}" '
                     f'height="{base - top + 4}" fill="#f4f0e8" rx="4"/>')
            b.append(text(x0 + (c - a) * step / 2, top + 9, f"{c - a} days, no edits" if c < n else "since last reset", 9, MUTED, "middle", 600))
    # spend columns
    for i, (_, sp, _) in enumerate(daily):
        x = left + i * step + (step - col_w) / 2
        b.append(rbar_v(x, base, col_w, (base - top) * sp / vmax, NEUTRAL, 3))
    # reset markers
    for k, i in enumerate(idx, 1):
        x = left + i * step + step / 2
        b.append(f'<line x1="{x:.1f}" y1="30" x2="{x:.1f}" y2="{base}" stroke="{NEW}" stroke-width="2"/>')
        b.append(f'<circle cx="{x:.1f}" cy="22" r="9" fill="{NEW}" stroke="{SURFACE}" stroke-width="2"/>')
        b.append(text(x, 26, str(k), 10, "#fff", "middle", 700))
    # purchase dot strip under axis
    b.append(text(left - 6, base + 22, "Sales", 9.5, HINT, "end"))
    for i, (_, _, p) in enumerate(daily):
        cx = left + i * step + step / 2
        for j in range(p):
            b.append(f'<circle cx="{cx:.1f}" cy="{base + 18 + j * 10}" r="4" fill="{INK}"/>')
    # x labels
    for i, (d, _, _) in enumerate(daily):
        if i % 2 == 0 or d in ("1",):
            x = left + i * step + step / 2
            b.append(text(x, h - 8, d, 9.5, HINT, "middle"))
    b.append(text(left + step * 0.5, h - 22 + 4, "", 9))
    b.append(text(left, h - 8 + 0, "", 9))
    b.append(text(left + 7.5 * step, h - 22, "September", 9.5, MUTED, "middle", 600))
    b.append(text(left + 20 * step, h - 22, "October", 9.5, MUTED, "middle", 600))
    return svg(w, h, "".join(b), "Daily spend with learning resets and daily sales")


def weekly_roas_chart():
    weeks = [("16–22 Sep", 0.47), ("23–29 Sep", 0.38), ("30 Sep–6 Oct", 0.43), ("7–10 Oct*", 0.11)]
    w, h = 300, 210
    left, base, top = 30, 170, 14
    vmax = 2.0
    b = []
    for v in (0, 0.5, 1.0, 1.5, 2.0):
        y = base - (base - top) * v / vmax
        b.append(f'<line x1="{left}" y1="{y:.1f}" x2="{w - 6}" y2="{y:.1f}" stroke="{GRID}"/>')
        b.append(text(left - 6, y + 4, f"{v:.1f}", 9.5, HINT, "end"))
    # break-even band 1.7-2.0
    y1 = base - (base - top) * 2.0 / vmax
    y2 = base - (base - top) * 1.7 / vmax
    b.append(f'<rect x="{left}" y="{y1:.1f}" width="{w - 6 - left}" height="{y2 - y1:.1f}" fill="#e9f1e6"/>')
    b.append(text(w - 10, y1 + 13, "Likely break-even zone", 9.5, "#3F6B4F", "end", 600))
    # previous setup reference
    yp = base - (base - top) * 0.67 / vmax
    b.append(f'<line x1="{left}" y1="{yp:.1f}" x2="{w - 6}" y2="{yp:.1f}" stroke="{PREV}" stroke-width="2"/>')
    b.append(text(w - 10, yp - 5, "Previous setup 0.67", 9.5, INK, "end", 600))
    slot = (w - 6 - left) / 4
    for i, (lab, v) in enumerate(weeks):
        x = left + i * slot + (slot - 24) / 2
        hh = (base - top) * v / vmax
        b.append(rbar_v(x, base, 24, hh, NEW))
        b.append(text(x + 12, base - hh - 5, f"{v:.2f}", 11, INK, "middle", 700))
        b.append(text(x + 12, base + 15, lab, 9, MUTED, "middle"))
    return svg(w, h, "".join(b), "Weekly ROAS of the new setup")


def funnel_chart():
    steps = [("Link clicks", 1185, None, None), ("Landing page loaded", 661, "56% of clicks", "44% drop before page loads"),
             ("Added to cart", 51, "7.7% of visitors", None), ("Started checkout", 45, "88% of carts", None),
             ("Purchased", 22, "49% of checkouts", "Half abandon at checkout")]
    w, label_w = 654, 140
    bar_h, gap = 24, 16
    plot_w = 290
    h = len(steps) * (bar_h + gap)
    note_x = label_w + plot_w + 50
    b = []
    for i, (lab, v, note, leak) in enumerate(steps):
        y = i * (bar_h + gap)
        bw = max(3, plot_w * v / 1185)
        b.append(text(label_w - 10, y + 16, lab, 11.5, INK, "end", 500))
        b.append(rbar_h(label_w, y, bw, bar_h, NEW))
        b.append(text(label_w + bw + 8, y + 16, f"{v:,}", 12, INK, "start", 700))
        if note:
            b.append(text(note_x, y + (10 if leak else 16), note, 11, MUTED))
        if leak:
            b.append(text(note_x, y + 24, "▲ " + leak, 10.5, "#C2492E", "start", 700))
    return svg(w, h, "".join(b), "Purchase funnel for the new setup")


def emq_chart():
    rows = [("Page view", 5.5), ("View product", 5.5), ("Add to cart", 6.9),
            ("Checkout started", 6.7), ("Payment info", 9.3), ("Purchase", None)]
    w, label_w = 300, 108
    bar_h, gap = 18, 10
    plot_w = 140
    h = len(rows) * (bar_h + gap)
    b = [f'<line x1="{label_w}" y1="0" x2="{label_w}" y2="{h - 6}" stroke="{GRID}"/>']
    for i, (lab, v) in enumerate(rows):
        y = i * (bar_h + gap)
        b.append(text(label_w - 8, y + 13, lab, 11, INK, "end", 500 if v else 700))
        if v is None:
            b.append(f'<rect x="{label_w}" y="{y}" width="{plot_w}" height="{bar_h}" fill="none" '
                     f'stroke="#C2492E" stroke-width="1.5" rx="4"/>')
            b.append(text(label_w + plot_w / 2, y + 13, "Not reported", 10.5, "#C2492E", "middle", 700))
        else:
            bw = plot_w * v / 10
            b.append(rbar_h(label_w, y, bw, bar_h, PREV))
            b.append(text(label_w + bw + 6, y + 13, f"{v}/10", 11, INK, "start", 700))
    return svg(w, h, "".join(b), "Meta event match quality by event")


def roas_ladder():
    w, h = 690, 128
    left, right = 20, 20
    vmax = 2.2
    plot_w = w - left - right
    y = 54
    b = []
    def X(v): return left + plot_w * v / vmax
    # track
    b.append(f'<rect x="{left}" y="{y}" width="{plot_w}" height="14" rx="7" fill="#f4f0e8"/>')
    b.append(f'<rect x="{X(1.7):.1f}" y="{y}" width="{X(2.0) - X(1.7):.1f}" height="14" fill="#cfe2c9"/>')
    for v in (0, 0.5, 1.0, 1.5, 2.0):
        b.append(text(X(v), y + 34, f"{v:.1f}", 9.5, HINT, "middle"))
    pts = [(0.37, "Now", "0.37", NEW, -1), (0.67, "Previous setup", "0.67", PREV, -1),
           (1.0, "Target after fixes", "~1.0", INK, 1), (1.85, "Break-even (est.)", "1.7–2.0", "#3F6B4F", -1)]
    for v, lab, vt, col, side in pts:
        x = X(v)
        b.append(f'<circle cx="{x:.1f}" cy="{y + 7}" r="8" fill="{col}" stroke="{SURFACE}" stroke-width="2"/>')
        ty = y - 14 if side < 0 else y + 56
        b.append(text(x, ty, f"{lab}", 10.5, MUTED, "middle", 600))
        b.append(text(x, ty + (-13 if side < 0 else 13), vt, 12.5, INK, "middle", 800))
    return svg(w, h, "".join(b), "ROAS ladder from now to break-even")


def meter(value, goal, color, w=300):
    pct = value / goal
    return (f'<div class="meter"><div class="meter-fill" style="width:{max(pct * 100, 1.5):.1f}%;'
            f'background:{color}"></div></div>')


# ---- page html ------------------------------------------------------------
learning_rows = [
    ("We get", 6, NEW, "6"),
    ("Learning needs", 50, NEUTRAL, "50"),
]
budget_rows = [
    ("Our budget", 1850, NEW, "₹1,850"),
    ("At old cost", 7200, NEUTRAL, "₹7,200"),
    ("At today's cost", 12500, NEUTRAL, "₹12,500"),
]
cmp = {
    "Click-through rate": [("Previous", 2.31, PREV, "2.31%"), ("New", 0.97, NEW, "0.97%")],
    "Visitors who add to cart": [("Previous", 13.6, PREV, "13.6%"), ("New", 7.7, NEW, "7.7%")],
    "Cost per purchase (lower is better)": [("Previous", 1008, PREV, "₹1,008"), ("New", 1748, NEW, "₹1,748")],
    "ROAS (higher is better)": [("Previous", 0.67, PREV, "0.67"), ("New", 0.37, NEW, "0.37")],
}
tracking_rows = [
    ("Purchases the pixel saw", 34, PREV, "34+"),
    ("Purchases credited to ads", 22, NEW, "22"),
]

legend = (f'<div class="legend"><span><i style="background:{PREV}"></i>Previous setup '
          f'(Helium, 12 Aug–10 Sep)</span><span><i style="background:{NEW}"></i>New manager\'s setup '
          f'(Edamame TOF, 16 Sep–10 Oct)</span></div>')

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Meta Ads Health Check</title>
<style>
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; font-family: Inter, 'DejaVu Sans', sans-serif; color:{INK}; background:#F1EBE0; }}
.page {{ width:210mm; height:297mm; padding:15mm 14mm 12mm; background:#FBF8F2; position:relative;
  page-break-after: always; overflow:hidden; }}
.page:last-child {{ page-break-after: auto; }}
.eyebrow {{ font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:{MUTED}; font-weight:700; }}
h1 {{ font-size:30px; line-height:1.1; margin:6px 0 6px; font-weight:800; letter-spacing:-.01em; }}
h2 {{ font-size:21px; margin:2px 0 4px; font-weight:800; letter-spacing:-.01em; }}
.lede {{ font-size:13px; color:{MUTED}; margin:0 0 14px; line-height:1.45; max-width:165mm; }}
.card {{ background:#fff; border:1px solid #E8DFD0; border-radius:14px; padding:14px 16px; margin-bottom:12px; }}
.card h3 {{ font-size:13.5px; margin:0 0 2px; font-weight:700; }}
.card .sub {{ font-size:11px; color:{HINT}; margin:0 0 10px; }}
.grid2 {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }}
.grid4 {{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }}
.kpi {{ background:#fff; border:1px solid #E8DFD0; border-radius:14px; padding:12px 14px; }}
.kpi .l {{ font-size:11px; color:{MUTED}; font-weight:600; }}
.kpi .v {{ font-size:27px; font-weight:800; margin-top:4px; letter-spacing:-.02em; }}
.kpi .n {{ font-size:10.5px; color:{HINT}; margin-top:2px; }}
.verdict {{ background:#1B2A20; color:#fff; border-radius:16px; padding:16px 18px; margin:12px 0; }}
.verdict .t {{ font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#E0A24E; font-weight:700; }}
.verdict p {{ font-size:15px; line-height:1.45; margin:6px 0 0; }}
.pts {{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }}
.pt {{ background:#fff; border:1px solid #E8DFD0; border-radius:14px; padding:12px 14px; font-size:12px; line-height:1.45; color:{MUTED}; }}
.pt b {{ display:block; color:{INK}; font-size:13px; margin-bottom:3px; }}
.pt .num {{ display:inline-flex; width:22px; height:22px; border-radius:50%; align-items:center; justify-content:center;
  background:{INK}; color:#fff; font-size:11px; font-weight:700; margin-bottom:6px; }}
.meter {{ height:12px; background:#f0eadf; border-radius:6px; overflow:hidden; margin:8px 0 4px; }}
.meter-fill {{ height:100%; border-radius:0 4px 4px 0; }}
.legend {{ display:flex; gap:18px; font-size:11px; color:{MUTED}; margin:0 0 10px; flex-wrap:wrap; }}
.legend i {{ display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }}
.note {{ font-size:11.5px; color:{MUTED}; line-height:1.45; margin:6px 0 0; }}
.note b {{ color:{INK}; }}
.foot {{ position:absolute; bottom:8mm; left:14mm; right:14mm; font-size:9px; color:{HINT};
  display:flex; justify-content:space-between; border-top:1px solid #E8DFD0; padding-top:5px; }}
.split {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }}
.col h4 {{ margin:0 0 8px; font-size:13px; display:flex; align-items:center; gap:8px; }}
.col ul {{ margin:0; padding-left:0; list-style:none; }}
.col li {{ font-size:12px; color:{MUTED}; line-height:1.4; padding:7px 0; border-top:1px solid #EFE8DB; }}
.col li b {{ color:{INK}; }}
.chip {{ display:inline-block; font-size:10px; font-weight:700; border-radius:20px; padding:2px 8px; }}
.badge {{ width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:13px; color:#fff; font-weight:800; }}
table.plan {{ width:100%; border-collapse:collapse; font-size:11.5px; }}
table.plan th {{ text-align:left; font-size:10px; color:{HINT}; text-transform:uppercase; letter-spacing:.08em; padding:6px 8px; border-bottom:1px solid #E8DFD0; }}
table.plan td {{ padding:9px 8px; border-bottom:1px solid #EFE8DB; vertical-align:top; color:{MUTED}; line-height:1.4; }}
table.plan td b {{ color:{INK}; }}
.road {{ display:grid; grid-template-columns:repeat(3,1fr); gap:0; position:relative; margin-top:6px; }}
.road .m {{ padding:0 12px 0 0; }}
.road .dot {{ width:14px; height:14px; border-radius:50%; background:{INK}; border:3px solid #fff; box-shadow:0 0 0 1px {INK}; }}
.road .bar {{ position:absolute; top:6px; left:7px; right:20px; height:2px; background:#d9d1c3; z-index:0; }}
.road .m * {{ position:relative; z-index:1; }}
.road .d {{ font-size:12px; font-weight:800; margin-top:8px; }}
.road .x {{ font-size:11.5px; color:{MUTED}; line-height:1.4; margin-top:3px; }}
.qs {{ counter-reset:q; margin:0; padding:0; list-style:none; }}
.qs li {{ counter-increment:q; font-size:12px; color:{INK}; padding:7px 0 7px 30px; position:relative; border-top:1px solid #EFE8DB; line-height:1.4; }}
.qs li:before {{ content:counter(q); position:absolute; left:0; top:6px; width:20px; height:20px; border-radius:50%;
  background:#E0A24E; color:#fff; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; }}
</style></head><body>

<!-- PAGE 1: summary -->
<section class="page">
  <div class="eyebrow">PROMUNCH · Meta ads health check · 10 Oct 2026</div>
  <h1>Why our ads are stuck in<br>"Learning", and what fixes ROAS</h1>
  <p class="lede">Read-only review of the sales campaign the new manager launched on 16 Sep, compared with the setup it replaced. Vippy Soya ad account, Meta-attributed numbers.</p>

  <div class="grid4">
    <div class="kpi"><div class="l">Spent (16 Sep–10 Oct)</div><div class="v">₹38.4K</div><div class="n">main ad set, 25 days</div></div>
    <div class="kpi"><div class="l">Purchases</div><div class="v">22</div><div class="n">~6 a week</div></div>
    <div class="kpi"><div class="l">Cost per purchase</div><div class="v">₹1,748</div><div class="n">previous setup: ₹1,008</div></div>
    <div class="kpi"><div class="l">ROAS</div><div class="v" style="color:#C2492E">0.37</div><div class="n">₹0.37 back per ₹1 spent</div></div>
  </div>

  <div class="card" style="margin-top:12px">
    <h3>Learning progress: 1 of 50 purchases needed</h3>
    <p class="sub">Meta counts purchases in the 7 days after the last big edit. The last reset was 6 Oct.</p>
    {meter(1, 50, NEW)}
    <div style="display:flex;justify-content:space-between;font-size:10.5px;color:{HINT}"><span>1 purchase since reset</span><span>50 needed</span></div>
  </div>

  <div class="verdict">
    <div class="t">The short answer</div>
    <p>It is <b>partly the budget and partly how the campaign is managed</b>. At ₹1,850 a day, no manager could get out of learning. But the ad set was also reset about <b>9 times in 25 days</b>, and the new setup is doing worse than the old one on every efficiency number. Learning alone will not fix ROAS. Five changes will.</p>
  </div>

  <div class="pts">
    <div class="pt"><span class="num">1</span><b>Budget is too small for purchase learning</b>Learning needs ~50 purchases a week. We get 6. That would cost ₹7K to ₹12.5K a day.</div>
    <div class="pt"><span class="num">2</span><b>The ad set never gets a clean week</b>Targeting, budget and creative changes every 2 to 3 days restart learning each time.</div>
    <div class="pt"><span class="num">3</span><b>"Broad" targeting is not broad</b>8 cities, automatic audience off. The old all-India setup got 2.4x the clicks per view.</div>
  </div>

  <div class="card" style="margin-top:12px">
    <h3>Where ROAS stands vs where it needs to be</h3>
    <p class="sub">Break-even depends on our margin; 1.7 to 2.0 is an estimate for a ~₹650 order.</p>
    {roas_ladder()}
  </div>
  <div class="foot"><span>Source: Meta Ads connector (read-only). ROAS = Meta-attributed, 7-day click / 1-day view.</span><span>1 / 5</span></div>
</section>

<!-- PAGE 2: why learning -->
<section class="page">
  <div class="eyebrow">Question 1</div>
  <h2>Why is it still in the learning phase?</h2>
  <p class="lede">Two separate reasons. The first is maths, the second is management.</p>

  <div class="grid2">
    <div class="card">
      <h3>Reason A: not enough purchases</h3>
      <p class="sub">Purchases per week, new setup vs Meta's learning threshold</p>
      {hbar_compare(learning_rows, vmax=50, label_w=104, title="Purchases per week vs needed")}
    </div>
    <div class="card">
      <h3>…and the budget cannot buy 50</h3>
      <p class="sub">Daily budget to buy 50 purchases a week</p>
      {hbar_compare(budget_rows, vmax=12500, label_w=104, title="Daily budget vs needed")}
    </div>
  </div>
  <p class="note" style="margin:-2px 0 12px"><b>What this means:</b> at this budget a purchase campaign stays in "Learning" or "Learning limited" for good. That label alone is not the problem. Small brands run profitably while learning-limited. <b>The real problem is the cost per purchase.</b></p>

  <div class="card">
    <h3>Reason B: the ad set keeps getting reset</h3>
    <p class="sub">Daily spend (grey bars), each restart of learning (numbered orange lines), and each day's sales (one dot per purchase)</p>
    {timeline_chart()}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;font-size:10.5px;color:{MUTED};margin-top:6px">
      {''.join(f'<div><b style="color:{INK}">{k}.</b> {datestr} · {esc(lbl)}</div>' for k, (datestr, lbl) in enumerate(
          [(f"{16 + i} Sep" if i < 15 else f"{i - 14} Oct", resets[i]) for i in sorted(resets)], 1))}
    </div>
  </div>
  <div class="grid2">
    <div class="pt"><b>9 resets in 25 days</b>The longest stretch without a change was 5 days. Learning needs 7. It has never once had a full clean week.</div>
    <div class="pt"><b>The best ad was switched off</b>On 6 Oct the only ad that reliably converts ("Edamame") was turned off for two days. Sales dropped to zero on 6, 7 and 8 Oct.</div>
  </div>
  <div class="foot"><span>Resets = targeting change, budget jump over ~20%, creative swap, ad added or paused (from Meta's change log).</span><span>2 / 5</span></div>
</section>

<!-- PAGE 3: new vs previous -->
<section class="page">
  <div class="eyebrow">Question 2</div>
  <h2>Is the new setup working properly?</h2>
  <p class="lede">Not yet. Compared with the campaign it replaced, it is behind on every number, and it is not improving week to week.</p>
  {legend}
  <div class="grid2">
    {''.join(f'<div class="card"><h3>{esc(k)}</h3><p class="sub">&nbsp;</p>{hbar_compare(v, label_w=70, title=k)}</div>' for k, v in cmp.items())}
  </div>

  <div class="grid2">
    <div class="card">
      <h3>Weekly ROAS of the new setup</h3>
      <p class="sub">Spend rose 60% after week 1. Sales did not follow. *4 days only</p>
      {weekly_roas_chart()}
    </div>
    <div class="card">
      <h3>Targeting: then vs now</h3>
      <p class="sub">The campaign is named "Broad targeting"</p>
      <table class="plan">
        <tr><th></th><th>Previous</th><th>New</th></tr>
        <tr><td><b>Area</b></td><td>All India</td><td>8 metro cities</td></tr>
        <tr><td><b>Automatic audience</b></td><td>On</td><td style="color:#C2492E;font-weight:700">Off</td></tr>
        <tr><td><b>Age</b></td><td>18–65</td><td>18–55</td></tr>
        <tr><td><b>Excludes</b></td><td>None</td><td>IG engagers, 60 days</td></tr>
      </table>
      <p class="note">Meta's own recommendation on this ad set: turn automatic (Advantage+) audience on, for about 7% lower cost per purchase.</p>
    </div>
  </div>
  <div class="foot"><span>Caveat: the previous setup had only 14 purchases and different creatives, so treat it as a direction, not proof.</span><span>3 / 5</span></div>
</section>

<!-- PAGE 4: funnel + tracking + manager -->
<section class="page">
  <div class="eyebrow">Where the money leaks</div>
  <h2>The funnel, and what Meta cannot see</h2>
  <p class="lede">Two leaks on our side of the click, plus a tracking gap that makes results look worse and gives learning less to work with.</p>
  <div class="card">
    <h3>From click to purchase (new setup, 16 Sep–10 Oct)</h3>
    <p class="sub">Bar length = number of people at each step</p>
    {funnel_chart()}
  </div>
  <div class="grid2">
    <div class="card">
      <h3>Some sales are not credited to ads</h3>
      <p class="sub">Purchase events on the site vs those Meta matched to an ad</p>
      {hbar_compare(tracking_rows, vmax=34, label_w=150, title="Pixel purchases vs credited")}
      <p class="note">Part of the gap is organic or WhatsApp sales. Part is probably ad sales Meta cannot match, because Purchase is sent <b>without the click ID</b>. Meta says fixing this typically doubles extra conversions reported.</p>
    </div>
    <div class="card">
      <h3>Signal quality by event (out of 10)</h3>
      <p class="sub">How well Meta can match each event to a person</p>
      {emq_chart()}
      <p class="note">The event that matters most, <b>Purchase</b>, has no score at all.</p>
    </div>
  </div>

  <div class="card">
    <h3>So, is it the new manager?</h3>
    <p class="sub">Partly. Here is the split.</p>
    <div class="split">
      <div class="col"><h4><span class="badge" style="background:#3F6B4F">✓</span>Not their fault</h4><ul>
        <li><b>Budget vs cost:</b> any manager would sit in learning at ₹1,850/day.</li>
        <li><b>ROAS was already weak</b> before they joined (0.67).</li>
        <li><b>Festive season:</b> ad costs are high (₹229 per 1,000 views).</li>
        <li><b>Short time:</b> 3.5 weeks and ₹38K is a small sample.</li></ul></div>
      <div class="col"><h4><span class="badge" style="background:#C2492E">!</span>Their part</h4><ul>
        <li><b>~9 resets in 25 days</b>: no week ever ran clean.</li>
        <li><b>Narrowed a "broad" campaign</b>: automatic audience off.</li>
        <li><b>Creatives swapped in the live ad set</b> instead of tested separately; best ad paused for 2 days.</li>
        <li><b>New ₹300/day ad set</b> is iOS-only and optimises for add to cart, so it can never learn.</li></ul></div>
    </div>
  </div>
  <div class="foot"><span>Pixel count from Meta Events Manager, 13 Sep–10 Oct. Shopify cross-check was not run (no production access in this review).</span><span>4 / 5</span></div>
</section>

<!-- PAGE 5: when ROAS + plan -->
<section class="page">
  <div class="eyebrow">Question 3</div>
  <h2>When can we see real return on ad spend?</h2>
  <p class="lede">Not on the current setup. Exiting learning usually trims cost per purchase by 20 to 40%. We need roughly 5x. If the changes below start this week:</p>
  <div class="card">
    <div class="road"><div class="bar"></div>
      <div class="m"><div class="dot"></div><div class="d">By ~17 Oct</div><div class="x">First clean 7 days. Cost per purchase should head back toward ₹1,000.</div></div>
      <div class="m"><div class="dot"></div><div class="d">Late Oct to early Nov (Diwali)</div><div class="x">2 to 3 stable weeks. Prospecting ROAS ~0.65+, retargeting clearly above 1.</div></div>
      <div class="m"><div class="dot"></div><div class="d">Mid to late Nov</div><div class="x">Decision point. Still above ₹1,200 per purchase after 4 clean weeks means the ad or offer is the problem, not learning.</div></div>
    </div>
  </div>

  <div class="card">
    <h3>The action plan, in order</h3>
    <p class="sub">Highest effect first</p>
    <table class="plan">
      <tr><th style="width:24px">#</th><th>Do this</th><th>Why</th><th style="width:70px">Effect</th><th style="width:70px">Who</th></tr>
      <tr><td><b>1</b></td><td><b>Freeze the main ad set for 7 days</b>; budget moves ±20% max, every 3–4 days</td><td>Gives learning its first clean week</td><td><span class="chip" style="background:#e9f1e6;color:#3F6B4F">High</span></td><td>Manager</td></tr>
      <tr><td><b>2</b></td><td><b>Add a retargeting ad set</b> (₹300–500/day) using the cart, checkout and visitor audiences already built</td><td>45 checkouts started, 22 bought. These audiences exist but no ad uses them.</td><td><span class="chip" style="background:#e9f1e6;color:#3F6B4F">High</span></td><td>Manager</td></tr>
      <tr><td><b>3</b></td><td><b>Fix purchase tracking</b>: Conversions API via the Shopify Meta app, send click ID and contact on Purchase, check COD orders fire it</td><td>Credits sales we are missing and feeds learning more signal</td><td><span class="chip" style="background:#e9f1e6;color:#3F6B4F">High</span></td><td>Us + manager</td></tr>
      <tr><td><b>4</b></td><td><b>Raise order value</b> with bundles and combos aimed at ₹900+</td><td>Average order ~₹650, just over the ₹599 free-shipping line. ROAS rises in step.</td><td><span class="chip" style="background:#e9f1e6;color:#3F6B4F">High</span></td><td>Us</td></tr>
      <tr><td><b>5</b></td><td><b>Test truly broad</b>: all-India, automatic audience on, as its own ad set</td><td>The old broad setup beat the narrow one on every number</td><td><span class="chip" style="background:#FAF1DD;color:#C98A1E">Medium</span></td><td>Manager</td></tr>
      <tr><td><b>6</b></td><td><b>Test creatives in a separate ad set</b>, then move winners in</td><td>Stops creative swaps from resetting the main ad set</td><td><span class="chip" style="background:#FAF1DD;color:#C98A1E">Medium</span></td><td>Manager</td></tr>
      <tr><td><b>7</b></td><td><b>Relabel or fold the "first club" ad set</b>; drop iOS-only unless there is a reason</td><td>At ₹300/day on add to cart it cannot learn</td><td><span class="chip" style="background:#f0eadf;color:{MUTED}">Low</span></td><td>Manager</td></tr>
    </table>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>Ask the manager</h3>
      <ol class="qs">
        <li>Why is automatic audience off in a campaign named "Broad targeting"?</li>
        <li>Why is the "first club" ad set iOS-only and on add to cart?</li>
        <li>What cost per purchase and ROAS are you aiming for, and by when?</li>
        <li>Can we agree on 7 days with no edits, and test creatives separately?</li>
      </ol>
    </div>
    <div class="card">
      <h3>Not covered in this report</h3>
      <ul class="col" style="list-style:none;padding:0;margin:0">
        <li style="font-size:12px;color:{MUTED};padding:6px 0;border-top:1px solid #EFE8DB"><b style="color:{INK}">PROMUNCH Protein Snacks ad account</b>: Meta has not opened it to the connector yet.</li>
        <li style="font-size:12px;color:{MUTED};padding:6px 0;border-top:1px solid #EFE8DB"><b style="color:{INK}">Real Shopify revenue</b>: comparing it with spend gives true ROAS. Needs production read access.</li>
        <li style="font-size:12px;color:{MUTED};padding:6px 0;border-top:1px solid #EFE8DB"><b style="color:{INK}">Gross margin</b>: needed to set an exact break-even ROAS and target cost per purchase.</li>
      </ul>
    </div>
  </div>
  <div class="foot"><span>Nothing in the ad account was changed during this review.</span><span>5 / 5</span></div>
</section>
</body></html>"""

OUT.write_text(html, encoding="utf-8")
print("wrote", OUT)
