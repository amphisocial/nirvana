(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  let accounts = [];
  let selectedAccountId = '';
  let portfolio = { account: null, holdings: [], forecast: null };
  let editingHoldingId = null;
  let forecastChart = null;

  const request = (url, options = {}) => {
    if (!window.nirvanaApi) throw new Error('Nirvana API is not ready');
    return window.nirvanaApi(url, options);
  };

  function investmentAccounts(summary) {
    return (summary?.accounts || []).filter((account) =>
      ['brokerage', 'ira', '401k', 'retirement'].includes(account.account_type)
    );
  }

  function resetHoldingForm() {
    editingHoldingId = null;
    const form = $('#holdingForm');
    form.reset();
    form.assetClass.value = 'equity';
    $('#holdingSubmitButton').textContent = 'Add holding';
    $('#holdingCancelEdit').classList.add('hidden');
  }

  function updateAccountSelect(summary, preferredId = null) {
    accounts = investmentAccounts(summary);
    const select = $('#portfolioAccountSelect');
    if (!select) return;
    const current = preferredId || selectedAccountId || select.value;
    select.replaceChildren(new Option('Select a brokerage, IRA or 401(k)', ''));
    for (const account of accounts) {
      const mode = account.projection_method === 'holdings_monte_carlo' ? 'holdings forecast' : 'profile';
      select.add(new Option(`${account.name} · ${account.account_type.replaceAll('_', ' ')} · ${mode}`, account.id));
    }
    if (current && accounts.some((account) => account.id === current)) {
      select.value = current;
      selectedAccountId = current;
    } else if (accounts.length === 1) {
      select.value = accounts[0].id;
      selectedAccountId = accounts[0].id;
    }
  }

  function renderForecast(forecast) {
    const empty = $('#accountForecastEmpty');
    const wrap = $('#accountForecastChartWrap');
    if (!forecast) {
      $('#accountForecastReturn').textContent = '—';
      $('#accountForecastVolatility').textContent = '—';
      $('#accountForecastCashFlow').textContent = '—';
      empty.classList.remove('hidden');
      wrap.classList.add('hidden');
      forecastChart?.destroy();
      forecastChart = null;
      return;
    }

    $('#accountForecastReturn').textContent = `${(Number(forecast.expected_return || 0) * 100).toFixed(1)}%`;
    $('#accountForecastVolatility').textContent = `${(Number(forecast.volatility || 0) * 100).toFixed(1)}%`;
    $('#accountForecastCashFlow').textContent = money.format(Number(forecast.annual_linked_cash_flow || 0));
    empty.classList.add('hidden');
    wrap.classList.remove('hidden');

    const timeline = typeof forecast.timeline === 'string' ? JSON.parse(forecast.timeline) : forecast.timeline;
    if (!Array.isArray(timeline) || typeof Chart === 'undefined') return;
    forecastChart?.destroy();
    const style = getComputedStyle(document.documentElement);
    const blue = style.getPropertyValue('--blue').trim() || '#1976c5';
    const dark = style.getPropertyValue('--blue-dark').trim() || '#0b3a67';
    const light = style.getPropertyValue('--blue-light').trim() || '#83b9ed';
    forecastChart = new Chart($('#accountForecastChart'), {
      type: 'line',
      data: {
        labels: timeline.map((row) => row.year),
        datasets: [
          { label: '90th percentile', data: timeline.map((row) => row.p90), borderColor: light, backgroundColor: light, borderWidth: 1.5, pointRadius: 0, tension: .25 },
          { label: 'Median', data: timeline.map((row) => row.p50), borderColor: blue, backgroundColor: blue, borderWidth: 3, pointRadius: 0, tension: .25 },
          { label: '10th percentile', data: timeline.map((row) => row.p10), borderColor: dark, backgroundColor: dark, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .25 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Years from now' } },
          y: { ticks: { callback: (value) => money.format(value) } }
        }
      }
    });
  }

  function renderHoldings() {
    const tbody = $('#accountHoldingsTable');
    tbody.replaceChildren();
    const total = portfolio.holdings.reduce((sum, row) => sum + Number(row.current_value || 0), 0);
    if (!portfolio.holdings.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No holdings yet. Add stocks or ETFs above.</td></tr>';
      return;
    }
    for (const holding of portfolio.holdings) {
      const tr = document.createElement('tr');
      const value = Number(holding.current_value || 0);
      const weight = total > 0 ? value / total * 100 : 0;
      const actions = document.createElement('td');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'row-action';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => editHolding(holding.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'row-action danger';
      del.textContent = 'Delete';
      del.addEventListener('click', () => deleteHolding(holding));
      actions.append(edit, del);
      tr.innerHTML = `<td><strong>${holding.symbol}</strong><small>${holding.name || ''}<br>${number.format(holding.quantity)} shares @ ${holding.current_price == null ? 'price pending' : money.format(holding.current_price)}</small></td><td>${money.format(value)}</td><td>${weight.toFixed(1)}%</td>`;
      tr.append(actions);
      tbody.append(tr);
    }
  }

  function editHolding(id) {
    const holding = portfolio.holdings.find((row) => row.id === id);
    if (!holding) return;
    editingHoldingId = id;
    const form = $('#holdingForm');
    form.symbol.value = holding.symbol || '';
    form.name.value = holding.name || '';
    form.quantity.value = holding.quantity ?? '';
    form.currentPrice.value = holding.current_price ?? '';
    form.costBasisPerShare.value = holding.cost_basis_per_share ?? '';
    form.assetClass.value = holding.asset_class || 'equity';
    $('#holdingSubmitButton').textContent = 'Save holding';
    $('#holdingCancelEdit').classList.remove('hidden');
    form.symbol.focus();
  }

  async function deleteHolding(holding) {
    if (!window.confirm(`Delete ${holding.symbol} from this account?`)) return;
    try {
      await request(`/api/accounts/${selectedAccountId}/holdings/${holding.id}`, { method: 'DELETE' });
      await loadPortfolio();
      await window.loadNirvanaDashboard?.();
      window.showNirvanaAlert?.(`${holding.symbol} deleted.`);
    } catch (error) { window.showNirvanaAlert?.(error.message); }
  }

  async function loadPortfolio() {
    if (!selectedAccountId) {
      portfolio = { account: null, holdings: [], forecast: null };
      renderHoldings();
      renderForecast(null);
      $('#portfolioForecastStatus').textContent = 'Choose an investment account to manage its holdings.';
      return;
    }
    $('#portfolioForecastStatus').textContent = 'Loading portfolio…';
    portfolio = await request(`/api/accounts/${selectedAccountId}/portfolio`);
    renderHoldings();
    renderForecast(portfolio.forecast);
    const account = portfolio.account;
    const forecastDate = account.forecast_as_of ? new Date(account.forecast_as_of).toLocaleDateString() : null;
    $('#portfolioForecastStatus').textContent = forecastDate
      ? `${portfolio.holdings.length} holdings · forecast saved ${forecastDate}`
      : `${portfolio.holdings.length} holdings · forecast not calculated yet`;
  }

  async function calculateForecast() {
    if (!selectedAccountId) return window.showNirvanaAlert?.('Select an investment account first.');
    const button = $('#calculateAccountForecastButton');
    button.disabled = true;
    $('#portfolioForecastStatus').textContent = 'Fetching market history and running Monte Carlo…';
    try {
      const result = await request(`/api/accounts/${selectedAccountId}/forecast`, {
        method: 'POST',
        body: JSON.stringify({ horizonYears: 30, simulationCount: 1000 })
      });
      portfolio.forecast = result.forecast;
      renderForecast(result.forecast);
      const gaps = result.dataGaps?.length ? ` ${result.dataGaps.length} data gap(s) used fallback assumptions.` : '';
      $('#portfolioForecastStatus').textContent = `Forecast saved from ${result.positions.length} modeled holdings.${gaps}`;
      await window.loadNirvanaDashboard?.();
      window.showNirvanaAlert?.('Account forecast calculated and saved.');
    } catch (error) {
      $('#portfolioForecastStatus').textContent = 'Forecast calculation failed.';
      window.showNirvanaAlert?.(error.message);
    } finally { button.disabled = false; }
  }

  document.addEventListener('nirvana:data-loaded', (event) => {
    updateAccountSelect(event.detail.summary);
    if (selectedAccountId) loadPortfolio().catch((error) => window.showNirvanaAlert?.(error.message));
  });

  document.addEventListener('nirvana:open-portfolio', (event) => {
    const accountId = event.detail?.accountId;
    if (!accountId) return;
    selectedAccountId = accountId;
    updateAccountSelect(window.nirvanaState?.summary, accountId);
    $('#portfolioAccountSelect').value = accountId;
    $('#portfolioAccountSelect').scrollIntoView({ behavior: 'smooth', block: 'center' });
    loadPortfolio().catch((error) => window.showNirvanaAlert?.(error.message));
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('#portfolioAccountSelect').addEventListener('change', (event) => {
      selectedAccountId = event.target.value;
      resetHoldingForm();
      loadPortfolio().catch((error) => window.showNirvanaAlert?.(error.message));
    });
    $('#holdingCancelEdit').addEventListener('click', resetHoldingForm);
    $('#holdingForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedAccountId) return window.showNirvanaAlert?.('Select an investment account first.');
      const form = event.currentTarget;
      const button = event.submitter;
      button.disabled = true;
      const payload = {
        symbol: form.symbol.value,
        name: form.name.value || null,
        quantity: form.quantity.value,
        currentPrice: form.currentPrice.value || null,
        costBasisPerShare: form.costBasisPerShare.value || null,
        assetClass: form.assetClass.value
      };
      try {
        const editing = Boolean(editingHoldingId);
        await request(
          editing
            ? `/api/accounts/${selectedAccountId}/holdings/${editingHoldingId}`
            : `/api/accounts/${selectedAccountId}/holdings`,
          { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) }
        );
        resetHoldingForm();
        await loadPortfolio();
        await window.loadNirvanaDashboard?.();
        window.showNirvanaAlert?.(editing ? 'Holding updated.' : 'Holding added.');
      } catch (error) { window.showNirvanaAlert?.(error.message); }
      finally { button.disabled = false; }
    });
    $('#calculateAccountForecastButton').addEventListener('click', calculateForecast);
    $('#askAccountAIButton').addEventListener('click', () => {
      const account = accounts.find((row) => row.id === selectedAccountId);
      if (!account) return window.showNirvanaAlert?.('Select an investment account first.');
      window.openNirvanaAssistant?.(`Review my ${account.name} ${account.account_type.replaceAll('_', ' ')} portfolio, its saved holdings-based forecast, concentration risk, linked cash flows, and impact on retirement readiness.`);
    });
    resetHoldingForm();
  });
})();
