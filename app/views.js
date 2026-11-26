import {
  addDays, addMonths, billInstances, cashProjection, compactMoney, currentCash, dateFromKey,
  debtPlan, envelopeStatus, fmt, fmtDate, goalDate, incomeEvents, monthLabel, monthOf,
  monthOptions, monthStats, safeToSpend, simulate, sum, todayKey, transactionsInMonth,
  transactionCSV, buildInsights,
} from './core.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (s, n, d = 0) => esc(fmt(s, n, d));
const short = (s, n) => esc(compactMoney(s, n));
const opt = (value, label, selected) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
const options = (list, selected) => list.map((v) => opt(v, v, selected)).join('');

function progress(pct, color) {
  const value = Math.max(0, Math.min(100, pct));
  return `<div class="bar"><i style="width:${value.toFixed(1)}%;background:${esc(color)}"></i></div>`;
}

function cashflowChart(state, months) {
  const data = months.map((m) => ({ label: fmtDate(state, `${m}-01`, { month: 'short' }), ...monthStats(state, m) }));
  const w = 560, h = 188, l = 45, r = 8, t = 12, b = 28;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spend])) * 1.12;
  const group = (w - l - r) / Math.max(1, data.length);
  const bw = Math.min(17, group * 0.3);
  const y = (v) => t + (h - t - b) * (1 - v / max);
  const grid = [0, 1, 2, 3].map((i) => {
    const yy = t + ((h - t - b) * i) / 3;
    return `<line x1="${l}" y1="${yy}" x2="${w - r}" y2="${yy}" class="grid"/><text x="${l - 6}" y="${yy + 4}" text-anchor="end" class="axis">${short(state, max * (1 - i / 3))}</text>`;
  }).join('');
  const bars = data.map((d, i) => {
    const cx = l + group * i + group / 2;
    const ih = Math.max(1, h - b - y(d.income));
    const sh = Math.max(1, h - b - y(d.spend));
    return `<rect x="${cx - bw - 1}" y="${y(d.income)}" width="${bw}" height="${ih}" rx="3" class="income-bar"/><rect x="${cx + 1}" y="${y(d.spend)}" width="${bw}" height="${sh}" rx="3" class="spend-bar"/><text x="${cx}" y="${h - 8}" text-anchor="middle" class="axis">${esc(d.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Monthly income and spending bars">${grid}${bars}</svg>`;
}

function donutChart(state, items) {
  const total = sum(items, (i) => i.value);
  const r = 46, circumference = 2 * Math.PI * r;
  let offset = 0;
  const rings = items.map((item) => {
    const length = total > 0 ? (Math.max(0, item.value) / total) * circumference : 0;
    const circle = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${esc(item.color)}" stroke-width="16" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
    offset += length;
    return circle;
  }).join('');
  return `<svg viewBox="0 0 120 120" class="donut" role="img" aria-label="Spending by category"><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="16"/>${rings}<text x="60" y="56" text-anchor="middle" class="donut-total">${short(state, total)}</text><text x="60" y="72" text-anchor="middle" class="donut-label">spent</text></svg>`;
}

function lineChart(state, points, color = 'var(--teal)', label = 'Trend') {
  if (!points.length) return '<p class="empty">No data in this range.</p>';
  const w = 560, h = 160, l = 45, r = 8, t = 12, b = 26;
  const values = points.map((p) => p.y);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values) * 1.08;
  const x = (i) => l + ((w - l - r) * i) / Math.max(1, points.length - 1);
  const y = (v) => t + (h - t - b) * (1 - (v - min) / (max - min));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${h - b} L${l},${h - b} Z`;
  const grid = [0, 1, 2].map((i) => {
    const yy = t + ((h - t - b) * i) / 2;
    return `<line x1="${l}" y1="${yy}" x2="${w - r}" y2="${yy}" class="grid"/><text x="${l - 6}" y="${yy + 4}" text-anchor="end" class="axis">${short(state, max - ((max - min) * i) / 2)}</text>`;
  }).join('');
  const labels = points.map((p, i) => (i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2) ? `<text x="${x(i)}" y="${h - 7}" text-anchor="middle" class="axis">${esc(p.label)}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="${esc(label)}"><path d="${area}" fill="${color}" opacity="0.13"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${grid}${labels}</svg>`;
}

function debtChart(state, selected, alternative) {
  const a = selected.series.length ? selected.series : [{ month: 0, total: sum(state.debts, (d) => d.balance) }];
  const b = alternative.series.length ? alternative.series : [];
  const max = Math.max(1, ...a.map((p) => p.total), ...b.map((p) => p.total));
  const w = 560, h = 170, l = 45, r = 8, t = 12, bPad = 26;
  const x = (m) => l + ((w - l - r) * m) / Math.max(1, selected.months, ...b.map((p) => p.month));
  const y = (v) => t + (h - t - bPad) * (1 - v / max);
  const path = (series) => series.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const grid = [0, 1, 2].map((i) => {
    const yy = t + ((h - t - bPad) * i) / 2;
    return `<line x1="${l}" y1="${yy}" x2="${w - r}" y2="${yy}" class="grid"/><text x="${l - 6}" y="${yy + 4}" text-anchor="end" class="axis">${short(state, max * (1 - i / 2))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Debt payoff projection"><path d="${path(b)}" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-dasharray="4 4"/><path d="${path(a)}" fill="none" stroke="var(--teal)" stroke-width="3"/>${grid}<text x="${l}" y="${h - 7}" class="axis">today</text><text x="${w - r}" y="${h - 7}" text-anchor="end" class="axis">${selected.months || 0} months</text></svg>`;
}

export function pageHead(state, eyebrow, title, subtitle, actions = '') {
  return `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><div class="head-actions">${actions}</div></div>`;
}

export function overview(state) {
  const month = monthOf(todayKey(state));
  const stats = monthStats(state, month);
  const envelopes = envelopeStatus(state, month).filter((e) => e.budget > 0).slice(0, 6);
  const bills = billInstances(state, todayKey(state), 14);
  const goals = state.goals.slice(0, 3);
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6);
  const months = monthOptions(state).filter((m) => m <= month).slice(-6);
  const plan = debtPlan(state);
  const cash = cashProjection(state, 35);
  const safe = safeToSpend(state);
  const sim = simulate(state);
  return `${pageHead(state, `Sample household · as of ${fmtDate(state, todayKey(state), { month: 'short', day: 'numeric', year: 'numeric' })}`, 'Household money desk', `${state.household}. ${monthLabel(state, month)} is ${stats.spend > stats.income ? 'spending ahead of income' : 'tracking inside income'}. Safe spend below covers 14 days of scheduled bills.`,
    `<a class="btn primary" href="#/transactions">Add transaction</a><a class="btn" href="#/reports">Full report</a>`)}
  <div class="kpi-grid">
    <article class="kpi hero"><span class="kpi-label">Safe to spend · next 14 days</span><strong>${money(state, safe)}</strong><span class="kpi-note">${money(state, currentCash(state))} checking − ${money(state, sum(bills, (b) => b.amount))} bills − ${money(state, state.settings.safe_to_spend_buffer)} buffer</span></article>
    <article class="kpi"><span class="kpi-label">${esc(fmtDate(state, `${month}-01`, { month: 'long' }))} cashflow</span><strong class="split">${money(state, stats.income)} <em>/</em> ${money(state, stats.spend)}</strong><span class="kpi-note">income / spent · net ${money(state, stats.net)}</span></article>
    <article class="kpi"><span class="kpi-label">Envelope left</span><strong>${money(state, stats.left)}</strong><span class="kpi-note">${money(state, stats.budget)} planned across ${state.envelopes.length} envelopes</span></article>
    <article class="kpi"><span class="kpi-label">Debt-free target</span><strong>${plan.payoffDate ? esc(fmtDate(state, plan.payoffDate, { month: 'short', year: 'numeric' })) : '—'}</strong><span class="kpi-note">${plan.months} months · ${money(state, plan.interest)} interest</span></article>
  </div>
  ${cash.warnings.length ? `<div class="alert-strip"><span class="alert-mark">Cash watch</span><span>${esc(cash.warnings[0].text)}. <a href="#/bills">Open bill calendar</a></span></div>` : ''}
  <div class="grid-two">
    <section class="card"><div class="card-head"><h2>Six-month cashflow</h2><span class="legend"><i class="dot teal"></i>Income <i class="dot coral"></i>Spending</span></div>${cashflowChart(state, months)}</section>
    <section class="card"><div class="card-head"><h2>Envelope progress · ${esc(fmtDate(state, `${month}-01`, { month: 'short' }))}</h2><a class="link" href="#/budget">Edit plan</a></div><div class="env-list">${envelopes.map((e) => `<div class="env-row"><div class="env-top"><span>${esc(e.category)}</span><span>${money(state, e.spent)} / ${money(state, e.budget)}</span></div>${progress(e.pct, e.color)}</div>`).join('')}</div></section>
  </div>
  <div class="grid-three">
    <section class="card"><div class="card-head"><h2>Next 14 days</h2><a class="link" href="#/bills">Calendar</a></div><ul class="mini-list">${bills.length ? bills.slice(0, 6).map((b) => `<li><span class="date-chip">${esc(fmtDate(state, b.date, { month: 'short', day: 'numeric' }))}</span><span class="grow">${esc(b.name)}${b.autopay ? '<small> autopay</small>' : ''}</span><b>${money(state, b.amount)}</b></li>`).join('') : '<li class="empty">No bills due in the next two weeks.</li>'}</ul></section>
    <section class="card"><div class="card-head"><h2>Savings goals</h2><a class="link" href="#/goals">All goals</a></div><ul class="mini-list">${goals.map((g) => { const pct = (numLocal(g.balance) / Math.max(1, numLocal(g.target))) * 100; return `<li><div class="grow"><span>${esc(g.name)}</span><small>${money(state, g.balance)} of ${money(state, g.target)}</small>${progress(pct, 'var(--teal)')}</div><b>${pct.toFixed(0)}%</b></li>`; }).join('')}</ul></section>
    <section class="card"><div class="card-head"><h2>Recent activity</h2><a class="link" href="#/transactions">See all</a></div><ul class="mini-list">${recent.map((t) => `<li><span class="cat-dot" style="background:${esc(colorFor(state, t.category))}"></span><span class="grow">${esc(t.payee)}<small>${esc(fmtDate(state, t.date))} · ${esc(t.category)}</small></span><b class="${t.amount > 0 ? 'positive' : ''}">${t.amount > 0 ? '+' : '−'}${money(state, Math.abs(t.amount), 2)}</b></li>`).join('')}</ul></section>
  </div>
  <section class="card sim-card"><div class="card-head"><h2>What-if lab</h2><span class="hint">Sliders model the next month; nothing is saved until you apply a plan.</span></div><div class="sim-grid">
    <label>Extra debt payment <output id="sim-extra-out">${money(state, state.ui.whatif.extraDebt)}/mo</output><input type="range" data-whatif="extraDebt" min="0" max="600" step="25" value="${state.ui.whatif.extraDebt}"></label>
    <label>Dining reduction <output id="sim-dining-out">${state.ui.whatif.diningCut}%</output><input type="range" data-whatif="diningCut" min="0" max="100" step="5" value="${state.ui.whatif.diningCut}"></label>
    <label>Income change <output id="sim-income-out">${state.ui.whatif.incomeShift > 0 ? '+' : ''}${state.ui.whatif.incomeShift}%</output><input type="range" data-whatif="incomeShift" min="-20" max="20" step="1" value="${state.ui.whatif.incomeShift}"></label>
  </div><div id="sim-results" class="sim-results">${simResults(state)}</div></section>`;
}

