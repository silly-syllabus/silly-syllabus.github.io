/* Strategy playground backtest engine — pure functions, no DOM.
 * Long-only spot simulation. Fills at candle close unless stop-loss /
 * take-profit is touched intrabar (then fills at the stop/tp price).
 * Fees are applied per side on notional. This is an approximation for
 * intuition-building; validate anything promising in Freqtrade proper.
 */
"use strict";

/* ---------------- indicators ---------------- */

function sma(values, period) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(prev)) {
      // seed with SMA once enough data
      if (i >= period - 1) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += values[j];
        prev = s / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsi(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function macd(closes, fast, slow, signal) {
  const fastE = ema(closes, fast), slowE = ema(closes, slow);
  const line = closes.map((_, i) =>
    (Number.isNaN(fastE[i]) || Number.isNaN(slowE[i])) ? NaN : fastE[i] - slowE[i]);
  // signal EMA over the macd line, ignoring leading NaNs
  const sig = new Array(closes.length).fill(NaN);
  const k = 2 / (signal + 1);
  let prev = NaN, count = 0, acc = 0, seeded = false;
  for (let i = 0; i < closes.length; i++) {
    const v = line[i];
    if (Number.isNaN(v)) continue;
    if (!seeded) {
      acc += v; count++;
      if (count === signal) { prev = acc / signal; sig[i] = prev; seeded = true; }
    } else {
      prev = v * k + prev * (1 - k);
      sig[i] = prev;
    }
  }
  return { line, signal: sig };
}

function bollinger(closes, period, mult) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, mid, lower };
}

/* ---------------- signal generators ----------------
 * Each returns {buy: boolean[], sell: boolean[]} aligned to candles.
 * Signals are evaluated on closed candles; entries fill at that close.
 */

const STRATEGIES = {
  rsi: {
    name: "RSI mean reversion",
    blurb: "Buys when RSI sinks under the oversold line, sells when it climbs over the overbought line.",
    params: [
      { key: "rsi_period", label: "RSI period", min: 2, max: 50, step: 1, def: 14 },
      { key: "oversold", label: "Oversold", min: 5, max: 45, step: 1, def: 30 },
      { key: "overbought", label: "Overbought", min: 55, max: 95, step: 1, def: 70 },
    ],
    signals(c, p) {
      const r = rsi(c.map(x => x[4]), p.rsi_period);
      return {
        buy: r.map(v => !Number.isNaN(v) && v < p.oversold),
        sell: r.map(v => !Number.isNaN(v) && v > p.overbought),
      };
    },
  },
  sma_cross: {
    name: "SMA crossover",
    blurb: "Buys when the fast average crosses above the slow one, sells on the cross back down.",
    params: [
      { key: "fast", label: "Fast SMA", min: 2, max: 100, step: 1, def: 20 },
      { key: "slow", label: "Slow SMA", min: 5, max: 300, step: 1, def: 50 },
    ],
    signals(c, p) {
      const cl = c.map(x => x[4]);
      const f = sma(cl, p.fast), s = sma(cl, p.slow);
      const buy = new Array(c.length).fill(false);
      const sell = new Array(c.length).fill(false);
      for (let i = 1; i < c.length; i++) {
        if ([f[i], s[i], f[i-1], s[i-1]].some(Number.isNaN)) continue;
        if (f[i-1] <= s[i-1] && f[i] > s[i]) buy[i] = true;
        if (f[i-1] >= s[i-1] && f[i] < s[i]) sell[i] = true;
      }
      return { buy, sell };
    },
  },
  bollinger: {
    name: "Bollinger snap-back",
    blurb: "Buys when price closes under the lower band, exits at the middle band.",
    params: [
      { key: "bb_period", label: "Band period", min: 5, max: 100, step: 1, def: 20 },
      { key: "bb_mult", label: "Std dev", min: 1, max: 4, step: 0.1, def: 2 },
    ],
    signals(c, p) {
      const cl = c.map(x => x[4]);
      const b = bollinger(cl, p.bb_period, p.bb_mult);
      const buy = new Array(c.length).fill(false);
      const sell = new Array(c.length).fill(false);
      for (let i = 0; i < c.length; i++) {
        if (Number.isNaN(b.lower[i])) continue;
        if (cl[i] < b.lower[i]) buy[i] = true;
        if (cl[i] > b.mid[i]) sell[i] = true;
      }
      return { buy, sell };
    },
  },
  macd: {
    name: "MACD trend",
    blurb: "Buys when MACD crosses above its signal line, sells on the cross under.",
    params: [
      { key: "macd_fast", label: "Fast EMA", min: 2, max: 50, step: 1, def: 12 },
      { key: "macd_slow", label: "Slow EMA", min: 5, max: 100, step: 1, def: 26 },
      { key: "macd_signal", label: "Signal EMA", min: 2, max: 30, step: 1, def: 9 },
    ],
    signals(c, p) {
      const m = macd(c.map(x => x[4]), p.macd_fast, p.macd_slow, p.macd_signal);
      const buy = new Array(c.length).fill(false);
      const sell = new Array(c.length).fill(false);
      for (let i = 1; i < c.length; i++) {
        const a = [m.line[i], m.signal[i], m.line[i-1], m.signal[i-1]];
        if (a.some(Number.isNaN)) continue;
        if (m.line[i-1] <= m.signal[i-1] && m.line[i] > m.signal[i]) buy[i] = true;
        if (m.line[i-1] >= m.signal[i-1] && m.line[i] < m.signal[i]) sell[i] = true;
      }
      return { buy, sell };
    },
  },
};

