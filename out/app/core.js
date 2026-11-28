import sample from './seed.js';

const KEY = 'hearthline.household.v1';
const DAY = 86400000;
const clone = (v) => JSON.parse(JSON.stringify(v));
const round = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function freshState() {
  const s = clone(sample);
  const primary = s.accounts.find((a) => a.primary) ?? s.accounts[0];
  return {
    ...s,
    v: 1,
    baseline: primary.balance,
    reminders: {},
    paid: {},
    ui: {
      theme: 'light',
      density: 'regular',
      month: todayKey(s).slice(0, 7),
      calMonth: todayKey(s).slice(0, 7),
      strategy: 'avalanche',
      filters: { q: '', type: 'all', category: 'all', account: 'all', from: '', to: '', recurring: false, sort: 'date' },
      report: { range: '6m', category: 'all', from: '', to: '' },
      whatif: { extraDebt: 100, diningCut: 25, incomeShift: 0 },
    },
  };
}

export function normalizeState(raw) {
  const base = freshState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const out = { ...base };
  for (const k of ['household', 'currency', 'sources_note', 'generated_at']) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  out.settings = { ...base.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) };
  for (const k of ['income', 'envelopes', 'goals', 'debts', 'bills', 'transactions', 'accounts', 'subscriptions']) {
    if (Array.isArray(raw[k])) out[k] = clone(raw[k]);
  }
  out.reminders = raw.reminders && typeof raw.reminders === 'object' ? clone(raw.reminders) : {};
  out.paid = raw.paid && typeof raw.paid === 'object' ? clone(raw.paid) : {};
  out.baseline = num(raw.baseline, base.baseline);
  out.ui = { ...base.ui, ...(raw.ui && typeof raw.ui === 'object' ? raw.ui : {}) };
  out.ui.filters = { ...base.ui.filters, ...(out.ui.filters || {}) };
  out.ui.report = { ...base.ui.report, ...(out.ui.report || {}) };
  out.ui.whatif = { ...base.ui.whatif, ...(out.ui.whatif || {}) };
  const primary = out.accounts.find((a) => a.primary) ?? out.accounts[0];
  if (primary && !Number.isFinite(primary.balance)) primary.balance = out.baseline;
  return out;
}

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return freshState();
}

export function saveState(state) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}

export function clearState() {
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* storage unavailable */ }
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function dateFromKey(key) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
}

export function addDays(key, count) {
  return isoDate(new Date(dateFromKey(key).getTime() + count * DAY));
}

export function addMonths(key, count) {
  const [y, m] = String(key).slice(0, 7).split('-').map(Number);
  const total = y * 12 + m - 1 + count;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function todayKey(state) {
  let latest = (num(state.generated_at, 0) * 1000) || dateFromKey('2026-11-26').getTime();
  for (const t of state.transactions) {
    const time = dateFromKey(t.date).getTime();
    if (time > latest) latest = time;
  }
  return isoDate(new Date(latest));
}

export const monthOf = (dateKey) => String(dateKey).slice(0, 7);

export function monthOptions(state) {
  const dates = state.transactions.map((t) => monthOf(t.date)).concat(monthOf(todayKey(state)));
  const first = dates.sort()[0] ?? monthOf(todayKey(state));
  const last = addMonths(monthOf(todayKey(state)), 2);
  const out = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function fmt(state, value, digits = 0) {
  const locale = state.settings.locale || 'en-US';
  const currency = state.settings.currency || state.currency || 'USD';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(num(value));
  } catch {
    return `$${num(value).toFixed(digits)}`;
  }
}

export function compactMoney(state, value) {
  const locale = state.settings.locale || 'en-US';
  const currency = state.settings.currency || state.currency || 'USD';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(num(value));
  } catch { return `${num(value) >= 0 ? '' : '-'}$${Math.abs(num(value)).toFixed(0)}`; }
}

export function fmtDate(state, key, options = { month: 'short', day: 'numeric' }) {
  try { return new Intl.DateTimeFormat(state.settings.locale || 'en-US', options).format(dateFromKey(key)); }
  catch { return String(key); }
}

export function monthLabel(state, key) {
  return fmtDate(state, `${key}-01`, { month: 'long', year: 'numeric' });
}

