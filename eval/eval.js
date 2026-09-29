/* Eval dashboard UI — data loading, controls, canvas charts, results. */
"use strict";

const $ = (id) => document.getElementById(id);
const DATA = (pair, tf) => `data/${pair.replace("/", "_")}_${tf}.json`;

let candles = null;   // [[t,o,h,l,c,v],...]
let meta = null;
let lastResult = null;

const fmtCAD = (v, dp = 0) =>
  v.toLocaleString("en-CA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtDate = (t) =>
  new Date(t).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
const fmtDT = (t) => {
  const d = new Date(t);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
};

/* ---------- canvas helpers ---------- */

function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function resampleForDisplay(c, target) {
  if (c.length <= target) return { candles: c, group: 1 };
  const group = Math.ceil(c.length / target);
  const out = [];
  for (let i = 0; i < c.length; i += group) {
    const slice = c.slice(i, i + group);
    out.push([
      slice[0][0],
      slice[0][1],
      Math.max(...slice.map(x => x[2])),
      Math.min(...slice.map(x => x[3])),
      slice[slice.length - 1][4],
      slice.reduce((s, x) => s + x[5], 0),
    ]);
  }
  return { candles: out, group };
}

function drawPrice(cv, c, markers) {
  const { ctx, w, h } = fitCanvas(cv);
  const padL = 8, padR = 64, padT = 14, padB = 22;
  const { candles: dc, group } = resampleForDisplay(c, Math.max(60, Math.floor((w - padL - padR) / 4)));

  let lo = Infinity, hi = -Infinity;
  for (const x of dc) { if (x[3] < lo) lo = x[3]; if (x[2] > hi) hi = x[2]; }
  const span = hi - lo || 1;
  const X = (i) => padL + (i / Math.max(dc.length - 1, 1)) * (w - padL - padR);
  const Y = (p) => padT + (1 - (p - lo) / span) * (h - padT - padB);

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(233,231,242,0.07)";
  ctx.fillStyle = "#5d5878";
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "left";
  for (let g = 0; g <= 4; g++) {
    const p = lo + (span * g) / 4, y = Y(p);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(fmtCAD(p), w - padR + 6, y + 3);
  }
  // date labels
  ctx.fillText(fmtDate(dc[0][0]), padL, h - 6);
  const endLabel = fmtDate(dc[dc.length - 1][0]);
  ctx.fillText(endLabel, w - padR - ctx.measureText(endLabel).width, h - 6);

  const step = (w - padL - padR) / Math.max(dc.length - 1, 1);
  const bw = Math.max(1, Math.min(9, step * 0.62));
  for (let i = 0; i < dc.length; i++) {
    const x = X(i), [, o, hh, ll, cl] = dc[i];
    const up = cl >= o;
    ctx.strokeStyle = up ? "#26a69a" : "#ef5350";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(1, bw * 0.28);
    ctx.beginPath(); ctx.moveTo(x, Y(hh)); ctx.lineTo(x, Y(ll)); ctx.stroke();
    const yO = Y(o), yC = Y(cl);
    ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1.5, Math.abs(yC - yO)));
  }

  // trade markers
  for (const m of markers) {
    const di = Math.min(dc.length - 1, Math.floor(m.idx / group));
    const x = X(di);
    if (m.type === "buy") {
      const y = Y(dc[di][3]) + 9;
      ctx.fillStyle = "#8b7cf6";
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x - 5, y + 2); ctx.lineTo(x + 5, y + 2); ctx.closePath(); ctx.fill();
    } else {
      const y = Y(dc[di][2]) - 9;
      ctx.fillStyle = "#f87171";
      ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x - 5, y - 2); ctx.lineTo(x + 5, y - 2); ctx.closePath(); ctx.fill();
    }
  }
}

function drawEquity(cv, equity, startBalance) {
  const { ctx, w, h } = fitCanvas(cv);
  const padL = 8, padR = 64, padT = 12, padB = 18;
  let lo = Math.min(startBalance, ...equity), hi = Math.max(startBalance, ...equity);
  const span = hi - lo || 1;
  lo -= span * 0.06; hi += span * 0.06;
  const X = (i) => padL + (i / Math.max(equity.length - 1, 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);

  ctx.clearRect(0, 0, w, h);
  // start-balance baseline
  ctx.strokeStyle = "rgba(233,231,242,0.18)";
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(padL, Y(startBalance)); ctx.lineTo(w - padR, Y(startBalance)); ctx.stroke();
  ctx.setLineDash([]);

  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, "rgba(139,124,246,0.35)");
  grad.addColorStop(1, "rgba(139,124,246,0.02)");
  ctx.beginPath();
  ctx.moveTo(X(0), Y(equity[0]));
  for (let i = 1; i < equity.length; i++) ctx.lineTo(X(i), Y(equity[i]));
  ctx.strokeStyle = "#8b7cf6";
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.lineTo(X(equity.length - 1), h - padB);
  ctx.lineTo(X(0), h - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = "#5d5878";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText(fmtCAD(hi), w - padR + 6, Y(hi) + 3);
  ctx.fillText(fmtCAD(lo), w - padR + 6, Y(lo) + 3);
}

/* ---------- controls ---------- */

function sliderRow(p) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML =
    `<label>${p.label} <output id="p-${p.key}">${p.def}</output></label>` +
    `<input type="range" id="in-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}">`;
  const input = wrap.querySelector("input");
  const out = wrap.querySelector("output");
  input.addEventListener("input", () => { out.textContent = input.value; });
  input.addEventListener("change", run);
  return wrap;
}

