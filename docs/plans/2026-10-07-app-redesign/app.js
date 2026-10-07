/* PROMUNCH CRM redesign prototype · shared shell + interactions.
   No network calls. Everything here is illustrative. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const params = new URLSearchParams(location.search);
  if (params.has('frame')) { document.body.classList.add('framed'); window.addEventListener('load', () => setTimeout(() => window.scrollTo(0, 0), 60)); }

  /* ---------------- navigation model ---------------- */
  const NAV = [
    { g: null, items: [
      { id: 'home', label: 'Home', icon: 'house', href: 'index.html#home' },
      { id: 'inbox', label: 'Inbox', icon: 'inbox', href: 'tickets.html#tk-queue', badge: 9 },
      { id: 'orders', label: 'Orders & COD', icon: 'package', href: 'cod-voice.html#or-today', badge: 6 },
    ]},
    { g: 'Grow', items: [
      { id: 'marketing', label: 'Marketing', icon: 'megaphone', href: 'whatsapp.html#wa-home', sub: [
        { id: 'whatsapp', label: 'WhatsApp', href: 'whatsapp.html#wa-home' },
        { id: 'email', label: 'Email', href: 'email.html#em-home' },
      ]},
      { id: 'creators', label: 'Creators', icon: 'sparkles', href: 'influencers.html#inf-board', badge: 4 },
      { id: 'b2b', label: 'B2B & deals', icon: 'handshake', href: 'b2b.html#b2b-home' },
    ]},
    { g: 'Know', items: [
      { id: 'customers', label: 'Customers', icon: 'users', href: 'other.html#cu-list' },
      { id: 'insights', label: 'Insights', icon: 'chart-line', href: 'analytics.html#an-overview' },
    ]},
  ];
  const TABS = {
    wa: [['wa-home', 'Overview'], ['wa-campaigns', 'Campaigns'], ['wa-templates', 'Templates'], ['wa-flows', 'Automations'], ['wa-results', 'Results']],
    em: [['em-home', 'Overview'], ['em-campaigns', 'Campaigns'], ['em-flows', 'Automations'], ['em-templates', 'Templates'], ['em-results', 'Results']],
    tk: [['tk-queue', 'Tickets', 9], ['tk-chats', 'Live chats', 3], ['tk-drafts', 'Email drafts', 4], ['tk-kb', 'Bot knowledge'], ['tk-reports', 'Reports']],
    or: [['or-today', 'Confirm COD', 6], ['or-calls', 'Voice calls'], ['or-all', 'All orders'], ['or-settings', 'Call rules']],
    an: [['an-overview', 'Sales'], ['an-web', 'Website'], ['an-retention', 'Repeat & cohorts'], ['an-products', 'What people buy'], ['an-amazon', 'Amazon']],
    b2b: [['b2b-home', 'Overview'], ['b2b-find', '1 · Find'], ['b2b-review', '2 · Review', 8], ['b2b-track', '3 · Sent & replies'], ['b2b-deals', 'Deals']],
    inf: [['inf-board', 'Board'], ['inf-creators', 'Creators'], ['inf-kits', 'Kits'], ['inf-settings', 'Settings']],
    cu: [['cu-list', 'Customers'], ['cu-segments', 'Segments'], ['cu-popup', 'Sign-up popup']],
    set: [['set-home', 'Connections'], ['set-team', 'Team & access'], ['set-keys', 'API keys'], ['set-brand', 'Brand & email'], ['set-security', 'Security']],
    maya: [['maya-home', 'Ask'], ['maya-saved', 'Saved answers']],
    home: [['home', 'Today'], ['attention', 'Needs you', 7]],
  };
  const MORE = [
    ['whatsapp.html#wa-home', 'message-circle', 'WhatsApp', 'Campaigns, templates, automations'],
    ['email.html#em-home', 'mail', 'Email', 'Campaigns, automations, templates'],
    ['influencers.html#inf-board', 'sparkles', 'Creators', 'Collabs, drafts, kits'],
    ['b2b.html#b2b-home', 'handshake', 'B2B & deals', 'Find, review, send, track'],
    ['other.html#cu-list', 'users', 'Customers', 'People, segments, popup'],
    ['analytics.html#an-overview', 'chart-line', 'Insights', 'Sales, repeat, Amazon'],
    ['other.html#set-home', 'settings', 'Settings', 'Team, connections, keys'],
  ];

  const icon = (n, cls = '') => `<i data-lucide="${n}" class="${cls}"></i>`;

  /* ---------------- shell ---------------- */
  function buildShell() {
    const main = $('main.content');
    if (!main || document.body.dataset.shell === 'none') return;
    const nav = NAV.map(gr => `${gr.g ? `<div class="nav-group">${gr.g}</div>` : ''}<div class="nav">${gr.items.map(it => `
      <a href="${it.href}" data-nav-id="${it.id}" title="${it.label}">${icon(it.icon)}<span>${it.label}</span>${it.badge ? `<em class="badge">${it.badge}</em><i class="dot"></i>` : ''}</a>
      ${it.sub ? `<div class="sub" data-sub-of="${it.id}">${it.sub.map(s => `<a href="${s.href}" data-sub-id="${s.id}">${s.label}</a>`).join('')}</div>` : ''}`).join('')}</div>`).join('');
    const side = `<aside class="side" aria-label="Main">
      <a class="brand" href="index.html#home"><img src="assets/promunch-logo.png" alt="PROMUNCH"><span>CRM</span></a>
      <a class="maya-btn" href="maya.html#maya-home" title="Ask Maya" data-nav-id="maya">${icon('sparkle')}<span>Ask Maya</span><em class="k">⌘J</em></a>
      ${nav}
      <div class="foot">
        <div class="nav"><a href="other.html#set-home" data-nav-id="settings" title="Settings">${icon('settings')}<span>Settings</span></a></div>
        <button class="collapse-btn" data-collapse>${icon('panel-left-close')}<span>Collapse</span></button>
        <a class="me" href="other.html#set-team"><span class="av red sm">KM</span><div><div class="who">Khush Mutha</div><div class="role">Owner</div></div></a>
        <div class="tagline">★ Your Munchy Pal</div>
      </div></aside>`;
    const top = `<div class="topbar">
      <button class="search" data-open="palette">${icon('search')}Search orders, customers, tickets, anything<span class="kbd">⌘K</span></button>
      <span class="sp"></span>
      <button class="icon-btn" data-open="notif" aria-label="Notifications">${icon('bell')}<span class="ping"></span></button>
    </div>
    <div class="mtop"><a href="index.html#home"><img src="assets/promunch-logo.png" alt="PROMUNCH"></a><span class="sp"></span>
      <button class="icon-btn" data-open="palette" aria-label="Search">${icon('search')}</button>
      <button class="icon-btn" data-open="notif" aria-label="Notifications">${icon('bell')}<span class="ping"></span></button></div>`;
    const tab = `<nav class="tabbar" aria-label="Main">
      <a href="index.html#home" data-tab-id="home">${icon('house')}Home</a>
      <a href="tickets.html#tk-queue" data-tab-id="inbox">${icon('inbox')}<em class="badge">9</em>Inbox</a>
      <a href="maya.html#maya-home" class="mid" data-tab-id="maya"><span class="ic">${icon('sparkle')}</span>Maya</a>
      <a href="cod-voice.html#or-today" data-tab-id="orders">${icon('package')}<em class="badge">6</em>Orders</a>
      <button data-open="more">${icon('layout-grid')}More</button></nav>`;
    const wrap = document.createElement('div');
    wrap.className = 'shell';
    main.parentNode.insertBefore(wrap, main);
    wrap.innerHTML = side + '<div class="main"></div>';
    const m = $('.main', wrap);
    m.insertAdjacentHTML('beforeend', top);
    m.appendChild(main);
    document.body.insertAdjacentHTML('beforeend', tab);
  }

  function buildReview() {
    const r = document.createElement('div');
    r.className = 'review';
    r.innerHTML = `<span>★ PROMUNCH CRM <b>redesign prototype</b></span><span class="hide-s">· illustrative data</span><span class="sp"></span>
      <span class="hide-s" id="rv-screen"></span>
      <button data-open="screens">All screens</button><a href="mobile.html" class="hide-s">Phone frames</a><a href="system.html" class="hide-s">Design system</a>`;
    document.body.prepend(r);
  }

  function buildOverlays() {
    const host = document.createElement('div');
    const groups = {};
    (window.MANIFEST || []).forEach(s => { (groups[s.g] = groups[s.g] || []).push(s); });
    const screensHtml = Object.keys(groups).map(g => `<div class="pg">${g}</div>${groups[g].map(s => `<a class="pr" href="${s.f}${s.id ? '#' + s.id : ''}">${icon(s.k === 'overlay' ? 'square-stack' : 'monitor')}<span>${s.t}</span><span class="muted">${s.f}</span></a>`).join('')}`).join('');
    host.innerHTML = `
    <div class="overlay" id="palette" role="dialog" aria-label="Search"><div class="palette">
      <div class="pin">${icon('search')}<input placeholder="Search orders, customers, tickets, pages" aria-label="Search"><span class="kbd">ESC</span></div>
      <div style="max-height:60vh;overflow:auto;padding-bottom:10px">
        <div class="pg">Jump to</div>
        <a class="pr on" href="cod-voice.html#or-today">${icon('package')}COD orders to confirm<span class="muted">6 waiting</span></a>
        <a class="pr" href="tickets.html#tk-queue">${icon('inbox')}My open tickets<span class="muted">4</span></a>
        <a class="pr" href="whatsapp.html#wa-new">${icon('plus')}New WhatsApp campaign<span class="muted">Marketing</span></a>
        <a class="pr" href="influencers.html#inf-board/add">${icon('plus')}Add a creator collab<span class="muted">Creators</span></a>
        <div class="pg">Customers</div>
        <a class="pr" href="other.html#cu-profile">${icon('user')}Priya Sharma<span class="muted">Pune · 6 orders · ₹4,812</span></a>
        <a class="pr" href="other.html#cu-profile">${icon('user')}Rahul Verma<span class="muted">Indore · 2 orders</span></a>
        <div class="pg">Orders</div>
        <a class="pr" href="cod-voice.html#or-all/order">${icon('receipt')}#PM-2841 · Ananya Iyer<span class="muted">COD · ₹749 · waiting</span></a>
        <div class="pg">Ask Maya</div>
        <a class="pr" href="maya.html#maya-chat">${icon('sparkle')}"Which flavour do repeat buyers pick second?"<span class="muted">Ask</span></a>
      </div></div></div>

    <div class="overlay right" id="notif" role="dialog" aria-label="Notifications"><div class="drawer">
      <div class="dh"><div class="t"><span class="eyebrow">★ Updates</span><h2>Notifications</h2></div><button class="x" data-close>${icon('x')}</button></div>
      <div class="db" style="padding:8px 0">
        <div class="list-row"><span class="ic bad">${icon('alarm-clock')}</span><div class="tx"><b>Ticket #1182 breached its 4h reply time</b><span>Damaged pouch · Meera Nair · 12 min ago</span></div></div>
        <div class="list-row"><span class="ic good">${icon('phone-call')}</span><div class="tx"><b>Voice agent confirmed 4 COD orders</b><span>₹3,196 safe to ship · 25 min ago</span></div></div>
        <div class="list-row"><span class="ic sun">${icon('clapperboard')}</span><div class="tx"><b>@fitwithaditi sent her draft</b><span>Review within 24h · 1 h ago</span></div></div>
        <div class="list-row"><span class="ic info">${icon('message-circle')}</span><div class="tx"><b>Diwali campaign finished sending</b><span>812 delivered · 38 orders so far · 2 h ago</span></div></div>
        <div class="list-row"><span class="ic warn">${icon('package-x')}</span><div class="tx"><b>Amazon: Masala Mania 100g runs out in 6 days</b><span>Send stock to FBA this week · 3 h ago</span></div></div>
      </div>
      <div class="df"><button class="btn ghost sm" data-toast="All caught up">Mark all read</button><a class="btn sm" href="other.html#set-home/notif-settings">Settings</a></div>
    </div></div>

    <div class="overlay" id="more" role="dialog" aria-label="More"><div class="modal">
      <div class="mh"><h2>Everything else</h2><button class="x" data-close>${icon('x')}</button></div>
      <div class="divide">${MORE.map(m => `<a class="list-row" style="padding:14px 4px" href="${m[0]}"><span class="ic">${icon(m[1])}</span><div class="tx"><b>${m[2]}</b><span>${m[3]}</span></div>${icon('chevron-right')}</a>`).join('')}</div>
    </div></div>

    <div class="overlay" id="screens" role="dialog" aria-label="All screens"><div class="palette" style="margin-top:5vh">
      <div class="pin">${icon('layout-grid')}<b style="flex:1">All prototype screens and pop-ups</b><button class="x" data-close>${icon('x')}</button></div>
      <div style="max-height:72vh;overflow:auto;padding-bottom:12px">${screensHtml}</div></div></div>
    <div class="toasts" aria-live="polite"></div>`;
    document.body.appendChild(host);
  }

  /* ---------------- routing ---------------- */
  function setNav(nav, sub) {
    $$('[data-nav-id]').forEach(a => a.classList.toggle('on', a.dataset.navId === nav));
    $$('.nav .sub').forEach(s => s.classList.toggle('open', s.dataset.subOf === nav));
    $$('[data-sub-id]').forEach(a => a.classList.toggle('on', a.dataset.subId === sub));
    $$('[data-tab-id]').forEach(a => a.classList.toggle('on', a.dataset.tabId === nav || (nav === 'maya' && a.dataset.tabId === 'maya')));
  }
  function route() {
    const screens = $$('.screen');
    if (!screens.length) { setNav(document.body.dataset.nav, document.body.dataset.sub); return; }
    const [id, ov] = (location.hash.replace('#', '') || params.get('s') || '').split('/');
    let s = screens.find(x => x.id === id) || screens[0];
    screens.forEach(x => x.classList.toggle('on', x === s));
    setNav(s.dataset.nav || document.body.dataset.nav, s.dataset.sub || document.body.dataset.sub);
    const rv = $('#rv-screen'); if (rv) rv.textContent = s.dataset.title || '';
    document.title = (s.dataset.title ? s.dataset.title + ' · ' : '') + 'PROMUNCH CRM';
    closeAll();
    if (ov) open(ov);
    if (!ov) window.scrollTo(0, 0);
    requestAnimationFrame(drawCharts);
  }

  /* ---------------- overlays ---------------- */
  function open(id) { const o = document.getElementById(id); if (o) { o.classList.add('open'); requestAnimationFrame(drawCharts); } }
  function closeAll() { $$('.overlay.open').forEach(o => o.classList.remove('open')); $$('.menu.open').forEach(m => m.classList.remove('open')); }
  function toast(msg, opts = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (opts.err ? ' err' : '');
    t.innerHTML = `${icon(opts.err ? 'circle-alert' : 'circle-check')}<span>${msg}</span>${opts.undo ? '<button>Undo</button>' : ''}`;
    $('.toasts').appendChild(t);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => t.remove(), 3600);
  }
  window.pmToast = toast;

  /* ---------------- charts ---------------- */
  const fmt = (v, f) => {
    if (f === 'inr') return v >= 100000 ? '₹' + (v / 100000).toFixed(v >= 1000000 ? 0 : 1) + 'L' : v >= 1000 ? '₹' + Math.round(v / 1000) + 'k' : '₹' + v;
    if (f === 'pct') return v + '%';
    return v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : String(v);
  };
  const cssv = c => c && c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() : c;
  function drawCharts() {
    $$('.chart[data-chart]').forEach(el => {
      if (!el.offsetParent) return;
      const cfg = JSON.parse(el.dataset.chart);
      const W = Math.max(240, el.clientWidth), H = cfg.h || 220;
      if (el.dataset.w == W) return; el.dataset.w = W;
      let svg = '';
      if (cfg.type === 'donut') {
        const tot = cfg.data.reduce((a, b) => a + b.v, 0); let a0 = -Math.PI / 2; const R = 70, r = 48, cx = 80, cy = 80;
        cfg.data.forEach(d => { const a1 = a0 + d.v / tot * Math.PI * 2; const L = a1 - a0 > Math.PI ? 1 : 0;
          const p = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
          const [x0, y0] = p(a0, R), [x1, y1] = p(a1 - 0.012, R), [x2, y2] = p(a1 - 0.012, r), [x3, y3] = p(a0, r);
          svg += `<path d="M${x0} ${y0}A${R} ${R} 0 ${L} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${L} 0 ${x3} ${y3}Z" fill="${cssv(d.c)}"/>`; a0 = a1; });
        svg += `<text x="80" y="78" text-anchor="middle" style="font:400 22px 'Archivo Black'">${cfg.center || ''}</text><text x="80" y="98" text-anchor="middle" class="ax">${cfg.sub || ''}</text>`;
        el.innerHTML = `<svg viewBox="0 0 160 160" role="img" aria-label="${cfg.label || 'chart'}">${svg}</svg>`; return;
      }
      const pad = { l: cfg.spark ? 0 : 44, r: cfg.spark ? 0 : 8, t: 10, b: cfg.spark ? 0 : 28 };
      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const all = cfg.stacked ? cfg.labels.map((_, i) => cfg.series.reduce((a, s) => a + s.data[i], 0)) : cfg.series.flatMap(s => s.data);
      let max = Math.max(...all) * 1.12; const step = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / step) * step;
      const y = v => pad.t + ih - v / max * ih;
      if (!cfg.spark) for (let i = 0; i <= 4; i++) { const v = max / 4 * i; svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#EFEBE3"/><text class="ax" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(Math.round(v), cfg.fmt)}</text>`; }
      const n = cfg.labels.length;
      const every = Math.ceil(n / Math.max(2, Math.floor(iw / 64)));
      if (cfg.type === 'bar') {
        const bw = iw / n; const gw = Math.min(46, bw * .62);
        cfg.labels.forEach((lb, i) => {
          let base = 0; const k = cfg.stacked ? 1 : cfg.series.length;
          cfg.series.forEach((s, j) => { const v = s.data[i]; const w = gw / k; const x = pad.l + bw * i + (bw - gw) / 2 + (cfg.stacked ? 0 : j * w);
            const y0 = y(base + (cfg.stacked ? v : v)); const h = (cfg.stacked ? y(base) : y(0)) - y0;
            svg += `<rect x="${x}" y="${y0}" width="${Math.max(2, w - 2)}" height="${Math.max(0, h)}" rx="4" fill="${cssv(s.color)}"><title>${lb} · ${s.name}: ${fmt(v, cfg.fmt)}</title></rect>`;
            if (cfg.stacked) base += v; });
          if (!cfg.spark && i % every === 0) svg += `<text class="ax" x="${pad.l + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${lb}</text>`;
        });
      } else {
        const x = i => pad.l + (n === 1 ? iw / 2 : i / (n - 1) * iw);
        cfg.series.forEach((s, j) => {
          const pts = s.data.map((v, i) => [x(i), y(v)]);
          const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
          const col = cssv(s.color);
          if (cfg.type === 'area' && j === 0) svg += `<path d="${d}L${x(n - 1)} ${y(0)}L${x(0)} ${y(0)}Z" fill="${col}" opacity=".12"/>`;
          svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${j === 0 ? 2.6 : 2}" ${s.dash ? 'stroke-dasharray="5 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
          if (!cfg.spark && j === 0) { const lp = pts[pts.length - 1]; svg += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4.5" fill="${col}" stroke="#fff" stroke-width="2"/>`; }
        });
        if (!cfg.spark) cfg.labels.forEach((lb, i) => { if (i % every === 0 || i === n - 1 && (n - 1) % every > every / 2) svg += `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${lb}</text>`; });
      }
      el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.label || 'chart'}">${svg}</svg>`;
    });
    $$('table.heat[data-heat]').forEach(t => {
      if (t.dataset.done) return; t.dataset.done = 1;
      $$('td[data-v]', t).forEach(td => { const v = +td.dataset.v; td.textContent = v + '%'; const a = Math.min(1, v / 26);
        td.style.background = `rgba(175,39,47,${(0.06 + a * 0.84).toFixed(2)})`; td.style.color = a > .45 ? '#fff' : 'var(--ink)'; });
    });
  }
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { $$('.chart').forEach(c => delete c.dataset.w); drawCharts(); }, 120); });

  /* ---------------- interactions ---------------- */
  document.addEventListener('click', e => {
    const t = e.target;
    const op = t.closest('[data-open]'); if (op) { e.preventDefault(); closeAll(); open(op.dataset.open); return; }
    if (t.closest('[data-close]')) { e.preventDefault(); closeAll(); return; }
    if (t.classList && t.classList.contains('overlay')) { closeAll(); return; }
    const ts = t.closest('[data-toast]'); if (ts) { if (ts.closest('.overlay') && !ts.hasAttribute('data-keep')) closeAll(); toast(ts.dataset.toast, { undo: ts.hasAttribute('data-undo'), err: ts.hasAttribute('data-err') }); }
    const mb = t.closest('[data-menu]'); if (mb) { e.preventDefault(); const m = document.getElementById(mb.dataset.menu); const was = m.classList.contains('open'); $$('.menu.open').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); return; }
    if (!t.closest('.menu')) $$('.menu.open').forEach(x => x.classList.remove('open'));
    const sg = t.closest('.seg button'); if (sg) { $$('button', sg.parentNode).forEach(b => b.classList.toggle('on', b === sg)); }
    const ch = t.closest('.chips[data-single] .chip'); if (ch) { $$('.chip', ch.parentNode).forEach(b => b.classList.toggle('on', b === ch)); }
    const chm = t.closest('.chips[data-multi] .chip'); if (chm) chm.classList.toggle('on');
    const sw = t.closest('.switch'); if (sw) { sw.classList.toggle('on'); if (sw.dataset.toastOn || sw.dataset.toastOff) toast(sw.classList.contains('on') ? sw.dataset.toastOn : sw.dataset.toastOff); }
    const rc = t.closest('.radio-card'); if (rc && rc.parentNode.dataset.group !== undefined) { $$('.radio-card', rc.parentNode).forEach(b => b.classList.toggle('on', b === rc)); }
    const ck = t.closest('.check[data-tog]'); if (ck) ck.classList.toggle('on');
    const md = t.closest('.composer .mode button'); if (md) { const c = md.closest('.composer'); $$('.mode button', c).forEach(b => b.classList.toggle('on', b === md)); c.classList.toggle('notem', md.dataset.mode === 'note'); const bx = $('.box', c); if (bx) bx.textContent = md.dataset.mode === 'note' ? 'Internal note. Only the team sees this. Type @ to mention someone.' : 'Reply to the customer on WhatsApp. Type / for a saved reply.'; }
    const tk = t.closest('.ibx .tk'); if (tk) { $$('.tk', tk.parentNode).forEach(x => x.classList.toggle('on', x === tk)); tk.classList.remove('unread'); tk.closest('.ibx').classList.add('show-conv'); }
    if (t.closest('[data-ibx-back]')) { const ib = t.closest('.ibx'); if (ib) ib.classList.remove('show-conv'); }
    if (t.closest('[data-collapse]')) { document.body.classList.toggle('rail'); $$('.chart').forEach(c => delete c.dataset.w); setTimeout(drawCharts, 50); }
    const nx = t.closest('[data-next],[data-prev],[data-goto]'); if (nx) { const w = nx.closest('.wiz'); if (w) { const panes = $$('[data-step]', w); let i = panes.findIndex(p => !p.hidden); i = nx.dataset.goto ? +nx.dataset.goto : i + (nx.hasAttribute('data-next') ? 1 : -1); i = Math.max(0, Math.min(panes.length - 1, i)); panes.forEach((p, k) => p.hidden = k !== i); $$('.steps .step', w).forEach((s, k) => { s.classList.toggle('done', k < i); s.classList.toggle('on', k === i); }); w.scrollIntoView({ block: 'start' }); requestAnimationFrame(drawCharts); } }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); closeAll(); open('palette'); setTimeout(() => { const i = $('#palette input'); if (i) i.focus(); }, 30); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); location.href = 'maya.html#maya-home'; }
    if (e.key === 'Escape') closeAll();
  });

  function tabs() {
    $$('[data-tabs]').forEach(h => {
      const set = TABS[h.dataset.tabs]; if (!set) return;
      const active = h.dataset.active || (h.closest('.screen') || {}).id;
      const nav = document.createElement('nav'); nav.className = 'tabs'; nav.setAttribute('aria-label', 'Section');
      nav.innerHTML = set.map(([id, lb, n]) => `<a href="${id.includes('.html') ? id : '#' + id}" class="${id === active ? 'on' : ''}">${lb}${n ? `<span class="n">${n}</span>` : ''}</a>`).join('');
      h.appendChild(nav);
    });
  }

  buildReview();
  buildShell();
  buildOverlays();
  tabs();
  window.addEventListener('hashchange', route);
  route();
  if (window.lucide) lucide.createIcons();
  document.fonts && document.fonts.ready.then(() => { $$('.chart').forEach(c => delete c.dataset.w); drawCharts(); });
})();