function numLocal(v) { return Number(v) || 0; }

export function colorFor(state, category) {
  return state.envelopes.find((e) => e.category === category)?.color ?? (category === 'Income' ? 'var(--teal)' : 'var(--muted)');
}

export function simResults(state) {
  const s = simulate(state);
  const cells = [
    ['Safe spend next month', money(state, s.safe), `+${money(state, s.freedCash)} from changes`],
    ['Debt-free date', s.scenario.payoffDate ? fmtDate(state, s.scenario.payoffDate, { month: 'short', year: 'numeric' }) : '—', `${s.monthsSaved} months sooner`],
    ['Interest saved', money(state, s.interestSaved), 'over full payoff'],
    ['Emergency fund', s.goalDate ? fmtDate(state, s.goalDate, { month: 'short', year: 'numeric' }) : '—', `vs ${s.baselineGoalDate ? fmtDate(state, s.baselineGoalDate, { month: 'short', year: 'numeric' }) : '—'}`],
  ];
  return cells.map(([label, value, note]) => `<div class="sim-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('') + `<p class="sim-foot">Assumes ${money(state, s.diningSaving)} dining savings and ${money(state, s.incomeDelta)} income change move to the emergency fund; extra debt payment is added to the payoff budget.</p>`;
}

export function filterTransactions(state) {
  const f = state.ui.filters;
  let list = state.transactions.filter((t) => {
    if (f.q && !`${t.payee} ${t.category} ${t.note} ${t.account}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.type === 'income' && t.amount <= 0) return false;
    if (f.type === 'expense' && t.amount >= 0) return false;
    if (f.category !== 'all' && t.category !== f.category) return false;
    if (f.account !== 'all' && t.account !== f.account) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.recurring && !/recurr/i.test(t.note || '')) return false;
    return true;
  });
  const dir = f.sort === 'amount' ? (a, b) => Math.abs(b.amount) - Math.abs(a.amount) : f.sort === 'payee' ? (a, b) => a.payee.localeCompare(b.payee) : (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
  return list.sort(dir);
}