/* ---------------- regime filters ----------------
 * Optional confluence gates evaluated before entries (never exits —
 * you don't want to be trapped in a position because a filter said
 * "don't trade"). Gates are pure functions of past data with fixed
 * round thresholds chosen from independent evidence, not tuned here.
 *
 * regime: {
 *   usdtCandles: [[t,o,h,l,c,v],...] | null,  // 15m USDT/USD
 *   maxUsdtDevBps: number,                    // 0 = off; skip entries when
 *                                             // trailing-1h mean |USDT-1| exceeds this
 * }
 * A trailing-24h realized-vol gate was tested on 90d and cut: it only
 * delayed entries rather than selecting trades (+0.69% -> +0.74%,
 * statistically nothing) — confluence theater, not confluence.
 * Returns {allow: boolean[], filtered: number} aligned to candles.
 */
function buildRegime(candles, buy, regime) {
  const n = candles.length;
  const allow = new Array(n).fill(true);
  let filtered = 0;
  if (!regime) return { allow, filtered };

  if (regime.usdtCandles && regime.maxUsdtDevBps > 0) {
    const um = new Map(regime.usdtCandles.map(c => [c[0], c[4]]));
    for (let i = 0; i < n; i++) {
      const t = candles[i][0];
      let sum = 0, cnt = 0;
      for (let k = 0; k < 4; k++) {
        const u = um.get(t - k * 900000);
        if (u !== undefined) { sum += Math.abs(u - 1); cnt++; }
      }
      if (cnt > 0 && (sum / cnt) * 1e4 > regime.maxUsdtDevBps) allow[i] = false;
    }
  }

  for (let i = 0; i < n; i++) if (buy[i] && !allow[i]) filtered++;
  return { allow, filtered };
}

/* ---------------- simulation ---------------- */