function buildStrategyControls() {
  const sel = $("strategy");
  sel.innerHTML = "";
  for (const [key, s] of Object.entries(STRATEGIES)) {
    const opt = document.createElement("option");
    opt.value = key; opt.textContent = s.name;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => { buildParamFields(); run(); });
  buildParamFields();
}

function buildParamFields() {
  const key = $("strategy").value;
  const s = STRATEGIES[key];
  $("strat-blurb").textContent = s.blurb;
  const host = $("strategy-params");
  host.innerHTML = "";
  for (const p of s.params) host.appendChild(sliderRow(p));
}

function getParams() {
  const key = $("strategy").value;
  const p = {};
  for (const def of STRATEGIES[key].params) {
    p[def.key] = parseFloat($("in-" + def.key).value);
  }
  return p;
}

function getRisk() {
  return {
    stake: parseFloat($("stake").value),
    stoplossPct: parseFloat($("stoploss").value),
    takeprofitPct: parseFloat($("takeprofit").value),
    feePct: parseFloat($("fee").value),
    maxOpen: parseInt($("maxopen").value, 10),
    startBalance: 10000,
  };
}

const RISK_FIELDS = [
  ["stake", "stake-out", (v) => `${fmtCAD(v)} CAD`],
  ["stoploss", "stoploss-out", (v) => `${v}%`],
  ["takeprofit", "takeprofit-out", (v) => `${v}%`],
  ["fee", "fee-out", (v) => `${v.toFixed(2)}%`],
  ["maxopen", "maxopen-out", (v) => `${v}`],
];

function refreshRiskOutputs() {
  for (const [id, out, fmt] of RISK_FIELDS) {
    $(out).textContent = fmt(parseFloat($(id).value));
  }
}

function wireRiskOutputs() {
  for (const [id, , ] of RISK_FIELDS) {
    const el = $(id);
    el.addEventListener("input", refreshRiskOutputs);
    el.addEventListener("change", run);
  }
}

/* ---------- results ---------- */

function statCard(k, v, cls = "") {
  return `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
}

function render(result) {
  const st = result.stats;
  const pos = st.profit >= 0;
  $("stats").hidden = false;
  $("stats").innerHTML =
    statCard("Total return", `${pos ? "+" : ""}${st.profitPct.toFixed(2)}%`, pos ? "pos" : "neg") +
    statCard("Final equity", `${fmtCAD(st.endBalance)} CAD`) +
    statCard("Trades", st.tradeCount) +
    statCard("Win rate", `${st.winRate.toFixed(1)}%`) +
    statCard("Profit factor", Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : "∞") +
    statCard("Max drawdown", `${st.maxDrawdownPct.toFixed(2)}%`, "neg") +
    statCard("Sharpe", st.sharpe.toFixed(2), st.sharpe >= 0 ? "pos" : "neg") +
    statCard("Avg win / loss", `${fmtCAD(st.avgWin)} / ${fmtCAD(st.avgLoss)}`);

  const reasons = {};
  for (const t of result.trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  const rEl = $("reasons");
  rEl.hidden = false;
  rEl.innerHTML = Object.entries(reasons)
    .map(([k, v]) => `<span class="reason-pill">${k} <b>×${v}</b></span>`)
    .join("") || `<span class="reason-pill">no trades taken</span>`;

  const last = candles[candles.length - 1][4];
  $("price-now").innerHTML = `last <b>${fmtCAD(last)} CAD</b>`;
  $("equity-now").innerHTML = `final <b>${fmtCAD(st.endBalance)} CAD</b>`;

  drawPrice($("price-chart"), candles, result.markers);
  $("price-chart").hidden = false;
  $("price-loading").style.display = "none";
  drawEquity($("equity-chart"), result.equity, st.startBalance);
  $("equity-chart").hidden = false;

  const tp = $("trades-panel");
  tp.hidden = false;
  $("trades-count").textContent = `${st.tradeCount} closed`;
  const rows = [...result.trades].reverse().slice(0, 25).map((t) => {
    const cls = t.profit >= 0 ? "pl-pos" : "pl-neg";
    return `<tr><td>${fmtDT(t.entryTime)}</td><td>${fmtDT(t.exitTime)}</td>` +
      `<td class="num">${fmtCAD(t.entryPrice, 2)}</td><td class="num">${fmtCAD(t.exitPrice, 2)}</td>` +
      `<td class="num ${cls}">${t.profit >= 0 ? "+" : ""}${fmtCAD(t.profit, 2)}</td>` +
      `<td class="num ${cls}">${t.profitPct >= 0 ? "+" : ""}${t.profitPct.toFixed(2)}%</td>` +
      `<td>${t.reason}</td></tr>`;
  }).join("");
  $("trades-body").innerHTML = rows || `<tr><td colspan="7">No trades — the strategy never pulled the trigger.</td></tr>`;
}

function run() {
  if (!candles) return;
  const btn = $("run");
  btn.classList.add("running");
  // let the UI paint the running state before the (fast) synchronous compute
  requestAnimationFrame(() => setTimeout(() => {
    try {
      lastResult = backtest(candles, $("strategy").value, getParams(), getRisk());
      render(lastResult);
    } finally {
      btn.classList.remove("running");
    }
  }, 30));
}

/* ---------- data ---------- */

async function loadData() {
  const pair = $("pair").value, tf = $("timeframe").value;
  $("run").disabled = true;
  $("data-note").textContent = "Summoning candles…";
  try {
    const res = await fetch(DATA(pair, tf));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    candles = payload.candles;
    meta = payload.meta;
    const from = fmtDate(candles[0][0]), to = fmtDate(candles[candles.length - 1][0]);
    $("data-note").innerHTML =
      `Data: <b>${meta.candles.toLocaleString()} ${meta.timeframe} candles</b> for <b>${meta.pair}</b> ` +
      `from Kraken, ${from} → ${to}. Refreshed ${fmtDate(Date.parse(meta.exported_at))}.`;
    $("price-title").textContent = `${pair} · ${tf}`;
    $("run").disabled = false;
    run();
  } catch (err) {
    $("data-note").textContent = `Couldn't load the candles (${err.message}). The dark provides no data today.`;
  }
}