export function txTable(state) {
  const list = filterTransactions(state);
  const total = sum(list, (t) => t.amount);
  if (!list.length) return `<div class="empty">No transactions match these filters. <button class="link" data-action="clear-filters">Clear filters</button></div>`;
  return `<div class="table-summary"><span><b>${list.length}</b> of ${state.transactions.length} transactions</span><span>Net <b class="${total >= 0 ? 'positive' : ''}">${money(state, total, 2)}</b></span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Account</th><th class="right">Amount</th><th></th></tr></thead><tbody>${list.slice(0, 250).map((t) => `<tr><td>${esc(fmtDate(state, t.date, { month: 'short', day: 'numeric', year: '2-digit' }))}</td><td><span class="cat-dot" style="background:${esc(colorFor(state, t.category))}"></span>${esc(t.payee)}${/recurr/i.test(t.note || '') ? '<small class="tag">repeat</small>' : ''}<small>${esc(t.note || '')}</small></td><td>${esc(t.category)}</td><td>${esc(t.account)}</td><td class="right ${t.amount > 0 ? 'positive' : ''}">${money(state, t.amount, 2)}</td><td class="right"><button class="icon-btn" data-action="edit-tx" data-id="${esc(t.id)}" title="Edit">✎</button><button class="icon-btn danger" data-action="delete-tx" data-id="${esc(t.id)}" title="Delete">×</button></td></tr>`).join('')}</tbody></table></div>${list.length > 250 ? '<p class="hint">Showing the first 250 results. Narrow the filters for more.</p>' : ''}`;
}

export function transactions(state) {
  const f = state.ui.filters;
  const categories = [...state.envelopes.map((e) => e.category), 'Income'];
  const accounts = [...new Set(state.transactions.map((t) => t.account))];
  return `${pageHead(state, 'Ledger', 'Transactions', 'Search, categorize and correct every entry. Changes update checking balance and every report.', `<button class="btn primary" data-action="new-tx">+ Add transaction</button><button class="btn" data-action="export-csv">Export CSV</button>`)}
  <section class="card filter-card"><div class="filters">
    <label class="grow">Search<input id="f-q" type="search" placeholder="Payee, note, account…" value="${esc(f.q)}"></label>
    <label>Type<select id="f-type">${opt('all', 'All', f.type)}${opt('expense', 'Expenses', f.type)}${opt('income', 'Income', f.type)}</select></label>
    <label>Category<select id="f-category">${opt('all', 'All categories', f.category)}${options(categories, f.category)}</select></label>
    <label>Account<select id="f-account">${opt('all', 'All accounts', f.account)}${options(accounts, f.account)}</select></label>
    <label>From<input id="f-from" type="date" value="${esc(f.from)}"></label>
    <label>To<input id="f-to" type="date" value="${esc(f.to)}"></label>
    <label>Sort<select id="f-sort">${opt('date', 'Newest first', f.sort)}${opt('amount', 'Largest amount', f.sort)}${opt('payee', 'Payee A–Z', f.sort)}</select></label>
    <label class="check"><input id="f-recurring" type="checkbox"${f.recurring ? ' checked' : ''}> Recurring only</label>
    <button class="btn small" data-action="clear-filters">Clear</button>
  </div></section>
  <section class="card" id="tx-results">${txTable(state)}</section>`;
}

