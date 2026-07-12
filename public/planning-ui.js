(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const charts = {};
  let planning = { incomes: [], expenses: [], accounts: [], metrics: {} };
  let netWorthProjection = null;
  let editingIncomeId = null;
  let editingExpenseId = null;

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
    q('#expenseFormTitle').textContent = 'Add monthly expense';
    q('#expenseSubmitButton').textContent = 'Add expense';
    q('#expenseCancelEdit').classList.add('hidden');
    togglePostRetirementFields();
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


  function linkedAccountName(id) {
    if (!id) return 'default cash account';
    return planning.accounts.find((account) => account.id === id)?.name || 'linked account';
  }

  function populateCashflowAccountSelects() {
    const selects = [
      [q('#incomeDepositAccountSelect'), 'Use default cash account'],
      [q('#expensePaymentAccountSelect'), 'Use default cash account']
    ];
    for (const [select, placeholder] of selects) {
      if (!select) continue;
      const selected = select.value;
      select.replaceChildren(new Option(placeholder, ''));
      for (const account of planning.accounts || []) {
        if (account.account_type === 'property' || account.account_type === 'other_asset') continue;
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
    planning.incomes.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cashflow-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.name;
      const meta = document.createElement('small');
      meta.textContent = `${String(item.income_type).replaceAll('_', ' ')} · ${item.ends_at_retirement ? 'ends at retirement' : 'continues by age range'} · deposits to ${linkedAccountName(item.deposit_account_id)}`;
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
    planning.expenses.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cashflow-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.name;
      const meta = document.createElement('small');
      const end = item.end_age == null ? '' : ` · ends age ${item.end_age}`;
      meta.textContent = `${String(item.category).replaceAll('_', ' ')} · ${retirementBehaviorLabel(item.retirement_behavior)}${end} · paid from ${linkedAccountName(item.payment_account_id)}`;
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

  function renderPlanningMetrics() {
    const metrics = planning.metrics || {};
    q('#currentIncomeMetric').textContent = currency.format(metrics.currentMonthlyIncome || 0);
    q('#currentExpenseMetric').textContent = currency.format(metrics.currentMonthlyExpenses || 0);
    q('#currentSurplusMetric').textContent = currency.format(metrics.currentMonthlySurplus || 0);
    q('#retirementGapMetric').textContent = currency.format(metrics.retirementMonthlyGap || 0);
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
            { label: 'Monthly expenses', data: projection.cashflowTimeline.map((row) => row.monthlyExpenses), borderColor: colors.blueLight, backgroundColor: colors.blueLight, borderWidth: 3, pointRadius: 0, fill: false, tension: .25 }
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
          { type: 'line', label: 'Net cash flow', data: projection.timeline.map((row) => row.annualNetCashFlow), borderColor: '#183f66', backgroundColor: '#183f66', borderWidth: 2.5, pointRadius: 0, tension: .2, yAxisID: 'yCash' }
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
      inflationRate: Number(form.inflationRatePct.value || 0) / 100,
      essential: form.essential.checked,
      paymentAccountId: form.paymentAccountId.value || null,
      notes: form.notes.value || null
    };
  }

  document.addEventListener('nirvana:data-loaded', (event) => {
    renderRetirementEnhancements(event.detail);
    Promise.all([loadPlanningSummary(), loadNetWorthProjection()]).catch((error) => alertUser(error.message));
  });

  document.addEventListener('DOMContentLoaded', () => {
    q('#retirementBehavior').addEventListener('change', togglePostRetirementFields);
    q('#incomeCancelEdit').addEventListener('click', resetIncomeForm);
    q('#expenseCancelEdit').addEventListener('click', resetExpenseForm);

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

    q('#retirementForm').addEventListener('submit', () => {
      window.setTimeout(() => refreshEverything().catch((error) => alertUser(error.message)), 700);
    });

    resetIncomeForm();
    resetExpenseForm();
  });
})();
