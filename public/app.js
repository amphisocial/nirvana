const state = {
  summary: null,
  projection: null,
  settings: null,
  auth: null,
  threadId: null,
  charts: {},
  editingAccountId: null,
  editingLiabilityId: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function showAlert(message) {
  const alert = $('#globalAlert');
  alert.textContent = message;
  alert.classList.remove('hidden');
  window.clearTimeout(showAlert.timer);
  showAlert.timer = window.setTimeout(() => alert.classList.add('hidden'), 7000);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.status === 401) {
    window.location.href = '/';
    throw new Error('Authentication required');
  }
  if (!response.ok) {
    const details = payload?.details?.map((item) => `${item.path}: ${item.message}`).join('; ');
    throw new Error(details || payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function switchView(id) {
  $$('.view').forEach((view) => view.classList.toggle('active-view', view.id === id));
  $$('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  const active = $(`.nav-item[data-view="${id}"]`);
  $('#pageTitle').textContent = active?.textContent.trim() || 'Nirvana';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function destroyChart(name) {
  state.charts[name]?.destroy();
  delete state.charts[name];
}

function chartDefaults() {
  const style = getComputedStyle(document.documentElement);
  return {
    ink: style.getPropertyValue('--ink').trim(),
    soft: style.getPropertyValue('--ink-soft').trim(),
    accent: style.getPropertyValue('--accent').trim(),
    accentPale: style.getPropertyValue('--accent-pale').trim(),
    sand: style.getPropertyValue('--sand').trim(),
    line: style.getPropertyValue('--line').trim(),
    blueDark: style.getPropertyValue('--blue-dark').trim() || '#0b3a67',
    blue: style.getPropertyValue('--blue').trim() || '#1976c5',
    blueLight: style.getPropertyValue('--blue-light').trim() || '#83b9ed'
  };
}

function standardScales(currency = true) {
  const colors = chartDefaults();
  return {
    x: { grid: { display: false }, ticks: { color: colors.soft, maxTicksLimit: 8 } },
    y: {
      grid: { color: colors.line },
      ticks: { color: colors.soft, callback: (value) => currency ? money.format(value) : value }
    }
  };
}

function renderOverview() {
  const { metrics, holdings, allocation, netWorthHistory } = state.summary;
  $('#netWorthMetric').textContent = money.format(metrics.netWorth);
  $('#assetsMetric').textContent = money.format(metrics.assetsTotal);
  $('#liabilitiesMetric').textContent = money.format(metrics.liabilitiesTotal);
  $('#portfolioMetric').textContent = money.format(metrics.investableAssets ?? metrics.liquidPortfolio);
  $('#homeEquityMetric').textContent = money.format(metrics.homeEquity || 0);
  $('#accountCountMetric').textContent = `${metrics.accountCount} account${metrics.accountCount === 1 ? '' : 's'}`;
  $('#holdingsCountMetric').textContent = `${metrics.holdingsCount} holding${metrics.holdingsCount === 1 ? '' : 's'}`;

  const tbody = $('#holdingsTable');
  tbody.replaceChildren();
  if (!holdings.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="muted">No holdings imported yet.</td>';
    tbody.append(row);
  } else {
    holdings.slice(0, 8).forEach((holding) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td><strong>${escapeHtml(holding.symbol)}</strong><br><small class="muted">${escapeHtml(holding.name || '')}</small></td><td>${money.format(holding.current_value)}</td><td>${money.format(holding.current_price)}</td><td>${number.format(holding.quantity)}</td>`;
      tbody.append(row);
    });
  }

  if (typeof Chart !== 'undefined') {
    const colors = chartDefaults();

    const palette = [colors.blue, colors.blueLight, colors.blueDark, '#4f97d1', '#a9cce8', '#769fca', '#c8dcef'];
    destroyChart('allocation');
    state.charts.allocation = new Chart($('#allocationChart'), {
      type: 'doughnut',
      data: {
        labels: allocation.map((item) => item.label),
        datasets: [{ data: allocation.map((item) => item.value), backgroundColor: allocation.map((_, index) => palette[index % palette.length]), borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.label}: ${money.format(context.raw)}` } } } }
    });
    const legend = $('#allocationLegend');
    legend.replaceChildren();
    allocation.forEach((item, index) => {
      const label = document.createElement('span');
      label.innerHTML = `<i class="legend-dot" style="background:${palette[index % palette.length]}"></i>${item.label}: ${money.format(item.value)}`;
      legend.append(label);
    });
  }
}