export function budget(state) {
  const month = state.ui.month;
  const stats = monthStats(state, month);
  const rows = envelopeStatus(state, month);
  const unassigned = stats.income - stats.budget;
  return `${pageHead(state, 'Plan', 'Budget envelopes', `${monthLabel(state, month)} · give every dollar a job. Edit an amount and all bars recompute immediately.`, `<button class="btn" data-action="copy-budget">Copy last month</button><button class="btn primary" data-action="auto-balance">Auto-balance</button>`)}
  <div class="kpi-grid three">
    <article class="kpi"><span class="kpi-label">Income recorded</span><strong>${money(state, stats.income)}</strong><span class="kpi-note">${stats.txs.filter((t) => t.amount > 0).length} deposits</span></article>
    <article class="kpi"><span class="kpi-label">Planned</span><strong>${money(state, stats.budget)}</strong><span class="kpi-note">${Math.round((stats.budget / Math.max(1, stats.income)) * 100)}% of income</span></article>
    <article class="kpi ${unassigned < 0 ? 'warn' : ''}"><span class="kpi-label">Unassigned</span><strong>${money(state, unassigned)}</strong><span class="kpi-note">${unassigned < 0 ? 'Overassigned — trim a plan' : 'Ready to allocate'}</span></article>
  </div>
  <section class="card"><div class="card-head"><h2>Monthly plan</h2><span class="hint">Spent includes every ledger entry in this month</span></div><div class="table-wrap"><table class="data-table budget-table"><thead><tr><th>Envelope</th><th class="right">Plan</th><th class="right">Spent</th><th style="width:30%">Progress</th><th class="right">Left</th></tr></thead><tbody>${rows.map((e) => `<tr><td><span class="cat-dot" style="background:${esc(e.color)}"></span>${esc(e.category)}</td><td class="right"><input class="money-input" type="number" min="0" step="10" value="${e.budget}" data-budget="${esc(e.category)}" aria-label="${esc(e.category)} monthly budget"></td><td class="right">${money(state, e.spent, 2)}</td><td>${progress(e.pct, e.color)}<small>${e.pct.toFixed(0)}%</small></td><td class="right ${e.left < 0 ? 'negative' : ''}">${money(state, e.left, 2)}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="card"><div class="card-head"><h2>Allocate unassigned money</h2><span class="hint">${money(state, Math.max(0, unassigned))} available</span></div><form class="inline-form" data-form="allocate"><label>Envelope<select name="category">${rows.map((e) => opt(e.category, e.category, '')).join('')}</select></label><label>Amount<input name="amount" type="number" min="1" step="10" value="${Math.max(10, Math.round(Math.max(0, unassigned) / 4))}" required></label><button class="btn primary" type="submit">Add to plan</button></form></section>`;
}

function calendar(state) {
  const key = state.ui.calMonth;
  const [year, month] = key.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const today = todayKey(state);
  const bills = state.bills;
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => {
    const day = i - offset + 1;
    if (day < 1 || day > days) return `<div class="cal-cell empty-cell"></div>`;
    const date = `${key}-${String(day).padStart(2, '0')}`;
    const items = bills.filter((b) => Number(b.day) === day);
    return `<div class="cal-cell${date === today ? ' today' : ''}${date < today ? ' past' : ''}"><span class="cal-day">${day}</span>${items.map((b) => `<span class="cal-bill" title="${esc(b.name)} ${fmt(state, b.amount)}">${esc(b.name.split(' ')[0])} <b>${compactMoney(state, b.amount)}</b></span>`).join('')}</div>`;
  }).join('');
  return `<div class="card-head"><h2>${esc(monthLabel(state, key))}</h2><div class="month-nav"><button class="btn small" data-action="cal-month" data-delta="-1" aria-label="Previous month">←</button><button class="btn small" data-action="cal-today">Today</button><button class="btn small" data-action="cal-month" data-delta="1" aria-label="Next month">→</button></div></div><div class="calendar"><div class="cal-week">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
}

