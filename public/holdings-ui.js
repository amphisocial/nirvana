(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const charts = {};
  const growthOverrides = {};
  let lastResult = null;
  let loaded = false;
  let loading = false;
  let currentPrompt = '';
  let activeTab = 'insights';

  async function api(url, options = {}) {
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

  function notify(message) {
    if (window.showNirvanaAlert) window.showNirvanaAlert(message);
    else window.alert(message);
  }

  function colors() {
    const style = getComputedStyle(document.documentElement);
    return {
      dark: style.getPropertyValue('--blue-dark').trim() || '#0b3a67',
      blue: style.getPropertyValue('--blue').trim() || '#1976c5',
      light: style.getPropertyValue('--blue-light').trim() || '#83b9ed',
      pale: style.getPropertyValue('--blue-pale').trim() || '#dceeff',
      slate: style.getPropertyValue('--blue-slate').trim() || '#486581',
      line: style.getPropertyValue('--line').trim() || '#d8e6f2',
      ink: style.getPropertyValue('--ink').trim() || '#102a43',
      soft: style.getPropertyValue('--ink-soft').trim() || '#627d98'
    };
  }

  function destroyChart(name) {
    charts[name]?.destroy();
    delete charts[name];
  }


  function showHoldingsTab(name, options = {}) {
    const selected = ['insights', 'manage', 'research', 'desk'].includes(name) ? name : 'insights';
    activeTab = selected;

    $$('[data-holdings-tab]').forEach((button) => {
      const active = button.dataset.holdingsTab === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });

    $$('.holdings-tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.holdingsPanel === selected);
    });

    window.setTimeout(() => {
      if (selected === 'insights') {
        Object.values(charts).forEach((chart) => chart?.resize());
        if (!loaded && !loading) runAnalysis('', true);
      } else if (selected === 'manage') {
        window.dispatchEvent(new Event('resize'));
        if (options.scroll !== false) {
          $('#portfolioAccountSelect')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (selected === 'research') {
        document.dispatchEvent(new CustomEvent('nirvana:load-holding-research'));
      } else if (selected === 'desk') {
        document.dispatchEvent(new CustomEvent('nirvana:open-trading-desk'));
      }
    }, 70);
  }

  function openManageHoldings(options = {}) {
    if (!$('#holdings')?.classList.contains('active-view')) {
      $('[data-view="holdings"]')?.click();
    }
    showHoldingsTab('manage', options);
  }

  function selectedTypes() {
    const values = $$('[data-holdings-account-type]:checked').map((input) => input.value);
    return values.length ? values : ['brokerage'];
  }

  function payload(prompt = currentPrompt, includeNarrative = true) {
    return {
      accountTypes: selectedTypes(),
      growthOverrides,
      prompt: prompt || null,
      horizonMonths: 36,
      maxLiveSymbols: 24,
      includeNarrative
    };
  }

  function setLoading(active, message = 'Running symbol agents…') {
    loading = active;
    const status = $('#holdingsAgentStatus');
    if (status) status.textContent = active ? message : status.textContent;
    const buttons = ['#refreshMissingHoldingPrices', '#runHoldingsWhatIf', '#resetHoldingsWhatIf'];
    buttons.forEach((selector) => { const button = $(selector); if (button) button.disabled = active; });
  }

  function renderGrowthOverrides(accounts = []) {
    const container = $('#holdingsGrowthOverrides');
    if (!container) return;
    const activeIds = new Set(accounts.map((account) => account.id));
    Object.keys(growthOverrides).forEach((id) => { if (!activeIds.has(id)) delete growthOverrides[id]; });
    container.replaceChildren();

    if (!accounts.length) {
      container.innerHTML = '<div class="empty-inline">No selected investment accounts were found.</div>';
      return;
    }

    for (const account of accounts) {
      if (growthOverrides[account.id] == null) growthOverrides[account.id] = Number(account.fallbackAnnualReturn || 0) / 100;
      const label = document.createElement('label');
      label.className = 'holdings-growth-input';
      label.innerHTML = `<span>${escapeHtml(account.name)} <small>${escapeHtml(account.accountType.replaceAll('_', ' '))}</small></span><div><input type="number" min="-50" max="100" step="0.1" value="${(growthOverrides[account.id] * 100).toFixed(1)}" data-holdings-growth="${account.id}"><b>%</b></div>`;
      container.append(label);
    }

    $$('[data-holdings-growth]', container).forEach((input) => {
      input.addEventListener('change', () => {
        growthOverrides[input.dataset.holdingsGrowth] = Number(input.value || 0) / 100;
        runAnalysis(currentPrompt, false);
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function riskLabel(value) {
    return { high: 'High risk', low: 'Low risk', stable: 'Stable', unclassified: 'Unclassified', unallocated: 'Unallocated account value' }[value] || value;
  }

  function renderMetrics(result) {
    const metrics = result.metrics || {};
    $('#holdingsSelectedTotal').textContent = money.format(metrics.selectedAccountTotal || 0);
    $('#holdingsKnownValue').textContent = money.format(metrics.knownHoldingsValue || 0);
    $('#holdingsUnallocatedValue').textContent = money.format(metrics.unallocatedValue || 0);
    $('#holdingsThreeYearBaseline').textContent = money.format(metrics.baselineThreeYearValue || 0);
    $('#holdingsCoverageCopy').textContent = `${Number(metrics.holdingsCoveragePct || 0).toFixed(1)}% of selected value`;
    const impact = Number(metrics.scenarioThreeYearChange || 0);
    const impactElement = $('#holdingsScenarioImpact');
    impactElement.textContent = money.format(impact);
    impactElement.classList.toggle('positive', impact > 0);
    impactElement.classList.toggle('negative', impact < 0);
    $('#holdingsForecastNote').textContent = metrics.scenarioFundingGap > 0
      ? `Temporary scenario funding gap: ${money.format(metrics.scenarioFundingGap)}. The graph remains session-only.`
      : 'Known symbols use agent-derived planning returns; uncovered account value uses the growth assumptions above. This is not a market prediction.';
  }

  function renderTotalChart(result) {
    if (typeof Chart === 'undefined') return;
    const c = colors();
    const baseline = result.baseline?.timeline || [];
    const scenario = result.alternative?.timeline || [];
    const hasScenario = Boolean(currentPrompt && result.scenario);
    destroyChart('total');
    charts.total = new Chart($('#holdingsTotalForecastChart'), {
      type: 'line',
      data: {
        labels: baseline.map((row) => row.label),
        datasets: [
          { label: 'Baseline portfolio', data: baseline.map((row) => row.total), borderColor: c.blue, backgroundColor: c.pale, borderWidth: 3, pointRadius: 0, tension: .25, fill: true },
          ...(hasScenario ? [{ label: 'Temporary scenario', data: scenario.map((row) => row.total), borderColor: c.dark, backgroundColor: c.dark, borderWidth: 3, pointRadius: 0, tension: .25 }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${money.format(ctx.raw)}`,
            afterBody: (items) => {
              if (!hasScenario) return [];
              const events = scenario[items?.[0]?.dataIndex]?.events || [];
              return events.length ? events : [];
            }
          } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 9 } },
          y: { grid: { color: c.line }, ticks: { callback: (value) => money.format(value) } }
        }
      }
    });
  }

  function renderRisk(result) {
    const rows = result.riskAllocation || [];
    const c = colors();
    const palette = { high: c.dark, low: c.blue, stable: c.light, unclassified: c.slate, unallocated: c.pale };
    destroyChart('risk');
    if (typeof Chart !== 'undefined') {
      charts.risk = new Chart($('#holdingsRiskChart'), {
        type: 'doughnut',
        data: {
          labels: rows.map((row) => riskLabel(row.risk)),
          datasets: [{ data: rows.map((row) => row.value), backgroundColor: rows.map((row) => palette[row.risk]), borderWidth: 2, borderColor: '#fff' }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money.format(ctx.raw)}` } } } }
      });
    }
    const legend = $('#holdingsRiskLegend');
    legend.replaceChildren();
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.innerHTML = `<i style="background:${palette[row.risk]}"></i><span>${riskLabel(row.risk)}</span><strong>${Number(row.percent || 0).toFixed(1)}%</strong>`;
      legend.append(item);
    });
  }

  function renderAccountChart(result) {
    const accounts = result.accounts || [];
    const c = colors();
    destroyChart('accounts');
    if (typeof Chart === 'undefined') return;
    charts.accounts = new Chart($('#holdingsAccountChart'), {
      type: 'bar',
      data: {
        labels: ['Current', 'Year 1', 'Year 2', 'Year 3'],
        datasets: accounts.map((account, index) => ({
          label: account.name,
          data: account.baseline,
          backgroundColor: [c.blue, c.light, c.dark, c.slate][index % 4],
          borderWidth: 0
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: c.line }, ticks: { callback: (value) => money.format(value) } }
        }
      }
    });
  }

  function renderConcentration(result) {
    const rows = result.concentration || [];
    const c = colors();
    destroyChart('concentration');
    if (typeof Chart === 'undefined') return;
    charts.concentration = new Chart($('#holdingsConcentrationChart'), {
      type: 'bar',
      data: {
        labels: rows.map((row) => row.symbol),
        datasets: [{ label: 'Portfolio weight', data: rows.map((row) => row.percent), backgroundColor: c.blue, borderRadius: 6 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toFixed(1)}% · ${money.format(rows[ctx.dataIndex]?.value || 0)}` } } },
        scales: {
          x: { grid: { color: c.line }, ticks: { callback: (value) => `${value}%` }, suggestedMax: Math.max(25, ...rows.map((row) => row.percent || 0)) },
          y: { grid: { display: false } }
        }
      }
    });
  }

  function renderCoverage(result) {
    const container = $('#holdingsCoverageCards');
    container.replaceChildren();
    for (const account of result.accounts || []) {
      const item = document.createElement('div');
      item.className = 'holdings-coverage-card';
      item.innerHTML = `<div><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.accountType.replaceAll('_', ' '))}</span></div><b>${Number(account.coveragePct || 0).toFixed(1)}%</b><progress max="100" value="${Number(account.coveragePct || 0)}"></progress><small>${money.format(account.knownHoldingsValue)} known · ${money.format(account.unallocatedValue)} unallocated</small>`;
      container.append(item);
    }
  }

  function renderScenario(result) {
    const panel = $('#holdingsScenarioPanel');
    if (!currentPrompt) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    $('#holdingsScenarioTitle').textContent = result.scenario?.title || 'Temporary scenario';
    $('#holdingsScenarioSummary').textContent = result.scenario?.summary || currentPrompt;
    const assumptions = $('#holdingsScenarioAssumptions');
    assumptions.replaceChildren();
    const chips = [];
    for (const trade of result.scenario?.trades || []) chips.push(`${String(trade.action).toUpperCase()} ${trade.symbol} ${trade.amount ? money.format(trade.amount) : `${decimal.format(trade.quantity)} shares`} · ${trade.date || 'now'} · ${trade.accountName || 'selected account'}`);
    for (const override of result.scenario?.symbolReturnOverrides || []) chips.push(`${override.symbol}: ${(Number(override.annualReturn) * 100).toFixed(1)}% annual return`);
    for (const override of result.scenario?.accountReturnOverrides || []) chips.push(`${override.accountName || 'Selected accounts'}: ${(Number(override.annualReturn) * 100).toFixed(1)}% annual return`);
    if (!chips.length) chips.push('No specific temporary change was recognized.');
    chips.forEach((text) => {
      const chip = document.createElement('span');
      chip.className = 'whatif-assumption-chip';
      chip.textContent = text;
      assumptions.append(chip);
    });
    const events = $('#holdingsScenarioEvents');
    events.replaceChildren();
    for (const event of result.alternative?.events || []) {
      const row = document.createElement('div');
      row.innerHTML = `<strong>${escapeHtml(event.label)}</strong><span>${event.items.map(escapeHtml).join(' · ')}</span>`;
      events.append(row);
    }
    if (!events.children.length) events.innerHTML = '<div class="empty-inline">The scenario changes return assumptions without a discrete trade event.</div>';
  }

  function renderInsights(result) {
    const ai = result.aiInsights || {};
    $('#holdingsInsightHeadline').textContent = ai.headline || 'Holdings diagnostic';
    const list = $('#holdingsInsightList');
    list.replaceChildren();
    const insights = ai.insights?.length ? ai.insights : result.insights || [];
    insights.forEach((text) => {
      const item = document.createElement('div');
      item.className = 'holdings-insight-item';
      item.textContent = text;
      list.append(item);
    });
    if (!list.children.length) list.innerHTML = '<div class="empty-inline">No insight was generated for the selected accounts.</div>';

    const watch = $('#holdingsWatchList');
    watch.replaceChildren();
    (ai.watchItems || []).forEach((text) => {
      const item = document.createElement('div');
      item.innerHTML = `<strong>Watch</strong><span>${escapeHtml(text)}</span>`;
      watch.append(item);
    });
  }

  function renderAgentStatus(result) {
    const summary = result.agentSummary || {};
    const status = $('#holdingsAgentStatus');
    status.textContent = `${summary.totalSymbols || 0} symbol agents · ${summary.marketAnalyzed || 0} market packets · ${summary.fallbackSymbols || 0} fallback`;
    const container = $('#holdingsAgentBreakdown');
    container.replaceChildren();
    [
      ['Symbol agents completed', summary.totalSymbols || 0],
      ['Live/cached market packets', summary.marketAnalyzed || 0],
      ['Account-fallback symbols', summary.fallbackSymbols || 0],
      ['Priced holdings coverage', `${Number(result.metrics?.holdingsCoveragePct || 0).toFixed(1)}%`]
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      container.append(row);
    });
  }

  function renderHoldingsTable(result) {
    const body = $('#holdingsLabRows');
    body.replaceChildren();
    const rows = [...(result.holdings || [])].sort((a, b) => Number(b.currentValue) - Number(a.currentValue));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted">No saved holdings are available for the selected account types.</td></tr>';
      return;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      const missing = row.priceSource === 'missing' || row.priceSource === 'average-cost estimate';
      tr.innerHTML = `<td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.name || '')}</small></td><td>${escapeHtml(row.accountName)}<small>${escapeHtml(row.accountType.replaceAll('_', ' '))}</small></td><td>${decimal.format(row.quantity || 0)}</td><td>${row.price ? money.format(row.price) : 'Missing'}<small class="${missing ? 'holding-price-warning' : ''}">${escapeHtml(row.priceSource || '')}${row.priceAsOf ? ` · ${String(row.priceAsOf).slice(0, 10)}` : ''}</small></td><td>${money.format(row.currentValue || 0)}</td><td>${Number(row.annualReturnPct || 0).toFixed(1)}%</td><td><span class="holdings-risk-pill risk-${escapeHtml(row.risk)}">${riskLabel(row.risk)}</span></td><td>${row.analytics ? 'Market analyzed' : 'Account fallback'}<small>${row.quant?.momentumState ? `Momentum: ${escapeHtml(row.quant.momentumState)}` : row.dataGaps?.[0] ? escapeHtml(row.dataGaps[0]) : ''}</small></td>`;
      body.append(tr);
    }
  }

  function render(result) {
    lastResult = result;
    renderGrowthOverrides(result.accounts || []);
    renderMetrics(result);
    renderTotalChart(result);
    renderRisk(result);
    renderAccountChart(result);
    renderConcentration(result);
    renderCoverage(result);
    renderScenario(result);
    renderInsights(result);
    renderAgentStatus(result);
    renderHoldingsTable(result);
  }

  async function runAnalysis(prompt = currentPrompt, includeNarrative = true) {
    if (loading) return;
    currentPrompt = String(prompt || '').trim();
    setLoading(true, currentPrompt ? 'Running temporary scenario agents…' : 'Running symbol agents…');
    try {
      const result = await api('/api/holdings-lab/overview', {
        method: 'POST',
        body: JSON.stringify(payload(currentPrompt, includeNarrative))
      });
      render(result);
      loaded = true;
    } catch (error) {
      notify(error.message);
      $('#holdingsAgentStatus').textContent = 'Holdings analysis failed';
    } finally {
      setLoading(false);
    }
  }

  async function refreshMissingPrices() {
    if (loading) return;
    setLoading(true, 'Refreshing missing prices…');
    try {
      const result = await api('/api/holdings-lab/refresh-missing', {
        method: 'POST',
        body: JSON.stringify({ accountTypes: selectedTypes(), missingOnly: true })
      });
      const failures = result.failedSymbols?.length || 0;
      notify(`Refreshed ${result.refreshedSymbols} of ${result.requestedSymbols} missing symbols${failures ? `; ${failures} could not be priced` : ''}.`);
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
    await runAnalysis(currentPrompt, true);
    await window.loadNirvanaDashboard?.();
  }

  function activateHoldingsPage() {
    window.setTimeout(() => {
      if (activeTab === 'manage') {
        window.dispatchEvent(new Event('resize'));
        return;
      }
      Object.values(charts).forEach((chart) => chart?.resize());
      if (!loaded && !loading) runAnalysis('', true);
    }, 60);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#holdings')) return;

    $$('[data-holdings-tab]').forEach((button) => {
      button.addEventListener('click', () => showHoldingsTab(button.dataset.holdingsTab));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const order = ['insights', 'manage', 'research', 'desk'];
        const currentIndex = order.indexOf(button.dataset.holdingsTab);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = order[(currentIndex + direction + order.length) % order.length];
        showHoldingsTab(next, { scroll: false });
        $(`[data-holdings-tab="${next}"]`)?.focus();
      });
    });

    $$('[data-holdings-open-manage]').forEach((button) => {
      button.addEventListener('click', () => openManageHoldings());
    });

    document.addEventListener('nirvana:open-portfolio', () => {
      openManageHoldings();
    });

    $$('[data-holdings-account-type]').forEach((input) => {
      input.addEventListener('change', () => runAnalysis(currentPrompt, false));
    });

    $('#refreshMissingHoldingPrices').addEventListener('click', refreshMissingPrices);
    $('#openHoldingsAssistant').addEventListener('click', () => {
      window.openNirvanaAssistant?.('Review my combined brokerage, IRA, and 401(k) holdings. Explain concentration, priced-holdings coverage, high-risk versus stable allocation, account-level fallback assumptions, and the three-year holdings forecast.');
    });

    $('#holdingsWhatIfForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = $('#holdingsWhatIfPrompt').value.trim();
      if (prompt) runAnalysis(prompt, true);
    });
    $('#resetHoldingsWhatIf').addEventListener('click', () => {
      currentPrompt = '';
      $('#holdingsWhatIfPrompt').value = '';
      runAnalysis('', true);
    });
    $$('[data-holdings-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        $('#holdingsWhatIfPrompt').value = button.dataset.holdingsPrompt;
        $('#holdingsWhatIfPrompt').focus();
      });
    });

    $$('[data-view="holdings"], [data-view-link="holdings"]').forEach((button) => {
      button.addEventListener('click', activateHoldingsPage);
    });

    window.openNirvanaHoldingsTab = showHoldingsTab;
    showHoldingsTab('insights', { scroll: false });
    if ($('#holdings').classList.contains('active-view')) activateHoldingsPage();
  });
})();