function populateRetirementForm() {
  const plan = state.summary.retirementPlan;
  if (!plan) return;
  const form = $('#retirementForm');
  form.currentAge.value = plan.current_age;
  form.retirementAge.value = plan.retirement_age;
  form.planEndAge.value = plan.plan_end_age;
  form.annualContribution.value = plan.annual_contribution;
  form.annualRetirementSpending.value = plan.annual_retirement_spending;
  form.expectedReturnPct.value = Number(plan.expected_return) * 100;
  form.volatilityPct.value = Number(plan.volatility) * 100;
  form.inflationPct.value = Number(plan.inflation) * 100;
  if (form.successThresholdPct) form.successThresholdPct.value = Number(plan.success_threshold ?? 0.90) * 100;
  if (form.maxSearchAge) form.maxSearchAge.value = plan.max_search_age ?? 75;
  if (form.effectiveTaxRatePct) form.effectiveTaxRatePct.value = Number(plan.effective_tax_rate ?? 0.15) * 100;
}

function renderProjection() {
  const projection = state.projection;
  if (!projection) return;
  $('#successRateMetric').textContent = `${projection.successRatePct}%`;
  $('#readinessLabel').textContent = projection.readiness;
  $('#retirementStatus').textContent = `${projection.successRatePct}% · ${projection.readiness}`;
  $('#readinessRing').style.background = `conic-gradient(var(--accent) ${Math.min(100, projection.successRatePct) * 3.6}deg, var(--surface-soft) 0)`;
  $('#readinessCopy').textContent = `Median projected portfolio at age ${projection.inputs.endAge}: ${money.format(projection.p50.at(-1))}.`;

  const assumptions = $('#retirementAssumptions');
  assumptions.replaceChildren();
  projection.assumptions.forEach((text) => {
    const item = document.createElement('div');
    item.className = 'assumption-item';
    item.textContent = text;
    assumptions.append(item);
  });

  if (typeof Chart !== 'undefined') {
    const colors = chartDefaults();
    destroyChart('retirement');
    state.charts.retirement = new Chart($('#retirementChart'), {
      type: 'line',
      data: {
        labels: projection.ages,
        datasets: [
          { label: '90th percentile', data: projection.p90, borderColor: colors.accentPale, backgroundColor: colors.accentPale, borderWidth: 1.5, pointRadius: 0, tension: .25 },
          { label: 'Median', data: projection.p50, borderColor: colors.accent, backgroundColor: colors.accent, borderWidth: 3, pointRadius: 0, tension: .25 },
          { label: '10th percentile', data: projection.p10, borderColor: colors.sand, backgroundColor: colors.sand, borderWidth: 2, pointRadius: 0, tension: .25 },
          { label: 'Deterministic', data: projection.deterministic, borderColor: colors.ink, borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: .25 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7 } } },
        scales: { ...standardScales(true), x: { ...standardScales(true).x, title: { display: true, text: 'Age' } } }
      }
    });
  }
}

const investmentDefaults = {
  growth: { expectedReturnPct: 8.0, expectedVolatilityPct: 18.0, hint: 'Higher-growth fund assumption with wider potential swings.' },
  balanced: { expectedReturnPct: 6.0, expectedVolatilityPct: 12.0, hint: 'Balanced stock-and-bond portfolio assumption.' },
  conservative: { expectedReturnPct: 4.0, expectedVolatilityPct: 7.0, hint: 'Lower-risk fund assumption with lower modeled growth.' },
  self_managed: { expectedReturnPct: 7.0, expectedVolatilityPct: 20.0, hint: 'User-defined assumption for self-managed stocks. This is not a forecast.' }
};

function isRetirementType(type) {
  return ['ira', '401k', 'retirement'].includes(type);
}

function isInvestmentType(type) {
  return ['brokerage', 'ira', '401k', 'retirement'].includes(type);
}

function refreshInvestmentProfile(resetValues = false) {
  const form = $('#accountForm');
  const type = form.accountType.value;
  const isInvestment = isInvestmentType(type);
  const fields = $('#investmentProfileFields');
  fields.classList.toggle('hidden', !isInvestment);
  $('#portfolioSetupPrompt').classList.toggle('hidden', !isInvestment || form.projectionMethod.value !== 'holdings_monte_carlo');
  if (!isInvestment) return;

  if (resetValues) {
    form.projectionMethod.value = ['brokerage', 'ira'].includes(type) ? 'holdings_monte_carlo' : 'profile';
    form.investmentStyle.value = ['brokerage', 'ira'].includes(type) ? 'self_managed' : 'balanced';
  }
  const style = form.investmentStyle.value || (['brokerage', 'ira'].includes(type) ? 'self_managed' : 'balanced');
  const defaults = investmentDefaults[style] || investmentDefaults.balanced;
  if (resetValues) {
    form.expectedReturnPct.value = defaults.expectedReturnPct;
    form.expectedVolatilityPct.value = defaults.expectedVolatilityPct;
  }
  const holdingsMode = form.projectionMethod.value === 'holdings_monte_carlo';
  $('#investmentProfileHint').textContent = holdingsMode
    ? 'Add stocks and ETFs below, then calculate the forecast. These values are fallback assumptions until that calculation is saved.'
    : defaults.hint;
  $('#portfolioSetupPrompt').classList.toggle('hidden', !holdingsMode);
}