export function currentCash(state) {
  const primary = state.accounts.find((a) => a.primary) ?? state.accounts[0];
  return num(primary?.balance, state.baseline);
}

function adjustCash(state, delta) {
  const primary = state.accounts.find((a) => a.primary) ?? state.accounts[0];
  if (primary) primary.balance = round(num(primary.balance) + delta);
  state.baseline = round(num(state.baseline) + delta);
}

export function addTransaction(state, tx) {
  const item = {
    id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: tx.date || todayKey(state),
    payee: tx.payee || 'Unnamed transaction',
    category: tx.category || 'Personal',
    amount: round(num(tx.amount)),
    account: tx.account || (state.accounts.find((a) => a.primary)?.name ?? 'Joint checking'),
    note: tx.note || '',
  };
  state.transactions.push(item);
  adjustCash(state, item.amount);
  return item.id;
}

export function updateTransaction(state, id, patch) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return null;
  const amount = patch.amount === undefined ? tx.amount : round(num(patch.amount));
  adjustCash(state, amount - tx.amount);
  Object.assign(tx, patch, { amount });
  return tx;
}

export function deleteTransaction(state, id) {
  const index = state.transactions.findIndex((t) => t.id === id);
  if (index < 0) return false;
  const [tx] = state.transactions.splice(index, 1);
  adjustCash(state, -num(tx.amount));
  return true;
}

export const transactionsInMonth = (state, month) => state.transactions.filter((t) => monthOf(t.date) === month);
export const sum = (items, fn = (x) => x) => items.reduce((total, x) => total + num(fn(x)), 0);

export function monthStats(state, month) {
  const txs = transactionsInMonth(state, month);
  const income = sum(txs, (t) => Math.max(0, t.amount));
  const spend = sum(txs, (t) => Math.max(0, -t.amount));
  const budget = sum(state.envelopes, (e) => e.monthly_budget);
  return { income, spend, net: income - spend, budget, left: budget - spend, txs };
}

export function envelopeStatus(state, month) {
  const stats = monthStats(state, month);
  return state.envelopes.map((env) => {
    const spent = sum(stats.txs.filter((t) => t.category === env.category), (t) => Math.max(0, -t.amount));
    const budget = num(env.monthly_budget);
    return { ...env, spent, budget, left: budget - spent, pct: budget > 0 ? (spent / budget) * 100 : 0 };
  });
}

export function billInstances(state, from, days) {
  const out = [];
  const end = addDays(from, days);
  for (let date = from; date <= end; date = addDays(date, 1)) {
    const day = Number(date.slice(8));
    for (const bill of state.bills) {
      if (num(bill.day) !== day) continue;
      const key = `${date}|${bill.name}`;
      if (state.paid[key]) continue;
      const logged = state.transactions.some((t) => t.date === date && t.payee.toLowerCase() === String(bill.name).toLowerCase() && t.amount < 0);
      if (logged) continue;
      out.push({ ...bill, date, key });
    }
  }
  return out;
}

export function incomeEvents(state, from, days) {
  const out = [];
  const end = addDays(from, days);
  for (let date = from; date <= end; date = addDays(date, 1)) {
    const day = Number(date.slice(8));
    for (const inc of state.income) {
      if (num(inc.day) !== day) continue;
      out.push({ ...inc, date, amount: inc.frequency === 'variable' ? num(inc.amount) * 0.6 : num(inc.amount) });
    }
  }
  return out;
}

export function safeToSpend(state, horizon = 14) {
  const bills = billInstances(state, todayKey(state), horizon);
  const income = incomeEvents(state, todayKey(state), horizon);
  return currentCash(state) + sum(income, (i) => i.amount) - sum(bills, (b) => b.amount) - num(state.settings.safe_to_spend_buffer);
}

function lastDebtDay(state, debt) {
  const token = String(debt.name).toLowerCase().split(' ')[0];
  const matches = state.transactions.filter((t) => t.amount < 0 && t.payee.toLowerCase().includes(token));
  const last = matches.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return last ? Number(last.date.slice(8)) : 15;
}

