(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  const charts = {};
  let context = null;
  let lastHouseholdAnalysis = null;
  let lastPortfolioAnalysis = null;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const details = payload?.details?.map((item) => `${item.path}: ${item.message}`).join('; ');
      throw new Error(details || payload?.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  function notify(message) {
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
      blueDark: style.getPropertyValue('--blue-dark').trim() || '#0b3a67',
      blue: style.getPropertyValue('--blue').trim() || '#1976c5',
      blueLight: style.getPropertyValue('--blue-light').trim() || '#83b9ed',
      bluePale: style.getPropertyValue('--blue-pale').trim() || '#dceeff',
      slate: style.getPropertyValue('--blue-slate').trim() || '#486581',
      line: style.getPropertyValue('--line').trim() || '#d8e6f2'
    };
  }

  function showTab(name) {
    $$('[data-whatif-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.whatifTab === name);
      button.setAttribute('aria-selected', String(button.dataset.whatifTab === name));
    });
    $$('.whatif-tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.whatifPanel === name);
    });
    window.setTimeout(() => Object.values(charts).forEach((chart) => chart.resize()), 50);
  }

  function populateContext() {
    const accountSelect = $('#portfolioWhatIfAccount');
    if (accountSelect) {
      accountSelect.replaceChildren(new Option('Choose a stock account', ''));
      for (const account of context?.accounts || []) {
        if (account.account_type !== 'brokerage') continue;
        accountSelect.add(new Option(`${account.name} · ${currency.format(account.current_balance)}`, account.id));
      }
      if (accountSelect.options.length > 1) accountSelect.selectedIndex = 1;
    }

    renderPortfolioComposition();
  }

  function renderPortfolioComposition() {
    if (!context) return;
    const accountId = $('#portfolioWhatIfAccount')?.value;
    const account = context.accounts.find((row) => row.id === accountId)
      || context.accounts.find((row) => row.account_type === 'brokerage');
    const holdings = (context.holdings || []).filter((row) => !account || row.account_id === account.id);
    const total = account?.current_balance || holdings.reduce((sum, row) => sum + Number(row.market_value || 0), 0);

    if ($('#portfolioAccountTotal')) $('#portfolioAccountTotal').textContent = currency.format(total);
    const table = $('#portfolioHoldingRows');
    if (table) {
      table.replaceChildren();
      if (!holdings.length) {
        table.innerHTML = '<tr><td colspan="3">No symbols saved for this account yet. Use Accounts to break the total into holdings.</td></tr>';
      } else {
        for (const row of holdings) {
          const tr = document.createElement('tr');
          const share = total > 0 ? Number(row.market_value || 0) / total : 0;
          tr.innerHTML = `<td><strong>${row.symbol}</strong></td><td>${currency.format(row.market_value || 0)}</td><td>${(share * 100).toFixed(1)}%</td>`;
          table.append(tr);
        }
      }
    }

    destroyChart('composition');
    const canvas = $('#portfolioCompositionChart');
    if (!canvas || typeof Chart === 'undefined' || !holdings.length) return;
    charts.composition = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: holdings.map((row) => row.symbol),
        datasets: [{
          data: holdings.map((row) => Number(row.market_value || 0)),
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${currency.format(ctx.raw)}` } }
        }
      }
    });
  }

  function renderAssumptions(scenario, target) {
    const container = $(target);
    if (!container) return;
    container.replaceChildren();
    const chips = [];

    for (const action of scenario?.payoffActions || []) {
      chips.push(`Age ${action.age}: pay ${action.liabilityNames?.join(', ') || 'selected debt'} from ${action.sourceAccountName || 'selected account'}`);
    }
    for (const phase of scenario?.returnPhases || []) {
      const years = phase.endOffset == null
        ? `year ${Number(phase.startOffset || 0) + 1}+`
        : `years ${Number(phase.startOffset || 0) + 1}-${Number(phase.endOffset || 0) + 1}`;
      chips.push(`${phase.scope || 'investments'} ${(Number(phase.annualReturn || 0) * 100).toFixed(1)}% · ${years}`);
    }
    for (const shock of scenario?.symbolShocks || []) {
      chips.push(`${shock.symbol} ${(Number(shock.annualReturn || 0) * 100).toFixed(1)}%`);
    }

    if (!chips.length) {
      container.innerHTML = '<span class="whatif-empty-chip">No recognized assumptions</span>';
      return;
    }

    for (const text of chips) {
      const chip = document.createElement('span');
      chip.className = 'whatif-assumption-chip';
      chip.textContent = text;
      container.append(chip);
    }
  }

  function setMetric(id, value, positiveIsGood = true) {
    const element = $(id);
    if (!element) return;
    element.textContent = currency.format(value || 0);
    element.classList.toggle('positive', positiveIsGood ? value > 0 : value < 0);
    element.classList.toggle('negative', positiveIsGood ? value < 0 : value > 0);
  }

  function renderHouseholdAnalysis(payload) {
    lastHouseholdAnalysis = payload;
    const { baseline, alternative, metrics, scenario } = payload;
    $('#whatIfScenarioTitle').textContent = scenario.title || 'What-if scenario';
    $('#whatIfScenarioSummary').textContent = scenario.summary || payload.prompt;
    $('#whatIfPersistenceNote').textContent = payload.persisted === false
      ? 'Temporary analysis only · nothing was saved'
      : 'Scenario analysis';
    renderAssumptions(scenario, '#whatIfAssumptions');

    setMetric('#whatIfDebtPaid', metrics.debtPaidFromAssets, true);
    setMetric('#whatIfExpenseReduction', metrics.monthlyExpenseReduction, true);
    setMetric('#whatIfRetirementChange', metrics.netWorthAtRetirementChange, true);
    setMetric('#whatIfEndChange', metrics.netWorthAtEndChange, true);

    $('#whatIfExpenseReductionNote').textContent = metrics.expenseReductionStartsAtAge
      ? `Starts around age ${metrics.expenseReductionStartsAtAge}`
      : 'No recurring debt-payment reduction';
    $('#whatIfShortfall').textContent = metrics.scenarioFundingShortfall > 0
      ? `Funding shortfall: ${currency.format(metrics.scenarioFundingShortfall)}`
      : 'No modeled funding shortfall';

    const colors = chartColors();
    const labels = baseline.timeline.map((row) => row.age);
    const exclude529 = $('#whatIfExclude529')?.checked !== false;
    const baselineExpenses = baseline.timeline.map((row) => exclude529 ? row.monthlyExpensesExcluding529 : row.monthlyExpenses);
    const scenarioExpenses = alternative.timeline.map((row) => exclude529 ? row.monthlyExpensesExcluding529 : row.monthlyExpenses);

    destroyChart('householdCashflow');
    charts.householdCashflow = new Chart($('#whatIfCashflowChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Income', data: alternative.timeline.map((row) => row.monthlyIncome), borderColor: colors.blue, backgroundColor: colors.blue, borderWidth: 3, pointRadius: 0, tension: .2 },
          { label: 'Baseline expenses', data: baselineExpenses, borderColor: colors.blueLight, backgroundColor: colors.blueLight, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .2 },
          { label: 'Scenario expenses', data: scenarioExpenses, borderColor: colors.blueDark, backgroundColor: colors.blueDark, borderWidth: 3, pointRadius: 0, tension: .2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Age' } },
          y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
        }
      }
    });

    destroyChart('householdNetWorth');
    charts.householdNetWorth = new Chart($('#whatIfNetWorthChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Baseline net worth', data: baseline.timeline.map((row) => row.netWorth), borderColor: colors.blueLight, backgroundColor: colors.bluePale, borderWidth: 2.5, borderDash: [5, 4], pointRadius: 0, tension: .2 },
          { label: 'Scenario net worth', data: alternative.timeline.map((row) => row.netWorth), borderColor: colors.blueDark, backgroundColor: colors.blueDark, borderWidth: 3, pointRadius: (ctx) => alternative.timeline[ctx.dataIndex]?.events?.length ? 4 : 0, tension: .2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${currency.format(ctx.raw)}`,
            afterBody: (items) => {
              const events = alternative.timeline[items?.[0]?.dataIndex]?.events || [];
              return events.length ? [`Event: ${events.join(' · ')}`] : [];
            }
          } }
        },
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Age' } },
          y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
        }
      }
    });

    destroyChart('householdDebt');
    charts.householdDebt = new Chart($('#whatIfDebtChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Baseline debt', data: baseline.timeline.map((row) => row.debt), borderColor: colors.slate, backgroundColor: colors.slate, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .2 },
          { label: 'Scenario debt', data: alternative.timeline.map((row) => row.debt), borderColor: colors.blue, backgroundColor: colors.blue, borderWidth: 3, pointRadius: 0, tension: .2 },
          { label: 'Scenario stock accounts', data: alternative.timeline.map((row) => row.stockAccounts), borderColor: colors.blueDark, backgroundColor: colors.blueDark, borderWidth: 2, pointRadius: 0, tension: .2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Age' } },
          y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
        }
      }
    });

    $('#whatIfResults').classList.remove('hidden');
    $('#whatIfEmpty').classList.add('hidden');
  }

  function renderPortfolioAnalysis(payload) {
    lastPortfolioAnalysis = payload;
    renderAssumptions(payload.scenario, '#portfolioWhatIfAssumptions');
    $('#portfolioWhatIfSummary').textContent = payload.scenario?.summary || payload.prompt;
    $('#portfolioWhatIfPersistence').textContent = 'Temporary analysis only · nothing was saved';
    setMetric('#portfolioEndingValue', payload.metrics.endingPortfolioScenario, true);
    setMetric('#portfolioValueChange', payload.metrics.endingPortfolioChange, true);
    setMetric('#portfolioNetWorthChange', payload.metrics.endingNetWorthChange, true);

    const colors = chartColors();
    const labels = payload.baselineTimeline.map((row) => row.yearOffset === 0 ? 'Now' : `Year ${row.yearOffset}`);

    destroyChart('portfolioScenario');
    charts.portfolioScenario = new Chart($('#portfolioWhatIfChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Baseline stock account', data: payload.baselineTimeline.map((row) => row.portfolioValue), borderColor: colors.blueLight, backgroundColor: colors.bluePale, borderDash: [5, 4], borderWidth: 2.5, pointRadius: 0, tension: .2 },
          { label: 'Scenario stock account', data: payload.alternativeTimeline.map((row) => row.portfolioValue), borderColor: colors.blueDark, backgroundColor: colors.blueDark, borderWidth: 3, pointRadius: 0, tension: .2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
        }
      }
    });

    destroyChart('portfolioNetWorth');
    charts.portfolioNetWorth = new Chart($('#portfolioNetWorthImpactChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Baseline household net worth', data: payload.baselineTimeline.map((row) => row.netWorth), borderColor: colors.blueLight, backgroundColor: colors.bluePale, borderDash: [5, 4], borderWidth: 2.5, pointRadius: 0, tension: .2 },
          { label: 'Scenario household net worth', data: payload.alternativeTimeline.map((row) => row.netWorth), borderColor: colors.blue, backgroundColor: colors.blue, borderWidth: 3, pointRadius: 0, tension: .2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: colors.line }, ticks: { callback: (value) => currency.format(value) } }
        }
      }
    });

    $('#portfolioWhatIfResults').classList.remove('hidden');
    $('#portfolioWhatIfEmpty').classList.add('hidden');
  }

  async function runHousehold(prompt) {
    const button = $('#runHouseholdWhatIf');
    button.disabled = true;
    button.textContent = 'Analyzing…';
    try {
      const payload = await api('/api/what-if/analyze', {
        method: 'POST',
        body: JSON.stringify({ prompt })
      });
      renderHouseholdAnalysis(payload);
    } catch (error) {
      notify(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Run what-if';
    }
  }

  async function runPortfolio(prompt) {
    const button = $('#runPortfolioWhatIf');
    button.disabled = true;
    button.textContent = 'Analyzing…';
    try {
      const payload = await api('/api/what-if/portfolio', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          accountId: $('#portfolioWhatIfAccount').value || null,
          horizonYears: $('#portfolioWhatIfHorizon').value || 10
        })
      });
      renderPortfolioAnalysis(payload);
    } catch (error) {
      notify(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Run portfolio what-if';
    }
  }

  function resetHousehold() {
    lastHouseholdAnalysis = null;
    ['householdCashflow', 'householdNetWorth', 'householdDebt'].forEach(destroyChart);
    $('#whatIfResults').classList.add('hidden');
    $('#whatIfEmpty').classList.remove('hidden');
    $('#householdWhatIfPrompt').value = '';
  }

  function resetPortfolio() {
    lastPortfolioAnalysis = null;
    ['portfolioScenario', 'portfolioNetWorth'].forEach(destroyChart);
    $('#portfolioWhatIfResults').classList.add('hidden');
    $('#portfolioWhatIfEmpty').classList.remove('hidden');
    $('#portfolioWhatIfPrompt').value = '';
  }

  async function initialize() {
    if (!$('#whatIfLab')) return;
    try {
      context = await api('/api/what-if/context');
      populateContext();
    } catch (error) {
      notify(`What-if context could not load: ${error.message}`);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#whatIfLab')) return;

    $$('[data-whatif-tab]').forEach((button) => {
      button.addEventListener('click', () => showTab(button.dataset.whatifTab));
    });

    $$('[data-household-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        $('#householdWhatIfPrompt').value = button.dataset.householdPrompt;
        $('#householdWhatIfPrompt').focus();
      });
    });

    $$('[data-portfolio-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        $('#portfolioWhatIfPrompt').value = button.dataset.portfolioPrompt;
        $('#portfolioWhatIfPrompt').focus();
      });
    });

    $('#householdWhatIfForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = $('#householdWhatIfPrompt').value.trim();
      if (prompt) runHousehold(prompt);
    });

    $('#portfolioWhatIfForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = $('#portfolioWhatIfPrompt').value.trim();
      if (prompt) runPortfolio(prompt);
    });

    $('#resetHouseholdWhatIf').addEventListener('click', resetHousehold);
    $('#resetPortfolioWhatIf').addEventListener('click', resetPortfolio);
    $('#portfolioWhatIfAccount').addEventListener('change', renderPortfolioComposition);

    $('#whatIfExclude529').addEventListener('change', () => {
      if (lastHouseholdAnalysis) renderHouseholdAnalysis(lastHouseholdAnalysis);
    });

    $('#openAccountsForHoldings').addEventListener('click', () => {
      const accountNav = $('[data-view="accounts"]');
      if (accountNav) accountNav.click();
    });

    showTab('household');
    initialize();
  });
})();
