/* Jornada — controle de ponto e banco de horas.
   Estado = um JSON por usuário (cifrado em store.js). Tudo é calculado na hora a partir das batidas. */
(() => {
const MES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DSEM = ["dom","seg","ter","qua","qui","sex","sáb"];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = n => String(n).padStart(2, "0");
const toM = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const fm = m => pad(Math.floor(m / 60) % 24) + ":" + pad(Math.floor(m % 60));
const dur = m => { m = Math.round(Math.abs(m)); return Math.floor(m / 60) + ":" + pad(m % 60); };
const sgn = m => (Math.round(m) < 0 ? "−" : "+") + dur(m);
const clock = sec => { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec / 60) % 60) + ":" + pad(sec % 60); };
const dk = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayK = () => dk(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const ym = k => k.slice(0, 7);
const addM = (m, n) => { let [y, mo] = m.split("-").map(Number); mo += n; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return y + "-" + pad(mo); };
const mLabel = m => { const [y, mo] = m.split("-"); return MES[+mo - 1] + " " + y; };
const dateOf = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const dLabel = k => { const d = dateOf(k); return DSEM[d.getDay()] + ", " + d.getDate() + " de " + MES[d.getMonth()].toLowerCase(); };
const TIPOS = { normal: "Normal", feriado: "Feriado", falta: "Falta", atestado: "Atestado" };
const FASES = ["Entrada", "Almoço", "Volta", "Saída"];
const validHM = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function baseState() {
  return { v: 1, jornada: { dias: [1, 2, 3, 4, 5], manha: ["08:00", "12:00"], tarde: ["13:00", "17:48"] },
    dias: {}, oficial: {}, prefs: { theme: "auto", modo: "crono", avisar: false } };
}
let S = null, page = "hoje", cur = ym(todayK()), animate = true;

/* ---------- cálculo ---------- */
const jornadaMin = () => { const j = S.jornada; return (toM(j.manha[1]) - toM(j.manha[0])) + (toM(j.tarde[1]) - toM(j.tarde[0])); };
const expected = k => S.jornada.dias.includes(dateOf(k).getDay()) ? jornadaMin() : 0;
/* status: ok (fechado) · andamento (hoje, incompleto) · incompleto (passado sem as 4 batidas) · vazio (dia útil sem nada)
   saldo = conta do relógio · saldoEmp = como o sistema da empresa conta: diferenças de até `tol` min
   na entrada (vs 08:00), no almoço (vs 1h) e na saída (vs 17:48) são zeradas (CLT art. 58 §1º).
   Conferido com o espelho de set/2026: extras 9:03, atrasos 3:06, saída antecipada 1:15 batem exato com tol=5. */
/* regra do sistema de ponto de cada empresa (Ajustes → Regras da empresa) */
const REGRAS = {
  clt: { n: "CLT padrão", tol: 5, teto: 10, almoco: true, d: "Até 5 min por marcação, no máximo 10 min no dia; se passar, conta tudo." },
  marc: { n: "Por marcação", tol: 5, teto: 0, almoco: true, d: "Até 5 min em cada marcação, sem limite no dia." },
  zero: { n: "Sem tolerância", tol: 0, teto: 0, almoco: true, d: "Conta minuto a minuto." },
};
const regra = () => ({ empresa: "", tol: S.jornada.tol ?? 5, teto: 0, almoco: true, ...(S.regra || {}) });
const tolMin = () => regra().tol;
function dayInfo(k) {
  const x = S.dias[k], exp = expected(k), tk = todayK(), isToday = k === tk;
  if (!x) return exp && k < tk ? { k, exp, status: "vazio", saldo: 0, saldoEmp: 0, work: 0, warns: [] } : null;
  const tipo = x.tipo || "normal", warns = [];
  if (tipo === "feriado" || tipo === "atestado") return { k, exp, tipo, status: "ok", saldo: 0, saldoEmp: 0, work: 0, warns };
  if (tipo === "falta") return { k, exp, tipo, status: "ok", saldo: -exp, saldoEmp: -exp, work: 0, warns };
  let work = 0, status = "ok", parts = null;
  const b = (x.b || []).map(toM), j = S.jornada;
  if (x.total != null && !b.length) work = x.total;
  else {
    for (let i = 0; i < b.length; i += 2) work += (b[i + 1] ?? (isToday ? nowMin() : b[i])) - b[i];
    if (b.length < 4) status = isToday ? "andamento" : "incompleto";
    if (b.length && b[0] > toM(j.manha[0])) warns.push(`chegou ${Math.round(b[0] - toM(j.manha[0]))} min depois`);
    if (b.length >= 3 && exp > 360 && b[2] - b[1] < 60) warns.push(`almoço de ${b[2] - b[1]} min`);
    if (b.length === 4 && exp) {
      const lunch = toM(j.tarde[0]) - toM(j.manha[1]), R = regra();
      parts = [["entrada", toM(j.manha[0]) - b[0]], ["almoço", lunch - (b[2] - b[1])], ["saída", b[3] - toM(j.tarde[1])]].map(([n, v]) => ({ n, v, emp: v }));
      if (!R.almoco) parts[1].emp = 0; // empresa não controla o intervalo
      const small = parts.filter(p => p.emp && Math.abs(p.emp) <= R.tol);
      // CLT: se as pequenas diferenças somarem mais que o teto do dia, todas passam a contar
      if (!R.teto || small.reduce((t, p) => t + Math.abs(p.emp), 0) <= R.teto) small.forEach(p => p.emp = 0);
    }
  }
  if (x.alm) warns.push(`almoço ~${x.alm} min`);
  const saldo = work - exp, saldoEmp = parts ? parts.reduce((t, p) => t + p.emp, 0) : saldo;
  return { k, exp, tipo, status, work, saldo, saldoEmp, parts, warns, b: x.b || [], total: x.total, obs: x.obs };
}
const lastDay = m => { const [y, mo] = m.split("-").map(Number); return m + "-" + pad(new Date(y, mo, 0).getDate()); };
/* soma de um intervalo de datas (inclusive) */
function rangeInfo(from, to) {
  const tk = todayK(), days = [];
  for (let d = dateOf(from); dk(d) <= to; d.setDate(d.getDate() + 1)) { const k = dk(d); if (k > tk && !S.dias[k]) continue; const i = dayInfo(k); if (i) days.push(i); }
  const closed = days.filter(d => d.status === "ok"), sum = f => closed.reduce((t, d) => t + f(d), 0);
  const part = (name, sign) => sum(d => d.parts ? d.parts.filter(p => p.n === name && Math.sign(p.emp) === sign).reduce((t, p) => t + p.emp, 0) : 0);
  const noParts = f => sum(d => !d.parts && d.tipo !== "falta" && f(d.saldo) ? d.saldo : 0);
  const worked = closed.filter(d => d.work > 0), full = closed.filter(d => d.parts);
  const avg = f => full.length ? full.reduce((t, d) => t + f(d), 0) / full.length : null;
  return { days, closed,
    total: sum(d => d.saldo), totalEmp: sum(d => d.saldoEmp),
    extra: sum(d => d.parts ? d.parts.filter(p => p.emp > 0).reduce((t, p) => t + p.emp, 0) : 0) + noParts(v => v > 0),
    atraso: part("entrada", -1) + part("almoço", -1) + noParts(v => v < 0), antecip: part("saída", -1),
    faltas: sum(d => d.tipo === "falta" ? d.saldo : 0), nFaltas: closed.filter(d => d.tipo === "falta").length,
    work: sum(d => d.work), exp: sum(d => d.exp), nDias: worked.length,
    nAtraso: full.filter(d => d.parts[0].emp < 0).length,
    avgIn: avg(d => toM(d.b[0])), avgOut: avg(d => toM(d.b[3])), avgLunch: avg(d => toM(d.b[2]) - toM(d.b[1])) };
}
function monthInfo(m) {
  const r = rangeInfo(m + "-01", lastDay(m));
  return { ...r, hoje: r.days.find(d => d.status === "andamento"), vazios: r.days.filter(d => d.status === "vazio" || d.status === "incompleto") };
}

/* ---------- utilidades de UI ---------- */
function commit(msg, undo) { Store.save(S); render(); if (msg) toast(msg, undo); }
let toastT;
function toast(t, undo) {
  const el = $("#toast");
  el.innerHTML = esc(t) + (undo ? ' <button id="undoBtn">Desfazer</button>' : "");
  el.hidden = false; el.style.animation = "none"; el.offsetHeight; el.style.animation = "";
  if (undo) $("#undoBtn").onclick = () => { undo(); el.hidden = true; Store.save(S); render(); };
  clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, undo ? 10000 : 2400);
}
const snapshot = () => JSON.parse(JSON.stringify(S));
const restoreFrom = snap => () => { S = snap; };
/* o visual acompanha o horário: madrugada · amanhecer · dia · entardecer · noite; o sol/lua anda num arco */
const skyOf = m => m < 300 ? "madrugada" : m < 480 ? "amanhecer" : m < 960 ? "dia" : m < 1140 ? "entardecer" : "noite";
const GREET = { madrugada: "Boa madrugada", amanhecer: "Bom dia", dia: "Bom dia", entardecer: "Boa tarde", noite: "Boa noite" };
function applyTheme() {
  const r = document.documentElement, t = S?.prefs?.theme || "auto", m = nowMin();
  const sky = t === "light" ? "dia" : t === "dark" ? "noite" : skyOf(m);
  r.dataset.sky = sky; delete r.dataset.theme;
  const day = t === "light" ? 720 : t === "dark" ? null : m;
  const f = day != null && day >= 330 && day <= 1170 ? (day - 330) / 840 : null; // sol entre 05:30 e 19:30
  const g = f ?? (((m - 1170 + 1440) % 1440) / 600); // lua no resto (19:30 → 05:30)
  r.style.setProperty("--sx", (6 + Math.min(1, g) * 88).toFixed(1) + "%");
  r.style.setProperty("--sy", (78 - Math.sin(Math.PI * Math.min(1, g)) * 58).toFixed(1) + "%");
  r.dataset.orb = f != null ? "sol" : "lua";
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = getComputedStyle(r).getPropertyValue("--sky-a").trim();
}
applyTheme(); setInterval(applyTheme, 60000);
function openSheet(html, bind) {
  Controls.close();
  const sh = $("#sheet"); sh.innerHTML = html; sh.hidden = false;
  Controls.enhance(sh); bind?.(sh);
}
const closeSheet = () => { Controls.close(); $("#sheet").hidden = true; };
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
function segBind(el, attr, fn) { el.onclick = e => { const b = e.target.closest("button"); if (!b || !el.contains(b)) return; el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); fn(b.dataset[attr]); }; }
function confirmBox(title, text, okLabel, onOk) {
  openSheet(`<div class="panel"><h2>${esc(title)}</h2><p class="hint">${text}</p><div class="tools" style="justify-content:flex-end"><button class="btn" id="cNo">Cancelar</button><button class="btn pri" id="cOk" style="background:var(--out);border-color:var(--out)">${esc(okLabel)}</button></div></div>`,
    () => { $("#cNo").onclick = closeSheet; $("#cOk").onclick = () => { closeSheet(); onOk(); }; });
}
/* campo de horário: só números, vira HH:MM sozinho (sem o input time nativo) */
function maskTime(inp, onDone) {
  inp.addEventListener("input", () => {
    let v = inp.value.replace(/\D/g, "").slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + ":" + v.slice(2);
    inp.value = v; inp.classList.toggle("bad", v.length === 5 && !validHM(v));
    if (v.length === 5 && validHM(v)) onDone?.(inp);
  });
}
const timeInputs = (vals, cls = "") => `<div class="slots">${FASES.map((l, i) => `<label class="slot"><span class="mini">${l}</span><input class="hin ${cls}" inputmode="numeric" maxlength="5" placeholder="--:--" data-i="${i}" value="${esc(vals[i] || "")}" aria-label="${l}"></label>`).join("")}</div>`;
function bindTimeInputs(root, onFilled) {
  const ins = [...root.querySelectorAll(".hin")];
  ins.forEach((inp, i) => maskTime(inp, () => { ins[i + 1]?.focus(); onFilled?.(); }));
  return () => ins.map(i => i.value.trim());
}
/* batidas digitadas: vazias só no fim, em ordem crescente */
function checkTimes(vals) {
  const last = vals.reduce((l, v, i) => v ? i : l, -1), used = vals.slice(0, last + 1);
  if (used.some(v => !v)) return "Preencha os horários em ordem, sem pular.";
  if (used.some(v => !validHM(v))) return "Use horários no formato 08:00.";
  for (let i = 1; i < used.length; i++) if (toM(used[i]) <= toM(used[i - 1])) return `${FASES[i]} tem que ser depois de ${FASES[i - 1].toLowerCase()}.`;
  return null;
}