export function cashProjection(state, days = 35) {
  const from = todayKey(state);
  const end = addDays(from, days);
  const bills = billInstances(state, from, days);
  const income = incomeEvents(state, from, days);
  const contributions = sum(state.goals, (g) => g.monthly_contribution);
  const debtPayments = state.debts.map((d) => ({ ...d, day: lastDebtDay(state, d), amount: num(d.minimum) + num(d.extra) }));
  let balance = currentCash(state);
  let low = balance;
  const warnings = [];
  const series = [];
  for (let date = from; date <= end; date = addDays(date, 1)) {
    const day = Number(date.slice(8));
    const dayBills = bills.filter((b) => b.date === date);
    const dayIncome = income.filter((i) => i.date === date);
    const dayDebt = debtPayments.filter((d) => d.day === day);
    const dayContribution = day === 26 ? contributions : 0;
    const delta = sum(dayIncome, (i) => i.amount) - sum(dayBills, (b) => b.amount) - sum(dayDebt, (d) => d.amount) - dayContribution;
    balance = round(balance + delta);
    low = Math.min(low, balance);
    series.push({ date, balance });
    if (balance < num(state.settings.safe_to_spend_buffer) && warnings.length < 6) {
      warnings.push({ date, kind: 'low', text: `${fmtDate(state, date)} projected cash ${fmt(state, balance)} is under the ${fmt(state, state.settings.safe_to_spend_buffer)} buffer` });
    }
    if (dayBills.length > 1 && sum(dayBills, (b) => b.amount) > balance + num(state.settings.safe_to_spend_buffer)) {
      warnings.push({ date, kind: 'cluster', text: `${dayBills.length} bills due ${fmtDate(state, date)} total ${fmt(state, sum(dayBills, (b) => b.amount))} with only ${fmt(state, balance)} projected cash` });
    }
  }
  return { series, low, warnings, bills, income };
}

export function debtPlan(state, options = {}) {
  const strategy = options.strategy ?? state.ui.strategy;
  const globalExtra = num(options.extra);
  const debts = state.debts.map((d) => ({ ...d, balance: num(d.balance), apr: num(d.apr), minimum: num(d.minimum), extra: num(d.extra) }));
  if (!debts.length) return { months: 0, interest: 0, payoffs: {}, series: [], payoffDate: null };
  const order = [...debts].sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr));
  const startingBudget = sum(debts, (d) => d.minimum + d.extra) + globalExtra;
  let interest = 0;
  let paidAll = 0;
  const payoffs = {};
  const series = [{ month: 0, total: sum(debts, (d) => d.balance) }];
  for (let month = 1; month <= 720 && paidAll < debts.length; month++) {
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const charged = (d.balance * d.apr) / 1200;
      interest += charged;
      d.balance += charged;
    }
    let pool = startingBudget;
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const payment = Math.min(pool, d.minimum, d.balance);
      d.balance = round(d.balance - payment);
      pool -= payment;
    }
    for (const d of order) {
      if (d.balance <= 0 || pool <= 0) continue;
      const payment = Math.min(pool, d.balance);
      d.balance = round(d.balance - payment);
      pool -= payment;
    }
    for (const d of debts) {
      if (d.balance <= 0 && payoffs[d.id] === undefined) {
        payoffs[d.id] = month;
        paidAll++;
      }
    }
    if (month % 3 === 0 || paidAll === debts.length) series.push({ month, total: round(sum(debts, (d) => Math.max(0, d.balance))) });
  }
  const months = Math.max(0, ...Object.values(payoffs));
  return {
    months,
    interest: round(interest),
    payoffs,
    series,
    payoffDate: months ? `${addMonths(monthOf(todayKey(state)), months)}-01` : null,
    monthlyBudget: startingBudget,
  };
}

export function goalDate(state, goal, extraMonthly = 0) {
  const need = Math.max(0, num(goal.target) - num(goal.balance));
  const contribution = num(goal.monthly_contribution) + num(extraMonthly);
  if (need <= 0) return todayKey(state);
  if (contribution <= 0) return null;
  return `${addMonths(monthOf(todayKey(state)), Math.ceil(need / contribution))}-01`;
}

