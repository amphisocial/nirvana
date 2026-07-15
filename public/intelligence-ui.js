(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const charts = {};
  const state = {
    overview: null,
    desk: [],
    calendar: null,
    spending: null,
    goals: null,
    research: null,
    sharing: null,
    alerts: [],
    loaded: new Set(),
    activeIntelligenceTab: 'week',
    activeAccountsTab: 'accounts',
    editingGoalId: null
  };
  let alertsCloseTimer = null;
  let alertsReturnFocus = null;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) window.location.href = '/';
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

  const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  async function waitForAgentRun(runId, statusElement, options = {}) {
    if (!runId) return { status: 'unknown' };
    const timeoutMs = Number(options.timeoutMs || 30 * 60 * 1000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const runs = await api('/api/intelligence/runs');
        const run = runs.find((row) => row.id === runId);
        if (run) {
          if (statusElement) statusElement.textContent = `${String(run.run_type).replaceAll('_', ' ')} · ${run.status}`;
          if (run.status === 'completed' || run.status === 'failed') return run;
        }
      } catch (error) {
        console.warn('Agent status check failed:', error.message);
      }
      await sleep(5000);
    }
    return { id: runId, status: 'running', timedOut: true };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function parseJson(value, fallback = {}) {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function formatDate(value) {
    if (!value) return 'Unknown';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function setMoney(id, value, positiveGood = true) {
    const element = $(id);
    if (!element) return;
    const amount = Number(value || 0);
    element.textContent = money.format(amount);
    element.classList.toggle('positive', positiveGood ? amount > 0 : amount < 0);
    element.classList.toggle('negative', positiveGood ? amount < 0 : amount > 0);
  }

  function destroyChart(name) {
    charts[name]?.destroy();
    delete charts[name];
  }

  function colors() {
    const style = getComputedStyle(document.documentElement);
    return {
      dark: style.getPropertyValue('--blue-dark').trim() || '#0b3a67',
      blue: style.getPropertyValue('--blue').trim() || '#1976c5',
      light: style.getPropertyValue('--blue-light').trim() || '#83b9ed',
      pale: style.getPropertyValue('--blue-pale').trim() || '#dceeff',
      slate: style.getPropertyValue('--blue-slate').trim() || '#486581',
      line: style.getPropertyValue('--line').trim() || '#d8e6f2'
    };
  }

  function listItems(container, values, emptyText = 'Nothing to report.') {
    container.replaceChildren();
    for (const value of values || []) {
      const item = document.createElement('div');
      item.className = 'briefing-item';
      item.textContent = value;
      container.append(item);
    }
    if (!container.children.length) container.innerHTML = `<div class="empty-state-card">${escapeHtml(emptyText)}</div>`;
  }

  function showIntelligenceTab(name) {
    const valid = ['week', 'desk', 'calendar', 'spending'];
    const selected = valid.includes(name) ? name : 'week';
    state.activeIntelligenceTab = selected;
    $$('[data-intelligence-tab]').forEach((button) => {
      const active = button.dataset.intelligenceTab === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$('[data-intelligence-panel]').forEach((panel) => {
      const active = panel.dataset.intelligencePanel === selected;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', String(!active));
    });
    if (selected === 'week') loadOverview();
    if (selected === 'desk') loadDesk();
    if (selected === 'calendar') loadCalendar();
    if (selected === 'spending') loadSpending();
    window.setTimeout(() => Object.values(charts).forEach((chart) => chart?.resize()), 60);
  }

  function showAccountsTab(name) {
    const selected = name === 'sharing' ? 'sharing' : 'accounts';
    state.activeAccountsTab = selected;
    $$('[data-accounts-tab]').forEach((button) => {
      const active = button.dataset.accountsTab === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$('[data-accounts-panel]').forEach((panel) => {
      const active = panel.dataset.accountsPanel === selected;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', String(!active));
    });
    if (selected === 'sharing') loadSharing();
    window.setTimeout(() => Object.values(charts).forEach((chart) => chart?.resize()), 60);
  }

  function renderMovements(id, rows, debt = false) {
    const container = $(id);
    container.replaceChildren();
    for (const row of rows || []) {
      const item = document.createElement('div');
      item.className = 'movement-item';
      const change = Number(row.change || 0);
      const good = debt ? change < 0 : change > 0;
      item.innerHTML = `<div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(String(row.type || '').replaceAll('_', ' '))}</small></div><strong class="${good ? 'positive' : 'negative'}">${change > 0 ? '+' : ''}${money.format(change)}</strong>`;
      container.append(item);
    }
    if (!container.children.length) container.innerHTML = '<div class="empty-state-card">No material movement was detected.</div>';
  }

  function renderTenYearForecast(forecastRow) {
    const forecast = parseJson(forecastRow?.forecast, {});
    const summary = parseJson(forecastRow?.summary, {});
    const timeline = forecast.timeline || [];
    setMoney('#weekTenYearNetWorth', summary.tenYearNetWorth || 0);
    $('#weekForecastAsOf').textContent = forecastRow?.generated_at ? `Generated ${new Date(forecastRow.generated_at).toLocaleString()}` : 'Run the weekly agent to create it';
    $('#tenYearForecastNote').textContent = timeline.length
      ? `Forecast from age ${timeline[0].age} through ${timeline.at(-1).age}. ${forecast.assumptions?.[0] || ''}`
      : 'No weekly forecast has been saved yet. Run the weekly agents now.';
    destroyChart('tenYear');
    if (!timeline.length || typeof Chart === 'undefined') return;
    const c = colors();
    charts.tenYear = new Chart($('#tenYearForecastChart'), {
      type: 'line',
      data: {
        labels: timeline.map((row) => `Age ${row.age}`),
        datasets: [
          { label: 'Net worth', data: timeline.map((row) => row.netWorth), borderColor: c.dark, backgroundColor: c.pale, fill: true, borderWidth: 3, pointRadius: 2, tension: .22 },
          { label: 'Assets', data: timeline.map((row) => row.assets), borderColor: c.blue, backgroundColor: c.blue, borderWidth: 2, pointRadius: 0, tension: .22 },
          { label: 'Debt', data: timeline.map((row) => row.debt), borderColor: c.slate, backgroundColor: c.slate, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .22 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: c.line }, ticks: { callback: (value) => money.format(value) } } }
      }
    });
  }

  function renderWeeklyBriefing(row) {
    const content = parseJson(row?.content, {});
    $('#weeklyBriefingTitle').textContent = content.title || row?.title || 'Waiting for the first weekly agent run';
    $('#weeklyBriefingSummary').textContent = content.summary || row?.dek || 'Run the weekly agents to create a personalized household briefing.';
    listItems($('#weeklyWins'), content.wins, 'No wins were highlighted.');
    listItems($('#weeklyRisks'), content.risks, 'No material risks were highlighted.');
    listItems($('#weeklyActions'), content.nextActions, 'No next action was generated.');
  }

  function renderOverview(data) {
    state.overview = data;
    const change = data.change || {};
    setMoney('#weekNetWorthChange', change.netWorthChange || 0);
    setMoney('#weekAssetChange', change.assetsChange || 0);
    setMoney('#weekDebtChange', change.liabilitiesChange || 0, false);
    $('#weekComparisonPeriod').textContent = change.daysCompared ? `${change.daysCompared}-day comparison` : 'Starting snapshot captured';
    $('#weekMovementHeadline').textContent = Number(change.netWorthChange || 0) >= 0 ? 'Net worth moved higher' : 'Net worth moved lower';
    $('#weekMovementExplanation').textContent = change.explanation || 'No movement explanation is available yet.';
    renderMovements('#weekAccountMovements', change.accountMovements, false);
    renderMovements('#weekDebtMovements', change.liabilityMovements, true);
    renderTenYearForecast(data.forecast);
    renderWeeklyBriefing(data.weeklyBriefing);
    $('#weekAlertCount').textContent = String(data.alerts?.length || 0);
    const latestRun = data.runs?.[0];
    $('#weeklyAgentRunStatus').textContent = latestRun
      ? `${String(latestRun.run_type).replaceAll('_', ' ')} · ${latestRun.status}`
      : data.scheduler?.enabled ? 'Scheduler enabled' : 'Scheduler disabled';
    renderAlerts(data.alerts || []);
  }

  async function loadOverview(force = false) {
    if (!force && state.loaded.has('overview')) return;
    try {
      const data = await api('/api/intelligence/overview');
      renderOverview(data);
      state.loaded.add('overview');
    } catch (error) { notify(error.message); }
  }

  function renderDeskArticle(row) {
    const content = parseJson(row?.content, {});
    $('#deskTitle').textContent = content.title || row?.title || "From Nirvana's Desk";
    $('#deskDek').textContent = content.dek || row?.dek || 'No nightly article has been generated yet.';
    const sections = $('#deskSections');
    sections.replaceChildren();
    for (const section of content.sections || []) {
      const article = document.createElement('section');
      article.className = 'desk-section';
      const heading = document.createElement('h3');
      heading.textContent = section.heading || 'Market note';
      const body = document.createElement('p');
      body.textContent = section.body || '';
      article.append(heading, body);
      sections.append(article);
    }
    if (!sections.children.length) sections.innerHTML = '<div class="empty-state-card">Run the nightly agent to create the first article.</div>';
    listItems($('#deskWatchItems'), content.watchItems, 'No watch item was generated.');
    listItems($('#deskRiskActions'), content.proactiveRiskActions, 'No risk action was generated.');
    listItems($('#deskShortTerm'), content.shortTermIdeas, 'No tactical scenario was generated.');
    listItems($('#deskLongTerm'), content.longTermIdeas, 'No long-term practice was generated.');
    const sourceBox = $('#deskSources');
    sourceBox.replaceChildren();
    for (const source of parseJson(row?.sources, [])) {
      const item = document.createElement('div');
      item.className = 'source-item';
      if (source.url) {
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = source.name || source.title || 'Research source';
        item.append(link);
      } else item.textContent = source.name || source.title || 'Research source';
      sourceBox.append(item);
    }
  }

  function renderDeskArchive(rows) {
    const list = $('#deskArchiveList');
    list.replaceChildren();
    rows.forEach((row, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `archive-item${index === 0 ? ' active' : ''}`;
      item.innerHTML = `<strong>${escapeHtml(row.title)}</strong><small>${formatDate(row.briefing_date)}</small>`;
      item.addEventListener('click', () => {
        $$('.archive-item', list).forEach((node) => node.classList.remove('active'));
        item.classList.add('active');
        renderDeskArticle(row);
      });
      list.append(item);
    });
    if (!rows.length) list.innerHTML = '<div class="empty-state-card">No editions yet.</div>';
  }

  async function loadDesk(force = false) {
    if (!force && state.loaded.has('desk')) return;
    try {
      state.desk = await api('/api/intelligence/desk?limit=21');
      renderDeskArchive(state.desk);
      renderDeskArticle(state.desk[0]);
      state.loaded.add('desk');
    } catch (error) { notify(error.message); }
  }

  function calendarCategory(type) {
    if (String(type).startsWith('dividend')) return 'dividend';
    if (type === 'interest') return 'interest';
    return 'earnings';
  }

  function renderCalendar() {
    const filter = $('#calendarTypeFilter').value;
    const list = $('#incomeCalendar');
    list.replaceChildren();
    const events = (state.calendar?.events || []).filter((event) => !filter || calendarCategory(event.type) === filter);
    for (const event of events) {
      const item = document.createElement('div');
      item.className = 'calendar-event';
      item.innerHTML = `<div class="calendar-date">${formatDate(event.date)}</div><div><span class="calendar-kind">${escapeHtml(calendarCategory(event.type))}</span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.source || '')}</small></div><strong>${event.estimatedAmount == null ? '' : money.format(event.estimatedAmount)}</strong>`;
      list.append(item);
    }
    if (!list.children.length) list.innerHTML = '<div class="empty-state-card">No matching upcoming event is available. Holding agents need current earnings and dividend dates.</div>';
  }

  async function loadCalendar(force = false) {
    if (!force && state.loaded.has('calendar')) return;
    try {
      state.calendar = await api('/api/intelligence/calendar');
      renderCalendar();
      state.loaded.add('calendar');
    } catch (error) { notify(error.message); }
  }

  function renderSpending(data) {
    state.spending = data;
    const body = $('#spendingActualRows');
    body.replaceChildren();
    for (const row of data.rows || []) {
      const tr = document.createElement('tr');
      const variance = row.variance;
      tr.innerHTML = `<td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(String(row.category || '').replaceAll('_', ' '))}</td><td>${money.format(row.planned || 0)}</td><td><input data-actual-expense="${row.id}" type="number" min="0" step="0.01" value="${row.actual ?? ''}" placeholder="Enter actual"></td><td class="${variance == null ? '' : variance > 0 ? 'variance-positive' : 'variance-negative'}">${variance == null ? '—' : `${variance > 0 ? '+' : ''}${money.format(variance)}`}</td><td><input data-actual-notes="${row.id}" type="text" value="${escapeHtml(row.notes || '')}" placeholder="Optional note"></td>`;
      body.append(tr);
    }
    if (!body.children.length) body.innerHTML = '<tr><td colspan="6" class="muted">No planned expenses are active for this month.</td></tr>';
    const reminders = $('#largeExpenseReminders');
    reminders.replaceChildren();
    for (const alert of data.reminders || []) {
      const item = document.createElement('div');
      item.className = 'reminder-item';
      item.innerHTML = `<div><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.summary)}</small></div>`;
      reminders.append(item);
    }
    if (!reminders.children.length) reminders.innerHTML = '<div class="empty-state-card">No large-expense reminder is open.</div>';

    destroyChart('spending');
    if (typeof Chart === 'undefined') return;
    const c = colors();
    charts.spending = new Chart($('#spendingActualChart'), {
      type: 'bar',
      data: {
        labels: (data.history || []).map((row) => row.month),
        datasets: [
          { label: 'Planned', data: data.history.map((row) => row.planned), backgroundColor: c.light, borderRadius: 5 },
          { label: 'Actual', data: data.history.map((row) => row.actual), backgroundColor: c.dark, borderRadius: 5 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { grid: { color: c.line }, ticks: { callback: (value) => money.format(value) } } } }
    });
  }

  async function loadSpending(force = false) {
    const month = $('#spendingMonth').value || new Date().toISOString().slice(0, 7);
    $('#spendingMonth').value = month;
    const key = `spending:${month}`;
    if (!force && state.loaded.has(key)) return;
    try {
      renderSpending(await api(`/api/intelligence/spending?month=${encodeURIComponent(month)}`));
      state.loaded.add(key);
    } catch (error) { notify(error.message); }
  }

  async function saveSpendingActuals() {
    const month = $('#spendingMonth').value;
    const entries = $$('[data-actual-expense]').filter((input) => input.value !== '').map((input) => ({
      expenseId: input.dataset.actualExpense,
      actualAmount: input.value,
      notes: $(`[data-actual-notes="${input.dataset.actualExpense}"]`)?.value || null
    }));
    try {
      await api('/api/intelligence/spending/actuals', { method: 'PUT', body: JSON.stringify({ month, entries }) });
      state.loaded.delete(`spending:${month}`);
      await loadSpending(true);
      notify(`Saved ${entries.length} actual expense entries for ${month}.`);
    } catch (error) { notify(error.message); }
  }

  function alertAction(alert) {
    closeAlerts();
    if (alert.action_view) $(`[data-view="${alert.action_view}"]`)?.click();
    if (alert.action_view === 'insights' && alert.action_tab) showIntelligenceTab(alert.action_tab);
    if (alert.action_view === 'holdings' && alert.action_tab) window.openNirvanaHoldingsTab?.(alert.action_tab);
  }

  function renderAlerts(rows) {
    state.alerts = rows;
    const count = $('#alertCount');
    count.textContent = String(rows.length);
    count.classList.toggle('hidden', rows.length === 0);
    const list = $('#alertsDrawerList');
    list.replaceChildren();
    for (const alert of rows) {
      const item = document.createElement('article');
      item.className = `alert-item ${alert.severity || 'info'}`;
      const top = document.createElement('div');
      top.className = 'alert-title-row';
      top.innerHTML = `<strong>${escapeHtml(alert.title)}</strong><span class="alert-severity">${escapeHtml(alert.severity || 'info')}</span>`;
      const summary = document.createElement('p');
      summary.textContent = alert.summary || '';
      const recommendation = document.createElement('small');
      recommendation.textContent = alert.recommendation || '';
      const actions = document.createElement('div');
      actions.className = 'alert-actions';
      if (alert.action_view) {
        const open = document.createElement('button');
        open.type = 'button'; open.className = 'button button-primary'; open.textContent = 'Review';
        open.addEventListener('click', () => alertAction(alert));
        actions.append(open);
      }
      const dismiss = document.createElement('button');
      dismiss.type = 'button'; dismiss.className = 'button button-secondary'; dismiss.textContent = 'Dismiss';
      dismiss.setAttribute('aria-label', `Dismiss ${alert.title}`);
      dismiss.addEventListener('click', async () => {
        dismiss.disabled = true;
        dismiss.textContent = 'Dismissing…';
        try {
          await api(`/api/intelligence/alerts/${alert.id}/dismiss`, { method: 'POST', body: '{}' });
          item.remove();
          state.alerts = state.alerts.filter((row) => row.id !== alert.id);
          count.textContent = String(state.alerts.length);
          count.classList.toggle('hidden', state.alerts.length === 0);
          if (!list.children.length) list.innerHTML = '<div class="empty-state-card">No open alert. Weekly agents will add meaningful drift, goal, and spending items here.</div>';
        } catch (error) {
          dismiss.disabled = false;
          dismiss.textContent = 'Dismiss';
          notify(error.message);
        }
      });
      actions.append(dismiss);
      item.append(top, summary, recommendation, actions);
      list.append(item);
    }
    if (!list.children.length) list.innerHTML = '<div class="empty-state-card">No open alert. Weekly agents will add meaningful drift, goal, and spending items here.</div>';
  }

  async function loadAlerts(force = false) {
    if (!force && state.loaded.has('alerts')) return;
    try {
      renderAlerts(await api('/api/intelligence/alerts'));
      state.loaded.add('alerts');
    } catch (error) { console.warn('Could not load alerts:', error.message); }
  }

  function openAlerts() {
    const dialog = $('#alertsDrawer');
    const backdrop = $('#alertsBackdrop');
    if (!dialog || !backdrop) return;
    window.clearTimeout(alertsCloseTimer);
    alertsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('#alertBell');
    dialog.hidden = false;
    backdrop.hidden = false;
    dialog.setAttribute('aria-hidden', 'false');
    $('#alertBell')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('alerts-open');
    window.requestAnimationFrame(() => {
      dialog.classList.add('open');
      $('#alertsClose')?.focus();
    });
    loadAlerts(true);
  }

  function closeAlerts() {
    const dialog = $('#alertsDrawer');
    const backdrop = $('#alertsBackdrop');
    if (!dialog || dialog.hidden) return;
    dialog.classList.remove('open');
    dialog.setAttribute('aria-hidden', 'true');
    $('#alertBell')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('alerts-open');
    window.clearTimeout(alertsCloseTimer);
    alertsCloseTimer = window.setTimeout(() => {
      dialog.hidden = true;
      backdrop.hidden = true;
    }, 190);
    alertsReturnFocus?.focus?.();
  }

  async function resetDriftTargets() {
    try {
      const result = await api('/api/intelligence/alerts/targets/reset', { method: 'POST', body: '{}' });
      notify(`Saved ${result.saved || 0} current positions as the drift reference mix.`);
      await loadAlerts(true);
    } catch (error) { notify(error.message); }
  }

  async function runWeeklyAgents() {
    const button = $('#runWeeklyAgents');
    const status = $('#weeklyAgentRunStatus');
    button.disabled = true;
    try {
      const result = await api('/api/intelligence/run-now', { method: 'POST', body: JSON.stringify({ type: 'weekly' }) });
      status.textContent = 'Weekly agents running in background';
      notify(result.message || 'Weekly agent run started.');
      const run = await waitForAgentRun(result.runId, status);
      if (run.status === 'failed') throw new Error(run.error_text || 'Weekly agent run failed.');
      if (run.timedOut) {
        notify('The weekly agent is still running. You may leave this page; results will appear when it finishes.');
        return;
      }
      ['overview', 'alerts', 'desk', 'calendar', 'research'].forEach((key) => state.loaded.delete(key));
      await Promise.all([loadOverview(true), loadAlerts(true)]);
      if (state.activeIntelligenceTab === 'desk') await loadDesk(true);
      if (state.activeIntelligenceTab === 'calendar') await loadCalendar(true);
      notify('Weekly forecast, research, alerts, goals, and financial briefing were refreshed.');
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  }

  function renderHoldingResearch() {
    const search = $('#holdingResearchSearch').value.trim().toLowerCase();
    const rating = $('#holdingResearchRating').value;
    const rows = (state.research || []).filter((row) => {
      const matchesSearch = !search || `${row.symbol} ${row.company_name || row.holding_name || ''}`.toLowerCase().includes(search);
      return matchesSearch && (!rating || row.consensus_rating === rating);
    });
    const body = $('#holdingResearchRows');
    body.replaceChildren();
    for (const row of rows) {
      const currentPrice = Number(row.saved_price || row.research_price || 0);
      const target = Number(row.analyst_target_price || 0);
      const upside = row.target_upside_pct;
      const upcoming = [row.next_earnings_date ? `Earnings ${formatDate(row.next_earnings_date)}` : null, row.next_dividend_pay_date ? `Dividend ${formatDate(row.next_dividend_pay_date)}` : null].filter(Boolean).join(' · ');
      const ratings = parseJson(row.rating_counts, {});
      const ratingSummary = [
        ['Strong buy', ratings.strongBuy ?? ratings.strong_buy],
        ['Buy', ratings.buy],
        ['Hold', ratings.hold],
        ['Sell', ratings.sell],
        ['Strong sell', ratings.strongSell ?? ratings.strong_sell]
      ].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${value}`).join(' · ');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.company_name || row.holding_name || '')}</small></td><td>${money.format(row.current_value || 0)}<small>${currentPrice ? `${money.format(currentPrice)} / share` : 'Price missing'}</small></td><td>${target ? money.format(target) : '—'}<small>${upside == null ? '' : `${upside >= 0 ? '+' : ''}${percent.format(upside)}% vs current`}</small></td><td><span class="street-rating">${escapeHtml(row.consensus_rating || 'Unrated')}</span><small>${escapeHtml(ratingSummary || 'No street rating count')}</small></td><td><div class="research-summary">${escapeHtml(row.earnings_summary || 'Research agent has not produced an earnings summary yet.')}</div><div class="research-source-links"></div></td><td>${escapeHtml(upcoming || 'No saved date')}</td><td>${row.researched_at ? new Date(row.researched_at).toLocaleString() : 'Not run'}</td>`;
      const sourceLinks = $('.research-source-links', tr);
      const sources = parseJson(row.source_payload, {}).sources || [];
      for (const source of sources.slice(0, 3)) {
        if (!source?.url) continue;
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = source.name || source.title || 'Source';
        sourceLinks.append(link);
      }
      body.append(tr);
    }
    if (!body.children.length) body.innerHTML = '<tr><td colspan="7" class="muted">No holding research matches the filter.</td></tr>';
    $('#holdingResearchStatus').textContent = `${state.research?.length || 0} holdings · ${state.research?.filter((row) => row.researched_at).length || 0} researched`;
  }

  async function loadHoldingResearch(force = false) {
    if (!force && state.loaded.has('research')) { renderHoldingResearch(); return; }
    try {
      $('#holdingResearchStatus').textContent = 'Loading holding research…';
      state.research = await api('/api/intelligence/holding-research');
      renderHoldingResearch();
      state.loaded.add('research');
    } catch (error) { notify(error.message); }
  }

  async function refreshHoldingResearch() {
    const button = $('#refreshHoldingResearch');
    const status = $('#holdingResearchStatus');
    button.disabled = true;
    try {
      const result = await api('/api/intelligence/holding-research/refresh', { method: 'POST', body: '{}' });
      status.textContent = 'Research agents running in background';
      notify(result.message);
      const run = await waitForAgentRun(result.runId, status);
      if (run.status === 'failed') throw new Error(run.error_text || 'Holding research refresh failed.');
      if (run.timedOut) {
        notify('Holding research is still running. Results will appear when the agent finishes.');
        return;
      }
      state.loaded.delete('research');
      state.loaded.delete('overview');
      state.loaded.delete('alerts');
      await Promise.all([loadHoldingResearch(true), loadAlerts(true)]);
      await window.loadNirvanaDashboard?.();
      notify('Holding prices, earnings summaries, street targets, and ratings were refreshed.');
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  }

  function renderGoals(data) {
    state.goals = data;
    const active = (data.goals || []).filter((goal) => goal.status === 'active');
    $('#activeGoalCount').textContent = String(active.length);
    setMoney('#goalTargetTotal', active.reduce((sum, goal) => sum + Number(goal.progress?.target || 0), 0));
    setMoney('#goalCurrentTotal', active.reduce((sum, goal) => sum + Number(goal.progress?.current || 0), 0));
    setMoney('#goalRemainingTotal', active.reduce((sum, goal) => sum + Number(goal.progress?.remaining || 0), 0), false);
    const cards = $('#goalCards');
    cards.replaceChildren();
    for (const goal of data.goals || []) {
      const progress = goal.progress || {};
      const card = document.createElement('article');
      card.className = 'goal-card';
      card.innerHTML = `<div class="goal-card-head"><div><h3>${escapeHtml(goal.name)}</h3><small>${escapeHtml(String(goal.goal_type).replaceAll('_', ' '))} · ${escapeHtml(goal.priority)} priority</small></div><span class="status-pill neutral">${escapeHtml(goal.status)}</span></div><progress max="100" value="${progress.progressPct || 0}"></progress><p><strong>${percent.format(progress.progressPct || 0)}%</strong> funded${goal.target_date ? ` · target ${formatDate(goal.target_date)}` : ''}</p><div class="goal-card-metrics"><div><span>Current</span><strong>${money.format(progress.current || 0)}</strong></div><div><span>Remaining</span><strong>${money.format(progress.remaining || 0)}</strong></div><div><span>Target</span><strong>${money.format(progress.target || 0)}</strong></div><div><span>Monthly needed</span><strong>${progress.monthlyNeeded == null ? '—' : money.format(progress.monthlyNeeded)}</strong></div></div>`;
      card.addEventListener('click', () => openGoalEditor(goal));
      cards.append(card);
    }
    if (!cards.children.length) cards.innerHTML = '<div class="empty-state-card">No goal yet. Add one and link the accounts that fund it.</div>';
    renderGoalAccountOptions([]);
  }

  async function loadGoals(force = false) {
    if (!force && state.loaded.has('goals')) return;
    try {
      renderGoals(await api('/api/goals'));
      state.loaded.add('goals');
    } catch (error) { notify(error.message); }
  }

  function renderGoalAccountOptions(selectedIds = []) {
    const selected = new Set((selectedIds || []).map(String));
    const container = $('#goalAccountOptions');
    container.replaceChildren();
    for (const account of state.goals?.accounts || []) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" name="linkedAccountIds" value="${account.id}" ${selected.has(String(account.id)) ? 'checked' : ''}><span>${escapeHtml(account.name)} · ${money.format(account.current_balance || 0)}</span>`;
      container.append(label);
    }
    if (!container.children.length) container.innerHTML = '<div class="empty-state-card">Add accounts first or use a manual current amount.</div>';
  }

  function openGoalEditor(goal = null) {
    state.editingGoalId = goal?.id || null;
    const form = $('#goalForm');
    form.reset();
    form.id.value = goal?.id || '';
    form.name.value = goal?.name || '';
    form.goalType.value = goal?.goal_type || 'other';
    form.targetAmount.value = goal?.target_amount ?? '';
    form.targetDate.value = goal?.target_date ? String(goal.target_date).slice(0, 10) : '';
    form.manualCurrentAmount.value = goal?.manual_current_amount ?? 0;
    form.priority.value = goal?.priority || 'medium';
    form.status.value = goal?.status || 'active';
    form.notes.value = goal?.notes || '';
    renderGoalAccountOptions(goal?.linked_account_ids || []);
    $('#goalEditorTitle').textContent = goal ? `Edit ${goal.name}` : 'Add goal';
    $('#deleteGoalButton').classList.toggle('hidden', !goal);
    $('#goalEditorPanel').classList.remove('hidden');
    form.name.focus();
  }

  function closeGoalEditor() {
    state.editingGoalId = null;
    $('#goalEditorPanel').classList.add('hidden');
  }

  async function saveGoal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      name: form.name.value,
      goalType: form.goalType.value,
      targetAmount: form.targetAmount.value,
      targetDate: form.targetDate.value || null,
      manualCurrentAmount: form.manualCurrentAmount.value || 0,
      linkedAccountIds: $$('input[name="linkedAccountIds"]:checked', form).map((input) => input.value),
      priority: form.priority.value,
      status: form.status.value,
      notes: form.notes.value || null
    };
    try {
      const editing = Boolean(state.editingGoalId);
      await api(editing ? `/api/goals/${state.editingGoalId}` : '/api/goals', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeGoalEditor();
      state.loaded.delete('goals');
      await loadGoals(true);
      await loadAlerts(true);
      notify(editing ? 'Goal updated.' : 'Goal added.');
    } catch (error) { notify(error.message); }
  }

  async function deleteGoal() {
    if (!state.editingGoalId || !window.confirm('Delete this goal?')) return;
    try {
      await api(`/api/goals/${state.editingGoalId}`, { method: 'DELETE' });
      closeGoalEditor();
      state.loaded.delete('goals');
      await loadGoals(true);
      notify('Goal deleted.');
    } catch (error) { notify(error.message); }
  }

  function renderSharing(data) {
    state.sharing = data;
    $('#householdRoleBadge').textContent = data.role === 'owner' ? 'Primary owner' : 'Shared partner';
    const members = $('#householdMembers');
    members.replaceChildren();
    for (const member of data.members || []) {
      const item = document.createElement('div');
      item.className = 'member-item';
      const avatar = member.avatar_url ? `<img class="member-avatar" src="${escapeHtml(member.avatar_url)}" alt="">` : '<div class="member-avatar"></div>';
      item.innerHTML = `${avatar}<div class="member-copy"><strong>${escapeHtml(member.display_name)}</strong><span>${escapeHtml(member.email)}</span><small>${escapeHtml(member.role)}</small></div>`;
      if (data.role === 'owner' && member.role !== 'owner') {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'row-action danger'; remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Remove ${member.email} from this household?`)) return;
          try { await api(`/api/household/member/${member.id}`, { method: 'DELETE' }); await loadSharing(true); }
          catch (error) { notify(error.message); }
        });
        item.append(remove);
      }
      members.append(item);
    }
    const invites = $('#householdInvites');
    invites.replaceChildren();
    for (const invite of (data.invites || []).filter((row) => row.status === 'pending')) {
      const item = document.createElement('div');
      item.className = 'member-item';
      item.innerHTML = `<div class="member-copy"><strong>${escapeHtml(invite.email)}</strong><span>Pending Google sign-in</span><small>Invited ${new Date(invite.created_at).toLocaleDateString()}</small></div>`;
      if (data.role === 'owner') {
        const revoke = document.createElement('button');
        revoke.type = 'button'; revoke.className = 'row-action danger'; revoke.textContent = 'Revoke';
        revoke.addEventListener('click', async () => {
          try { await api(`/api/household/invite/${invite.id}`, { method: 'DELETE' }); await loadSharing(true); }
          catch (error) { notify(error.message); }
        });
        item.append(revoke);
      }
      invites.append(item);
    }
    if (!invites.children.length) invites.innerHTML = '<div class="empty-state-card">No pending invitation.</div>';
    $('#partnerInviteForm').classList.toggle('hidden', data.role !== 'owner');
    const memberships = $('#householdMemberships');
    memberships.replaceChildren();
    for (const membership of data.memberships || []) {
      const item = document.createElement('div');
      item.className = `household-switch-item${membership.id === data.activeHouseholdId ? ' active' : ''}`;
      item.innerHTML = `<div><strong>${escapeHtml(membership.name)}</strong><small>${escapeHtml(membership.role)}</small></div>`;
      if (membership.id !== data.activeHouseholdId) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button button-secondary'; button.textContent = 'Open household';
        button.addEventListener('click', async () => {
          try { await api('/api/household/switch', { method: 'POST', body: JSON.stringify({ householdId: membership.id }) }); window.location.reload(); }
          catch (error) { notify(error.message); }
        });
        item.append(button);
      }
      memberships.append(item);
    }
  }

  async function loadSharing(force = false) {
    if (!force && state.loaded.has('sharing')) return;
    try { renderSharing(await api('/api/household')); state.loaded.add('sharing'); }
    catch (error) { notify(error.message); }
  }

  async function invitePartner(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api('/api/household/invite', { method: 'POST', body: JSON.stringify({ email: form.email.value, role: 'member' }) });
      form.reset();
      state.loaded.delete('sharing');
      await loadSharing(true);
      const delivery = result.emailDelivery || {};
      if (result.status === 'accepted') {
        notify(delivery.sent
          ? 'Partner already had a Nirvana login, was added, and received a notification email.'
          : 'Partner already had a Nirvana login and was added.');
      } else if (delivery.sent) {
        notify('Partner invitation email sent. They should sign in with that exact Google address.');
      } else if (delivery.skipped) {
        notify('Partner invitation saved. Email delivery is not configured, but they can still sign in with that Google address.');
      } else {
        notify('Partner invitation saved, but the email could not be sent. They can still sign in with that Google address.');
      }
    } catch (error) { notify(error.message); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $$('[data-intelligence-tab]').forEach((button) => button.addEventListener('click', () => showIntelligenceTab(button.dataset.intelligenceTab)));
    $$('[data-accounts-tab]').forEach((button) => button.addEventListener('click', () => showAccountsTab(button.dataset.accountsTab)));

    $('[data-view="insights"]')?.addEventListener('click', () => showIntelligenceTab(state.activeIntelligenceTab));
    $('[data-view="goals"]')?.addEventListener('click', () => loadGoals());
    $('[data-view="accounts"]')?.addEventListener('click', () => showAccountsTab('accounts'));
    document.addEventListener('click', (event) => {
      if (event.target.closest('#accountsList .row-action, #accountForm, #liabilityForm')) showAccountsTab('accounts');
    }, true);

    $('#alertBell')?.addEventListener('click', openAlerts);
    $('#alertsClose')?.addEventListener('click', closeAlerts);
    $('#alertsBackdrop')?.addEventListener('click', closeAlerts);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#alertsDrawer')?.hidden) closeAlerts();
    });
    $('#resetDriftTargetsDrawer')?.addEventListener('click', resetDriftTargets);
    $('#resetPortfolioTargets')?.addEventListener('click', resetDriftTargets);
    $('#runWeeklyAgents')?.addEventListener('click', runWeeklyAgents);
    $('#printIntelligence')?.addEventListener('click', () => window.print());
    $('#printDesk')?.addEventListener('click', () => window.print());
    $('#calendarTypeFilter')?.addEventListener('change', renderCalendar);
    $('#spendingMonth')?.addEventListener('change', () => loadSpending(true));
    $('#saveExpenseActuals')?.addEventListener('click', saveSpendingActuals);

    document.addEventListener('nirvana:load-holding-research', () => loadHoldingResearch());
    $('#refreshHoldingResearch')?.addEventListener('click', refreshHoldingResearch);
    $('#holdingResearchSearch')?.addEventListener('input', renderHoldingResearch);
    $('#holdingResearchRating')?.addEventListener('change', renderHoldingResearch);

    $('#addGoalButton')?.addEventListener('click', () => openGoalEditor());
    $('#closeGoalEditor')?.addEventListener('click', closeGoalEditor);
    $('#goalForm')?.addEventListener('submit', saveGoal);
    $('#deleteGoalButton')?.addEventListener('click', deleteGoal);

    $('#partnerInviteForm')?.addEventListener('submit', invitePartner);

    const month = new Date().toISOString().slice(0, 7);
    if ($('#spendingMonth')) $('#spendingMonth').value = month;
    showIntelligenceTab(state.activeIntelligenceTab);
    showAccountsTab(state.activeAccountsTab);
    loadAlerts();
    window.setTimeout(() => loadOverview(), 300);
  });
})();