/* ---------- ícones da navegação ---------- */
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  hoje: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>'),
  mes: svg('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
  rel: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  ajustes: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};
const PAGES = [["hoje", "Hoje"], ["mes", "Mês"], ["rel", "Relatório"], ["ajustes", "Ajustes"]];

/* ---------- shell ---------- */
function navs() {
  const h = sh => PAGES.map(([id, t]) => `<button class="navbtn" data-p="${id}" aria-current="${page === id}" aria-label="${t}">${I[id]}<span>${t}</span></button>`).join("");
  $("#sidenav").innerHTML = h(); $("#bottomnav").innerHTML = h(true);
  $("#who").textContent = Store.user?.email || "";
}
document.addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (b) { page = b.dataset.p; animate = true; render(); scrollTo({ top: 0, behavior: "smooth" }); } });
function render() {
  if (!S) return;
  applyTheme(); navs();
  const monthly = page === "mes", now = ym(todayK());
  $("#mnav").hidden = !monthly; $("#today").hidden = cur === now;
  $("#mlabel").textContent = mLabel(cur);
  $("#ttl").textContent = page === "hoje" ? GREET[skyOf(nowMin())] : page === "mes" ? "Banco de horas" : page === "rel" ? "Relatório" : "Ajustes";
  $("#ttlSub").textContent = page === "hoje" ? dLabel(todayK()) : "";
  const v = $("#view"); v.className = animate ? "view-enter" : "";
  ({ hoje: pgHoje, mes: pgMes, rel: pgRel, ajustes: pgAjustes })[page]();
  Controls.enhance(v);
  animate = false;
  schedule();
}
$("#prev").onclick = () => { cur = addM(cur, -1); animate = true; render(); };
$("#next").onclick = () => { cur = addM(cur, 1); animate = true; render(); };
$("#today").onclick = () => { cur = ym(todayK()); animate = true; render(); };