export function bills(state) {
  const from = todayKey(state);
  const upcoming = billInstances(state, from, 40);
  const cash = cashProjection(state, 35);
  return `${pageHead(state, 'Calendar', 'Bills and reminders', 'Bills repeat on the day of month from the sample household. Log a payment to mark it handled.', `<button class="btn primary" data-action="new-bill">+ Add bill</button>`)}
  ${cash.warnings.length ? `<div class="alert-strip"><span class="alert-mark">${cash.warnings.length} cash warning${cash.warnings.length > 1 ? 's' : ''}</span><span>${esc(cash.warnings.map((w) => w.text).join(' · '))}</span></div>` : '<div class="good-strip">No cash conflicts in the next 35 days at the current balance.</div>'}
  <div class="grid-two wide-left"><section class="card">${calendar(state)}</section><section class="card"><div class="card-head"><h2>Due in 40 days</h2><span class="hint">${money(state, sum(upcoming, (b) => b.amount))} total</span></div><ul class="mini-list bills-list">${upcoming.length ? upcoming.map((b) => `<li><div class="grow"><b>${esc(b.name)}</b><small>${esc(fmtDate(state, b.date, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${esc(b.category)}${b.autopay ? ' · autopay' : ''}${state.reminders[b.key] ? ' · reminded' : ''}</small></div><b>${money(state, b.amount)}</b><button class="btn tiny ${state.reminders[b.key] ? 'on' : ''}" data-action="toggle-reminder" data-key="${esc(b.key)}">${state.reminders[b.key] ? 'Reminded' : 'Remind me'}</button><button class="btn tiny" data-action="pay-bill" data-key="${esc(b.key)}">Paid</button></li>`).join('') : '<li class="empty">No bills due in this window.</li>'}</ul></section></div>
  <section class="card"><div class="card-head"><h2>All recurring bills</h2><span class="hint">${money(state, sum(state.bills, (b) => b.amount))} per month</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Bill</th><th>Category</th><th class="right">Day</th><th class="right">Amount</th><th>Autopay</th><th></th></tr></thead><tbody>${state.bills.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.category)}</td><td class="right">${b.day}</td><td class="right">${money(state, b.amount, 2)}</td><td>${b.autopay ? 'Yes' : '<span class="tag">manual</span>'}</td><td class="right"><button class="icon-btn" data-action="edit-bill" data-name="${esc(b.name)}" title="Edit bill">✎</button></td></tr>`).join('')}</tbody></table></div></section>`;
}

export function goals(state) {
  const totalSaved = sum(state.goals, (g) => g.balance);
  const totalTarget = sum(state.goals, (g) => g.target);
  return `${pageHead(state, 'Savings', 'Goals and contributions', 'Every goal shows real progress and a date computed from its monthly contribution.', `<button class="btn primary" data-action="new-goal">+ New goal</button>`)}
  <div class="kpi-grid three"><article class="kpi"><span class="kpi-label">Total saved</span><strong>${money(state, totalSaved)}</strong><span class="kpi-note">${Math.round((totalSaved / Math.max(1, totalTarget)) * 100)}% of ${money(state, totalTarget)} target</span></article><article class="kpi"><span class="kpi-label">Monthly contributions</span><strong>${money(state, sum(state.goals, (g) => g.monthly_contribution))}</strong><span class="kpi-note">${money(state, sum(state.goals, (g) => g.monthly_contribution) / Math.max(1, currentCash(state)) * 100)}% of current cash</span></article><article class="kpi"><span class="kpi-label">Emergency fund</span><strong>${state.goals[0] ? money(state, state.goals[0].balance) : '—'}</strong><span class="kpi-note">${state.goals[0] ? `${money(state, state.goals[0].target - state.goals[0].balance)} to target` : ''}</span></article></div>
  <div class="goal-grid">${state.goals.map((g) => {
    const pct = Math.min(100, (numLocal(g.balance) / Math.max(1, numLocal(g.target))) * 100);
    const projected = goalDate(state, g);
    const late = projected && g.target_date && projected.slice(0, 7) > g.target_date.slice(0, 7);
    return `<section class="card goal-card"><div class="card-head"><h2>${esc(g.name)}</h2><button class="icon-btn" data-action="edit-goal" data-id="${esc(g.id)}" title="Edit goal">✎</button></div><div class="goal-amount"><strong>${money(state, g.balance)}</strong><span>of ${money(state, g.target)}</span></div>${progress(pct, 'var(--teal)')}<p class="goal-meta"><span>${pct.toFixed(1)}% complete</span><span class="${late ? 'negative' : ''}">${projected ? `Projected ${esc(fmtDate(state, projected, { month: 'short', year: 'numeric' }))}` : 'No contribution set'}</span></p><p class="hint">Target date ${esc(fmtDate(state, g.target_date || `${monthOf(todayKey(state))}-01`, { month: 'short', year: 'numeric' }))} · ${money(state, g.monthly_contribution)}/month</p><form class="inline-form" data-form="contribute" data-id="${esc(g.id)}"><label>Amount<input name="amount" type="number" min="1" step="25" value="${esc(g.monthly_contribution)}" required></label><button class="btn primary" type="submit">Add contribution</button></form></section>`;
  }).join('')}</div>`;
}

export function debt(state) {
  const plan = debtPlan(state);
  const other = debtPlan(state, { strategy: state.ui.strategy === 'avalanche' ? 'snowball' : 'avalanche' });
  const totalBalance = sum(state.debts, (d) => d.balance);
  const order = [...state.debts].sort((a, b) => (state.ui.strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr));
  return `${pageHead(state, 'Payoff', 'Debt payoff plan', 'Choose a strategy, model extra payments and see the exact interest cost.', `<button class="btn" data-action="new-debt">+ Add debt</button>`)}
  <div class="segmented"><button class="${state.ui.strategy === 'avalanche' ? 'active' : ''}" data-action="strategy" data-value="avalanche">Avalanche · highest APR first</button><button class="${state.ui.strategy === 'snowball' ? 'active' : ''}" data-action="strategy" data-value="snowball">Snowball · smallest balance first</button></div>
  <div class="kpi-grid three"><article class="kpi"><span class="kpi-label">Total balance</span><strong>${money(state, totalBalance, 2)}</strong><span class="kpi-note">${state.debts.length} debts · ${money(state, plan.monthlyBudget)}/mo plan</span></article><article class="kpi"><span class="kpi-label">Payoff date</span><strong>${plan.payoffDate ? esc(fmtDate(state, plan.payoffDate, { month: 'short', year: 'numeric' })) : '—'}</strong><span class="kpi-note">${plan.months} months from today</span></article><article class="kpi"><span class="kpi-label">Total interest</span><strong>${money(state, plan.interest)}</strong><span class="kpi-note">${other.interest < plan.interest ? `${money(state, plan.interest - other.interest)} less with ${state.ui.strategy === 'avalanche' ? 'snowball' : 'avalanche'}` : 'Lowest of the two strategies'}</span></article></div>
  <div class="grid-two"><section class="card"><div class="card-head"><h2>Balance projection</h2><span class="legend"><i class="dot teal"></i>${esc(state.ui.strategy)} <i class="dot muted"></i>${esc(state.ui.strategy === 'avalanche' ? 'snowball' : 'avalanche')}</span></div>${debtChart(state, plan, other)}</section>
  <section class="card"><div class="card-head"><h2>Payoff order</h2><span class="hint">Minimums paid on all debts, then extra rolls down the list</span></div><ul class="mini-list">${order.map((d, i) => `<li><span class="rank">${i + 1}</span><span class="grow"><b>${esc(d.name)}</b><small>${numLocal(d.apr).toFixed(2)}% APR · ${money(state, d.minimum)} min + ${money(state, d.extra)} extra</small></span><b>${plan.payoffs[d.id] ? `${plan.payoffs[d.id]} mo` : '—'}</b><button class="icon-btn" data-action="edit-debt" data-id="${esc(d.id)}" title="Edit debt">✎</button></li>`).join('')}</ul><form class="inline-form" data-form="apply-extra"><label>Lock in extra payment<input name="amount" type="number" min="0" step="25" value="${state.ui.whatif.extraDebt}" required></label><button class="btn" type="submit">Apply to first in order</button></form></section></div>`;
}

function reportMonths(state) {
  const r = state.ui.report;
  const all = monthOptions(state).filter((m) => m <= monthOf(todayKey(state)));
  if (r.range === 'custom' && r.from && r.to) return all.filter((m) => m >= r.from.slice(0, 7) && m <= r.to.slice(0, 7));
  if (r.range === 'all') return all;
  const count = r.range === '3m' ? 3 : r.range === '6m' ? 6 : 12;
  return all.slice(-count);
}

export function reports(state) {
  const months = reportMonths(state);
  const txs = months.flatMap((m) => transactionsInMonth(state, m)).filter((t) => state.ui.report.category === 'all' || t.category === state.ui.report.category);
  const income = sum(txs, (t) => Math.max(0, t.amount));
  const spend = sum(txs, (t) => Math.max(0, -t.amount));
  const net = income - spend;
  const byCategory = state.envelopes.map((e) => ({ label: e.category, value: sum(txs.filter((t) => t.category === e.category && t.amount < 0), (t) => -t.amount), color: e.color })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  let cumulative = 0;
  const trend = months.map((m) => {
    const s = monthStats(state, m);
    cumulative += s.net;
    return { label: fmtDate(state, `${m}-01`, { month: 'short' }), y: Math.round(cumulative) };
  });
  const r = state.ui.report;
  return `${pageHead(state, 'Trends', 'Reports and analysis', `${months.length} months · ${txs.length} entries · all charts drawn locally from the ledger.`, `<button class="btn" data-action="export-csv">Export CSV</button><button class="btn primary" data-action="export-json">Export JSON</button>`)}
  <section class="card filter-card"><div class="filters"><label>Range<select id="r-range">${opt('3m', 'Last 3 months', r.range)}${opt('6m', 'Last 6 months', r.range)}${opt('12m', 'Last 12 months', r.range)}${opt('all', 'All data', r.range)}${opt('custom', 'Custom', r.range)}</select></label><label>Category<select id="r-category">${opt('all', 'All categories', r.category)}${options([...state.envelopes.map((e) => e.category), 'Income'], r.category)}</select></label><label>From<input id="r-from" type="date" value="${esc(r.from)}"></label><label>To<input id="r-to" type="date" value="${esc(r.to)}"></label><button class="btn small" data-action="apply-range">Apply</button></div></section>
  <div class="kpi-grid"><article class="kpi"><span class="kpi-label">Income</span><strong>${money(state, income)}</strong><span class="kpi-note">${money(state, income / Math.max(1, months.length))} per month</span></article><article class="kpi"><span class="kpi-label">Spending</span><strong>${money(state, spend)}</strong><span class="kpi-note">${money(state, spend / Math.max(1, months.length))} per month</span></article><article class="kpi"><span class="kpi-label">Net cashflow</span><strong class="${net >= 0 ? 'positive' : 'negative'}">${money(state, net)}</strong><span class="kpi-note">${((net / Math.max(1, income)) * 100).toFixed(1)}% savings rate</span></article><article class="kpi"><span class="kpi-label">Largest category</span><strong>${byCategory[0] ? esc(byCategory[0].label) : '—'}</strong><span class="kpi-note">${byCategory[0] ? money(state, byCategory[0].value) : 'No spending'}</span></article></div>
  <div class="grid-two"><section class="card"><div class="card-head"><h2>Income and spending</h2><span class="legend"><i class="dot teal"></i>Income <i class="dot coral"></i>Spending</span></div>${cashflowChart(state, months)}</section><section class="card"><div class="card-head"><h2>Where it went</h2><span class="hint">${byCategory.length} categories</span></div><div class="donut-wrap">${donutChart(state, byCategory)}<ul class="legend-list">${byCategory.slice(0, 6).map((c) => `<li><span class="cat-dot" style="background:${esc(c.color)}"></span><span class="grow">${esc(c.label)}</span><b>${money(state, c.value)}</b></li>`).join('')}</ul></div></section></div>
  <div class="grid-two"><section class="card"><div class="card-head"><h2>Cumulative net cashflow</h2><span class="hint">Running total across the range</span></div>${lineChart(state, trend, 'var(--teal)', 'Cumulative net cashflow')}</section><section class="card"><div class="card-head"><h2>Category totals</h2></div><div class="env-list">${byCategory.map((c) => `<div class="env-row"><div class="env-top"><span>${esc(c.label)}</span><span>${money(state, c.value)}</span></div>${progress((c.value / Math.max(1, byCategory[0]?.value || 1)) * 100, c.color)}</div>`).join('') || '<p class="empty">No spending in this range.</p>'}</div></section></div>`;
}

export function insights(state) {
  const list = buildInsights(state);
  return `${pageHead(state, 'Actions', 'Insights from your ledger', 'Each card is calculated from current transactions, plans and dates — no generic advice.', `<a class="btn primary" href="#/reports">Open reports</a>`)}
  <div class="insight-grid">${list.map((i) => `<section class="card insight ${esc(i.level)}"><div class="insight-head"><span class="tag">${esc(i.tag)}</span><span class="severity">${esc(i.level === 'alert' ? 'Needs attention' : i.level === 'warn' ? 'Watch' : i.level === 'good' ? 'On track' : 'Opportunity')}</span></div><h2>${esc(i.title)}</h2><p>${esc(i.text)}</p><button class="btn small" data-action="insight" data-kind="${esc(i.action.kind)}"${i.action.category ? ` data-category="${esc(i.action.category)}"` : ''}${i.action.value !== undefined ? ` data-value="${esc(i.action.value)}"` : ''}${i.action.id ? ` data-id="${esc(i.action.id)}"` : ''}${i.action.name ? ` data-name="${esc(i.action.name)}"` : ''}${i.action.route ? ` data-route="${esc(i.action.route)}"` : ''}>${esc(i.action.label)}</button></section>`).join('')}</div>
  <section class="card"><div class="card-head"><h2>Recurring commitments</h2><span class="hint">What the household has already committed</span></div><div class="kpi-grid three"><article class="kpi"><span class="kpi-label">Bills</span><strong>${money(state, sum(state.bills, (b) => b.amount))}</strong></article><article class="kpi"><span class="kpi-label">Goal contributions</span><strong>${money(state, sum(state.goals, (g) => g.monthly_contribution))}</strong></article><article class="kpi"><span class="kpi-label">Debt payments</span><strong>${money(state, sum(state.debts, (d) => d.minimum + d.extra))}</strong></article></div></section>`;
}

export function settings(state) {
  const accounts = state.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.type)}</td><td class="right"><input class="money-input" type="number" step="0.01" value="${a.balance}" data-account="${esc(a.id)}"></td><td>${a.primary ? 'Primary' : a.limit ? `${money(state, a.limit)} limit` : `${numLocal(a.apr).toFixed(2)}% APR`}</td></tr>`).join('');
  return `${pageHead(state, 'Control room', 'Settings and data', 'Sample household data is stored only in this browser. Replace it with your own numbers at any time.', '')}
  <div class="grid-two"><section class="card"><div class="card-head"><h2>Household</h2></div><form class="setting-form" data-form="settings">
    <label>Household name<input name="household" value="${esc(state.household)}"></label>
    <label>Locale<select name="locale">${opt('en-US', 'English (US)', state.settings.locale)}${opt('en-GB', 'English (UK)', state.settings.locale)}${opt('de-DE', 'Deutsch (DE)', state.settings.locale)}${opt('fr-FR', 'Français (FR)', state.settings.locale)}${opt('ja-JP', '日本語 (JP)', state.settings.locale)}</select></label>
    <label>Display currency (no conversion)<select name="currency">${['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].map((c) => opt(c, c, state.settings.currency)).join('')}</select></label>
    <label>Month starts on day<input name="month_start_day" type="number" min="1" max="28" value="${state.settings.month_start_day}"></label>
    <label>Safety buffer<input name="safe_to_spend_buffer" type="number" min="0" step="50" value="${state.settings.safe_to_spend_buffer}"></label>
    <button class="btn primary" type="submit">Save settings</button>
  </form></section>
  <section class="card"><div class="card-head"><h2>Appearance</h2></div><div class="choice-row"><button class="btn ${state.ui.theme === 'light' ? 'primary' : ''}" data-action="theme" data-value="light">Light</button><button class="btn ${state.ui.theme === 'dark' ? 'primary' : ''}" data-action="theme" data-value="dark">Dark</button></div><div class="choice-row"><button class="btn ${state.ui.density === 'regular' ? 'primary' : ''}" data-action="density" data-value="regular">Comfortable</button><button class="btn ${state.ui.density === 'compact' ? 'primary' : ''}" data-action="density" data-value="compact">Compact</button></div><p class="hint">Both choices persist in localStorage and apply to every screen.</p>
  <div class="card-head"><h2>Balances</h2><span class="hint">Editing a balance updates safe-to-spend</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th>Type</th><th class="right">Balance</th><th>Detail</th></tr></thead><tbody>${accounts}</tbody></table></div></section></div>
  <section class="card"><div class="card-head"><h2>Subscriptions</h2><span class="hint">${money(state, sum(state.subscriptions, (s) => s.amount))}/month tracked</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th class="right">Amount</th><th class="right">Day</th><th>Status</th><th></th></tr></thead><tbody>${state.subscriptions.map((s) => `<tr><td>${esc(s.name)}</td><td class="right">${money(state, s.amount, 2)}</td><td class="right">${s.day}</td><td><select data-sub-status="${esc(s.name)}">${opt('keep', 'Keep', s.status)}${opt('review', 'Review', s.status)}</select></td><td class="right"><button class="btn tiny" data-action="cancel-sub" data-name="${esc(s.name)}">Cancel</button></td></tr>`).join('')}</tbody></table></div></section>
  <section class="card"><div class="card-head"><h2>Income schedule</h2><span class="hint">${money(state, sum(state.income, (i) => i.amount))}/month scheduled · variable income projected at 60%</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th class="right">Amount</th><th class="right">Day</th><th>Frequency</th></tr></thead><tbody>${state.income.map((i) => `<tr><td>${esc(i.name)}</td><td class="right"><input class="money-input" type="number" min="0" step="10" value="${i.amount}" data-income-amount="${esc(i.id)}"></td><td class="right"><input class="money-input" type="number" min="1" max="28" value="${i.day}" data-income-day="${esc(i.id)}"></td><td><select data-income-freq="${esc(i.id)}">${opt('monthly', 'Monthly', i.frequency)}${opt('variable', 'Variable', i.frequency)}</select></td></tr>`).join('')}</tbody></table></div></section>
  <section class="card"><div class="card-head"><h2>Your data, your browser</h2></div><p class="hint">${esc(state.sources_note)} The 158 starting entries, plans and balances are a demonstration dataset; import your own JSON with the same shape to replace them. Nothing leaves this device.</p><div class="choice-row"><button class="btn" data-action="export-json">Export JSON</button><button class="btn" data-action="export-csv">Export transactions CSV</button><button class="btn" data-action="import-json">Import JSON</button><button class="btn danger-btn" data-action="reset-data">Reset sample data</button><input id="import-file" type="file" accept="application/json,.json" hidden></div></section>`;
}