function refreshPropertyProfile(resetValues = false) {
  const form = $('#accountForm');
  const isProperty = form.accountType.value === 'property';
  $('#propertyProfileFields').classList.toggle('hidden', !isProperty);
  if (!isProperty) return;
  if (resetValues) {
    form.isPrimaryResidence.checked = false;
    form.retirementTreatment.value = 'keep';
    form.retirementTreatmentAge.value = '';
    form.retirementCashRelease.value = '';
    form.propertyGrowthRatePct.value = '3.0';
  }
  const treatment = form.retirementTreatment.value;
  $('#propertyReleaseFields').classList.toggle('hidden', ['keep', 'convert_to_rental', 'undecided'].includes(treatment));
}

function resetAccountEditor() {
  state.editingAccountId = null;
  const form = $('#accountForm');
  form.reset();
  $('#accountFormTitle').textContent = 'Add an asset';
  $('#accountSubmitButton').textContent = 'Add account';
  $('#accountCancelEdit').classList.add('hidden');
  form.projectionMethod.value = 'profile';
  form.investmentStyle.value = 'balanced';
  form.expectedReturnPct.value = '6.0';
  form.expectedVolatilityPct.value = '12.0';
  refreshInvestmentProfile(false);
  form.isPrimaryResidence.checked = false;
  form.retirementTreatment.value = 'keep';
  form.retirementTreatmentAge.value = '';
  form.retirementCashRelease.value = '';
  form.propertyGrowthRatePct.value = '3.0';
  refreshPropertyProfile(false);
}

function resetLiabilityEditor() {
  state.editingLiabilityId = null;
  const form = $('#liabilityForm');
  form.reset();
  $('#liabilityFormTitle').textContent = 'Add a debt';
  $('#liabilitySubmitButton').textContent = 'Add liability';
  $('#liabilityCancelEdit').classList.add('hidden');
  form.liabilityType.value = 'mortgage';
  refreshLoanForm();
}

function editAccount(id) {
  const account = state.summary.accounts.find((item) => item.id === id);
  if (!account) return showAlert('Account could not be found.');
  state.editingAccountId = id;
  const form = $('#accountForm');
  form.name.value = account.name || '';
  form.institution.value = account.institution || '';
  form.accountType.value = account.account_type;
  form.currentBalance.value = account.current_balance ?? 0;
  form.projectionMethod.value = account.projection_method || (['brokerage', 'ira'].includes(account.account_type) ? 'holdings_monte_carlo' : 'profile');
  form.investmentStyle.value = account.investment_style || (['brokerage', 'ira'].includes(account.account_type) ? 'self_managed' : 'balanced');
  form.expectedReturnPct.value = account.expected_return == null ? '6.0' : Number(account.expected_return) * 100;
  form.expectedVolatilityPct.value = account.expected_volatility == null ? '12.0' : Number(account.expected_volatility) * 100;
  form.isPrimaryResidence.checked = Boolean(account.is_primary_residence);
  form.retirementTreatment.value = account.retirement_treatment || 'keep';
  form.retirementTreatmentAge.value = account.retirement_treatment_age ?? '';
  form.retirementCashRelease.value = account.retirement_cash_release ?? '';
  form.propertyGrowthRatePct.value = account.property_growth_rate == null ? '3.0' : Number(account.property_growth_rate) * 100;
  refreshInvestmentProfile(false);
  refreshPropertyProfile(false);
  $('#accountFormTitle').textContent = 'Edit asset';
  $('#accountSubmitButton').textContent = 'Save changes';
  $('#accountCancelEdit').classList.remove('hidden');
  switchView('accounts');
  form.name.focus();
}

