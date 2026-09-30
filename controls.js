/* Fluo — controles próprios no lugar dos nativos (select e calendário).
   O <select>/<input type=date> original continua no DOM (escondido) guardando o valor,
   então o resto do app lê .value normalmente; mudanças disparam "input" e "change". */
(() => {
  const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const DOW = ["D","S","T","Q","Q","S","S"];
  let open = null; // { pop, anchor, close }

  const fire = el => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const parse = s => { const [y, m, d] = (s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
  const fmt = s => { const d = parse(s); return d ? d.getDate() + " de " + MES[d.getMonth()] + " de " + d.getFullYear() : "Escolher data"; };

  function closeAll() { if (open) { const o = open; open = null; o.pop.classList.add("out"); o.anchor.setAttribute("aria-expanded", "false"); setTimeout(() => o.pop.remove(), 140); } }
  function place(pop, anchor) {
    pop.style.maxHeight = ""; pop.style.minWidth = anchor.getBoundingClientRect().width + "px";
    const r = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, pw = pop.offsetWidth;
    const below = vh - r.bottom - 14, above = r.top - 14, up = pop.offsetHeight > below && above > below;
    pop.style.maxHeight = Math.max(120, up ? above : below) + "px";           // limita antes de medir a altura final
    const ph = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, vw - pw - 8)) + "px";
    const top = up ? r.top - ph - 6 : r.bottom + 6;                          // não cobre o campo…
    pop.style.top = Math.max(8, Math.min(top, vh - ph - 8)) + "px";         // …e nunca sai da tela
    pop.style.transformOrigin = up ? "bottom" : "top";
  }
  function popover(anchor, cls, build) {
    closeAll();
    const pop = document.createElement("div"); pop.className = "cpop " + cls; pop.setAttribute("role", "dialog");
    document.body.appendChild(pop); build(pop); place(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
    open = { pop, anchor, t: Date.now() };
    return pop;
  }
  addEventListener("pointerdown", e => { if (open && !open.pop.contains(e.target) && !open.anchor.contains(e.target)) closeAll(); }, true);
  addEventListener("keydown", e => { if (e.key === "Escape" && open) { e.stopPropagation(); const a = open.anchor; closeAll(); a.focus(); } }, true);
  addEventListener("resize", closeAll);
  // rolar a página fecha (como nos menus nativos), mas não a rolagem causada pela própria abertura
  document.addEventListener("scroll", e => { if (open && !open.pop.contains(e.target) && Date.now() - open.t > 500) closeAll(); }, true);

  /* ---------- select ---------- */
  function enhanceSelect(sel) {
    if (sel.dataset.cx) return; sel.dataset.cx = "1";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "cselect" + (sel.classList.contains("inline") ? " cs-inline" : "");
    btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
    const lbl = sel.getAttribute("aria-label") || sel.closest("label")?.firstChild?.textContent?.trim(); if (lbl) btn.setAttribute("aria-label", lbl);
    if (sel.id) btn.id = sel.id + "_btn";
    btn.style.cssText = sel.style.cssText;
    sel.after(btn); sel.classList.add("cx-hidden"); sel.tabIndex = -1;
    const sync = () => { const o = sel.selectedOptions[0]; btn.innerHTML = `<span class="cs-val">${o ? o.textContent : "—"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`; };
    sync(); sel.addEventListener("change", sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true });
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value"); // valor definido por código também atualiza o botão
    Object.defineProperty(sel, "value", { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
    const choose = (o) => { if (sel.value !== o.value) { sel.value = o.value; fire(sel); } closeAll(); btn.focus(); };
    const openList = () => {
      if (open?.anchor === btn) return closeAll();
      const pop = popover(btn, "clist", p => {
        p.setAttribute("role", "listbox");
        [...sel.options].forEach((o, i) => {
          const it = document.createElement("button"); it.type = "button"; it.className = "copt"; it.setAttribute("role", "option");
          it.setAttribute("aria-selected", o.selected); it.innerHTML = `<span>${o.textContent}</span><i aria-hidden="true">✓</i>`;
          it.style.setProperty("--d", Math.min(i, 12) * 18 + "ms");
          it.onclick = () => choose(o); p.appendChild(it);
        });
      });
      const cur = pop.querySelector('[aria-selected="true"]') || pop.firstChild;
      cur?.focus({ preventScroll: true });
      if (cur) pop.scrollTop = cur.offsetTop - pop.clientHeight / 2 + cur.offsetHeight / 2;
      pop.onkeydown = e => {
        const items = [...pop.children], i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
        else if (e.key === "Tab") closeAll();
        else if (e.key.length === 1) { const k = e.key.toLowerCase(); items.find((x, j) => j > i && x.textContent.replace(/^\W+/, "").toLowerCase().startsWith(k))?.focus() || items.find(x => x.textContent.replace(/^\W+/, "").toLowerCase().startsWith(k))?.focus(); }
      };
    };
    btn.onclick = openList;
    btn.onkeydown = e => { if (["ArrowDown", "ArrowUp", " ", "Enter"].includes(e.key)) { e.preventDefault(); openList(); } };
  }

  /* ---------- calendário ---------- */
  function enhanceDate(inp) {
    if (inp.dataset.cx) return; inp.dataset.cx = "1";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "cselect cdate"; btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
    if (inp.id) btn.id = inp.id + "_btn";
    inp.after(btn); inp.classList.add("cx-hidden"); inp.tabIndex = -1;
    const sync = () => { btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="cal-ic"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span class="cs-val">${fmt(inp.value)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`; };
    sync(); inp.addEventListener("change", sync); inp.addEventListener("input", sync);
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(inp, "value", { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
    const openCal = () => {
      if (open?.anchor === btn) return closeAll();
      let view = parse(inp.value) || new Date(); view = new Date(view.getFullYear(), view.getMonth(), 1);
      const pop = popover(btn, "ccal", () => {});
      const draw = (dir) => {
        const sel = inp.value, today = iso(new Date());
        const first = new Date(view.getFullYear(), view.getMonth(), 1), start = new Date(first); start.setDate(1 - first.getDay());
        let cells = ""; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const v = iso(d);
          cells += `<button type="button" class="cday${d.getMonth() !== view.getMonth() ? " other" : ""}${v === today ? " today" : ""}${v === sel ? " sel" : ""}" data-v="${v}" aria-label="${fmt(v)}">${d.getDate()}</button>`; }
        pop.innerHTML = `<div class="cal-head"><button type="button" class="cal-nav" data-n="-1" aria-label="Mês anterior">‹</button>
          <b>${MES[view.getMonth()]} <span>${view.getFullYear()}</span></b><button type="button" class="cal-nav" data-n="1" aria-label="Próximo mês">›</button></div>
          <div class="cal-grid ${dir ? (dir > 0 ? "slide-l" : "slide-r") : ""}">${DOW.map(x => `<span class="dow">${x}</span>`).join("")}${cells}</div>
          <div class="cal-foot"><button type="button" class="cal-today">Hoje</button><button type="button" class="cal-close">Fechar</button></div>`;
        pop.querySelectorAll(".cal-nav").forEach(b => b.onclick = () => { view.setMonth(view.getMonth() + +b.dataset.n); draw(+b.dataset.n); });
        pop.querySelectorAll(".cday").forEach(b => b.onclick = () => { inp.value = b.dataset.v; fire(inp); closeAll(); btn.focus(); });
        pop.querySelector(".cal-today").onclick = () => { inp.value = today; fire(inp); closeAll(); btn.focus(); };
        pop.querySelector(".cal-close").onclick = () => { closeAll(); btn.focus(); };
        place(pop, btn);
      };
      draw(0);
      (pop.querySelector(".cday.sel") || pop.querySelector(".cday.today"))?.focus({ preventScroll: true });
      pop.onkeydown = e => {
        const a = document.activeElement; if (!a?.classList.contains("cday")) return;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!step) return;
        e.preventDefault(); const d = parse(a.dataset.v); d.setDate(d.getDate() + step); const v = iso(d);
        if (d.getMonth() !== view.getMonth()) { view = new Date(d.getFullYear(), d.getMonth(), 1); draw(step > 0 ? 1 : -1); }
        pop.querySelector(`.cday[data-v="${v}"]`)?.focus();
      };
    };
    btn.onclick = openCal;
  }

  /* ---------- cor (paleta própria no lugar do seletor do sistema) ---------- */
  const COLORS = ["#0e8f7e","#3cc9b3","#1b9ad1","#1d4fa8","#5663e8","#8a6fd1","#7a2fb0","#b04fa6","#e0533d","#d85a5a","#f08a24","#c98a12","#7a8a3a","#2e7d4f","#6b7389","#2e2a26"];
  function enhanceColor(inp) {
    if (inp.dataset.cx) return; inp.dataset.cx = "1";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "cswatch " + inp.className.replace("swatch", "");
    btn.setAttribute("aria-label", inp.getAttribute("aria-label") || "Cor"); btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
    btn.style.cssText = inp.style.cssText; btn.style.background = inp.value;
    inp.after(btn); inp.classList.add("cx-hidden"); inp.tabIndex = -1;
    btn.onclick = () => {
      if (open?.anchor === btn) return closeAll();
      const pop = popover(btn, "ccolor", p => {
        p.innerHTML = COLORS.map((c, i) => `<button type="button" class="ccol${c.toLowerCase() === inp.value.toLowerCase() ? " sel" : ""}" data-c="${c}" style="background:${c};--d:${i * 12}ms" aria-label="Cor ${c}"></button>`).join("");
        p.querySelectorAll(".ccol").forEach(b => b.onclick = () => { inp.value = b.dataset.c; btn.style.background = b.dataset.c; fire(inp); closeAll(); btn.focus(); });
      });
      (pop.querySelector(".sel") || pop.firstChild).focus({ preventScroll: true });
    };
  }

  /* ---------- ícones próprios (no lugar de emoji) ---------- */
  const ICONS = {
    salario: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
    extra: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
    invest: '<path d="M3 17l6-6 4 4 7-8"/><path d="M15 6h5v5"/>',
    moradia: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
    contas: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
    transporte: '<path d="M4 16l1.5-5A2 2 0 0 1 7.4 9.5h9.2A2 2 0 0 1 18.5 11L20 16"/><rect x="3" y="16" width="18" height="4" rx="1.5"/><circle cx="7.5" cy="18" r="1.2"/><circle cx="16.5" cy="18" r="1.2"/>',
    alimentacao: '<path d="M7 3v8a2 2 0 0 0 4 0V3"/><path d="M9 11v10"/><path d="M16 3c-1.5 0-2.5 1.5-2.5 4s1 4 2.5 4v10"/>',
    assinaturas: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    saude: '<path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5c-2.3 4.6-9.3 9-9.3 9z"/>',
    lazer: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M14 6v12" stroke-dasharray="2 3"/>',
    compras: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    outros: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    tag: '<path d="M3 11.5V5a1 1 0 0 1 1-1h6.5L21 14.5 12.5 23 3 13.5z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8" stroke-linecap="round"/>',
    repeat: '<path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/><path d="M12 4l3 3-3 3M12 20l-3-3 3-3"/>',
    card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M4 20h16"/>',
    handshake: '<path d="M2 12l5-4 4 3 4-3 5 4"/><path d="M9 11l3 2.5L15 11"/><path d="M2 12v3l5 4 4-3 4 3 5-4v-3"/>',
    wave: '<path d="M4 15c1.5-4 3-6 3-9a2 2 0 0 1 4 0v6"/><path d="M11 6a2 2 0 0 1 4 0v5"/><path d="M15 7a2 2 0 0 1 4 0v6"/><path d="M19 10a2 2 0 0 1 3 1.7c0 4.6-2.7 9.3-8 9.3-4 0-6-2-8-5l-2.3-4A1.8 1.8 0 0 1 7 9.8L8 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    eye: '<path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.7a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.3a7 7 0 0 0-2 1.2l-2.4-.7-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-.7a7 7 0 0 0 2 1.2L10 21h4l.5-2.3a7 7 0 0 0 2-1.2l2.4.7 2-3.4-2-1.6a7 7 0 0 0 .1-1.2z"/>',
  };
  function iconSVG(key, size) {
    const d = ICONS[key]; if (!d) return null;
    return `<svg viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function enhanceIcon(inp) {
    if (inp.dataset.cx) return; inp.dataset.cx = "1";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "cicon";
    btn.setAttribute("aria-label", inp.getAttribute("aria-label") || "Ícone"); btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
    const paint = () => btn.innerHTML = iconSVG(inp.value, 20) || esc(inp.value) || iconSVG("tag", 20);
    paint(); inp.after(btn); inp.classList.add("cx-hidden"); inp.tabIndex = -1;
    btn.onclick = () => {
      if (open?.anchor === btn) return closeAll();
      const pop = popover(btn, "cicons", p => {
        p.innerHTML = Object.keys(ICONS).map((k, i) => `<button type="button" class="cicn${k === inp.value ? " sel" : ""}" data-i="${k}" style="--d:${i * 10}ms" aria-label="${k}">${iconSVG(k, 22)}</button>`).join("");
        p.querySelectorAll(".cicn").forEach(b => b.onclick = () => { inp.value = b.dataset.i; paint(); fire(inp); closeAll(); btn.focus(); });
      });
      (pop.querySelector(".sel") || pop.firstChild).focus({ preventScroll: true });
    };
  }
  const esc = s => (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- ver/ocultar senha ---------- */
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/><path d="M3 3l18 18" stroke-linecap="round"/></svg>';
  function enhancePassword(inp) {
    if (inp.dataset.cx) return; inp.dataset.cx = "1";
    const wrap = document.createElement("div"); wrap.className = "pwwrap";
    inp.replaceWith(wrap); wrap.appendChild(inp);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pwtoggle"; btn.innerHTML = EYE; btn.setAttribute("aria-label", "Mostrar senha");
    wrap.appendChild(btn);
    btn.onclick = () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
      inp.focus({ preventScroll: true });
    };
  }

  window.Controls = {
    enhance(root = document) {
      root.querySelectorAll("select").forEach(enhanceSelect);
      root.querySelectorAll('input[type="date"]').forEach(enhanceDate);
      root.querySelectorAll('input[type="color"]').forEach(enhanceColor);
      root.querySelectorAll('input[type="password"]').forEach(enhancePassword);
      root.querySelectorAll("input.emoji").forEach(enhanceIcon);
    },
    close: closeAll,
  };
  window.Icons = { render: iconSVG, keys: Object.keys(ICONS) };
})();
