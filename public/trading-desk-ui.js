/* Trading Desk & AI Inbox UI — talks to /api/trading-desk. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const api = (path, options) => window.nirvanaApi(path, options);
  const alertMsg = (m) => (window.showNirvanaAlert ? window.showNirvanaAlert(m) : window.alert(m));

  const STAGE_ORDER = ['scan', 'signals', 'plan', 'risk', 'decision'];
  const state = {
    loaded: false,
    isAdmin: false,
    enabled: false,
    settings: null,
    filter: 'pending',
    counts: {},
    selected: new Set()
  };

  const fmtMoney = (v) =>
    v == null ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ACTION_LABEL = { buy: 'Buy', add: 'Add', sell: 'Sell', trim: 'Trim', hold: 'Hold', new_idea: 'New idea' };
  const ORIGIN_LABEL = { holding: 'Owned', watchlist: 'Watchlist', discovery: 'Discovery' };

  // ---- Gate / settings --------------------------------------------------
  async function loadSettings() {
    const data = await api('/api/trading-desk/settings');
    state.isAdmin = data.isAdmin;
    state.enabled = data.settings.enabled;
    state.settings = data.settings;
    state.aiProvider = data.aiProvider;
    state.aiModel = data.aiModel;
    state.disclaimer = data.disclaimer;
    renderGate();
    if (state.enabled) {
      $('#deskProviderPill').textContent = `${data.aiProvider}·${data.aiModel}`;
      await Promise.all([loadWatchlist(), loadInbox()]);
    }
  }

  function renderGate() {
    const gate = $('#deskGate');
    const workspace = $('#deskWorkspace');
    if (state.enabled) {
      gate.hidden = true;
      workspace.hidden = false;
    } else {
      gate.hidden = false;
      workspace.hidden = true;
      $('#deskGateAdmin').hidden = !state.isAdmin;
      $('#deskGateMember').hidden = state.isAdmin;
    }
  }

  async function saveSettings(patch) {
    const data = await api('/api/trading-desk/settings', {
      method: 'PUT',
      body: JSON.stringify(patch)
    });
    state.settings = data.settings;
    state.enabled = data.settings.enabled;
    renderGate();
    return data.settings;
  }

  function openSettingsDrawer() {
    const s = state.settings || {};
    $('#deskSettingEnabled').checked = !!s.enabled;
    $('#deskSettingRisk').value = s.riskProfile || 'balanced';
    $('#deskSettingMaxPos').value = s.maxPositionPct ?? 10;
    $('#deskSettingMaxIdeas').value = s.maxNewIdeas ?? 3;
    $('#deskSettingCash').value = s.cashReservePct ?? 5;
    $('#deskSettingAutoRun').checked = !!s.autoRunEnabled;
    $('#deskSettingsDisclaimer').textContent =
      (state.disclaimer?.text || '') + ' The owner controls whether this feature is on.';
    // Non-admins can view but not change enablement.
    $('#deskSettingEnabled').disabled = !state.isAdmin;
    $('#deskSettingsDrawer').hidden = false;
  }
  function closeSettingsDrawer() { $('#deskSettingsDrawer').hidden = true; }

  // ---- Watchlist --------------------------------------------------------
  async function loadWatchlist() {
    const data = await api('/api/trading-desk/watchlist');
    const list = $('#deskWatchlist');
    if (!data.items.length) {
      list.innerHTML = '<li class="desk-watch-empty">No candidates yet. Add a ticker you\'re considering.</li>';
      return;
    }
    list.innerHTML = data.items.map((it) => `
      <li class="desk-watch-item" data-id="${it.id}">
        <div>
          <span class="sym">${esc(it.symbol)}</span>
          ${it.thesis ? `<div class="thesis">${esc(it.thesis)}</div>` : ''}
        </div>
        <button class="desk-watch-remove" type="button" data-remove="${it.id}" aria-label="Remove ${esc(it.symbol)}">✕</button>
      </li>`).join('');
  }

  async function addWatch(symbol, thesis) {
    await api('/api/trading-desk/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbol, thesis: thesis || null })
    });
    await loadWatchlist();
  }
  async function removeWatch(id) {
    await api(`/api/trading-desk/watchlist/${id}`, { method: 'DELETE' });
    await loadWatchlist();
  }

  // ---- Run pipeline -----------------------------------------------------
  function resetPipeline() {
    $$('.desk-stage').forEach((el) => el.classList.remove('is-active', 'is-done'));
  }
  function markStage(key) {
    const idx = STAGE_ORDER.indexOf(key);
    $$('.desk-stage').forEach((el) => {
      const i = STAGE_ORDER.indexOf(el.dataset.stage);
      el.classList.toggle('is-done', i < idx);
      el.classList.toggle('is-active', i === idx);
    });
  }
  function completePipeline() {
    $$('.desk-stage').forEach((el) => { el.classList.remove('is-active'); el.classList.add('is-done'); });
  }

  async function runAgent(options = {}) {
    const { scope = 'all', symbols = [], sourceButton = null } = options;
    const button = sourceButton || $('#deskRunButton');
    const allButtons = [$('#deskRunButton'), $('#deskScopedRunButton')].filter(Boolean);
    allButtons.forEach((b) => { b.disabled = true; });
    const note = $('#deskRunNote');
    note.classList.remove('error');
    resetPipeline();
    // Animate through stages while the request is in flight (best-effort).
    let animIndex = 0;
    markStage(STAGE_ORDER[0]);
    const anim = window.setInterval(() => {
      animIndex = Math.min(animIndex + 1, STAGE_ORDER.length - 1);
      markStage(STAGE_ORDER[animIndex]);
    }, 700);

    try {
      note.textContent = scope === 'symbols'
        ? `Agent running — analyzing ${symbols.join(', ')}…`
        : 'Agent running — scanning holdings and watchlist…';
      const result = await api('/api/trading-desk/run', {
        method: 'POST',
        body: JSON.stringify({ maxLiveSymbols: 24, scope, symbols })
      });
      window.clearInterval(anim);
      completePipeline();
      note.textContent = `${result.summary} Reviewed with ${result.provider}·${result.model}.`;
      state.filter = 'pending';
      syncFilterButtons();
      await loadInbox();
    } catch (error) {
      window.clearInterval(anim);
      resetPipeline();
      note.classList.add('error');
      note.textContent = error.message || 'The agent run could not be completed.';
      if (error.message && /empty|None of the requested/i.test(error.message)) {
        note.textContent = scope === 'symbols'
          ? 'None of those symbols could be evaluated. Check the tickers and try again.'
          : 'Add at least one holding or watchlist symbol before running the agent.';
      }
    } finally {
      allButtons.forEach((b) => { b.disabled = false; });
    }
  }

  // ---- Inbox ------------------------------------------------------------
  function syncFilterButtons() {
    $$('[data-inbox-filter]').forEach((b) => {
      const active = b.dataset.inboxFilter === state.filter;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderCounts() {
    $$('[data-count]').forEach((el) => { el.textContent = state.counts[el.dataset.count] ?? 0; });
    const badge = $('#deskInboxTabBadge');
    const pending = state.counts.pending ?? 0;
    if (badge) { badge.hidden = pending === 0; badge.textContent = pending; }
  }

  async function loadInbox() {
    const data = await api(`/api/trading-desk/inbox?status=${encodeURIComponent(state.filter)}`);
    state.counts = data.counts || {};
    renderCounts();
    state.selected.clear();
    updateBulkBar();
    renderInbox(data.recommendations || []);
  }

  function convictionMeter(conviction) {
    const level = conviction === 'high' ? 3 : conviction === 'medium' ? 2 : 1;
    return `<span class="conviction-meter" aria-label="Conviction ${esc(conviction)}">${
      [1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')
    }</span>`;
  }

  function planGrid(rec) {
    if (!rec.target_price && !rec.entry_zone_low) return '';
    const cells = [];
    if (rec.entry_zone_low) cells.push(`<div class="cell"><span>Entry</span><strong>${fmtMoney(rec.entry_zone_low)}–${fmtMoney(rec.entry_zone_high).replace('$','')}</strong></div>`);
    if (rec.target_price) cells.push(`<div class="cell target"><span>Target</span><strong>${fmtMoney(rec.target_price)}</strong></div>`);
    if (rec.stop_price) cells.push(`<div class="cell stop"><span>Stop</span><strong>${fmtMoney(rec.stop_price)}</strong></div>`);
    if (rec.rr_ratio) cells.push(`<div class="cell"><span>R:R</span><strong>1:${Number(rec.rr_ratio).toFixed(2)}</strong></div>`);
    if (rec.suggested_weight_pct) cells.push(`<div class="cell"><span>Weight</span><strong>${Number(rec.suggested_weight_pct).toFixed(1)}%</strong></div>`);
    return `<div class="memo-plan">${cells.join('')}</div>`;
  }

  function detailBlock(rec) {
    const signals = (rec.signals || []).map((s) => {
      const cls = s.bias === 'bullish' ? 'bull' : s.bias === 'bearish' ? 'bear' : '';
      return `<span class="memo-chip ${cls}">${esc(s.label)}${s.detail ? ` · ${esc(s.detail)}` : ''}</span>`;
    }).join('');
    const risks = (rec.risk_checks || []).map((r) =>
      `<span class="memo-chip ${r.ok ? 'risk-ok' : 'risk-fail'}">${esc(r.name)}: ${esc(r.detail)}</span>`
    ).join('');
    const gaps = (rec.data_gaps || []).length
      ? `<div class="memo-gaps">Watch: ${(rec.data_gaps || []).map(esc).join('; ')}</div>` : '';
    return `
      <button class="memo-detail-toggle" type="button" data-toggle-detail>Show signals &amp; risk checks ▾</button>
      <div class="memo-detail">
        ${signals ? `<div class="memo-chips">${signals}</div>` : ''}
        ${risks ? `<div class="memo-chips">${risks}</div>` : ''}
        ${gaps}
      </div>`;
  }

  function reviewFooter(rec) {
    if (rec.review_status === 'pending') {
      return `<div class="memo-actions">
        <button class="memo-btn approve" data-review="approve" data-id="${rec.id}">Approve</button>
        <button class="memo-btn watch" data-review="watchlist" data-id="${rec.id}">Watch</button>
        <button class="memo-btn snooze" data-review="snooze" data-id="${rec.id}">Snooze</button>
        <button class="memo-btn reject" data-review="reject" data-id="${rec.id}">Reject</button>
      </div>`;
    }
    const label = { approved: 'Approved', watchlisted: 'Watching', rejected: 'Rejected', snoozed: 'Snoozed' }[rec.review_status] || rec.review_status;
    return `<div class="memo-reviewed">
      <span class="badge ${esc(rec.review_status)}">${esc(label)}</span>
      ${rec.review_note ? `<span>· ${esc(rec.review_note)}</span>` : ''}
      <button class="memo-reopen" data-review="reopen" data-id="${rec.id}">Reopen</button>
    </div>`;
  }

  function memoCard(rec) {
    const selectable = rec.review_status === 'pending';
    const hasChart = (rec.chart_points ?? 0) > 0 || rec.reference_price != null;
    return `
    <div class="desk-memo" data-action="${esc(rec.action)}" data-reviewstatus="${esc(rec.review_status)}" data-id="${rec.id}" data-symbol="${esc(rec.symbol)}">
      <div class="memo-rail"></div>
      <div class="memo-body">
        <div class="memo-top">
          <div class="memo-id">
            ${selectable ? `<input type="checkbox" class="memo-check" data-select="${rec.id}" aria-label="Select ${esc(rec.symbol)}">` : ''}
            <div>
              <button class="memo-symbol memo-symbol-link" type="button" data-open-chart="${rec.id}" title="View charts & trade plan for ${esc(rec.symbol)}">${esc(rec.symbol)}<span class="memo-symbol-chart" aria-hidden="true">📈</span></button>
              ${rec.company_name ? `<span class="memo-company">${esc(rec.company_name)}</span>` : ''}
              <div class="memo-origin">${esc(ORIGIN_LABEL[rec.origin] || rec.origin)}${rec.time_horizon ? ` · ${esc(rec.time_horizon)}` : ''}</div>
            </div>
          </div>
          <span class="memo-action-chip" data-a="${esc(rec.action)}">${esc(ACTION_LABEL[rec.action] || rec.action)}</span>
        </div>
        <div class="memo-conviction">
          ${convictionMeter(rec.conviction)}
          <small>${esc(rec.conviction)} conviction${rec.confidence_score != null ? ` · ${Math.round(rec.confidence_score)}/100` : ''}</small>
        </div>
        <p class="memo-thesis">${esc(rec.thesis)}</p>
        ${miniSparkAndPlan(rec)}
        ${detailBlock(rec)}
        <div class="memo-quick-actions">
          <button class="memo-link-btn" type="button" data-open-chart="${rec.id}">View charts &amp; plan →</button>
          <button class="memo-link-btn" type="button" data-rerun="${esc(rec.symbol)}" title="Re-run the agent for ${esc(rec.symbol)}">↻ Re-analyze</button>
        </div>
        ${reviewFooter(rec)}
      </div>
    </div>`;
  }

  // A compact inline sparkline (if we have analytics) beside the plan grid.
  function miniSparkAndPlan(rec) {
    const plan = planGrid(rec);
    return plan;
  }

  function renderInbox(list) {
    const container = $('#deskInbox');
    const empty = $('#deskInboxEmpty');
    if (!list.length) {
      container.innerHTML = '';
      empty.hidden = false;
      const messages = {
        pending: ['Inbox zero.', 'No recommendations waiting. Run the agent to generate a fresh batch.'],
        approved: ['Nothing approved yet.', 'Approved recommendations will collect here.'],
        watchlisted: ['Nothing on watch.', 'Recommendations you choose to monitor appear here.'],
        rejected: ['Nothing rejected.', 'Passed-on recommendations are kept here for the record.']
      };
      const [h, p] = messages[state.filter] || ['Nothing here.', ''];
      empty.innerHTML = `<strong>${h}</strong>${p}`;
      return;
    }
    empty.hidden = true;
    container.innerHTML = list.map(memoCard).join('');
  }

  async function review(id, action, extra = {}) {
    await api(`/api/trading-desk/inbox/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, ...extra })
    });
    await loadInbox();
  }

  async function bulkReview(action) {
    if (!state.selected.size) return;
    await api('/api/trading-desk/inbox/bulk-review', {
      method: 'POST',
      body: JSON.stringify({ ids: [...state.selected], action })
    });
    await loadInbox();
  }

  function updateBulkBar() {
    const bar = $('#deskBulkBar');
    const n = state.selected.size;
    bar.hidden = n === 0;
    if (n) $('#deskBulkCount').textContent = `${n} selected`;
  }

  // ---- Per-symbol chart drawer -----------------------------------------
  function openChartDrawer() { $('#deskChartDrawer').hidden = false; }
  function closeChartDrawer() { $('#deskChartDrawer').hidden = true; }

  async function showChart(recId) {
    const drawer = $('#deskChartDrawer');
    const content = $('#deskChartContent');
    $('#deskChartTitle').textContent = 'Loading…';
    content.innerHTML = '<div class="desk-chart-loading">Loading analysis…</div>';
    openChartDrawer();
    try {
      const data = await api(`/api/trading-desk/chart/${recId}`);
      renderChart(data);
    } catch (error) {
      content.innerHTML = `<div class="desk-chart-loading error">${esc(error.message || 'Could not load the chart.')}</div>`;
    }
  }

  function renderChart(data) {
    const rec = data.recommendation;
    const history = data.history || [];
    $('#deskChartKicker').textContent = `${ACTION_LABEL[rec.action] || rec.action} · ${rec.conviction} conviction`;
    $('#deskChartTitle').textContent = `${rec.symbol}${rec.companyName ? ' · ' + rec.companyName : ''}`;

    const priceChart = buildPriceChartSVG(history, rec);
    const stats = analyticsStats(rec.analytics, rec);
    const signalBars = signalStrengthSVG(rec);
    const planTable = planDetailTable(rec);

    $('#deskChartContent').innerHTML = `
      <div class="chart-section">
        <div class="chart-section-head">
          <span class="chart-section-title">Price &amp; trade plan</span>
          <span class="chart-source">${esc(data.historySource || '')}</span>
        </div>
        ${priceChart}
        <div class="chart-legend">
          <span class="lg lg-price">Price</span>
          ${rec.entryZoneLow ? '<span class="lg lg-entry">Entry zone</span>' : ''}
          ${rec.targetPrice ? '<span class="lg lg-target">Target</span>' : ''}
          ${rec.stopPrice ? '<span class="lg lg-stop">Stop</span>' : ''}
        </div>
      </div>

      ${planTable}

      <div class="chart-section">
        <div class="chart-section-head"><span class="chart-section-title">Signal strength</span></div>
        ${signalBars}
      </div>

      <div class="chart-section">
        <div class="chart-section-head"><span class="chart-section-title">Key metrics</span></div>
        ${stats}
      </div>

      <div class="chart-section">
        <div class="chart-section-head"><span class="chart-section-title">Thesis</span></div>
        <p class="chart-thesis">${esc(rec.thesis || '')}</p>
        ${(rec.dataGaps || []).length ? `<p class="chart-gaps">Watch: ${(rec.dataGaps || []).map(esc).join('; ')}</p>` : ''}
      </div>

      <div class="chart-actions">
        <button class="button button-secondary" type="button" data-chart-rerun="${esc(rec.symbol)}">↻ Re-analyze ${esc(rec.symbol)}</button>
        ${rec.reviewStatus === 'pending' ? `
          <button class="button button-primary" type="button" data-chart-review="approve" data-id="${rec.id}">Approve</button>
          <button class="button button-secondary" type="button" data-chart-review="reject" data-id="${rec.id}">Reject</button>
        ` : `<span class="status-pill neutral">${esc(rec.reviewStatus)}</span>`}
      </div>
    `;
  }

  // Build an SVG line chart of price with entry-zone band + target/stop lines.
  function buildPriceChartSVG(history, rec) {
    const W = 640, H = 280, padL = 52, padR = 64, padT = 16, padB = 28;
    if (!history.length) {
      return '<div class="desk-chart-loading">No price history available for this symbol.</div>';
    }
    const closes = history.map((p) => p.close).filter((c) => Number.isFinite(c));
    const levels = [rec.entryZoneLow, rec.entryZoneHigh, rec.targetPrice, rec.stopPrice, rec.referencePrice]
      .filter((v) => Number.isFinite(v));
    const lo = Math.min(...closes, ...levels);
    const hi = Math.max(...closes, ...levels);
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
    const yMin = lo - pad, yMax = hi + pad;

    const x = (i) => padL + (i / (history.length - 1 || 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);

    const linePath = history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${x(history.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${padL},${(H - padB).toFixed(1)} Z`;

    // Y grid labels (4 ticks)
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const val = yMax - f * (yMax - yMin);
      return `<line x1="${padL}" y1="${y(val).toFixed(1)}" x2="${W - padR}" y2="${y(val).toFixed(1)}" class="grid"/>
              <text x="${padL - 8}" y="${(y(val) + 3).toFixed(1)}" class="axis-y">${fmtMoney(val).replace('$','')}</text>`;
    }).join('');

    const rightLabel = (v, cls, text) => Number.isFinite(v) ? `
      <line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="lvl ${cls}"/>
      <text x="${W - padR + 6}" y="${(y(v) + 3).toFixed(1)}" class="lvl-label ${cls}">${text}</text>` : '';

    const entryBand = (Number.isFinite(rec.entryZoneLow) && Number.isFinite(rec.entryZoneHigh)) ? `
      <rect x="${padL}" y="${y(rec.entryZoneHigh).toFixed(1)}" width="${W - padL - padR}"
            height="${Math.max(2, (y(rec.entryZoneLow) - y(rec.entryZoneHigh))).toFixed(1)}" class="entry-band"/>` : '';

    // Date labels (first / mid / last)
    const dateLabel = (i) => history[i] ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="axis-x" text-anchor="${i === 0 ? 'start' : i === history.length - 1 ? 'end' : 'middle'}">${history[i].date}</text>` : '';

    return `<svg class="price-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price chart for ${esc(rec.symbol)}">
      ${ticks}
      ${entryBand}
      <path d="${areaPath}" class="price-area"/>
      <path d="${linePath}" class="price-line"/>
      ${rightLabel(rec.targetPrice, 'target', 'TP')}
      ${rightLabel(rec.stopPrice, 'stop', 'SL')}
      ${rightLabel(rec.referencePrice, 'ref', 'Now')}
      ${dateLabel(0)}${dateLabel(Math.floor(history.length / 2))}${dateLabel(history.length - 1)}
    </svg>`;
  }

  function signalStrengthSVG(rec) {
    const signals = rec.signals || [];
    if (!signals.length) return '<p class="chart-gaps">No derived signals for this symbol.</p>';
    return `<div class="signal-bars">${signals.map((s) => {
      const bias = s.bias === 'bullish' ? 'bull' : s.bias === 'bearish' ? 'bear' : 'neutral';
      const pct = s.bias === 'bullish' ? 82 : s.bias === 'bearish' ? 30 : 55;
      return `<div class="signal-row">
        <span class="signal-name">${esc(s.label)}</span>
        <span class="signal-track"><span class="signal-fill ${bias}" style="width:${pct}%"></span></span>
        <span class="signal-detail">${esc(s.detail || bias)}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function planDetailTable(rec) {
    const rows = [];
    const money = (v) => Number.isFinite(v) ? fmtMoney(v) : '—';
    if (rec.entryZoneLow) rows.push(['Entry zone', `${money(rec.entryZoneLow)} – ${money(rec.entryZoneHigh)}`, 'entry']);
    if (rec.referencePrice) rows.push(['Reference price', money(rec.referencePrice), '']);
    if (rec.targetPrice) rows.push(['Target', money(rec.targetPrice), 'target']);
    if (rec.stopPrice) rows.push(['Stop loss', money(rec.stopPrice), 'stop']);
    if (rec.rrRatio) rows.push(['Reward : risk', `1 : ${Number(rec.rrRatio).toFixed(2)}`, '']);
    if (rec.suggestedWeightPct) rows.push(['Suggested weight', `${Number(rec.suggestedWeightPct).toFixed(1)}%`, '']);
    if (rec.invalidation) rows.push(['Invalidation', rec.invalidation, 'muted']);
    if (!rows.length) return '';
    return `<div class="chart-section"><div class="chart-section-head"><span class="chart-section-title">Trade plan</span></div>
      <table class="plan-table">${rows.map((r) => `<tr class="${r[2]}"><th>${esc(r[0])}</th><td>${esc(String(r[1]))}</td></tr>`).join('')}</table></div>`;
  }

  function analyticsStats(a = {}, rec) {
    const cells = [];
    const pct = (v) => Number.isFinite(v) ? `${Number(v).toFixed(1)}%` : '—';
    if (a.returnsPct?.oneYear != null) cells.push(['1-year return', pct(a.returnsPct.oneYear)]);
    if (a.returnsPct?.threeMonth != null) cells.push(['3-month return', pct(a.returnsPct.threeMonth)]);
    if (a.annualizedVolatilityPct != null) cells.push(['Volatility (annualized)', pct(a.annualizedVolatilityPct)]);
    if (a.maximumDrawdownPct != null) cells.push(['Max drawdown', pct(a.maximumDrawdownPct)]);
    if (a.beta != null) cells.push(['Beta vs SPY', Number(a.beta).toFixed(2)]);
    if (a.fiftyTwoWeekHigh != null) cells.push(['52-week high', fmtMoney(a.fiftyTwoWeekHigh)]);
    if (a.fiftyTwoWeekLow != null) cells.push(['52-week low', fmtMoney(a.fiftyTwoWeekLow)]);
    if (a.momentumState) cells.push(['Momentum', String(a.momentumState)]);
    if (!cells.length) return '<p class="chart-gaps">No analytics captured for this symbol.</p>';
    return `<div class="stat-grid">${cells.map((c) => `<div class="stat-cell"><span>${esc(c[0])}</span><strong>${esc(String(c[1]))}</strong></div>`).join('')}</div>`;
  }

  function parseSymbols(raw) {
    return [...new Set(String(raw || '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean))].slice(0, 25);
  }

  // ---- Events -----------------------------------------------------------
  function wire() {
    if (!$('#holdings')) return;

    $('#deskEnableButton')?.addEventListener('click', async () => {
      try { await saveSettings({ enabled: true }); await loadSettings(); }
      catch (e) { alertMsg(e.message); }
    });

    $('#deskSettingsButton')?.addEventListener('click', openSettingsDrawer);
    $$('[data-desk-close]').forEach((el) => el.addEventListener('click', closeSettingsDrawer));

    $('#deskSettingsForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const patch = {
        riskProfile: $('#deskSettingRisk').value,
        maxPositionPct: Number($('#deskSettingMaxPos').value),
        maxNewIdeas: Number($('#deskSettingMaxIdeas').value),
        cashReservePct: Number($('#deskSettingCash').value),
        autoRunEnabled: $('#deskSettingAutoRun').checked
      };
      if (state.isAdmin) patch.enabled = $('#deskSettingEnabled').checked;
      try {
        await saveSettings(patch);
        closeSettingsDrawer();
        await loadSettings();
      } catch (e) { alertMsg(e.message); }
    });

    $('#deskRunButton')?.addEventListener('click', () => runAgent({ scope: 'all' }));

    $('#deskScopedRunForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const symbols = parseSymbols($('#deskScopedSymbols').value);
      if (!symbols.length) {
        const note = $('#deskRunNote');
        note.classList.add('error');
        note.textContent = 'Enter one or more tickers (e.g. AAPL, NVDA) to run a scoped analysis.';
        return;
      }
      runAgent({ scope: 'symbols', symbols, sourceButton: $('#deskScopedRunButton') });
    });

    $('#deskWatchlistForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const symbol = $('#deskWatchSymbol').value.trim();
      const thesis = $('#deskWatchThesis').value.trim();
      if (!symbol) return;
      try {
        await addWatch(symbol, thesis);
        $('#deskWatchSymbol').value = '';
        $('#deskWatchThesis').value = '';
      } catch (e) { alertMsg(e.message); }
    });

    $('#deskWatchlist')?.addEventListener('click', async (event) => {
      const id = event.target.closest('[data-remove]')?.dataset.remove;
      if (id) { try { await removeWatch(id); } catch (e) { alertMsg(e.message); } }
    });

    $$('[data-inbox-filter]').forEach((b) =>
      b.addEventListener('click', () => {
        state.filter = b.dataset.inboxFilter;
        syncFilterButtons();
        loadInbox().catch((e) => alertMsg(e.message));
      })
    );

    // Delegated inbox interactions
    $('#deskInbox')?.addEventListener('click', async (event) => {
      const openChart = event.target.closest('[data-open-chart]');
      if (openChart) {
        showChart(openChart.dataset.openChart).catch((e) => alertMsg(e.message));
        return;
      }
      const rerun = event.target.closest('[data-rerun]');
      if (rerun) {
        runAgent({ scope: 'symbols', symbols: [rerun.dataset.rerun] });
        return;
      }
      const toggle = event.target.closest('[data-toggle-detail]');
      if (toggle) {
        const detail = toggle.nextElementSibling;
        const open = detail.classList.toggle('open');
        toggle.textContent = open ? 'Hide signals & risk checks ▴' : 'Show signals & risk checks ▾';
        return;
      }
      const reviewBtn = event.target.closest('[data-review]');
      if (reviewBtn) {
        const { review: action, id } = reviewBtn.dataset;
        try {
          if (action === 'reject' || action === 'snooze') {
            const note = window.prompt(action === 'reject' ? 'Optional note on why you passed:' : 'Snooze — optional note:');
            const extra = action === 'snooze' ? { snoozeDays: 7 } : {};
            if (note !== null && note.trim()) extra.note = note.trim();
            await review(id, action, extra);
          } else {
            await review(id, action);
          }
        } catch (e) { alertMsg(e.message); }
      }
    });

    // Chart drawer: close + internal actions
    $$('[data-chart-close]').forEach((el) => el.addEventListener('click', closeChartDrawer));
    $('#deskChartContent')?.addEventListener('click', async (event) => {
      const rerun = event.target.closest('[data-chart-rerun]');
      if (rerun) {
        closeChartDrawer();
        runAgent({ scope: 'symbols', symbols: [rerun.dataset.chartRerun] });
        return;
      }
      const reviewBtn = event.target.closest('[data-chart-review]');
      if (reviewBtn) {
        const { chartReview: action, id } = reviewBtn.dataset;
        try {
          if (action === 'reject') {
            const note = window.prompt('Optional note on why you passed:');
            const extra = {};
            if (note !== null && note.trim()) extra.note = note.trim();
            await review(id, action, extra);
          } else {
            await review(id, action);
          }
          closeChartDrawer();
        } catch (e) { alertMsg(e.message); }
      }
    });

    $('#deskInbox')?.addEventListener('change', (event) => {
      const cb = event.target.closest('[data-select]');
      if (!cb) return;
      const id = cb.dataset.select;
      if (cb.checked) state.selected.add(id); else state.selected.delete(id);
      updateBulkBar();
    });

    $('.desk-bulk-approve')?.addEventListener('click', () => bulkReview('approve').catch((e) => alertMsg(e.message)));
    $('.desk-bulk-watch')?.addEventListener('click', () => bulkReview('watchlist').catch((e) => alertMsg(e.message)));
    $('.desk-bulk-reject')?.addEventListener('click', () => bulkReview('reject').catch((e) => alertMsg(e.message)));
  }

  // Lazy-load when the Trading Desk tab is first opened.
  async function activate() {
    if (state.loaded) { renderCounts(); return; }
    try {
      await loadSettings();
      state.loaded = true;
    } catch (error) {
      alertMsg(error.message);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#holdings')) return;
    wire();
    // Hook the Trading Desk tab button so we load on demand.
    $$('[data-holdings-tab="desk"]').forEach((b) =>
      b.addEventListener('click', () => activate())
    );
    // Also refresh the pending badge once holdings tabs are known.
    window.openNirvanaTradingDesk = () => {
      window.openNirvanaHoldingsTab?.('desk');
      activate();
    };
  });
})();