function editLiability(id) {
  const liability = state.summary.liabilities.find((item) => item.id === id);
  if (!liability) return showAlert('Liability could not be found.');
  state.editingLiabilityId = id;
  const form = $('#liabilityForm');
  form.name.value = liability.name || '';
  form.institution.value = liability.institution || '';
  form.liabilityType.value = liability.liability_type;
  form.originalAmount.value = liability.original_amount ?? '';
  form.currentBalance.value = liability.current_balance ?? 0;
  form.interestRatePct.value = liability.interest_rate == null ? '' : Number(liability.interest_rate) * 100;
  form.originalTermMonths.value = liability.original_term_months ?? '';
  form.loanStartDate.value = liability.loan_start_date ? String(liability.loan_start_date).slice(0, 10) : '';
  form.currentTermMonth.value = liability.current_term_month ?? '';
  if (liability.current_term_month != null) {
    form.currentTermYear.value = Math.floor(Number(liability.current_term_month) / 12) + 1;
    form.currentTermMonthInYear.value = (Number(liability.current_term_month) % 12) + 1;
  } else {
    form.currentTermYear.value = '';
    form.currentTermMonthInYear.value = '';
  }
  form.principalInterestPayment.value = liability.principal_interest_payment ?? '';
  form.propertyTaxPayment.value = liability.property_tax_payment ?? '';
  form.homeInsurancePayment.value = liability.home_insurance_payment ?? '';
  form.pmiPayment.value = liability.pmi_payment ?? '';
  form.hoaPayment.value = liability.hoa_payment ?? '';
  form.otherEscrowPayment.value = liability.other_escrow_payment ?? '';
  form.monthlyPayment.value = liability.monthly_payment ?? liability.minimum_payment ?? '';
  form.payoffAge.value = liability.payoff_age ?? '';
  form.linkedAccountId.value = liability.linked_account_id ?? '';
  refreshLoanForm();
  $('#liabilityFormTitle').textContent = 'Edit liability';
  $('#liabilitySubmitButton').textContent = 'Save changes';
  $('#liabilityCancelEdit').classList.remove('hidden');
  switchView('accounts');
  form.name.focus();
}

async function deleteAccount(id) {
  const account = state.summary.accounts.find((item) => item.id === id);
  if (!account) return;
  const confirmed = window.confirm(
    `Delete "${account.name}"? Any holdings imported into this account will also be permanently deleted.`
  );
  if (!confirmed) return;
  await api(`/api/accounts/${id}`, { method: 'DELETE' });
  if (state.editingAccountId === id) resetAccountEditor();
  await loadDashboard();
  showAlert('Asset deleted.');
}

async function deleteLiability(id) {
  const liability = state.summary.liabilities.find((item) => item.id === id);
  if (!liability) return;
  if (!window.confirm(`Delete "${liability.name}"?`)) return;
  await api(`/api/accounts/liabilities/${id}`, { method: 'DELETE' });
  if (state.editingLiabilityId === id) resetLiabilityEditor();
  await loadDashboard();
  showAlert('Liability deleted.');
}