/* ---------- deep links ---------- */

const RISK_QUERY_KEYS = { stake: "stake", stoploss: "sl", takeprofit: "tp", fee: "fee", maxopen: "maxopen" };

function clampToSlider(el, v) {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return;
  el.value = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), n));
}

// Read ?pair=&tf=&strategy=&<strategy params>&stake=&sl=&tp=&fee=&maxopen=
// and pre-set every control. Called after the controls are built; loadData()
// then auto-runs the backtest with the linked settings.
function applyDeepLink() {
  const q = new URLSearchParams(location.search);
  if ([...q.keys()].length === 0) return;

  const setSel = (id, v) => {
    const el = $(id);
    if ([...el.options].some((o) => o.value === v)) el.value = v;
  };
  if (q.has("pair")) setSel("pair", q.get("pair").replace("_", "/"));
  if (q.has("tf")) setSel("timeframe", q.get("tf"));
  if (q.has("strategy")) {
    setSel("strategy", q.get("strategy"));
    buildParamFields();
  }

  for (const def of STRATEGIES[$("strategy").value].params) {
    if (!q.has(def.key)) continue;
    const el = $("in-" + def.key);
    clampToSlider(el, q.get(def.key));
    $("p-" + def.key).textContent = el.value;
  }
  for (const [id, qk] of Object.entries(RISK_QUERY_KEYS)) {
    if (q.has(qk)) clampToSlider($(id), q.get(qk));
  }
  refreshRiskOutputs();
}

function shareLink() {
  const base = location.href.split("?")[0].split("#")[0];
  const u = new URL(base);
  u.searchParams.set("pair", $("pair").value.replace("/", "_"));
  u.searchParams.set("tf", $("timeframe").value);
  u.searchParams.set("strategy", $("strategy").value);
  for (const [k, v] of Object.entries(getParams())) u.searchParams.set(k, v);
  u.searchParams.set("stake", $("stake").value);
  u.searchParams.set("sl", $("stoploss").value);
  u.searchParams.set("tp", $("takeprofit").value);
  u.searchParams.set("fee", $("fee").value);
  u.searchParams.set("maxopen", $("maxopen").value);
  return u.toString();
}

async function shareCurrent() {
  const btn = $("share");
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(shareLink());
    btn.textContent = "Link copied";
  } catch {
    btn.textContent = "Copy failed — share the URL by hand";
  }
  setTimeout(() => { btn.textContent = label; }, 1600);
}

/* ---------- init ---------- */

buildStrategyControls();
wireRiskOutputs();
applyDeepLink();
$("run").addEventListener("click", run);
$("share").addEventListener("click", shareCurrent);
$("pair").addEventListener("change", loadData);
$("timeframe").addEventListener("change", loadData);
window.addEventListener("resize", () => {
  if (lastResult) {
    drawPrice($("price-chart"), candles, lastResult.markers);
    drawEquity($("equity-chart"), lastResult.equity, lastResult.stats.startBalance);
  }
});
loadData();
