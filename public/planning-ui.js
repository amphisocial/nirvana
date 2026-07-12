(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const charts = {};
  let planning = { incomes: [], expenses: [], metrics: {} };
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
      line: style.getPropertyValue('--line').trim()
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
    form.notes.value = item.notes || '';
    q('#expenseFormTitle').textContent = 'Edit expense';
    q('#expenseSubmitButton').textContent = 'Save changes';
    q('#expenseCancelEdit').classList.remove('hidden');
    togglePostRetirementFields();
    form.name.focus();
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
      meta.textContent = `${String(item.income_type).replaceAll('_', ' ')} · ${item.ends_at_retirement ? 'ends at retirement' : 'continues by age range'}`;
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
      meta.textContent = `${String(item.category).replaceAll('_', ' ')} · ${retirementBehaviorLabel(item.retirement_behavior)}${end}`;
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
            { label: 'Expenses', data: projection.cashflowTimeline.map((row) => row.monthlyExpenses), borderColor: colors.sand, backgroundColor: colors.sand, borderWidth: 2.5, pointRadius: 0, tension: .25 },
            { label: 'Portfolio withdrawal', data: projection.cashflowTimeline.map((row) => row.monthlyPortfolioWithdrawal), borderColor: colors.ink, backgroundColor: colors.ink, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .25 }
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
            { label: 'Monthly expenses', data: projection.cashflowTimeline.map((row) => row.monthlyExpenses), borderColor: colors.sand, backgroundColor: colors.sand, borderWidth: 3, pointRadius: 0, fill: false, tension: .25 }
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

  async function loadPlanningSummary() {
    planning = await request('/api/planning/summary');
    renderPlanningMetrics();
    renderIncomeList();
    renderExpenseList();
  }

  async function refreshEverything() {
    if (window.loadNirvanaDashboard) await window.loadNirvanaDashboard();
    await loadPlanningSummary();
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
      notes: form.notes.value || null
    };
  }

  document.addEventListener('nirvana:data-loaded', (event) => {
    renderRetirementEnhancements(event.detail);
    loadPlanningSummary().catch((error) => alertUser(error.message));
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
