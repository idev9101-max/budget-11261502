import {
  addMonths, addTransaction, clearState, currentCash, deleteTransaction, download, fmt, freshState,
  loadState, monthLabel, monthOptions, monthOf, normalizeState, saveState, todayKey,
  transactionCSV, updateTransaction,
} from './core.js';
import {
  billForm, debtForm, goalForm, modal, routeView, simResults, txForm, txTable,
} from './views.js';

let state = loadState();
let filterTimer = 0;
let toastTimer = 0;
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');
const monthSelect = document.getElementById('month-select');

function route() {
  const value = location.hash.replace(/^#/, '') || '/';
  const known = ['/', '/transactions', '/budget', '/bills', '/goals', '/debt', '/reports', '/insights', '/settings'];
  return known.includes(value) ? value : '/';
}

function applyChrome() {
  document.documentElement.dataset.theme = state.ui.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.density = state.ui.density === 'compact' ? 'compact' : 'regular';
  monthSelect.innerHTML = monthOptions(state).map((m) => `<option value="${m}"${m === state.ui.month ? ' selected' : ''}>${monthLabel(state, m)}</option>`).join('');
  document.querySelectorAll('.sidebar nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${route()}`));
  document.querySelector('[data-action="theme"]').textContent = state.ui.theme === 'dark' ? '☀' : '◐';
  document.querySelector('[data-action="density"]').textContent = state.ui.density === 'compact' ? '≡' : '☰';
}

function render() {
  window.__shotReady = false;
  app.innerHTML = routeView(state, route());
  document.title = `${route() === '/' ? 'Overview' : route().slice(1).replace(/^\w/, (c) => c.toUpperCase())} · Hearthline`;
  applyChrome();
  window.scrollTo(0, 0);
  window.__shotReady = true;
}

function refresh() {
  saveState(state);
  render();
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function openModal(title, body) {
  modalRoot.innerHTML = modal(title, body);
  document.body.classList.add('modal-open');
  modalRoot.querySelector('input, select, button')?.focus();
}

function closeModal() {
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function insightAction(button) {
  const { kind, value, category, id, name, route: target } = button.dataset;
  if (kind === 'go') { location.hash = target || '#/'; return; }
  if (kind === 'set-budget') {
    const env = state.envelopes.find((e) => e.category === category);
    if (env) env.monthly_budget = Math.round(Number(value));
    toast(`${category} plan set to ${fmt(state, Number(value))}`);
  } else if (kind === 'set-contribution') {
    const goal = state.goals.find((g) => g.id === id);
    if (goal) goal.monthly_contribution = Math.round(Number(value));
    toast('Goal contribution updated');
  } else if (kind === 'set-strategy') {
    state.ui.strategy = value;
    toast('Payoff strategy switched');
  } else if (kind === 'cancel-sub') {
    state.subscriptions = state.subscriptions.filter((s) => s.name !== name);
    for (const bill of state.bills) if (bill.category === 'Subscriptions' && bill.amount >= Number(value)) bill.amount = Math.round((bill.amount - Number(value)) * 100) / 100;
    const goal = state.goals.find((g) => g.id === 'emergency') ?? state.goals[0];
    if (goal) goal.monthly_contribution += Number(value);
    toast(`${name} cancelled; its cost now goes to ${goal?.name ?? 'savings'}`);
  }
  refresh();
}

function payBill(key) {
  const split = key.indexOf('|');
  const date = key.slice(0, split);
  const name = key.slice(split + 1);
  const bill = state.bills.find((b) => b.name === name);
  if (!bill) return;
  addTransaction(state, { date, payee: name, category: bill.category, amount: -Math.abs(bill.amount), note: 'bill payment' });
  state.paid[key] = true;
  refresh();
  toast(`${name} logged as paid`);
}

function handleClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'close-modal' && el.classList.contains('modal-backdrop') && event.target !== el) return;
  switch (action) {
    case 'month': state.ui.month = addMonths(state.ui.month, Number(el.dataset.delta)); refresh(); break;
    case 'cal-month': state.ui.calMonth = addMonths(state.ui.calMonth, Number(el.dataset.delta)); refresh(); break;
    case 'cal-today': state.ui.calMonth = monthOf(todayKey(state)); refresh(); break;
    case 'theme': state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark'; refresh(); break;
    case 'density': state.ui.density = state.ui.density === 'compact' ? 'regular' : 'compact'; refresh(); break;
    case 'new-tx': openModal('Add transaction', txForm(state)); break;
    case 'edit-tx': openModal('Edit transaction', txForm(state, state.transactions.find((t) => t.id === el.dataset.id))); break;
    case 'delete-tx':
      if (confirm('Delete this transaction?')) { deleteTransaction(state, el.dataset.id); refresh(); toast('Transaction deleted'); }
      break;
    case 'clear-filters':
      state.ui.filters = { q: '', type: 'all', category: 'all', account: 'all', from: '', to: '', recurring: false, sort: 'date' };
      refresh();
      break;
    case 'new-bill': openModal('Add bill', billForm(state)); break;
    case 'edit-bill': openModal('Edit bill', billForm(state, el.dataset.name)); break;
    case 'delete-bill':
      state.bills = state.bills.filter((b) => b.name !== el.dataset.name); closeModal(); refresh(); toast('Bill removed');
      break;
    case 'toggle-reminder': {
      const key = el.dataset.key;
      if (state.reminders[key]) delete state.reminders[key]; else state.reminders[key] = true;
      refresh();
      toast(state.reminders[key] ? 'Reminder set for this bill' : 'Reminder cleared');
      break;
    }
    case 'pay-bill': payBill(el.dataset.key); break;
    case 'new-goal': openModal('New goal', goalForm(state)); break;
    case 'edit-goal': openModal('Edit goal', goalForm(state, el.dataset.id)); break;
    case 'delete-goal':
      state.goals = state.goals.filter((g) => g.id !== el.dataset.id); closeModal(); refresh(); toast('Goal removed');
      break;
    case 'new-debt': openModal('Add debt', debtForm(state)); break;
    case 'edit-debt': openModal('Edit debt', debtForm(state, el.dataset.id)); break;
    case 'delete-debt':
      state.debts = state.debts.filter((d) => d.id !== el.dataset.id); closeModal(); refresh(); toast('Debt removed');
      break;
    case 'strategy': state.ui.strategy = el.dataset.value; refresh(); toast(`Using ${el.dataset.value} payoff order`); break;
    case 'insight': insightAction(el); break;
    case 'apply-range': {
      state.ui.report = { ...state.ui.report, from: document.getElementById('r-from').value, to: document.getElementById('r-to').value };
      refresh();
      break;
    }
    case 'copy-budget': {
      const previous = addMonths(state.ui.month, -1);
      for (const env of state.envelopes) {
        const spent = state.transactions.filter((t) => t.category === env.category && monthOf(t.date) === previous && t.amount < 0).reduce((n, t) => n - t.amount, 0);
        env.monthly_budget = Math.round(spent);
      }
      refresh(); toast(`Envelopes copied from ${monthLabel(state, previous)}`);
      break;
    }
    case 'auto-balance': {
      const income = state.transactions.filter((t) => monthOf(t.date) === state.ui.month && t.amount > 0).reduce((n, t) => n + t.amount, 0);
      const total = state.envelopes.reduce((n, e) => n + Number(e.monthly_budget), 0);
      if (income <= 0 || total <= 0) { toast('Record income and plan amounts first'); break; }
      let assigned = 0;
      state.envelopes.forEach((env, i) => {
        env.monthly_budget = i === state.envelopes.length - 1 ? Math.max(0, Math.round(income) - assigned) : Math.round((Number(env.monthly_budget) / total) * income);
        assigned += env.monthly_budget;
      });
      refresh(); toast(`Plans scaled to ${fmt(state, income)} of income`);
      break;
    }
    case 'export-json': download(state, 'hearthline-household.json', JSON.stringify(state, null, 2), 'application/json'); toast('JSON exported'); break;
    case 'export-csv': download(state, 'hearthline-transactions.csv', transactionCSV(state), 'text/csv'); toast('CSV exported'); break;
    case 'import-json': document.getElementById('import-file')?.click(); break;
    case 'reset-data':
      if (confirm('Replace all local changes with the original sample household?')) {
        clearState(); state = freshState(); refresh(); toast('Sample data restored');
      }
      break;
    case 'cancel-sub': insightAction({ dataset: { kind: 'cancel-sub', name: el.dataset.name, value: state.subscriptions.find((s) => s.name === el.dataset.name)?.amount ?? 0 } }); break;
    case 'close-modal': closeModal(); break;
    default: break;
  }
}

function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const value = (key) => String(data.get(key) ?? '').trim();
  switch (form.dataset.form) {
    case 'tx': {
      const amount = Math.abs(Number(value('amount'))) * (value('type') === 'income' ? 1 : -1);
      const payload = { date: value('date'), payee: value('payee'), category: value('category'), amount, account: value('account'), note: data.get('recurring') ? 'recurring' : value('note') };
      if (form.dataset.id) updateTransaction(state, form.dataset.id, payload); else addTransaction(state, payload);
      closeModal(); refresh(); toast(form.dataset.id ? 'Transaction updated' : 'Transaction added');
      break;
    }
    case 'allocate': {
      const env = state.envelopes.find((e) => e.category === value('category'));
      const amount = Math.max(0, Number(value('amount')));
      if (env) env.monthly_budget = Math.round((Number(env.monthly_budget) + amount) * 100) / 100;
      refresh(); toast(`${fmt(state, amount)} allocated to ${env?.category ?? 'plan'}`);
      break;
    }
    case 'contribute': {
      const goal = state.goals.find((g) => g.id === form.dataset.id);
      const amount = Math.abs(Number(value('amount')));
      if (!goal || !amount) break;
      goal.balance = Math.round((Number(goal.balance) + amount) * 100) / 100;
      addTransaction(state, { date: todayKey(state), payee: `${goal.name} contribution`, category: 'Savings transfer', amount: -amount, note: 'goal contribution' });
      refresh(); toast(`${fmt(state, amount)} added to ${goal.name}`);
      break;
    }
    case 'apply-extra': {
      const amount = Math.max(0, Number(value('amount')));
      const first = [...state.debts].sort((a, b) => (state.ui.strategy === 'snowball' ? Number(a.balance) - Number(b.balance) : Number(b.apr) - Number(a.apr)))[0];
      if (!first) { toast('Add a debt first'); break; }
      first.extra = Math.round((Number(first.extra) + amount) * 100) / 100;
      const plan = state.envelopes.find((e) => e.category === 'Debt extra');
      if (plan) plan.monthly_budget += amount;
      refresh(); toast(`${fmt(state, amount)}/month added to ${first.name}`);
      break;
    }
    case 'settings': {
      state.household = value('household') || state.household;
      state.settings.locale = value('locale');
      state.settings.currency = value('currency');
      state.currency = value('currency');
      state.settings.month_start_day = Math.min(28, Math.max(1, Number(value('month_start_day')) || 1));
      state.settings.safe_to_spend_buffer = Math.max(0, Number(value('safe_to_spend_buffer')) || 0);
      refresh(); toast('Household settings saved');
      break;
    }
    case 'bill': {
      const payload = { name: value('name'), amount: Math.abs(Number(value('amount'))), day: Math.min(28, Math.max(1, Number(value('day')) || 1)), category: value('category'), autopay: Boolean(data.get('autopay')) };
      if (form.dataset.name) Object.assign(state.bills.find((b) => b.name === form.dataset.name) ?? {}, payload); else state.bills.push(payload);
      closeModal(); refresh(); toast('Bill saved');
      break;
    }
    case 'goal': {
      const payload = { name: value('name'), target: Math.abs(Number(value('target'))), balance: Math.max(0, Number(value('balance')) || 0), monthly_contribution: Math.max(0, Number(value('monthly_contribution')) || 0), target_date: value('target_date') };
      if (form.dataset.id) Object.assign(state.goals.find((g) => g.id === form.dataset.id) ?? {}, payload);
      else state.goals.push({ id: `g${Date.now().toString(36)}`, ...payload });
      closeModal(); refresh(); toast('Goal saved');
      break;
    }
    case 'debt': {
      const payload = { name: value('name'), balance: Math.max(0, Number(value('balance')) || 0), apr: Math.max(0, Number(value('apr')) || 0), minimum: Math.max(0, Number(value('minimum')) || 0), extra: Math.max(0, Number(value('extra')) || 0), type: value('type') };
      if (form.dataset.id) Object.assign(state.debts.find((d) => d.id === form.dataset.id) ?? {}, payload);
      else state.debts.push({ id: `d${Date.now().toString(36)}`, ...payload });
      closeModal(); refresh(); toast('Debt saved');
      break;
    }
    default: break;
  }
}

function handleChange(event) {
  const el = event.target;
  if (el.id === 'import-file') { handleImport(event); return; }
  if (el.id === 'month-select') { state.ui.month = el.value; refresh(); return; }
  if (el.id === 'f-type' || el.id === 'f-category' || el.id === 'f-account' || el.id === 'f-sort' || el.id === 'f-recurring' || el.id === 'f-from' || el.id === 'f-to') {
    const key = el.id.slice(2);
    state.ui.filters[key] = el.type === 'checkbox' ? el.checked : el.value;
    const target = document.getElementById('tx-results');
    if (target) target.innerHTML = txTable(state);
    saveState(state);
    return;
  }
  if (el.id === 'r-range' || el.id === 'r-category' || el.id === 'r-from' || el.id === 'r-to') {
    state.ui.report[el.id.slice(2)] = el.value;
    refresh();
    return;
  }
  if (el.dataset.budget !== undefined) {
    const env = state.envelopes.find((e) => e.category === el.dataset.budget);
    if (env) { env.monthly_budget = Math.max(0, Number(el.value) || 0); refresh(); toast('Envelope plan updated'); }
    return;
  }
  if (el.dataset.account !== undefined) {
    const account = state.accounts.find((a) => a.id === el.dataset.account);
    if (account) {
      account.balance = Number(el.value) || 0;
      if (account.primary) state.baseline = account.balance;
      refresh(); toast('Balance updated');
    }
    return;
  }
  if (el.dataset.subStatus !== undefined) {
    const sub = state.subscriptions.find((s) => s.name === el.dataset.subStatus);
    if (sub) { sub.status = el.value; refresh(); toast('Subscription status updated'); }
    return;
  }
  if (el.dataset.incomeAmount !== undefined || el.dataset.incomeDay !== undefined || el.dataset.incomeFreq !== undefined) {
    const income = state.income.find((i) => i.id === (el.dataset.incomeAmount || el.dataset.incomeDay || el.dataset.incomeFreq));
    if (!income) return;
    if (el.dataset.incomeAmount !== undefined) income.amount = Math.max(0, Number(el.value) || 0);
    if (el.dataset.incomeDay !== undefined) income.day = Math.min(28, Math.max(1, Number(el.value) || 1));
    if (el.dataset.incomeFreq !== undefined) income.frequency = el.value;
    refresh(); toast('Income schedule updated');
  }
}

function handleInput(event) {
  const el = event.target;
  if (el.id === 'f-q') {
    state.ui.filters.q = el.value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      const target = document.getElementById('tx-results');
      if (target) target.innerHTML = txTable(state);
      saveState(state);
    }, 90);
    return;
  }
  if (el.dataset.whatif) {
    state.ui.whatif[el.dataset.whatif] = Number(el.value);
    const outputs = { extraDebt: 'sim-extra-out', diningCut: 'sim-dining-out', incomeShift: 'sim-income-out' };
    const out = document.getElementById(outputs[el.dataset.whatif]);
    if (out) {
      const w = state.ui.whatif;
      out.textContent = el.dataset.whatif === 'extraDebt' ? `${fmt(state, w.extraDebt)}/mo` : el.dataset.whatif === 'diningCut' ? `${w.diningCut}%` : `${w.incomeShift > 0 ? '+' : ''}${w.incomeShift}%`;
    }
    const results = document.getElementById('sim-results');
    if (results) results.innerHTML = simResults(state);
    saveState(state);
  }
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const next = normalizeState(parsed);
    if (!Array.isArray(next.transactions) || !next.transactions.length) throw new Error('No transactions found');
    state = next;
    refresh();
    toast(`Imported ${state.transactions.length} transactions`);
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
  event.target.value = '';
}

document.addEventListener('click', handleClick);
document.addEventListener('submit', handleSubmit);
document.addEventListener('change', handleChange);
document.addEventListener('input', handleInput);
window.addEventListener('hashchange', render);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

saveState(state);
render();