export function txForm(state, tx) {
  const categories = [...state.envelopes.map((e) => e.category), 'Income'];
  const accounts = [...new Set(state.transactions.map((t) => t.account)), ...state.accounts.map((a) => a.name)];
  const isEdit = Boolean(tx);
  const amount = tx ? Math.abs(tx.amount) : '';
  const type = tx ? (tx.amount > 0 ? 'income' : 'expense') : 'expense';
  return `<form data-form="tx"${isEdit ? ` data-id="${esc(tx.id)}"` : ''}><div class="form-grid"><label>Date<input name="date" type="date" value="${esc(tx?.date || todayKey(state))}" required></label><label>Payee<input name="payee" value="${esc(tx?.payee || '')}" placeholder="e.g. Corner supermarket" required></label><label>Type<select name="type">${opt('expense', 'Expense', type)}${opt('income', 'Income', type)}</select></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" value="${esc(amount)}" required></label><label>Category<select name="category">${options(categories, tx?.category || 'Groceries')}</select></label><label>Account<select name="account">${options(accounts, tx?.account || state.accounts.find((a) => a.primary)?.name)}</select></label><label class="span-2">Note<input name="note" value="${esc(tx?.note || '')}" placeholder="Optional context"></label><label class="check span-2"><input name="recurring" type="checkbox"${/recurr/i.test(tx?.note || '') ? ' checked' : ''}> Repeats monthly</label></div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">${isEdit ? 'Save changes' : 'Add transaction'}</button></div></form>`;
}