/* ---------- Hoje ---------- */
const PHASE = [["Começar manhã", "Pronto para começar"], ["Sair para o almoço", "Manhã em andamento"], ["Voltar do almoço", "Almoço em andamento"], ["Encerrar o dia", "Tarde em andamento"], [null, "Dia encerrado"]];
function hojeParts(k) {
  const x = S.dias[k] || {}, b = (x.b || []).map(toM), ts = x.ts || [], n = b.length;
  const start = i => ts[i] ? (Date.now() - ts[i]) / 60000 : nowMin() - b[i]; // minutos desde a batida i (com segundos no cronômetro)
  const seg = (i) => b[i] == null ? 0 : b[i + 1] != null ? b[i + 1] - b[i] : start(i);
  return { n, b, manha: seg(0), alm: seg(1), tarde: seg(2), work: seg(0) + seg(2), running: n > 0 && n < 4 ? start(n - 1) : 0 };
}
function pgHoje() {
  const k = todayK(), x = S.dias[k], tipo = x?.tipo || "normal", exp = expected(k), mi = monthInfo(ym(k));
  const modo = S.prefs.modo || "crono";
  let body;
  if (tipo !== "normal") {
    body = `<div class="dayoff"><b>${TIPOS[tipo]}</b><span class="hint">${tipo === "falta" ? `Conta ${sgn(-exp)} no banco de horas.` : "Não conta no banco de horas."}</span>
      <button class="btn" id="tipoNormal">Voltar para dia normal</button></div>`;
  } else if (modo === "crono") {
    const p = hojeParts(k), [btn, st] = PHASE[p.n];
    const live = ["", "m", "a", "t"][p.n];
    body = `<div class="timer ${p.n === 2 ? "lunch" : p.n ? "run" : ""}"><span class="mini">${st}</span><b class="num" id="tkMain">${clock((p.n === 4 ? p.work : p.running) * 60)}</b>${p.n === 4 ? '<span class="mini">trabalhado</span>' : ""}</div>
      <div class="slots">
        <div class="slot ${live === "m" ? "live" : ""}"><span class="mini">Manhã</span><b class="num" id="tkM">${clock(p.manha * 60)}</b></div>
        <div class="slot ${live === "a" ? "live" : ""}"><span class="mini">Almoço</span><b class="num" id="tkA">${clock(p.alm * 60)}</b></div>
        <div class="slot ${live === "t" ? "live" : ""}"><span class="mini">Tarde</span><b class="num" id="tkT">${clock(p.tarde * 60)}</b></div>
        <div class="slot"><span class="mini">Total</span><b class="num" id="tkW">${clock(p.work * 60)}</b></div></div>
      ${btn ? `<button class="punchbtn ${p.n === 1 ? "alt" : ""}" id="bater">${btn}</button>` : ""}
      ${p.n ? `<div class="stamps">${p.b.map((t, i) => `<span>${FASES[i]} <b class="num">${fm(t)}</b></span>`).join("")}<button class="linkbtn" id="fixDay">Corrigir horários</button></div>` : ""}`;
  } else {
    body = `${timeInputs(x?.b || [])}<div class="err" id="hErr"></div>
      <div class="tools" style="justify-content:flex-end"><button class="btn" id="nowBtn">Usar hora atual no próximo</button><button class="btn acc" id="saveH">Salvar</button></div>`;
  }
  const info = hojeInfo(k);
  $("#view").innerHTML = `<section class="grid anim" style="margin-top:0">
   <div class="box c7 hojebox"><div class="phead"><h2>Registrar ponto</h2>
     <div class="seg" id="modoSeg"><button data-m="crono" aria-pressed="${modo === "crono"}">Cronômetro</button><button data-m="man" aria-pressed="${modo === "man"}">Digitar</button></div></div>
     ${body}
     <div class="hint" id="hInfo">${info.text}</div>
     ${info.warns.map(w => `<span class="warnchip">${esc(w)}</span>`).join(" ")}
     ${tipo === "normal" ? `<div class="daytype">Hoje não trabalhou? <button class="linkbtn" data-tipo="feriado">Feriado</button> · <button class="linkbtn" data-tipo="atestado">Atestado</button> · <button class="linkbtn" data-tipo="falta">Falta</button></div>` : ""}
   </div>
   <div class="c5" style="display:grid;gap:16px;align-content:start">
     ${monthCard(mi, ym(k), true)}
     <div class="box"><h2>Avisos</h2><label class="pref"><input type="checkbox" id="avisar" ${S.prefs.avisar ? "checked" : ""}> Avisar quando completar 1h de almoço e na hora de sair para zerar o dia</label>
      <p class="hint" style="margin:6px 0 0">Funciona com o app aberto (pode ficar em segundo plano no PC). No celular, deixe o app aberto.</p></div>
   </div></section>`;
  bindHoje(k);
}
function hojeInfo(k) {
  const d = dayInfo(k), exp = expected(k);
  if (!d) return { text: exp ? `Jornada de hoje: ${dur(exp)}.` : "Hoje não é dia de trabalho. Se trabalhar, tudo conta como hora extra.", warns: [] };
  if (d.tipo && d.tipo !== "normal") return { text: "", warns: [] };
  const n = d.b.length, b = d.b.map(toM), j = S.jornada;
  let text;
  if (d.status === "ok") text = `Dia fechado: trabalhou ${dur(d.work)} → <b class="${d.saldo >= 0 ? "pos" : "neg"}">${sgn(d.saldo)}</b>`;
  else if (n === 3) { const zero = b[2] + (exp - (b[1] - b[0])); text = `Para zerar o dia, saia às <b class="num">${fm(zero)}</b>. ` + (d.saldo >= 0 ? `Já está <b class="pos">${sgn(d.saldo)}</b>.` : `Faltam <b class="num">${dur(-d.saldo)}</b>.`); }
  else if (n === 2) { const back = b[1] + 60, zero = back + (exp - (b[1] - b[0])); text = `Com 1h de almoço, volte às <b class="num">${fm(back)}</b> e saia às <b class="num">${fm(zero)}</b>.`; }
  else if (n === 1) { const lunch = toM(j.manha[1]) - toM(j.manha[0]); text = `Almoço previsto às <b class="num">${fm(b[0] + lunch)}</b>; saída prevista às <b class="num">${fm(b[0] + exp + 60)}</b> (com 1h de almoço).`; }
  else text = `Jornada de hoje: ${dur(exp)}.`;
  return { text, warns: d.warns };
}
function monthCard(mi, m, compact) {
  const ok = mi.totalEmp >= 0, of = S.oficial[m], hj = mi.hoje ? mi.totalEmp + mi.hoje.saldo : null;
  return `<div class="box"><h2>Banco de horas · ${mLabel(m).toLowerCase()}</h2>
    <div class="bigbal ${ok ? "pos" : "neg"} num">${sgn(mi.totalEmp)}</div>
    <span class="prize ${ok ? "ok" : "bad"}">${ok ? "Prêmio garantido" : "Prêmio em risco"}</span>
    <p class="hint" style="margin:8px 0 0">Como o sistema ${regra().empresa ? "da " + esc(regra().empresa) : "da empresa"} conta (${regra().tol ? `ignora até ${regra().tol} min por marcação${regra().teto ? `, máx. ${regra().teto} no dia` : ""}` : "sem tolerância"}). ${ok ? `Margem de ${dur(mi.totalEmp)}.` : `Faltam ${dur(-mi.totalEmp)} para zerar.`}${hj != null ? ` Com hoje até agora: <b class="${hj >= 0 ? "pos" : "neg"}">${sgn(hj)}</b>.` : ""}</p>
    <p class="hint" style="margin:4px 0 0">No relógio, minuto a minuto: <b class="num">${sgn(mi.total)}</b>.${of != null ? ` Sistema informado: <b class="num">${sgn(of)}</b> (diferença ${sgn(of - mi.totalEmp)}).` : ""}</p>
    ${!compact ? kpis(mi) : ""}
    ${mi.vazios.length ? `<p class="warnchip" style="margin-top:10px">${mi.vazios.length} dia(s) sem registro completo</p>` : ""}</div>`;
}
const kpis = r => `<div class="kpis k4"><div class="kpi"><div class="l">Extras</div><div class="v num pos">${sgn(r.extra)}</div></div><div class="kpi"><div class="l">Atrasos</div><div class="v num neg">${sgn(r.atraso)}</div></div><div class="kpi"><div class="l">Saídas antes</div><div class="v num neg">${sgn(r.antecip)}</div></div><div class="kpi"><div class="l">Faltas${r.nFaltas ? ` (${r.nFaltas})` : ""}</div><div class="v num neg">${sgn(r.faltas)}</div></div></div>`;
function bindHoje(k) {
  const v = $("#view");
  segBind($("#modoSeg"), "m", m => { S.prefs.modo = m; commit(); });
  $("#avisar").onchange = async e => {
    if (e.target.checked && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    S.prefs.avisar = e.target.checked; commit(e.target.checked && window.Notification?.permission === "denied" ? "Notificações bloqueadas no navegador: vou avisar só aqui na tela" : "");
  };
  v.querySelectorAll("[data-tipo]").forEach(b => b.onclick = () => { const snap = snapshot(); S.dias[k] = { ...(S.dias[k] || {}), tipo: b.dataset.tipo }; commit(`Hoje marcado como ${TIPOS[b.dataset.tipo].toLowerCase()}`, restoreFrom(snap)); });
  if ($("#tipoNormal")) $("#tipoNormal").onclick = () => { const d = S.dias[k]; delete d.tipo; if (!d.b?.length) delete S.dias[k]; commit(); };
  if ($("#bater")) $("#bater").onclick = () => {
    const snap = snapshot(), d = S.dias[k] = S.dias[k] || {}, n = (d.b || []).length;
    let t = fm(Math.floor(nowMin()));
    if (n && toM(t) <= toM(d.b[n - 1])) t = fm(toM(d.b[n - 1]) + 1); // dois toques no mesmo minuto
    d.b = [...(d.b || []), t]; d.ts = [...(d.ts || []).slice(0, n), Date.now()];
    commit(`${FASES[n]} às ${t}`, restoreFrom(snap));
  };
  if ($("#fixDay")) $("#fixDay").onclick = () => editDay(k);
  if ($("#saveH")) {
    const read = bindTimeInputs(v);
    $("#nowBtn").onclick = () => { const e = [...v.querySelectorAll(".hin")].find(i => !i.value); if (e) { e.value = fm(Math.floor(nowMin())); e.dispatchEvent(new Event("input")); } };
    $("#saveH").onclick = () => {
      const vals = read(), er = checkTimes(vals); if (er) return $("#hErr").textContent = er;
      const snap = snapshot(), b = vals.filter(Boolean);
      if (b.length) S.dias[k] = { ...(S.dias[k] || {}), b }; else delete S.dias[k];
      if (S.dias[k]) delete S.dias[k].ts, delete S.dias[k].total;
      commit("Horários salvos", restoreFrom(snap));
    };
  }
}
/* atualiza só os números do cronômetro (sem redesenhar a página e perder o foco dos campos) */
setInterval(() => {
  if (!S || page !== "hoje" || !$("#tkMain")) return;
  const p = hojeParts(todayK()); if (!(p.n > 0 && p.n < 4)) return;
  $("#tkMain").textContent = clock(p.running * 60); $("#tkM").textContent = clock(p.manha * 60);
  $("#tkA").textContent = clock(p.alm * 60); $("#tkT").textContent = clock(p.tarde * 60); $("#tkW").textContent = clock(p.work * 60);
}, 1000);
/* virou o dia com o app aberto: redesenha */
let seenDay = todayK();
setInterval(() => { if (todayK() !== seenDay) { seenDay = todayK(); render(); } }, 60000);

/* ---------- avisos (almoço de 1h e hora de zerar) ---------- */
let timers = [];
function notify(title, body) {
  toast(title + " — " + body);
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  navigator.serviceWorker?.getRegistration().then(r => r ? r.showNotification(title, { body, icon: "icon-192.png", tag: "ponto" }) : new Notification(title, { body, icon: "icon-192.png" }))
    .catch(() => { try { new Notification(title, { body }); } catch (e) {} });
}
function schedule() {
  timers.forEach(clearTimeout); timers = [];
  if (!S?.prefs.avisar) return;
  const k = todayK(), x = S.dias[k]; if (!x?.b || (x.tipo && x.tipo !== "normal")) return;
  const b = x.b.map(toM), exp = expected(k), at = (min, title, body) => { const ms = (min - nowMin()) * 60000; if (ms > 0 && ms < 86400000) timers.push(setTimeout(() => notify(title, body), ms)); };
  if (b.length === 2) at(b[1] + 60, "1h de almoço", "Hora de voltar. Seu intervalo já completou 1 hora.");
  if (b.length === 3) at(b[2] + (exp - (b[1] - b[0])), "Hora de sair", "Você completou a jornada de hoje: saldo zerado.");
}

/* ---------- Mês ---------- */
function pgMes() {
  const mi = monthInfo(cur), mx = Math.max(60, ...mi.days.map(d => Math.abs(d.saldoEmp)));
  const of = S.oficial[cur];
  $("#view").innerHTML = `<section class="grid anim" style="margin-top:0">
   <div class="c5" style="display:grid;gap:16px;align-content:start">${monthCard(mi, cur, false)}
    <div class="box"><h2>Saldo do sistema da empresa</h2><p class="hint">Digite o saldo que o sistema oficial mostra para este mês (ex.: +0:09 ou -1:20) para comparar com a conta do app.</p>
     <div class="tools"><input class="hin wide" id="ofIn" inputmode="text" placeholder="+0:00" value="${of != null ? sgn(of).replace("−", "-") : ""}" aria-label="Saldo oficial"><button class="btn acc" id="ofSave">Salvar</button>${of != null ? '<button class="btn" id="ofDel">Limpar</button>' : ""}</div>
     <div class="err" id="ofErr"></div></div>
   </div>
   <div class="c7" style="display:grid;gap:16px;align-content:start">
    <div class="box"><h2>Saldo por dia</h2>${mi.days.length ? `<div class="bars">${mi.days.map(d => `<div class="bcol" title="${d.k.slice(8)}: ${sgn(d.saldoEmp)}"><div class="bup">${d.saldoEmp > 0 ? `<i style="height:${d.saldoEmp / mx * 100}%"></i>` : ""}</div><div class="bdn">${d.saldoEmp < 0 ? `<i style="height:${-d.saldoEmp / mx * 100}%"></i>` : ""}</div></div>`).join("")}</div>` : '<p class="hint">Nenhum dia registrado neste mês.</p>'}</div>
    <div class="box"><h2>Dias <button class="btn sm" id="addDay">+ Outro dia</button></h2><div class="list">${mi.days.slice().reverse().map(dayRow).join("") || '<p class="hint">Nada por aqui ainda.</p>'}</div></div>
   </div></section>`;
  const v = $("#view");
  v.querySelectorAll("[data-day]").forEach(r => r.onclick = () => editDay(r.dataset.day));
  $("#addDay").onclick = pickDay;
  $("#ofSave").onclick = () => { const s = $("#ofIn").value.trim().replace("−", "-"), mm = s.match(/^([+-]?)(\d{1,3}):([0-5]\d)$/); if (!mm) return $("#ofErr").textContent = "Use o formato +0:09 ou -1:20."; S.oficial[cur] = (mm[1] === "-" ? -1 : 1) * (+mm[2] * 60 + +mm[3]); commit("Saldo oficial salvo"); };
  if ($("#ofDel")) $("#ofDel").onclick = () => { delete S.oficial[cur]; commit(); };
}
/* cada dia mostra de onde veio o saldo: entrada, almoço e saída (tolerados em cinza) */
const partChips = d => (d.parts || []).filter(p => p.v).map(p => `<span class="pchip ${p.emp > 0 ? "pos" : p.emp < 0 ? "neg" : "tol"}" title="${p.emp ? "" : "dentro da tolerância: o sistema ignora"}">${p.n} ${sgn(p.v)}</span>`).join("");
function dayRow(d) {
  const tag = d.status === "vazio" ? "sem registro" : d.status === "incompleto" ? "incompleto" : d.status === "andamento" ? "em andamento" : d.tipo && d.tipo !== "normal" ? TIPOS[d.tipo] : "";
  const times = d.b?.length ? d.b.join(" · ") : d.total != null ? `total ${dur(d.total)} (importado)` : "";
  const open = d.status === "vazio" || d.status === "incompleto";
  return `<button class="row dayrow" data-day="${d.k}"><div class="dnum"><b>${+d.k.slice(8)}</b><span>${DSEM[dateOf(d.k).getDay()]}</span></div>
    <div><div class="t"><span class="num">${times}</span> ${tag ? `<span class="tag">${tag}</span>` : ""}</div><div class="m">${partChips(d)}${d.obs ? `<span>${esc(d.obs)}</span>` : ""}</div></div>
    <div class="val ${open || d.status !== "ok" ? "" : d.saldoEmp >= 0 ? "pos" : "neg"}">${open ? "—" : sgn(d.saldoEmp)}${!open && d.saldoEmp !== d.saldo ? `<small>relógio ${sgn(d.saldo)}</small>` : ""}</div></button>`;
}
function pickDay() {
  openSheet(`<form id="pdf"><h2>Registrar outro dia</h2><label class="fld">Data<input type="date" id="pdDate" value="${todayK()}" max="${todayK()}"></label><div class="tools" style="justify-content:flex-end"><button type="button" class="btn" id="pdx">Cancelar</button><button class="btn acc">Continuar</button></div></form>`, () => {
    $("#pdx").onclick = closeSheet; $("#pdf").onsubmit = e => { e.preventDefault(); const k = $("#pdDate").value; if (k) editDay(k); };
  });
}
function editDay(k) {
  const x = S.dias[k] || {}, tipo = x.tipo || "normal";
  openSheet(`<form id="edf"><h2>${esc(dLabel(k))}</h2>
    <div class="seg" id="tipoSeg">${Object.entries(TIPOS).map(([t, l]) => `<button type="button" data-t="${t}" aria-pressed="${tipo === t}">${l}</button>`).join("")}</div>
    <div id="edTimes" ${tipo !== "normal" ? "hidden" : ""}>${timeInputs(x.b || [])}${x.total != null && !x.b?.length ? `<p class="hint">Este dia foi importado só com o total (${dur(x.total)}). Digite os horários se quiser detalhar.</p>` : ""}</div>
    <label class="fld">Observação<input id="edObs" maxlength="120" value="${esc(x.obs || "")}" placeholder="Ex.: atestado entregue ao RH"></label>
    <div class="err" id="edErr"></div>
    <div class="tools" style="justify-content:space-between"><button type="button" class="btn danger" id="edDel">Limpar dia</button><span class="tools"><button type="button" class="btn" id="edx">Cancelar</button><button class="btn acc">Salvar</button></span></div></form>`, sh => {
    let t = tipo; const read = bindTimeInputs(sh);
    segBind($("#tipoSeg"), "t", v => { t = v; $("#edTimes").hidden = v !== "normal"; });
    $("#edx").onclick = closeSheet;
    $("#edDel").onclick = () => { const snap = snapshot(); delete S.dias[k]; closeSheet(); commit("Dia limpo", restoreFrom(snap)); };
    $("#edf").onsubmit = e => {
      e.preventDefault();
      const vals = read(), obs = $("#edObs").value.trim(), er = t === "normal" && checkTimes(vals);
      if (er) return $("#edErr").textContent = er;
      const snap = snapshot(), b = vals.filter(Boolean), d = {};
      if (t !== "normal") d.tipo = t;
      else if (b.length) d.b = b;
      else if (x.total != null) { d.total = x.total; if (x.alm) d.alm = x.alm; }
      if (obs) d.obs = obs;
      if (Object.keys(d).length) S.dias[k] = d; else delete S.dias[k];
      closeSheet(); commit("Dia salvo", restoreFrom(snap));
    };
  });
}

/* ---------- Relatório: mês, bimestre, trimestre, ano ou período personalizado ---------- */
const REP = { mes: ["Mês", 1], bim: ["Bimestre", 2], tri: ["Trimestre", 3], ano: ["Ano", 12], per: ["Personalizado", 0] };
let rep = { tipo: "mes", ref: null, de: null, ate: null };
function repRange() {
  const n = REP[rep.tipo][1], ref = rep.ref || ym(todayK());
  if (!n) return { from: rep.de || ym(todayK()) + "-01", to: rep.ate || todayK() };
  const [y, m] = ref.split("-").map(Number), m0 = Math.floor((m - 1) / n) * n + 1, first = y + "-" + pad(m0), last = addM(first, n - 1);
  const ord = ["1º", "2º", "3º", "4º", "5º", "6º"];
  const label = n === 1 ? mLabel(first) : n === 12 ? String(y) : `${ord[(m0 - 1) / n]} ${n === 2 ? "bimestre" : "trimestre"} de ${y}`;
  return { from: first + "-01", to: lastDay(last), label, first, n };
}
const fmtD = k => k.slice(8) + "/" + k.slice(5, 7) + "/" + k.slice(0, 4);
function pgRel() {
  const R = repRange(), r = rangeInfo(R.from, R.to), ok = r.totalEmp >= 0;
  const months = []; for (let m = ym(R.from); m <= ym(R.to); m = addM(m, 1)) months.push(m);
  const perMonth = months.map(m => { const f = m + "-01" < R.from ? R.from : m + "-01", t = lastDay(m) > R.to ? R.to : lastDay(m); return { m, ...rangeInfo(f, t) }; }).filter(x => x.closed.length);
  const oc = r.closed.filter(d => d.tipo === "falta" || d.parts?.some(p => p.emp < 0));
  const hm = v => v == null ? "—" : fm(Math.round(v));
  $("#view").innerHTML = `<section class="grid anim" style="margin-top:0">
   <div class="box c12 repbar"><div class="seg reptipo" id="repSeg">${Object.entries(REP).map(([k, [t]]) => `<button data-t="${k}" aria-pressed="${rep.tipo === k}">${t}</button>`).join("")}</div>
    ${R.n ? `<div class="mnav repnav"><button id="rPrev" aria-label="Anterior">‹</button><span>${R.label}</span><button id="rNext" aria-label="Próximo">›</button></div>`
      : `<div class="tools"><label class="fld">De<input type="date" id="rDe" value="${R.from}" max="${todayK()}"></label><label class="fld">Até<input type="date" id="rAte" value="${R.to}" max="${todayK()}"></label></div>`}
    <div class="tools noprint"><button class="btn" id="csvBtn">Baixar planilha (CSV)</button><button class="btn acc" id="prnBtn">Imprimir / PDF</button></div></div>
   <div class="box c5"><h2>Saldo do período <small>${fmtD(R.from)} a ${fmtD(R.to)}</small></h2>
    <div class="bigbal ${ok ? "pos" : "neg"} num">${sgn(r.totalEmp)}</div>
    <p class="hint" style="margin:0">Conta do sistema da empresa. No relógio: <b class="num">${sgn(r.total)}</b>.${perMonth.length > 1 ? " O banco zera todo mês: este total é só a soma dos meses." : ""}</p>
    ${kpis(r)}
    <div class="stats3"><div><span class="mini">Trabalhado</span><b class="num">${dur(r.work)}</b><span class="mini">de ${dur(r.exp)}</span></div><div><span class="mini">Dias trabalhados</span><b class="num">${r.nDias}</b><span class="mini">${r.nAtraso} com atraso</span></div><div><span class="mini">Média do dia</span><b class="num">${hm(r.avgIn)} → ${hm(r.avgOut)}</b><span class="mini">almoço ${r.avgLunch == null ? "—" : Math.round(r.avgLunch) + " min"}</span></div></div></div>
   <div class="box c7"><h2>Mês a mês</h2>${perMonth.length ? `<div class="tbl"><table><thead><tr><th>Mês</th><th>Trabalhado</th><th>Extras</th><th>Atrasos</th><th>Faltas</th><th>Saldo</th><th>Prêmio</th></tr></thead><tbody>
     ${perMonth.map(x => `<tr><td>${mLabel(x.m)}</td><td class="num">${dur(x.work)}</td><td class="num pos">${sgn(x.extra)}</td><td class="num neg">${sgn(x.atraso + x.antecip)}</td><td class="num">${x.nFaltas || "—"}</td><td class="num ${x.totalEmp >= 0 ? "pos" : "neg"}"><b>${sgn(x.totalEmp)}</b></td><td>${x.totalEmp >= 0 ? '<span class="prize ok">ok</span>' : '<span class="prize bad">perdeu</span>'}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">Nenhum dia registrado neste período.</p>'}</div>
   <div class="box c12"><h2>O que tirou horas <small>${oc.length} dia(s)</small></h2>${oc.length ? `<div class="list">${oc.map(dayRow).join("")}</div>` : '<p class="hint">Nenhum atraso, saída antecipada ou falta no período.</p>'}</div>
   </section>`;
  segBind($("#repSeg"), "t", t => { rep.tipo = t; render(); });
  if ($("#rPrev")) { $("#rPrev").onclick = () => { rep.ref = addM(R.first, -R.n); render(); }; $("#rNext").onclick = () => { rep.ref = addM(R.first, R.n); render(); }; }
  if ($("#rDe")) { const ch = () => { const a = $("#rDe").value, b = $("#rAte").value; if (a && b) { rep.de = a < b ? a : b; rep.ate = a < b ? b : a; render(); } }; $("#rDe").onchange = ch; $("#rAte").onchange = ch; }
  $("#view").querySelectorAll("[data-day]").forEach(x => x.onclick = () => editDay(x.dataset.day));
  $("#prnBtn").onclick = () => print();
  $("#csvBtn").onclick = () => {
    const L = [["Data", "Dia", "Tipo", "Entrada", "Almoço", "Volta", "Saída", "Trabalhado", "Saldo (empresa)", "Saldo (relógio)", "Obs"]];
    r.closed.forEach(d => L.push([fmtD(d.k), DSEM[dateOf(d.k).getDay()], TIPOS[d.tipo || "normal"], ...[0, 1, 2, 3].map(i => d.b?.[i] || ""), dur(d.work), sgn(d.saldoEmp), sgn(d.saldo), d.obs || ""]));
    L.push([], ["Total", "", "", "", "", "", "", dur(r.work), sgn(r.totalEmp), sgn(r.total), ""]);
    const csv = "\ufeff" + L.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `jornada-${R.from}-a-${R.to}.csv`; a.click(); toast("Planilha baixada");
  };
}

/* ---------- Regras da empresa (tolerância) ---------- */
const presetOf = R => Object.keys(REGRAS).find(k => { const p = REGRAS[k]; return p.tol === R.tol && p.teto === R.teto && p.almoco === R.almoco; }) || "custom";
function regraBox() {
  const R = regra(), pre = presetOf(R);
  return `<div class="box" id="regraBox"><h2>Regras da empresa</h2><p class="hint">Cada empresa configura o ponto de um jeito. Ajuste aqui para o saldo do app bater com o espelho oficial.</p>
    <label class="fld">Empresa<input id="rgEmp" maxlength="60" placeholder="Ex.: nome da empresa" value="${esc(R.empresa)}"></label>
    <div class="fld" style="margin-top:10px">Modelo<div class="seg rgseg" id="rgSeg">${Object.entries(REGRAS).map(([k, p]) => `<button type="button" data-k="${k}" aria-pressed="${pre === k}">${p.n}</button>`).join("")}<button type="button" data-k="custom" aria-pressed="${pre === "custom"}">Personalizada</button></div></div>
    <p class="hint" id="rgDesc" style="margin:6px 0 0">${pre === "custom" ? "Valores definidos por você abaixo." : REGRAS[pre].d}</p>
    <div class="rggrid"><label class="fld">Tolerância por marcação (min)<input class="num-in" id="rgTol" inputmode="numeric" maxlength="2" value="${R.tol}"></label>
     <label class="fld">Limite por dia (min)<input class="num-in" id="rgTeto" inputmode="numeric" maxlength="3" placeholder="sem limite" value="${R.teto || ""}"></label></div>
    <label class="pref"><input type="checkbox" id="rgAlm" ${R.almoco ? "checked" : ""}> A empresa desconta/credita o tempo de almoço</label>
    <p class="hint" style="margin:8px 0 0">Seu espelho de set/2026 bateu exato com <b>Por marcação</b> (5 min, sem limite no dia).</p>
    <div class="err" id="rgErr"></div><div class="tools" style="justify-content:flex-end;margin-top:8px"><button class="btn acc" id="rgSave">Salvar regras</button></div></div>`;
}
function bindRegra() {
  const set = p => { $("#rgTol").value = p.tol; $("#rgTeto").value = p.teto || ""; $("#rgAlm").checked = p.almoco; $("#rgDesc").textContent = p.d; };
  segBind($("#rgSeg"), "k", k => k === "custom" ? ($("#rgDesc").textContent = "Valores definidos por você abaixo.", $("#rgTol").focus()) : set(REGRAS[k]));
  const toCustom = () => $("#rgSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === presetOf({ tol: +$("#rgTol").value || 0, teto: +$("#rgTeto").value || 0, almoco: $("#rgAlm").checked })));
  ["#rgTol", "#rgTeto"].forEach(id => $(id).addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); toCustom(); }));
  $("#rgAlm").onchange = toCustom;
  $("#rgSave").onclick = () => {
    const tol = +$("#rgTol").value || 0, teto = +$("#rgTeto").value || 0;
    if (tol > 30) return $("#rgErr").textContent = "Tolerância muito alta (máx. 30 min).";
    const snap = snapshot(); S.regra = { empresa: $("#rgEmp").value.trim(), tol, teto, almoco: $("#rgAlm").checked }; delete S.jornada.tol;
    commit("Regras salvas: saldos recalculados", restoreFrom(snap));
  };
}

/* ---------- Ajustes ---------- */
function pgAjustes() {
  const j = S.jornada;
  $("#view").innerHTML = `<section class="grid anim" style="margin-top:0">
   <div class="box c6"><h2>Jornada</h2><p class="hint">Horário oficial de trabalho. O saldo de cada dia é o que você trabalhou menos a jornada (hoje: <b class="num">${dur(jornadaMin())}</b>).</p>
    <div class="slots">${[["Entrada", j.manha[0]], ["Almoço", j.manha[1]], ["Volta", j.tarde[0]], ["Saída", j.tarde[1]]].map(([l, t], i) => `<label class="slot"><span class="mini">${l}</span><input class="hin" inputmode="numeric" maxlength="5" data-i="${i}" value="${t}" aria-label="${l}"></label>`).join("")}</div>
    <div class="fld" style="margin-top:12px">Dias de trabalho<div class="seg wdays" id="wdSeg">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" data-d="${d}" aria-pressed="${j.dias.includes(d)}">${DSEM[d]}</button>`).join("")}</div></div>
    <div class="err" id="jErr"></div><div class="tools" style="justify-content:flex-end;margin-top:8px"><button class="btn acc" id="jSave">Salvar jornada</button></div>
    <p class="hint" style="margin-top:10px">O banco de horas fecha por mês: o saldo de um mês não passa para o seguinte.</p></div>
   <div class="c6" style="display:grid;gap:16px;align-content:start">
   ${regraBox()}
   <div class="box"><h2>Aparência</h2><p class="hint">Por padrão as cores mudam com o horário: amanhecer, dia, entardecer, noite e madrugada.</p><div class="fld">Céu<div class="seg" id="themeSeg">${[["auto", "Seguir o horário"], ["light", "Sempre dia"], ["dark", "Sempre noite"]].map(([k, t]) => `<button data-t="${k}" aria-pressed="${S.prefs.theme === k}">${t}</button>`).join("")}</div></div></div>
   <div class="box"><h2>Conta</h2><p class="hint">Conectado como <b>${esc(Store.user?.email)}</b>. Seus dados são criptografados antes de sair do aparelho: nem o administrador consegue ler.</p>
    <div class="fld" style="margin-top:10px">Ao abrir o Jornada neste aparelho
     <label class="pref"><input type="radio" name="openMode" value="direto"> Entrar direto, sem pedir nada</label>
     <label class="pref" id="bioRow" style="display:none"><input type="radio" name="openMode" value="bio"> Pedir biometria (Face ID / digital)</label>
     <label class="pref"><input type="radio" name="openMode" value="senha"> Pedir a senha</label></div>
    <div class="tools" style="margin-top:10px"><button class="btn" id="chPw">Trocar senha</button><button class="btn" id="expBtn">Baixar backup</button><label class="btn" style="cursor:pointer">Restaurar backup<input type="file" id="impFile" accept="application/json" hidden></label><button class="btn" id="outBtn">Sair</button></div>
    <div class="tools" style="margin-top:10px"><button class="btn danger" id="wipe">Apagar todos os dados</button></div></div>
   <div class="box"><h2>Instalar no celular ou PC</h2><p class="hint" style="margin-bottom:0"><b>iPhone:</b> abra no Safari → Compartilhar → “Adicionar à Tela de Início”. <b>Android:</b> Chrome → menu ⋮ → “Instalar app”. <b>PC:</b> Chrome/Edge → ícone de instalar na barra de endereço.</p></div></div>
   </section>`;
  const v = $("#view"), ins = [...v.querySelectorAll(".slots .hin")];
  bindRegra();
  ins.forEach((inp, i) => maskTime(inp, () => ins[i + 1]?.focus()));
  let dias = [...j.dias];
  $("#wdSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; const d = +b.dataset.d; dias = dias.includes(d) ? dias.filter(x => x !== d) : [...dias, d]; b.setAttribute("aria-pressed", dias.includes(d)); };
  $("#jSave").onclick = () => {
    const vals = ins.map(i => i.value.trim()), er = vals.some(x => !x) ? "Preencha os 4 horários." : checkTimes(vals);
    if (er) return $("#jErr").textContent = er;
    const snap = snapshot(); S.jornada = { ...S.jornada, dias: dias.sort(), manha: vals.slice(0, 2), tarde: vals.slice(2) }; commit("Jornada salva", restoreFrom(snap));
  };
  segBind($("#themeSeg"), "t", t => { S.prefs.theme = t; commit(); });
  const em = Store.user.email, radios = [...v.querySelectorAll('[name="openMode"]')];
  const curMode = () => Store.remembered ? "direto" : Store.bioEnabled(em) ? "bio" : "senha";
  const markMode = () => radios.forEach(r => r.checked = r.value === curMode());
  markMode();
  Store.bioSupported().then(ok => { if (ok && $("#bioRow")) $("#bioRow").style.display = ""; });
  radios.forEach(r => r.onchange = async () => {
    if (r.value === "bio") {
      try { await Store.bioEnroll(em); Store.setRemember(false); toast("Vai pedir biometria ao abrir"); }
      catch (e) { toast(/PRF/.test(e.message) ? "Este navegador ainda não suporta biometria aqui." : "Não foi possível ativar a biometria."); }
    } else { Store.bioForget(em); Store.setRemember(r.value === "direto"); toast(r.value === "direto" ? "Vai entrar direto ao abrir" : "Vai pedir a senha ao abrir"); }
    markMode();
  });
  $("#expBtn").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" })); a.download = "jornada-backup-" + todayK() + ".json"; a.click(); toast("Backup baixado"); };
  $("#impFile").onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); if (!d.jornada || !d.dias) throw 0; const snap = snapshot(); S = { ...baseState(), ...d, prefs: { ...baseState().prefs, ...d.prefs } }; commit("Backup restaurado", restoreFrom(snap)); } catch (err) { toast("Arquivo inválido: escolha um backup do Jornada (.json)"); } };
  $("#outBtn").onclick = async () => { await Store.signOut(); S = null; showAuth(); };
  $("#wipe").onclick = () => confirmBox("Apagar tudo?", "Todas as batidas e ajustes serão apagados. Baixe um backup antes se quiser guardar.", "Apagar tudo", () => { S = baseState(); commit("Dados apagados"); });
  $("#chPw").onclick = () => openSheet(`<form id="cpf"><h2>Trocar senha</h2><label class="fld">Nova senha<input id="np1" type="password" minlength="8" required autocomplete="new-password" autofocus></label><label class="fld">Repita<input id="np2" type="password" minlength="8" required autocomplete="new-password"></label><div class="err" id="cpe"></div><div class="tools" style="justify-content:flex-end"><button type="button" class="btn" id="cpx">Cancelar</button><button class="btn acc">Trocar</button></div></form>`, () => {
    $("#cpx").onclick = closeSheet; $("#cpf").onsubmit = async e => { e.preventDefault(); if ($("#np1").value.length < 8) { $("#cpe").textContent = "Use pelo menos 8 caracteres."; return; } if ($("#np1").value !== $("#np2").value) { $("#cpe").textContent = "As senhas não são iguais."; return; } try { await Store.changePassword($("#np1").value); closeSheet(); toast("Senha trocada"); } catch (err) { $("#cpe").textContent = err.message; } }; });
}

/* ---------- login / criar conta / recuperação (Supabase Auth do próprio Jornada) ---------- */
function showAuth(msg, startMode, preEmail) {
  $("#appShell").hidden = true; $("#bottomnav").hidden = true; $("#authShell").hidden = false;
  let mode = startMode || "in", email0 = preEmail || Store.user?.email || "", autoBio = false;
  const back = '<button type="button" class="linkbtn" data-m="in">← Voltar para entrar</button>';
  const emailFld = ro => `<label class="fld">E-mail<input id="aEmail" type="email" required autocomplete="email" value="${esc(email0)}" ${ro ? "readonly" : ""}></label>`;
  const rememberFld = email0 && Store.bioEnabled(email0) ? "" : `<label class="pref" style="margin-top:2px"><input type="checkbox" id="aRemember" checked> Manter minha sessão neste aparelho</label>`;
  const draw = () => {
    const E = `<div class="err" id="aErr">${esc(msg || "")}</div>`;
    const V = {
      bio: `<h2>Olá de novo</h2><p class="hint">Desbloqueie o Jornada de <b>${esc(email0)}</b>.</p>
        <button type="button" class="btn acc" id="aBioGo" style="padding:16px;font-size:16px">Desbloquear</button>${E}
        <button type="button" class="linkbtn" data-m="in" style="text-align:center">Usar senha</button>`,
      up: `<h2>Criar sua conta</h2><p class="hint">Crie uma senha com pelo menos 8 caracteres.</p>
        ${emailFld()}<label class="fld">Senha<input id="aPw" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="fld">Repita a senha<input id="aPw2" type="password" required minlength="8" autocomplete="new-password"></label>
        ${rememberFld}${E}<button class="btn acc" style="padding:12px">Criar conta</button>${back}`,
      forgot: `<h2>Esqueci a senha</h2><p class="hint">Vamos mandar um link para o seu e-mail. Ao abrir o link, você cria uma senha nova.</p>${emailFld()}
        ${E}<button class="btn acc" style="padding:12px">Enviar link</button>${back}`,
      sent: `<h2>Confira seu e-mail</h2><p class="hint">Se existir conta com <b>${esc(email0)}</b>, chegou um link para trocar a senha. Confira também o spam.</p>${back}`,
      newpw: `<h2>Nova senha</h2><p class="hint">Crie a nova senha. Para abrir seus dados criptografados, digite também o <b>código de recuperação</b> do Jornada que você guardou.</p>
        <label class="fld">Nova senha<input id="aPw" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="fld">Código de recuperação<input id="aCode" required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off"></label>
        ${E}<button class="btn acc" style="padding:12px">Trocar senha e entrar</button>`,
      rec: `<h2>Destravar seus dados</h2><p class="hint">Sua senha mudou. Digite o <b>código de recuperação</b> do Jornada que você guardou.</p>
        <label class="fld">Código de recuperação<input id="aCode" required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off"></label>
        <label class="fld">Sua senha<input id="aPw" type="password" required minlength="8" autocomplete="current-password"></label>
        ${E}<button class="btn acc" style="padding:12px">Destravar</button>`,
      in: `<h2>Entrar</h2>${Store.cloudReady ? `${emailFld()}
        <label class="fld">Senha<input id="aPw" type="password" required minlength="8" autocomplete="current-password"></label>
        ${rememberFld}${E}<button class="btn acc" style="padding:12px">Entrar</button>
        <button type="button" class="linkbtn" data-m="forgot" style="color:var(--muted)">Esqueci a senha</button>
        <div style="display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px"><hr style="flex:1;border:0;border-top:1px solid var(--line)">primeira vez?<hr style="flex:1;border:0;border-top:1px solid var(--line)"></div>
        <button type="button" class="btn" data-m="up" style="padding:12px">Criar conta</button>`
        : `<p class="hint">O login online ainda não foi configurado neste endereço.</p>`}
        <p class="hint" style="font-size:12px">Seus dados são criptografados no seu aparelho antes de irem para a nuvem. Ninguém além de você consegue lê-los.</p>`,
    };
    $("#authForm").innerHTML = V[mode]; Controls.enhance($("#authForm"));
    document.querySelectorAll("#authForm [data-m]").forEach(b => b.onclick = () => { email0 = $("#aEmail")?.value || email0; mode = b.dataset.m; msg = ""; draw(); });
    if (mode === "bio") $("#aBioGo").onclick = async () => {
      const b = $("#aBioGo"), old = b.innerHTML; b.innerHTML = '<span class="spin"></span> Verificando…'; b.disabled = true;
      try { S = fixState((await Store.bioUnlock(email0)).state); enterApp(); }
      catch (ex) { msg = ex?.name === "NotAllowedError" ? "" : "Não foi possível desbloquear. Use sua senha."; draw(); }
      finally { if (b.isConnected) { b.innerHTML = old; b.disabled = false; } }
    };
    if (mode === "bio" && !autoBio) { autoBio = true; $("#aBioGo").click(); }
    const f = $("#authForm").querySelector("input:not([readonly])"); if (f && matchMedia("(pointer:fine)").matches) f.focus();
  };
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const err = t => { $("#aErr").textContent = t; const f = $("#authForm"); f.classList.remove("shake"); f.offsetWidth; f.classList.add("shake"); };
    const btn = $("#authForm").querySelector(".btn.acc"); if (!btn) return;
    const bad = [...$("#authForm").querySelectorAll("input[required]")].find(i => !i.checkValidity());
    if (bad) { bad.focus(); return err(bad.type === "email" ? "Digite um e-mail válido." : bad.minLength > 0 && bad.value ? `Use pelo menos ${bad.minLength} caracteres.` : "Preencha este campo."); }
    const old = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Aguarde…'; btn.disabled = true;
    try {
      const email = ($("#aEmail")?.value || email0).trim().toLowerCase(), pw = $("#aPw")?.value;
      if (email) email0 = email;
      if ($("#aRemember")) Store.setRemember($("#aRemember").checked);
      if (mode === "forgot") { await Store.resetEmail(email); mode = "sent"; msg = ""; return draw(); }
      if (mode === "newpw") { S = fixState((await Store.recover($("#aCode").value, pw)).state); enterApp(); toast("Senha trocada"); return; }
      if (mode === "rec") { S = fixState((await Store.recover($("#aCode").value, pw)).state); enterApp(); toast("Acesso recuperado"); return; }
      if (mode === "up") {
        if (pw !== $("#aPw2").value) return err("As senhas não são iguais.");
        const r = await Store.signUp(email, pw, baseState());
        if (r.confirmEmail) { mode = "in"; msg = "Conta criada! Confirme pelo e-mail e depois entre."; return draw(); }
        S = r.state; return showRecovery(r.recoveryCode);
      }
      const r = await Store.signIn(email, pw);
      if (r.noVault) { const c = await Store.createVault(pw, baseState()); S = c.state; return showRecovery(c.recoveryCode); }
      if (r.needRecovery) { mode = "rec"; return draw(); }
      S = fixState(r.state); enterApp();
    } catch (ex) {
      const m = ex?.message || "";
      err(/not allowed|disabled/i.test(m) ? "Cadastro fechado neste app." : /Invalid login/i.test(m) ? "E-mail ou senha incorretos." : /registered|already/i.test(m) ? "Esse e-mail já tem conta. Tente entrar." : /fetch|network|Failed/i.test(m) ? "Sem conexão. Verifique a internet." : /decrypt|operation/i.test(m) ? "Código de recuperação incorreto." : "Algo deu errado. Tente de novo.");
    } finally { if (btn.isConnected) { btn.innerHTML = old; btn.disabled = false; } }
  };
  draw();
}
function showRecovery(code) {
  $("#authForm").innerHTML = `<h2>Guarde este código</h2><p class="hint">Se esquecer a senha, é a <b>única forma</b> de recuperar seus dados do Jornada — nem nós conseguimos, porque tudo é criptografado. Anote ou tire print e guarde em lugar seguro.</p>
   <div class="reccode">${code}</div><button type="button" class="btn" id="copyRec">Copiar código</button>
   <label class="note" style="cursor:pointer;align-items:center"><input type="checkbox" id="saved"> Guardei o código em lugar seguro</label>
   <button type="button" class="btn acc" id="goIn" style="padding:12px" disabled>Começar a usar</button>`;
  $("#copyRec").onclick = () => navigator.clipboard?.writeText(code).then(() => toast("Código copiado"), () => {});
  $("#saved").onchange = e => $("#goIn").disabled = !e.target.checked;
  $("#goIn").onclick = () => { enterApp(); setTimeout(tour, 600); };
}
const fixState = st => ({ ...baseState(), ...st, prefs: { ...baseState().prefs, ...(st?.prefs || {}) } });
function enterApp() {
  $("#authShell").hidden = true; $("#appShell").hidden = false; $("#bottomnav").hidden = false;
  page = "hoje"; cur = ym(todayK()); animate = true; render();
}
Store.onStatus(s => {
  const el = $("#sync"); el.className = "sync " + (s === "busy" ? "busy" : s === "err" || s === "conflict" ? "err" : "");
  $("#syncTxt").textContent = s === "busy" ? "salvando…" : s === "err" ? "sem conexão — tentaremos de novo" : s === "conflict" ? "alterado em outro aparelho" : "salvo na nuvem";
  if (s === "err") setTimeout(() => Store.flush(), 8000);
  if (s === "conflict") toast("Seus dados mudaram em outro aparelho. Recarregando…"), Store.reload().then(st => { S = fixState(st); render(); });
});
/* voltou para o app (ex.: bateu ponto no celular e abriu no PC): busca a versão mais nova */
addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S && Store.mode === "cloud") Store.flush().then(() => Store.reload()).then(st => { if (st) { S = fixState(st); render(); } }).catch(() => {}); });

function tour() {
  const steps = [["Bem-vindo ao Jornada", "Aqui você registra o dia e vê o banco de horas do mês."],
    ["Dois jeitos de bater ponto", "No Cronômetro, um toque só a cada momento: começar, almoço, volta e fim. Ou digite os horários, se preferir."],
    ["Saldo do mês", "Em “Mês” você vê cada dia, corrige horários, marca feriado, falta ou atestado e compara com o sistema da empresa."],
    ["Sua jornada", "Em Ajustes você define os horários oficiais e os dias de trabalho."]];
  let i = 0;
  const show = () => { const [t, d] = steps[i]; openSheet(`<div class="panel" style="text-align:center;justify-items:center"><h2>${t}</h2><p class="hint">${d}</p>
    <div style="display:flex;gap:6px;justify-content:center">${steps.map((_, j) => `<span class="dot" style="background:${j === i ? "var(--accent)" : "var(--line)"}"></span>`).join("")}</div>
    <div class="tools" style="justify-content:center"><button class="btn" id="tSkip">Pular</button><button class="btn acc" id="tNext">${i < steps.length - 1 ? "Próximo" : "Começar"}</button></div></div>`, () => {
      $("#tSkip").onclick = closeSheet; $("#tNext").onclick = () => { i++; i < steps.length ? show() : closeSheet(); }; }); };
  show();
}

/* ---------- boot ---------- */
Store.onRecoveryLink = () => showAuth("", "newpw");
(async () => {
  try {
    const criar = new URLSearchParams(location.search).get("criar");
    if (criar) { history.replaceState(null, "", location.pathname); return showAuth("", "up", criar); }
    const r = await Store.resume();
    if (r?.state) { S = fixState(r.state); enterApp(); return; }
    if (r?.needPassword && r.bioAvail) return showAuth("", "bio", r.email);
    showAuth(r?.needPassword ? "Digite sua senha para destravar seus dados." : "", r?.needPassword ? "in" : undefined, r?.email);
  } catch (e) { showAuth("Não foi possível conectar. Verifique a internet."); }
  finally { if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {}); }
})();
/* testes locais: window.__ponto dá acesso ao estado sem login (só em localhost) */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__ponto = { get S() { return S; }, set S(v) { S = fixState(v); }, enterApp, render, dayInfo, monthInfo, rangeInfo, baseState };
})();