function backtest(candles, strategyKey, sParams, risk, regime) {
  // candles: [[t, o, h, l, c, v], ...]
  // risk: {stake, stoplossPct, takeprofitPct, feePct, maxOpen, startBalance}
  // regime: optional confluence gates, see buildRegime (entries only)
  const strat = STRATEGIES[strategyKey];
  const { buy, sell } = strat.signals(candles, sParams);
  const { allow, filtered } = buildRegime(candles, buy, regime);
  const fee = risk.feePct / 100;
  const sl = risk.stoplossPct / 100;
  const tp = risk.takeprofitPct > 0 ? risk.takeprofitPct / 100 : Infinity;

  let cash = risk.startBalance;
  const open = [];           // {entryPrice, amount, entryIdx, entryTime}
  const trades = [];         // closed trades
  const equity = [];         // mark-to-market equity per candle
  const markers = [];        // {idx, type: 'buy'|'sell', price}

  const closePosition = (pos, exitPrice, idx, reason) => {
    const gross = pos.amount * exitPrice;
    const net = gross * (1 - fee);
    const cost = pos.amount * pos.entryPrice * (1 + fee);
    const profit = net - cost;
    cash += net;
    trades.push({
      entryTime: pos.entryTime, exitTime: candles[idx][0],
      entryPrice: pos.entryPrice, exitPrice,
      profit, profitPct: profit / cost * 100, reason,
    });
    markers.push({ idx, type: "sell", price: exitPrice });
  };

  for (let i = 0; i < candles.length; i++) {
    const [t, o, h, l, c] = candles[i];

    // 1) manage open positions: stop-loss, take-profit, then signal exits
    for (let k = open.length - 1; k >= 0; k--) {
      const pos = open[k];
      const stopPrice = pos.entryPrice * (1 - sl);
      const tpPrice = pos.entryPrice * (1 + tp);
      if (sl > 0 && l <= stopPrice) {
        closePosition(pos, stopPrice, i, "stoploss");
        open.splice(k, 1);
      } else if (tp !== Infinity && h >= tpPrice) {
        closePosition(pos, tpPrice, i, "takeprofit");
        open.splice(k, 1);
      } else if (sell[i]) {
        closePosition(pos, c, i, "signal");
        open.splice(k, 1);
      }
    }

    // 2) entries (gated by regime filters)
    if (buy[i] && allow[i] && open.length < risk.maxOpen && cash >= risk.stake * (1 + fee)) {
      const amount = (risk.stake * (1 - fee)) / c;
      cash -= risk.stake;
      open.push({ entryPrice: c, amount, entryIdx: i, entryTime: t });
      markers.push({ idx: i, type: "buy", price: c });
    }

    // 3) mark to market
    let posVal = 0;
    for (const pos of open) posVal += pos.amount * c;
    equity.push(cash + posVal);
  }

  // close anything left at the final close
  const lastIdx = candles.length - 1;
  for (let k = open.length - 1; k >= 0; k--) {
    closePosition(open[k], candles[lastIdx][4], lastIdx, "end");
  }
  equity[equity.length - 1] = cash;

  return { trades, equity, markers, filtered, stats: summarize(trades, equity, risk.startBalance, candles) };
}

function summarize(trades, equity, startBalance, candles) {
  const endBalance = equity[equity.length - 1];
  const profit = endBalance - startBalance;
  const wins = trades.filter(t => t.profit > 0);
  const losses = trades.filter(t => t.profit <= 0);
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));

  let peak = equity[0], maxDD = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = (peak - e) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe on per-candle equity returns, annualized by candle count
  const rets = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) rets.push((equity[i] - equity[i - 1]) / equity[i - 1]);
  }
  const mean = rets.reduce((s, r) => s + r, 0) / Math.max(rets.length, 1);
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(rets.length, 1));
  const msPerCandle = candles.length > 1 ? candles[1][0] - candles[0][0] : 3600000;
  const perYear = (365 * 24 * 3600 * 1000) / msPerCandle;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(perYear) : 0;

  return {
    startBalance, endBalance, profit,
    profitPct: profit / startBalance * 100,
    tradeCount: trades.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDrawdownPct: maxDD * 100,
    sharpe,
  };
}

// node test hook — harmless in the browser
if (typeof module !== "undefined") module.exports = { sma, ema, rsi, macd, bollinger, STRATEGIES, buildRegime, backtest };