export function billForm(state, name) {
  const bill = state.bills.find((b) => b.name === name);
  return `<form data-form="bill"${bill ? ` data-name="${esc(name)}"` : ''}><div class="form-grid"><label>Name<input name="name" value="${esc(bill?.name || '')}" required></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" value="${bill?.amount || ''}" required></label><label>Day of month<input name="day" type="number" min="1" max="28" value="${bill?.day || 1}" required></label><label>Category<select name="category">${options(state.envelopes.map((e) => e.category), bill?.category || 'Utilities')}</select></label><label class="check span-2"><input name="autopay" type="checkbox"${bill?.autopay ? ' checked' : ''}> Autopay enabled</label></div><div class="form-actions">${bill ? '<button class="btn danger-btn" type="button" data-action="delete-bill" data-name="' + esc(name) + '">Delete bill</button>' : ''}<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save bill</button></div></form>`;
}

export function goalForm(state, id) {
  const goal = state.goals.find((g) => g.id === id);
  return `<form data-form="goal"${goal ? ` data-id="${esc(id)}"` : ''}><div class="form-grid"><label>Name<input name="name" value="${esc(goal?.name || '')}" required></label><label>Target<input name="target" type="number" min="1" step="50" value="${goal?.target || ''}" required></label><label>Current balance<input name="balance" type="number" min="0" step="10" value="${goal?.balance || 0}" required></label><label>Monthly contribution<input name="monthly_contribution" type="number" min="0" step="10" value="${goal?.monthly_contribution || 100}" required></label><label>Target date<input name="target_date" type="date" value="${esc(goal?.target_date || addMonths(todayKey(state).slice(0, 7), 12) + '-01')}" required></label></div><div class="form-actions">${goal ? '<button class="btn danger-btn" type="button" data-action="delete-goal" data-id="' + esc(id) + '">Delete goal</button>' : ''}<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save goal</button></div></form>`;
}

