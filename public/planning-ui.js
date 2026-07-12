(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const charts = {};
  let planning = { incomes: [], expenses: [], accounts: [], metrics: {} };
  let netWorthProjection = null;
  let latestRetirementProjection = null;
  let editingIncomeId = null;
  let editingExpenseId = null;
  let editingContributionId = null;

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const details = payload?.details?.map((item) => `${item.path}: ${item.message}`).join('; ');
      throw new Error(details || payload?.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  function alertUser(message) {
    if (window.showNirvanaAlert) window.showNirvanaAlert(message);
    else window.alert(message);
  }

  function destroyChart(name) {
    charts[name]?.destroy();
    delete charts[name];
  }

  function chartColors() {
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
      blueLight: style.getPropertyValue('--blue-light').trim() || '#83b9ed',
      bluePale: style.getPropertyValue('--blue-pale').trim() || '#dceeff',
      slate: style.getPropertyValue('--blue-slate').trim() || '#486581'
    };
  }

  function retirementBehaviorLabel(value) {
    return {
      same: 'continues in retirement',
      ends: 'ends at retirement',
      custom: 'changes at retirement',
      starts: 'starts at retirement'
    }[value] || value;
  }

  function createActionButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }


  function appendMonthlyListTotal(container, label, description, items, amountKey = 'annual_amount') {
    const monthlyTotal = items.reduce((sum, item) => {
      if (amountKey === 'monthly_amount') return sum + Number(item.monthly_amount || 0);
      return sum + Number(item[amountKey] || 0) / 12;
    }, 0);
    const row = document.createElement('div');
    row.className = 'cashflow-row cashflow-total-row';
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = label;
    const meta = document.createElement('small');
    meta.textContent = description;
    details.append(title, meta);
    const trailing = document.createElement('div');
    trailing.className = 'cashflow-row-trailing';
    const amount = document.createElement('strong');
    amount.textContent = `${currency.format(monthlyTotal)}/mo`;
    trailing.append(amount);
    row.append(details, trailing);
    container.append(row);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : '';
  }

  function scheduleRangeLabel(item) {
    const start = formatDate(item.start_date);
    const end = formatDate(item.end_date);
    if (start && end) return `${start}–${end}`;
    if (start) return `starts ${start}`;
    if (end) return `through ${end}`;
    if (item.start_age != null || item.end_age != null) {
      const from = item.start_age == null ? '' : `age ${item.start_age}`;
      const to = item.end_age == null ? '' : `age ${item.end_age}`;
      return from && to ? `${from}–${to}` : (from || `through ${to}`);
    }
    return 'ongoing';
  }

  function resetIncomeForm() {
    editingIncomeId = null;
    const form = q('#incomeForm');
    form.reset();
    form.frequency.value = 'monthly';
    form.inflationRatePct.value = '0';
    form.taxable.checked = true;
    form.depositAccountId.value = '';
    q('#incomeFormTitle').textContent = 'Add income source';
    q('#incomeSubmitButton').textContent = 'Add income';
    q('#incomeCancelEdit').classList.add('hidden');
  }

  function resetExpenseForm() {
    editingExpenseId = null;
    const form = q('#expenseForm');
    form.reset();
    form.frequency.value = 'monthly';
    form.postRetirementFrequency.value = 'monthly';
    form.inflationRatePct.value = '2.5';
    form.essential.checked = true;
    form.paymentAccountId.value = '';
    form.fundingPolicy.value = 'linked_then_liquid';
    q('#expenseFormTitle').textContent = 'Add monthly expense';
    q('#expenseSubmitButton').textContent = 'Add expense';
    q('#expenseCancelEdit').classList.add('hidden');
    togglePostRetirementFields();
  }

  function resetContributionForm() {
    editingContributionId = null;
    const form = q('#contributionForm');
    if (!form) return;
    form.reset();
    form.contributionType.value = 'transfer';
    form.frequency.value = 'monthly';
    form.annualIncreaseRatePct.value = '0';
    q('#contributionFormTitle').textContent = 'Add planned contribution';
    q('#contributionSubmitButton').textContent = 'Add contribution';
    q('#contributionCancelEdit').classList.add('hidden');
    toggleContributionSource();
  }

  function editIncome(id) {
    const item = planning.incomes.find((row) => row.id === id);
    if (!item) return;
    editingIncomeId = id;
    const form = q('#incomeForm');
    form.name.value = item.name || '';
    form.incomeType.value = item.income_type || 'other';
    form.amount.value = Number(item.amount || 0).toFixed(2);
    form.frequency.value = item.frequency || 'monthly';
    form.startAge.value = item.start_age ?? '';
    form.endAge.value = item.end_age ?? '';
    form.startDate.value = item.start_date ? String(item.start_date).slice(0, 10) : '';
    form.endDate.value = item.end_date ? String(item.end_date).slice(0, 10) : '';
    form.inflationRatePct.value = Number(item.inflation_rate || 0) * 100;
    form.taxable.checked = item.taxable !== false;
    form.endsAtRetirement.checked = Boolean(item.ends_at_retirement);
    form.depositAccountId.value = item.deposit_account_id || '';
    form.notes.value = item.notes || '';
    q('#incomeFormTitle').textContent = 'Edit income source';
    q('#incomeSubmitButton').textContent = 'Save changes';
    q('#incomeCancelEdit').classList.remove('hidden');
    form.name.focus();
  }

  function editExpense(id) {
    const item = planning.expenses.find((row) => row.id === id);
    if (!item) return;
    editingExpenseId = id;
    const form = q('#expenseForm');
    form.name.value = item.name || '';
    form.category.value = item.category || 'other';
    form.amount.value = Number(item.amount || 0).toFixed(2);
    form.frequency.value = item.frequency || 'monthly';
    form.retirementBehavior.value = item.retirement_behavior || 'same';
    form.postRetirementAmount.value = item.post_retirement_amount == null ? '' : Number(item.post_retirement_amount).toFixed(2);
    form.postRetirementFrequency.value = item.post_retirement_frequency || 'monthly';
    form.startAge.value = item.start_age ?? '';
    form.endAge.value = item.end_age ?? '';
    form.startDate.value = item.start_date ? String(item.start_date).slice(0, 10) : '';
    form.endDate.value = item.end_date ? String(item.end_date).slice(0, 10) : '';
    form.fundingPolicy.value = item.funding_policy || 'linked_then_liquid';
    form.inflationRatePct.value = Number(item.inflation_rate || 0) * 100;
    form.essential.checked = item.essential !== false;
    form.paymentAccountId.value = item.payment_account_id || '';
    form.notes.value = item.notes || '';
    q('#expenseFormTitle').textContent = 'Edit expense';
    q('#expenseSubmitButton').textContent = 'Save changes';
    q('#expenseCancelEdit').classList.remove('hidden');
    togglePostRetirementFields();
    form.name.focus();
  }


  function editContribution(id) {
    const item = (planning.contributions || []).find((row) => row.id === id);
    if (!item) return;
    editingContributionId = id;
    const form = q('#contributionForm');
    form.name.value = item.name || '';
    form.contributionType.value = item.contribution_type || 'transfer';
    form.sourceAccountId.value = item.source_account_id || '';
    form.targetAccountId.value = item.target_account_id || '';
    form.amount.value = Number(item.amount || 0).toFixed(2);
    form.frequency.value = item.frequency || 'monthly';
    form.startDate.value = item.start_date ? String(item.start_date).slice(0, 10) : '';
    form.endDate.value = item.end_date ? String(item.end_date).slice(0, 10) : '';
    form.annualIncreaseRatePct.value = Number(item.annual_increase_rate || 0) * 100;
    form.notes.value = item.notes || '';
    q('#contributionFormTitle').textContent = 'Edit planned contribution';
    q('#contributionSubmitButton').textContent = 'Save changes';
    q('#contributionCancelEdit').classList.remove('hidden');
    toggleContributionSource();
    form.name.focus();
  }

  function toggleContributionSource() {
    const form = q('#contributionForm');
    if (!form) return;
    const isTransfer = form.contributionType.value === 'transfer';
    q('#contributionSourceLabel').classList.toggle('hidden', !isTransfer);
    form.sourceAccountId.required = isTransfer;
    if (!isTransfer) form.sourceAccountId.value = '';
  }

  function linkedAccountName(id) {
    if (!id) return 'default cash account';
    return planning.accounts.find((account) => account.id === id)?.name || 'linked account';
  }

  function populateCashflowAccountSelects() {
    const selects = [
      [q('#incomeDepositAccountSelect'), 'Use default cash account', () => true],
      [q('#expensePaymentAccountSelect'), 'Use default cash account', () => true],
      [q('#contributionSourceAccountSelect'), 'Choose source account', (account) => !['property', 'other_asset'].includes(account.account_type)],
      [q('#contributionTargetAccountSelect'), 'Choose 529, IRA, 401(k), brokerage, or HSA', (account) => ['529', 'ira', '401k', 'retirement', 'brokerage', 'hsa'].includes(account.account_type)]
    ];
    for (const [select, placeholder, allow] of selects) {
      if (!select) continue;
      const selected = select.value;
      select.replaceChildren(new Option(placeholder, ''));
      for (const account of planning.accounts || []) {
        if (allow && !allow(account)) continue;
        if (!allow && (account.account_type === 'property' || account.account_type === 'other_asset')) continue;
        select.add(new Option(`${account.name} · ${String(account.account_type).replaceAll('_', ' ')}`, account.id));
      }
      select.value = selected;
    }
  }

  function renderIncomeList() {
    const container = q('#incomeList');
    container.replaceChildren();
    if (!planning.incomes.length) {
      container.innerHTML = '<div class="empty-inline">Add salary, Social Security, pension, rental, or other income.</div>';
      return;
    }
    appendMonthlyListTotal(container, 'Total monthly income', 'All income sources shown below', planning.incomes);
    planning.incomes.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cashflow-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.name;
      const meta = document.createElement('small');
      meta.textContent = `${String(item.income_type).replaceAll('_', ' ')} · ${scheduleRangeLabel(item)} · ${item.ends_at_retirement ? 'ends at retirement' : 'continues by schedule'} · deposits to ${linkedAccountName(item.deposit_account_id)}`;
      details.append(title, meta);
      const trailing = document.createElement('div');
      trailing.className = 'cashflow-row-trailing';
      const amount = document.createElement('strong');
      amount.textContent = `${currency.format(Number(item.annual_amount || 0) / 12)}/mo`;
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        createActionButton('Edit', 'row-action', () => editIncome(item.id)),
        createActionButton('Delete', 'row-action danger', async () => {
          if (!window.confirm(`Delete "${item.name}"?`)) return;
          try {
            await request(`/api/planning/incomes/${item.id}`, { method: 'DELETE' });
            await refreshEverything();
            alertUser('Income source deleted.');
          } catch (error) { alertUser(error.message); }
        })
      );
      trailing.append(amount, actions);
      row.append(details, trailing);
      container.append(row);
    });
  }

  function renderExpenseList() {
    const container = q('#expenseList');
    container.replaceChildren();
    if (!planning.expenses.length) {
      container.innerHTML = '<div class="empty-inline">Add housing, healthcare, travel, food, and other recurring expenses.</div>';
      return;
    }
    appendMonthlyListTotal(container, 'Total monthly expenses', 'All recurring expenses shown below', planning.expenses);
    planning.expenses.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cashflow-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.name;
      const meta = document.createElement('small');
      const funding = item.funding_policy === 'linked_only' ? 'selected account only' : 'selected account, then liquid assets';
      meta.textContent = `${String(item.category).replaceAll('_', ' ')} · ${scheduleRangeLabel(item)} · ${retirementBehaviorLabel(item.retirement_behavior)} · paid from ${linkedAccountName(item.payment_account_id)} · ${funding}`;
      details.append(title, meta);
      const trailing = document.createElement('div');
      trailing.className = 'cashflow-row-trailing';
      const amount = document.createElement('strong');
      amount.textContent = `${currency.format(Number(item.annual_amount || 0) / 12)}/mo`;
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      if (item.derived_from_liability) {
        const badge = document.createElement('span');
        badge.className = 'derived-badge';
        badge.textContent = 'From liability';
        actions.append(badge);
      } else {
        actions.append(
          createActionButton('Edit', 'row-action', () => editExpense(item.id)),
          createActionButton('Delete', 'row-action danger', async () => {
            if (!window.confirm(`Delete \"${item.name}\"?`)) return;
            try {
              await request(`/api/planning/expenses/${item.id}`, { method: 'DELETE' });
              await refreshEverything();
              alertUser('Expense deleted.');
            } catch (error) { alertUser(error.message); }
          })
        );
      }
      trailing.append(amount, actions);
      row.append(details, trailing);
      container.append(row);
    });
  }

  function renderContributionList() {
    const container = q('#contributionList');
    if (!container) return;
    container.replaceChildren();
    const contributions = planning.contributions || [];
    if (!contributions.length) {
      container.innerHTML = '<div class="empty-inline">Add recurring deposits to a 529, IRA, 401(k), brokerage, or HSA.</div>';
      return;
    }
    appendMonthlyListTotal(
      container,
      'Total scheduled contributions',
      'Monthly equivalent of all schedules shown below',
      contributions,
      'monthly_amount'
    );
    for (const item of contributions) {
      const row = document.createElement('div');
      row.className = 'cashflow-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.name;
      const meta = document.createElement('small');
      const source = item.contribution_type === 'transfer'
        ? linkedAccountName(item.source_account_id)
        : item.contribution_type.replaceAll('_', ' ');
      meta.textContent = `${source} → ${linkedAccountName(item.target_account_id)} · ${scheduleRangeLabel(item)} · ${(Number(item.annual_increase_rate || 0) * 100).toFixed(1)}% annual increase`;
      details.append(title, meta);
      const trailing = document.createElement('div');
      trailing.className = 'cashflow-row-trailing';
      const amount = document.createElement('strong');
      amount.textContent = `${currency.format(Number(item.monthly_amount || 0))}/mo`;
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        createActionButton('Edit', 'row-action', () => editContribution(item.id)),
        createActionButton('Delete', 'row-action danger', async () => {
          if (!window.confirm(`Delete "${item.name}"?`)) return;
          try {
            await request(`/api/planning/contributions/${item.id}`, { method: 'DELETE' });
            await refreshEverything();
            alertUser('Contribution schedule deleted.');
          } catch (error) { alertUser(error.message); }
        })
      );
      trailing.append(amount, actions);
      row.append(details, trailing);
      container.append(row);
    }
  }

  function renderPlanningMetrics() {
    const metrics = planning.metrics || {};
    q('#currentIncomeMetric').textContent = currency.format(metrics.currentMonthlyIncome || 0);
    q('#currentExpenseMetric').textContent = currency.format(metrics.currentMonthlyExpenses || 0);
    q('#currentSurplusMetric').textContent = currency.format(metrics.currentMonthlySurplus || 0);
    q('#retirementGapMetric').textContent = currency.format(metrics.retirementMonthlyGap || 0);
    q('#currentContributionMetric').textContent = currency.format(metrics.currentMonthlyContributions || 0);
  }

  function populateLinkedProperties(summary) {
    const select = q('#linkedPropertySelect');
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option('Not linked', ''));
    for (const account of summary?.accounts || []) {
      if (account.account_type === 'property') select.add(new Option(account.name, account.id));
    }
    select.value = selected;
  }

  function populateAdvancedPlanFields(summary) {
    const form = q('#retirementForm');
    const plan = summary?.retirementPlan;
    if (!form || !plan) return;
    form.successThresholdPct.value = Number(plan.success_threshold ?? 0.90) * 100;
    form.maxSearchAge.value = plan.max_search_age ?? 75;
    form.effectiveTaxRatePct.value = Number(plan.effective_tax_rate ?? 0.15) * 100;
  }

  function renderRetirementEnhancements(state) {
    const projection = state?.projection;
    const summary = state?.summary;
    if (!projection || !summary) return;
    latestRetirementProjection = projection;

    q('#earliestFeasibleAge').textContent = projection.earliestFeasibleAge ?? 'Not reached';
    q('#earliestFeasibleCopy').textContent = projection.earliestFeasibleAge == null
      ? `No age through ${summary.retirementPlan?.max_search_age || 75} met ${projection.successThresholdPct}%`
      : `${projection.successThresholdPct}% success threshold`;
    q('#selectedAgeSuccess').textContent = `${projection.successRatePct}%`;
    q('#selectedAgeLabel').textContent = `Retire at age ${projection.retirementAge}`;
    q('#retirementExpenseMetric').textContent = currency.format(projection.monthlyExpensesAtRetirement || 0);
    q('#homeEquityRetirementMetric').textContent = currency.format(summary.metrics.homeEquity || 0);
    populateLinkedProperties(summary);
    populateAdvancedPlanFields(summary);

    const table = q('#retirementAgeTable');
    table.replaceChildren();
    const selectedAge = projection.retirementAge;
    const earliest = projection.earliestFeasibleAge;
    const rows = (projection.ageResults || []).filter((row) =>
      row.retirementAge === earliest || Math.abs(row.retirementAge - selectedAge) <= 3
    );
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.retirementAge === earliest) tr.className = 'feasible-row';
      tr.innerHTML = `<td><strong>${row.retirementAge}${row.retirementAge === earliest ? ' ✓' : ''}</strong></td><td>${row.successRatePct}%</td><td>${currency.format(row.medianAtEnd)}</td>`;
      table.append(tr);
    }

    if (typeof Chart !== 'undefined' && projection.cashflowTimeline?.length) {
      const colors = chartColors();
      const labels = projection.cashflowTimeline.map((row) => row.age);
      const exclude529 = q('#exclude529Expenses')?.checked !== false;
      const cashflowExpenseSeries = projection.cashflowTimeline.map((row) =>
        Number(row.monthlyExpenses || 0) +
        (exclude529 ? 0 : Number(row.monthly529Expenses || 0))
      );
      destroyChart('retirementCashflow');
      charts.retirementCashflow = new Chart(q('#retirementCashflowChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'After-tax income', data: projection.cashflowTimeline.map((row) => row.monthlyIncome), borderColor: colors.accent, backgroundColor: colors.accent, borderWidth: 2.5, pointRadius: 0, tension: .25 },
            { label: 'Expenses', data: projection.cashflowTimeline.map((row) => row.monthlyExpenses), borderColor: colors.blueLight, backgroundColor: colors.blueLight, borderWidth: 2.5, pointRadius: 0, tension: .25 },
            { label: 'Portfolio withdrawal', data: projection.cashflowTimeline.map((row) => row.monthlyPortfolioWithdrawal), borderColor: colors.blueDark, backgroundColor: colors.blueDark, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .25 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7 } } },
          scales: {
            x: { grid: { display: false }, title: { display: true, text: 'Age' } },
            y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
          }
        }
      });

      destroyChart('cashflow');
      charts.cashflow = new Chart(q('#cashflowChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Monthly income', data: projection.cashflowTimeline.map((row) => row.monthlyIncome), borderColor: colors.accent, backgroundColor: colors.accentPale, borderWidth: 3, pointRadius: 0, fill: false, tension: .25 },
            { label: exclude529 ? 'Monthly expenses (excl. 529)' : 'Monthly expenses', data: cashflowExpenseSeries, borderColor: colors.blueLight, backgroundColor: colors.blueLight, borderWidth: 3, pointRadius: 0, fill: false, tension: .25 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7 } } },
          scales: {
            x: { grid: { display: false }, title: { display: true, text: 'Age' } },
            y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
          }
        }
      });
    }
  }


  function renderProjectedNetWorth(projection) {
    if (!projection?.timeline?.length) return;
    netWorthProjection = projection;
    const retirement = projection.atRetirement || projection.timeline[0];
    const longevity = projection.atLongevity || projection.timeline.at(-1);
    q('#projectionRetirementAge').textContent = `(${projection.retirementAge})`;
    q('#projectionLongevityAge').textContent = `(${projection.longevityAge})`;
    q('#projectedRetirementNetWorth').textContent = currency.format(retirement?.netWorth || 0);
    q('#projectedLongevityNetWorth').textContent = currency.format(longevity?.netWorth || 0);
    q('#projectedAnnualInflow').textContent = currency.format(projection.timeline[0]?.annualInflow || 0);
    q('#projectedAnnualOutflow').textContent = currency.format(projection.timeline[0]?.annualOutflow || 0);
    q('#projectedNetCashFlow').textContent = currency.format(projection.timeline[0]?.annualNetCashFlow || 0);
    q('#projectionAssumptionNote').textContent = projection.assumptions?.[0]
      || 'Income and expenses are deposited to or withdrawn from their linked accounts.';

    if (typeof Chart === 'undefined') return;
    const colors = chartColors();
    const labels = projection.timeline.map((row) => row.year);
    destroyChart('projectedNetWorth');
    charts.projectedNetWorth = new Chart(q('#projectedNetWorthChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Savings & investments', data: projection.timeline.map((row) => row.savingsInvestments), backgroundColor: colors.blue, borderWidth: 0, stack: 'worth', yAxisID: 'yWorth' },
          { type: 'bar', label: 'Real estate', data: projection.timeline.map((row) => row.realEstate), backgroundColor: colors.blueLight, borderWidth: 0, stack: 'worth', yAxisID: 'yWorth' },
          { type: 'bar', label: 'Other assets', data: projection.timeline.map((row) => row.otherAssets), backgroundColor: colors.bluePale, borderWidth: 0, stack: 'worth', yAxisID: 'yWorth' },
          { type: 'bar', label: 'Debts', data: projection.timeline.map((row) => row.debts), backgroundColor: colors.slate, borderWidth: 0, stack: 'worth', yAxisID: 'yWorth' },
          { type: 'line', label: 'Net worth', data: projection.timeline.map((row) => row.netWorth), borderColor: colors.blueDark, backgroundColor: colors.blueDark, borderWidth: 3, pointRadius: (context) => projection.timeline[context.dataIndex]?.events?.length ? 4 : 0, pointHoverRadius: 5, tension: .25, yAxisID: 'yWorth' },
          { type: 'line', label: 'Inflow', data: projection.timeline.map((row) => row.annualInflow), borderColor: '#3d8bd4', backgroundColor: '#3d8bd4', borderDash: [5, 3], borderWidth: 2, pointRadius: 0, tension: .2, yAxisID: 'yCash' },
          { type: 'line', label: 'Outflow', data: projection.timeline.map((row) => -row.annualOutflow), borderColor: '#7aa6cf', backgroundColor: '#7aa6cf', borderDash: [2, 3], borderWidth: 2, pointRadius: 0, tension: .2, yAxisID: 'yCash' },
          { type: 'line', label: 'Net cash flow', data: projection.timeline.map((row) => row.annualNetCashFlow), borderColor: '#183f66', backgroundColor: '#183f66', borderWidth: 2.5, pointRadius: 0, tension: .2, yAxisID: 'yCash' },
          { type: 'line', label: 'Scheduled contributions', data: projection.timeline.map((row) => row.annualContributions || 0), borderColor: '#5aa3e6', backgroundColor: '#5aa3e6', borderDash: [8, 4], borderWidth: 2, pointRadius: 0, tension: .2, yAxisID: 'yCash' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: {
            label: (context) => `${context.dataset.label}: ${currency.format(context.raw)}`,
            afterBody: (items) => {
              const index = items?.[0]?.dataIndex;
              const events = projection.timeline[index]?.events || [];
              return events.length ? [`Milestone: ${events.join(' · ')}`] : [];
            }
          } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          yWorth: { stacked: true, position: 'left', grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) }, title: { display: true, text: 'Net worth' } },
          yCash: { position: 'right', grid: { display: false }, ticks: { callback: (value) => currency.format(value) }, title: { display: true, text: 'Annual cash flow' } }
        }
      }
    });
  }

  async function loadNetWorthProjection() {
    const projection = await request('/api/planning/net-worth-projection');
    renderProjectedNetWorth(projection);
  }

  async function loadPlanningSummary() {
    planning = await request('/api/planning/summary');
    populateCashflowAccountSelects();
    renderPlanningMetrics();
    renderIncomeList();
    renderExpenseList();
    renderContributionList();
  }

  async function refreshEverything() {
    if (window.loadNirvanaDashboard) await window.loadNirvanaDashboard();
    await Promise.all([loadPlanningSummary(), loadNetWorthProjection()]);
  }

  function togglePostRetirementFields() {
    const behavior = q('#expenseForm').retirementBehavior.value;
    q('#postRetirementExpenseFields').classList.toggle('hidden', !['custom', 'starts'].includes(behavior));
  }

  function incomePayload(form) {
    return {
      name: form.name.value,
      incomeType: form.incomeType.value,
      amount: form.amount.value,
      frequency: form.frequency.value,
      startAge: form.startAge.value || null,
      endAge: form.endAge.value || null,
      startDate: form.startDate.value || null,
      endDate: form.endDate.value || null,
      inflationRate: Number(form.inflationRatePct.value || 0) / 100,
      taxable: form.taxable.checked,
      endsAtRetirement: form.endsAtRetirement.checked,
      depositAccountId: form.depositAccountId.value || null,
      notes: form.notes.value || null
    };
  }

  function expensePayload(form) {
    return {
      name: form.name.value,
      category: form.category.value,
      amount: form.amount.value,
      frequency: form.frequency.value,
      retirementBehavior: form.retirementBehavior.value,
      postRetirementAmount: form.postRetirementAmount.value || null,
      postRetirementFrequency: form.postRetirementFrequency.value,
      startAge: form.startAge.value || null,
      endAge: form.endAge.value || null,
      startDate: form.startDate.value || null,
      endDate: form.endDate.value || null,
      fundingPolicy: form.fundingPolicy.value,
      inflationRate: Number(form.inflationRatePct.value || 0) / 100,
      essential: form.essential.checked,
      paymentAccountId: form.paymentAccountId.value || null,
      notes: form.notes.value || null
    };
  }

  function contributionPayload(form) {
    return {
      name: form.name.value,
      contributionType: form.contributionType.value,
      sourceAccountId: form.contributionType.value === 'transfer'
        ? (form.sourceAccountId.value || null)
        : null,
      targetAccountId: form.targetAccountId.value,
      amount: form.amount.value,
      frequency: form.frequency.value,
      startDate: form.startDate.value || null,
      endDate: form.endDate.value || null,
      annualIncreaseRate: Number(form.annualIncreaseRatePct.value || 0) / 100,
      notes: form.notes.value || null
    };
  }

  document.addEventListener('nirvana:data-loaded', (event) => {
    renderRetirementEnhancements(event.detail);
    Promise.all([loadPlanningSummary(), loadNetWorthProjection()]).catch((error) => alertUser(error.message));
  });

  document.addEventListener('DOMContentLoaded', () => {
    q('#retirementBehavior').addEventListener('change', togglePostRetirementFields);

    const exclude529Toggle = q('#exclude529Expenses');
    const cashflowChartNote = q('#cashflowChartNote');

    const update529ChartPreference = () => {
      if (!exclude529Toggle) return;

      const exclude529 = exclude529Toggle.checked;

      try {
        localStorage.setItem('nirvana.exclude529Cashflow', String(exclude529));
      } catch {
        // The chart still works when browser storage is unavailable.
      }

      if (cashflowChartNote) {
        cashflowChartNote.textContent = exclude529
          ? '529 withdrawals still reduce the 529 balance and projected net worth.'
          : '529-funded expenses are included in the household expense line.';
      }

      if (!latestRetirementProjection || !charts.cashflow) return;

      charts.cashflow.data.datasets[1].data =
        latestRetirementProjection.cashflowTimeline.map((row) =>
          Number(row.monthlyExpenses || 0) +
          (exclude529 ? 0 : Number(row.monthly529Expenses || 0))
        );

      charts.cashflow.data.datasets[1].label = exclude529
        ? 'Monthly expenses (excl. 529)'
        : 'Monthly expenses';

      charts.cashflow.update();
    };

    if (exclude529Toggle) {
      try {
        exclude529Toggle.checked =
          localStorage.getItem('nirvana.exclude529Cashflow') !== 'false';
      } catch {
        exclude529Toggle.checked = true;
      }

      exclude529Toggle.addEventListener('change', update529ChartPreference);
      update529ChartPreference();
    }
    q('#incomeCancelEdit').addEventListener('click', resetIncomeForm);
    q('#expenseCancelEdit').addEventListener('click', resetExpenseForm);
    q('#contributionCancelEdit').addEventListener('click', resetContributionForm);
    q('#contributionType').addEventListener('change', toggleContributionSource);

    q('#incomeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = event.submitter;
      button.disabled = true;
      try {
        const editing = Boolean(editingIncomeId);
        await request(editing ? `/api/planning/incomes/${editingIncomeId}` : '/api/planning/incomes', {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(incomePayload(form))
        });
        resetIncomeForm();
        await refreshEverything();
        alertUser(editing ? 'Income source updated.' : 'Income source added.');
      } catch (error) { alertUser(error.message); }
      finally { button.disabled = false; }
    });

    q('#expenseForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = event.submitter;
      button.disabled = true;
      try {
        const editing = Boolean(editingExpenseId);
        await request(editing ? `/api/planning/expenses/${editingExpenseId}` : '/api/planning/expenses', {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(expensePayload(form))
        });
        resetExpenseForm();
        await refreshEverything();
        alertUser(editing ? 'Expense updated.' : 'Expense added.');
      } catch (error) { alertUser(error.message); }
      finally { button.disabled = false; }
    });

    q('#contributionForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = event.submitter;
      button.disabled = true;
      try {
        const editing = Boolean(editingContributionId);
        await request(
          editing ? `/api/planning/contributions/${editingContributionId}` : '/api/planning/contributions',
          {
            method: editing ? 'PUT' : 'POST',
            body: JSON.stringify(contributionPayload(form))
          }
        );
        resetContributionForm();
        await refreshEverything();
        alertUser(editing ? 'Contribution schedule updated.' : 'Contribution schedule added.');
      } catch (error) { alertUser(error.message); }
      finally { button.disabled = false; }
    });

    q('#retirementForm').addEventListener('submit', () => {
      window.setTimeout(() => refreshEverything().catch((error) => alertUser(error.message)), 700);
    });

    resetIncomeForm();
    resetExpenseForm();
    resetContributionForm();
  });
})();