function recentFullMonths(state, count) {
  const current = monthOf(todayKey(state));
  return Array.from({ length: count }, (_, i) => addMonths(current, -(i + 1)));
}

export function simulate(state) {
  const w = state.ui.whatif;
  const months = recentFullMonths(state, 3);
  const avgIncome = sum(months, (m) => monthStats(state, m).income) / months.length;
  const avgDining = sum(months, (m) => sum(transactionsInMonth(state, m).filter((t) => t.category === 'Dining out' && t.amount < 0), (t) => -t.amount)) / months.length;
  const diningSaving = (avgDining * num(w.diningCut)) / 100;
  const incomeDelta = (avgIncome * num(w.incomeShift)) / 100;
  const freedCash = diningSaving + incomeDelta;
  const debtExtra = sum(state.debts, (d) => d.extra);
  const baseline = debtPlan(state, { extra: debtExtra });
  const scenario = debtPlan(state, { extra: debtExtra + num(w.extraDebt) + diningSaving });
  const emergency = state.goals.find((g) => g.id === 'emergency') ?? state.goals[0];
  return {
    safe: safeToSpend(state) + freedCash,
    freedCash,
    diningSaving,
    incomeDelta,
    baseline,
    scenario,
    interestSaved: Math.max(0, baseline.interest - scenario.interest),
    monthsSaved: Math.max(0, baseline.months - scenario.months),
    goalDate: emergency ? goalDate(state, emergency, freedCash) : null,
    baselineGoalDate: emergency ? goalDate(state, emergency) : null,
    avgDining,
    avgIncome,
  };
}

export function budgetHealth(state) {
  const month = monthOf(todayKey(state));
  const stats = monthStats(state, month);
  const savingsRate = stats.income > 0 ? Math.max(0, (stats.net / stats.income) * 100) : 0;
  const envelopes = envelopeStatus(state, month);
  const budgeted = envelopes.filter((e) => e.budget > 0);
  const adherence = budgeted.length ? (budgeted.filter((e) => e.spent <= e.budget).length / budgeted.length) * 100 : 100;
  const cash = cashProjection(state, 35);
  const bufferTarget = Math.max(1, num(state.settings.safe_to_spend_buffer));
  const cashScore = Math.max(0, Math.min(100, (cash.low / bufferTarget) * 100));
  const debtBal = sum(state.debts, (d) => d.balance);
  const debtScore = Math.max(0, 100 - Math.min(100, (debtBal / Math.max(1, stats.income * 6)) * 100));
  const score = Math.round(savingsRate * 0.35 + adherence * 0.3 + cashScore * 0.2 + debtScore * 0.15);
  const label = score >= 80 ? 'Strong' : score >= 65 ? 'Steady' : score >= 50 ? 'Needs attention' : 'At risk';
  return { score: Math.max(0, Math.min(100, score)), label, savingsRate, adherence, cashScore, debtScore, low: cash.low };
}