function renderAccounts() {
  const list = $('#accountsList');
  list.replaceChildren();
  const rows = [
    ...state.summary.accounts.map((item) => ({
      ...item,
      kind: item.account_type.replaceAll('_', ' '),
      balance: item.current_balance,
      debt: false
    })),
    ...state.summary.liabilities.map((item) => ({
      ...item,
      kind: item.liability_type.replaceAll('_', ' '),
      balance: item.current_balance,
      debt: true
    }))
  ];
  if (!rows.length) {
    list.innerHTML = '<div class="empty-inline">Add your first account or liability.</div>';
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'account-row';

    const details = document.createElement('div');
    details.className = 'account-row-details';
    const profileReturn = row.forecast_expected_return ?? row.expected_return;
    const profile = row.investment_style
      ? ` · ${escapeHtml((row.projection_method || 'profile').replaceAll('_', ' '))} · ${(Number(profileReturn || 0) * 100).toFixed(1)}% modeled growth${row.holding_count ? ` · ${row.holding_count} holdings` : ''}`
      : row.account_type === 'property'
        ? ` · ${row.is_primary_residence ? 'primary residence' : 'property'} · ${escapeHtml((row.retirement_treatment || 'keep').replaceAll('_', ' '))}`
        : '';
    details.innerHTML = `<span><strong>${escapeHtml(row.name)}</strong></span><small>${escapeHtml(row.institution || 'Manual')} · ${escapeHtml(row.kind)}${profile}</small>`;

    const trailing = document.createElement('div');
    trailing.className = 'account-row-trailing';

    const balance = document.createElement('strong');
    balance.className = row.debt ? 'debt-balance' : '';
    balance.textContent = `${row.debt ? '−' : ''}${money.format(row.balance)}`;

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'row-action';
    editButton.textContent = 'Edit';
    editButton.setAttribute('aria-label', `Edit ${row.name}`);
    editButton.addEventListener('click', () => row.debt ? editLiability(row.id) : editAccount(row.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'row-action danger';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete ${row.name}`);
    deleteButton.addEventListener('click', async () => {
      try {
        if (row.debt) await deleteLiability(row.id);
        else await deleteAccount(row.id);
      } catch (error) {
        showAlert(error.message);
      }
    });

    if (!row.debt && isInvestmentType(row.account_type)) {
      const portfolioButton = document.createElement('button');
      portfolioButton.type = 'button';
      portfolioButton.className = 'row-action';
      portfolioButton.textContent = 'Portfolio';
      portfolioButton.addEventListener('click', () => {
        switchView('accounts');
        document.dispatchEvent(new CustomEvent('nirvana:open-portfolio', { detail: { accountId: row.id } }));
      });
      actions.append(portfolioButton);
    }
    actions.append(editButton, deleteButton);
    trailing.append(balance, actions);
    item.append(details, trailing);
    list.append(item);
  });
}


function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const button = $('#sidebarToggle');
  button.textContent = collapsed ? '›' : '‹';
  button.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
  button.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
  localStorage.setItem('nirvana.sidebarCollapsed', collapsed ? '1' : '0');
  window.setTimeout(() => Object.values(state.charts).forEach((chart) => chart?.resize()), 260);
}

function numericFormValue(form, name) {
  const value = form[name]?.value;
  return value === '' || value == null ? null : Number(value);
}

function monthsElapsedFromDate(value) {
  if (!value) return null;
  const start = new Date(`${value}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const today = new Date();
  return Math.max(0, (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth());
}

function refreshLoanForm() {
  const form = $('#liabilityForm');
  if (!form) return;
  const isMortgage = form.liabilityType.value === 'mortgage';
  $('#mortgagePaymentFields').classList.toggle('hidden', !isMortgage);
  const term = numericFormValue(form, 'originalTermMonths');
  const currentYear = numericFormValue(form, 'currentTermYear');
  const monthInYear = numericFormValue(form, 'currentTermMonthInYear');
  let elapsed = currentYear == null
    ? null
    : Math.max(0, (Math.floor(currentYear) - 1) * 12 + Math.max(0, Math.floor((monthInYear || 1) - 1)));
  if (elapsed == null) elapsed = monthsElapsedFromDate(form.loanStartDate.value);
  form.currentTermMonth.value = elapsed == null ? '' : String(elapsed);
  if (isMortgage) {
    const components = ['principalInterestPayment','propertyTaxPayment','homeInsurancePayment','pmiPayment','hoaPayment','otherEscrowPayment'];
    const componentTotal = components.reduce((sum, name) => sum + (numericFormValue(form, name) || 0), 0);
    if (componentTotal > 0) form.monthlyPayment.value = componentTotal.toFixed(2);
  }
  const summary = $('#loanTermSummary');
  if (!term) {
    summary.textContent = 'Enter the original term and start date or current loan year and month to calculate the remaining term.';
    return;
  }
  const used = Math.min(term, Math.max(0, elapsed || 0));
  const remaining = Math.max(0, term - used);
  const year = Math.floor(used / 12) + 1;
  const month = (used % 12) + 1;
  summary.textContent = `You are approximately in year ${year}, month ${month}. ${remaining} months (${(remaining / 12).toFixed(1)} years) remain on the original ${term}-month term.`;
}

function populateLinkedPropertySelect() {
  const select = $('#linkedPropertySelect');
  if (!select || !state.summary) return;
  const selected = select.value;
  select.replaceChildren(new Option('Not linked', ''));
  state.summary.accounts.filter((account) => account.account_type === 'property')
    .forEach((account) => select.add(new Option(account.name, account.id)));
  select.value = selected;
}

function renderSettings() {
  $('#providerLabel').textContent = `${state.settings.marketDataProvider} · ${state.settings.aiProvider}`;
  $('#aggregationBadge').textContent = state.settings.plaid.enabled ? 'Plaid enabled' : 'Manual + CSV';
  $('#plaidMessage').textContent = state.settings.plaid.message;
  $('#skillCount').textContent = `${state.settings.enabledSkills.length} skills`;
  $('#disclaimerBox').textContent = `${state.settings.disclaimer.title}: ${state.settings.disclaimer.text}`;
}

async function loadDashboard() {
  const [summary, settings] = await Promise.all([api('/api/dashboard/summary'), api('/api/settings')]);
  state.summary = summary;
  state.settings = settings;
  try { state.projection = await api('/api/retirement/projection'); } catch (error) { state.projection = null; showAlert(error.message); }
  renderOverview();
  renderAccounts();
  renderSettings();
  populateRetirementForm();
  renderProjection();
  populateLinkedPropertySelect();
  await loadScenarioHistory();
  document.dispatchEvent(new CustomEvent('nirvana:data-loaded', { detail: state }));
}

async function loadScenarioHistory() {
  const history = await api('/api/scenarios');
  const container = $('#scenarioHistory');
  container.replaceChildren();
  if (!history.length) {
    container.innerHTML = '<div class="empty-inline">No saved scenarios yet.</div>';
    return;
  }
  history.slice(0, 10).forEach((scenario) => {
    const result = scenario.result || {};
    const row = document.createElement('div');
    row.className = 'scenario-row';
    row.innerHTML = `<strong>${escapeHtml(scenario.name)}</strong><span>${escapeHtml(scenario.scenario_type.replace('_', ' '))}</span><span>${result.targetScenarioDelta == null ? '—' : money.format(result.targetScenarioDelta)}</span><small class="muted">${new Date(scenario.created_at).toLocaleDateString()}</small>`;
    container.append(row);
  });
}

function renderScenario(result) {
  $('#scenarioEmpty').classList.add('hidden');
  const container = $('#scenarioResult');
  container.classList.remove('hidden');
  const positive = result.targetScenarioDelta >= 0;
  container.innerHTML = `
    <div class="result-callout ${positive ? '' : 'negative'}"><span>Portfolio change at target</span><h2>${positive ? '+' : ''}${money.format(result.targetScenarioDelta)}</h2><small>${escapeHtml(result.symbol)} at ${money.format(result.targetPrice)}; target is user-defined, not a forecast.</small></div>
    <div class="result-metrics">
      <div class="result-metric"><span>Portfolio now</span><strong>${money.format(result.portfolioBefore)}</strong></div>
      <div class="result-metric"><span>At target</span><strong>${money.format(result.portfolioAtTarget)}</strong></div>
      <div class="result-metric"><span>Cash after trade</span><strong>${money.format(result.cashAfter)}</strong></div>
      <div class="result-metric"><span>${escapeHtml(result.symbol)} allocation at target</span><strong>${result.allocationAtTargetPct}%</strong></div>
    </div>
    <p class="mini-disclaimer">${result.concentrationFlag ? 'Concentration flag: this holding reaches at least 25% of the modeled portfolio. ' : ''}${result.assumptions.join(' ')}</p>`;
}

function createMessage(container, role, text) {
  if (!container) return null;
  const message = document.createElement('div');
  message.className = `${role === 'user' ? 'user-message' : 'assistant-message'} message`;
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'You' : 'Nirvana';
  const body = document.createElement('p');
  body.textContent = text;
  message.append(label, body);
  container.append(message);
  container.scrollTop = container.scrollHeight;
  return message;
}

function appendMessage(role, text) {
  const main = createMessage($('#chatMessages'), role, text);
  const drawer = createMessage($('#assistantMessages'), role, text);
  if (main) main.mirrorMessage = drawer;
  return main || drawer;
}

function updateMessage(message, text) {
  if (!message) return;
  const body = message.querySelector('p');
  if (body) body.textContent = text;
  const mirrorBody = message.mirrorMessage?.querySelector('p');
  if (mirrorBody) mirrorBody.textContent = text;

  const mainContainer = message.parentElement;
  const drawerContainer = message.mirrorMessage?.parentElement;
  if (mainContainer) mainContainer.scrollTop = mainContainer.scrollHeight;
  if (drawerContainer) drawerContainer.scrollTop = drawerContainer.scrollHeight;
}

function setAssistantConversationMode(active = true) {
  const intro = $('#assistantIntro');
  const toggle = $('#assistantSuggestionsToggle');
  if (!intro || !toggle) return;

  intro.classList.toggle('collapsed', active);
  toggle.classList.toggle('hidden', !active);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Suggested questions';
}

function toggleAssistantSuggestions() {
  const intro = $('#assistantIntro');
  const toggle = $('#assistantSuggestionsToggle');
  if (!intro || !toggle) return;

  const opening = intro.classList.contains('collapsed');
  intro.classList.toggle('collapsed', !opening);
  toggle.setAttribute('aria-expanded', String(opening));
  toggle.textContent = opening ? 'Hide suggested questions' : 'Suggested questions';
}

async function askNirvana(text, button) {
  setAssistantConversationMode(true);
  appendMessage('user', text);
  if (button) button.disabled = true;
  const pending = appendMessage('assistant', 'Researching and grounding the response…');
  try {
    const response = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, threadId: state.threadId || undefined })
    });
    state.threadId = response.threadId;
    updateMessage(pending, response.message);
    renderResearchChart(response.chart);
    renderSources(response.sources);
    if (response.agents?.length) $('#skillCount').textContent = `${response.agents.length} agents active`;
    $('#disclaimerBox').textContent = `${response.disclaimer.title}: ${response.disclaimer.text} ${response.disclaimer.marketDataNotice}`;
  } catch (error) {
    updateMessage(pending, `I could not complete that request: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderResearchChart(chart) {
  if (!chart || typeof Chart === 'undefined') return;
  $('#researchChartEmpty').classList.add('hidden');
  $('#researchChartWrap').classList.remove('hidden');
  $('#researchChartTitle').textContent = chart.title;
  const colors = chartDefaults();
  destroyChart('research');
  state.charts.research = new Chart($('#researchChart'), {
    type: chart.type || 'line',
    data: {
      labels: chart.labels,
      datasets: chart.datasets.map((dataset) => ({
        ...dataset,
        borderColor: colors.accent,
        backgroundColor: colors.accentPale,
        borderWidth: 2.5,
        pointRadius: chart.labels.length > 70 ? 0 : 1.5,
        fill: true,
        tension: .25
      }))
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false } }, scales: standardScales(true) }
  });
}

function renderSources(sources = []) {
  const container = $('#researchSources');
  container.replaceChildren();
  sources.forEach((source) => {
    const item = document.createElement('div');
    item.className = 'source-item';
    const label = `${source.id ? `[${source.id}] ` : ''}${source.title || source.name}`;
    const details = document.createElement('small');
    details.textContent = `${source.name}${source.type ? ` · ${source.type}` : ''}${source.dataAsOf ? ` · data as of ${source.dataAsOf}` : ''}`;
    if (source.url) {
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      item.append(link, details);
    } else {
      const strong = document.createElement('strong');
      strong.textContent = label;
      item.append(strong, details);
    }
    container.append(item);
  });
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function initialize() {
  try {
    state.auth = await api('/api/auth/status');
    if (!state.auth.authenticated) return window.location.replace('/');
    $('#userLabel').textContent = state.auth.user?.displayName || state.auth.user?.email || 'Nirvana user';
    await loadDashboard();
  } catch (error) {
    showAlert(error.message);
  }

  setSidebarCollapsed(localStorage.getItem('nirvana.sidebarCollapsed') === '1');
  $('#sidebarToggle').addEventListener('click', () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed')));
  $$('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-view-link]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
  $('#refreshButton').addEventListener('click', async () => {
    try { await loadDashboard(); } catch (error) { showAlert(error.message); }
  });
  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { window.location.href = '/'; }
  });

  $('#retirementForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const values = formObject(event.currentTarget);
      await api('/api/retirement/plan', {
        method: 'PUT',
        body: JSON.stringify({
          currentAge: values.currentAge,
          retirementAge: values.retirementAge,
          planEndAge: values.planEndAge,
          annualContribution: values.annualContribution,
          annualRetirementSpending: values.annualRetirementSpending,
          expectedReturn: Number(values.expectedReturnPct) / 100,
          volatility: Number(values.volatilityPct) / 100,
          inflation: Number(values.inflationPct) / 100,
          successThreshold: Number(values.successThresholdPct) / 100,
          maxSearchAge: values.maxSearchAge,
          effectiveTaxRate: Number(values.effectiveTaxRatePct) / 100
        })
      });
      await loadDashboard();
    } catch (error) { showAlert(error.message); } finally { button.disabled = false; }
  });

  $('#scenarioForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const values = formObject(event.currentTarget);
      const payload = {
        action: values.action,
        symbol: values.symbol,
        targetPrice: values.targetPrice
      };
      ['quantity', 'amount', 'executionPrice'].forEach((key) => { if (values[key]) payload[key] = values[key]; });
      const result = await api('/api/scenarios/trade', { method: 'POST', body: JSON.stringify(payload) });
      renderScenario(result);
      await loadScenarioHistory();
    } catch (error) { showAlert(error.message); } finally { button.disabled = false; }
  });

  $('#accountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      const editing = Boolean(state.editingAccountId);
      const values = formObject(form);
      const payload = {
        name: values.name,
        institution: values.institution,
        accountType: values.accountType,
        currentBalance: values.currentBalance,
        currency: 'USD',
        projectionMethod: isInvestmentType(values.accountType) ? values.projectionMethod : 'profile'
      };
      if (isInvestmentType(values.accountType)) {
        payload.investmentStyle = values.investmentStyle;
        payload.expectedReturn = Number(values.expectedReturnPct) / 100;
        payload.expectedVolatility = Number(values.expectedVolatilityPct) / 100;
      }
      if (values.accountType === 'property') {
        payload.isPrimaryResidence = form.isPrimaryResidence.checked;
        payload.retirementTreatment = values.retirementTreatment;
        payload.retirementTreatmentAge = values.retirementTreatmentAge || null;
        payload.retirementCashRelease = values.retirementCashRelease || null;
        payload.propertyGrowthRate = Number(values.propertyGrowthRatePct || 3) / 100;
      }
      const savedAccount = await api(
        editing ? `/api/accounts/${state.editingAccountId}` : '/api/accounts',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        }
      );
      resetAccountEditor();
      await loadDashboard();
      if (savedAccount?.requiresPortfolioSetup || savedAccount?.projection_method === 'holdings_monte_carlo') {
        document.dispatchEvent(new CustomEvent('nirvana:open-portfolio', { detail: { accountId: savedAccount.id } }));
        showAlert('Account saved. Add its stocks or ETFs below, then calculate Monte Carlo growth.');
      } else {
        showAlert(editing ? 'Asset updated.' : 'Asset added.');
      }
    } catch (error) { showAlert(error.message); } finally { button.disabled = false; }
  });

  $('#accountCancelEdit').addEventListener('click', resetAccountEditor);
  $('#accountType').addEventListener('change', () => {
    refreshInvestmentProfile(true);
    refreshPropertyProfile(true);
  });
  $('#investmentStyle').addEventListener('change', () => refreshInvestmentProfile(true));
  $('#projectionMethod').addEventListener('change', () => refreshInvestmentProfile(false));
  $('#retirementTreatment').addEventListener('change', () => refreshPropertyProfile(false));

  $('#liabilityForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      const editing = Boolean(state.editingLiabilityId);
      const values = formObject(form);
      const payload = {
        name: values.name,
        institution: values.institution || null,
        liabilityType: values.liabilityType,
        originalAmount: values.originalAmount || null,
        currentBalance: values.currentBalance,
        interestRate: values.interestRatePct === '' ? null : Number(values.interestRatePct) / 100,
        originalTermMonths: values.originalTermMonths || null,
        loanStartDate: values.loanStartDate || null,
        currentTermMonth: values.currentTermMonth || null,
        principalInterestPayment: values.liabilityType === 'mortgage' ? (values.principalInterestPayment || null) : null,
        propertyTaxPayment: values.liabilityType === 'mortgage' ? (values.propertyTaxPayment || null) : null,
        homeInsurancePayment: values.liabilityType === 'mortgage' ? (values.homeInsurancePayment || null) : null,
        pmiPayment: values.liabilityType === 'mortgage' ? (values.pmiPayment || null) : null,
        hoaPayment: values.liabilityType === 'mortgage' ? (values.hoaPayment || null) : null,
        otherEscrowPayment: values.liabilityType === 'mortgage' ? (values.otherEscrowPayment || null) : null,
        minimumPayment: values.monthlyPayment || null,
        monthlyPayment: values.monthlyPayment || null,
        payoffAge: values.payoffAge || null,
        linkedAccountId: values.linkedAccountId || null
      };

      await api(
        editing ? `/api/accounts/liabilities/${state.editingLiabilityId}` : '/api/accounts/liabilities',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        }
      );
      resetLiabilityEditor();
      await loadDashboard();
      showAlert(editing ? 'Liability updated.' : 'Liability added.');
    } catch (error) { showAlert(error.message); } finally { button.disabled = false; }
  });

  $('#liabilityCancelEdit').addEventListener('click', resetLiabilityEditor);
  ['liabilityType','originalTermMonths','loanStartDate','currentTermYear','currentTermMonthInYear','principalInterestPayment','propertyTaxPayment','homeInsurancePayment','pmiPayment','hoaPayment','otherEscrowPayment']
    .forEach((name) => $('#liabilityForm')[name]?.addEventListener('input', refreshLoanForm));
  refreshLoanForm();

  $('#csvForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await api('/api/accounts/holdings/import', { method: 'POST', body: new FormData(form) });
      showAlert(`Imported ${result.imported} holding${result.imported === 1 ? '' : 's'}.`);
      form.reset();
      await loadDashboard();
    } catch (error) { showAlert(error.message); } finally { button.disabled = false; }
  });

  $$('.prompt-chips button').forEach((button) => button.addEventListener('click', () => {
    $('#chatForm').message.value = button.dataset.prompt;
    $('#chatForm').message.focus();
  }));

  $('#chatForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = form.message.value.trim();
    if (!text) return;
    form.message.value = '';
    await askNirvana(text, event.submitter);
  });

  const setAssistantOpen = (open) => {
    $('#assistantDrawer').classList.toggle('open', open);
    document.body.classList.toggle('assistant-open', open);
  };
  $('#assistantToggle').addEventListener('click', () => setAssistantOpen(true));
  $('#assistantFab').addEventListener('click', () => setAssistantOpen(true));
  $('#assistantClose').addEventListener('click', () => setAssistantOpen(false));
  $('#assistantSuggestionsToggle').addEventListener('click', toggleAssistantSuggestions);

  $$('[data-assistant-prompt]').forEach((button) => button.addEventListener('click', () => {
    $('#assistantForm').message.value = button.dataset.assistantPrompt;
    $('#assistantForm').message.focus();
  }));

  $('#assistantForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = form.message.value.trim();
    if (!text) return;
    form.message.value = '';
    await askNirvana(text, event.submitter);
  });
}

window.nirvanaState = state;
window.nirvanaApi = api;
window.askNirvana = askNirvana;
window.openNirvanaAssistant = (prompt = '') => {
  $('#assistantDrawer').classList.add('open');
  document.body.classList.add('assistant-open');
  if (prompt) {
    $('#assistantForm').message.value = prompt;
    $('#assistantForm').message.focus();
  }
};
window.loadNirvanaDashboard = loadDashboard;
window.showNirvanaAlert = showAlert;
document.addEventListener('DOMContentLoaded', initialize);