export function debtForm(state, id) {
  const debt = state.debts.find((d) => d.id === id);
  return `<form data-form="debt"${debt ? ` data-id="${esc(id)}"` : ''}><div class="form-grid"><label>Name<input name="name" value="${esc(debt?.name || '')}" required></label><label>Balance<input name="balance" type="number" min="0" step="0.01" value="${debt?.balance || ''}" required></label><label>APR %<input name="apr" type="number" min="0" step="0.01" value="${debt?.apr || 0}" required></label><label>Minimum payment<input name="minimum" type="number" min="0" step="1" value="${debt?.minimum || ''}" required></label><label>Extra payment<input name="extra" type="number" min="0" step="10" value="${debt?.extra || 0}" required></label><label>Type<select name="type">${opt('revolving', 'Revolving', debt?.type)}${opt('installment', 'Installment', debt?.type)}</select></label></div><div class="form-actions">${debt ? '<button class="btn danger-btn" type="button" data-action="delete-debt" data-id="' + esc(id) + '">Delete debt</button>' : ''}<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save debt</button></div></form>`;
}

export function modal(title, body) {
  return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="card-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>${body}</div></div>`;
}

export function routeView(state, route) {
  switch (route) {
    case '/transactions': return transactions(state);
    case '/budget': return budget(state);
    case '/bills': return bills(state);
    case '/goals': return goals(state);
    case '/debt': return debt(state);
    case '/reports': return reports(state);
    case '/insights': return insights(state);
    case '/settings': return settings(state);
    default: return overview(state);
  }
}

export { transactionCSV, fmtDate, todayKey, addDays, incomeEvents };