export function buildInsights(state) {
  const out = [];
  const month = monthOf(todayKey(state));
  const months = recentFullMonths(state, 3);
  const avg = (category) => sum(months, (m) => sum(transactionsInMonth(state, m).filter((t) => t.category === category && t.amount < 0), (t) => -t.amount)) / months.length;
  const money = (n) => fmt(state, n);
  const dining = avg('Dining out');
  const diningEnv = state.envelopes.find((e) => e.category === 'Dining out');
  if (diningEnv && dining > num(diningEnv.monthly_budget)) {
    const target = Math.round(dining * 0.85);
    out.push({
      level: 'warn', tag: 'Spending', title: `Dining is ${money(dining - diningEnv.monthly_budget)} above plan`,
      text: `Your three-month dining average is ${money(dining)} against a ${money(diningEnv.monthly_budget)} envelope. A ${money(target)} plan keeps weekends intact while freeing ${money(dining - target)} monthly.`,
      action: { label: `Set plan to ${money(target)}`, kind: 'set-budget', category: 'Dining out', value: target },
    });
  }
  const groceries = avg('Groceries');
  const groceryEnv = state.envelopes.find((e) => e.category === 'Groceries');
  if (groceryEnv && groceries > num(groceryEnv.monthly_budget)) {
    out.push({
      level: 'info', tag: 'Envelope', title: `Groceries trend ${money(groceries)} / month`,
      text: `Recent grocery spend runs ${money(groceries - groceryEnv.monthly_budget)} above the ${money(groceryEnv.monthly_budget)} envelope. Tighten the weekly shop or raise the plan deliberately.`,
      action: { label: 'Review budget', kind: 'go', route: '#/budget' },
    });
  }
  const cash = cashProjection(state, 35);
  if (cash.warnings.length) {
    out.push({
      level: 'alert', tag: 'Cash timing', title: `Cash dips to ${money(cash.low)} in 35 days`,
      text: `${cash.warnings[0].text}. Protect the buffer now or shift a bill before it clusters.`,
      action: { label: 'Open bill calendar', kind: 'go', route: '#/bills' },
    });
  }
  const emergency = state.goals.find((g) => g.id === 'emergency') ?? state.goals[0];
  if (emergency) {
    const projected = goalDate(state, emergency);
    const target = emergency.target_date?.slice(0, 7);
    if (projected && target && projected.slice(0, 7) > target) {
      const gap = Math.max(0, num(emergency.target) - num(emergency.balance));
      const monthsLeft = Math.max(1, (Date.parse(`${target}-01`) - Date.parse(`${month}-01`)) / (30.5 * DAY));
      const needed = Math.ceil(gap / monthsLeft);
      out.push({
        level: 'warn', tag: 'Goal', title: `${emergency.name} is ${money(gap)} short of target`,
        text: `At ${money(emergency.monthly_contribution)}/mo you land ${fmtDate(state, projected, { month: 'short', year: 'numeric' })}, past the ${target} target. ${money(needed)}/mo brings it back on schedule.`,
        action: { label: `Set ${money(needed)}/mo`, kind: 'set-contribution', id: emergency.id, value: needed },
      });
    }
  }
  const card = [...state.debts].sort((a, b) => num(b.apr) - num(a.apr))[0];
  if (card && num(card.apr) >= 15) {
    const plan = debtPlan(state, { strategy: 'avalanche', extra: sum(state.debts, (d) => d.extra) });
    const current = debtPlan(state, { strategy: 'snowball', extra: sum(state.debts, (d) => d.extra) });
    if (plan.interest < current.interest) {
      out.push({
        level: 'info', tag: 'Debt', title: `${card.name} is costing ${num(card.apr).toFixed(2)}% APR`,
        text: `Avalanche order targets this rate first and saves about ${money(current.interest - plan.interest)} in interest versus snowball over the full payoff.`,
        action: { label: 'Use avalanche', kind: 'set-strategy', value: 'avalanche' },
      });
    }
  }
  const review = state.subscriptions.filter((s) => s.status === 'review');
  if (review.length) {
    const total = sum(review, (s) => s.amount);
    out.push({
      level: 'info', tag: 'Subscriptions', title: `${review.length} subscriptions need a decision`,
      text: `${review.map((s) => s.name).join(' and ')} cost ${money(total)}/mo. Canceling the first one routes that cash straight to savings.`,
      action: { label: `Cancel ${review[0].name}`, kind: 'cancel-sub', name: review[0].name, value: review[0].amount },
    });
  }
  const plan = monthStats(state, month);
  if (plan.budget > 0 && plan.income > 0) {
    const plannedRate = Math.round((plan.budget / plan.income) * 100);
    out.push({
      level: plannedRate > 90 ? 'warn' : 'good', tag: 'Plan', title: `${plannedRate}% of income has a job`,
      text: `${money(plan.income)} in income, ${money(plan.budget)} planned across ${state.envelopes.length} envelopes, ${money(Math.max(0, plan.income - plan.budget))} still unassigned.`,
      action: { label: 'Balance envelopes', kind: 'go', route: '#/budget' },
    });
  }
  return out.slice(0, 7);
}

export function transactionCSV(state) {
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['id', 'date', 'payee', 'category', 'amount', 'account', 'note']];
  for (const t of state.transactions) rows.push([t.id, t.date, t.payee, t.category, t.amount, t.account, t.note]);
  return rows.map((r) => r.map(quote).join(',')).join('\r\n');
}

export function download(state, filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
