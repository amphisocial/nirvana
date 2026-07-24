(() => {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let current = null;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) window.location.href = '/';
    if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message) {
    if (window.showNirvanaAlert) window.showNirvanaAlert(message);
    else window.alert(message);
  }

  function scheduleText(settings, type) {
    const global = settings.global || {};
    if (type === 'nightly') {
      return `Daily after ${global.nightlyHour}:00 in ${global.timezone}`;
    }
    return `${DAYS[global.weeklyDay] || 'Scheduled day'} after ${global.weeklyHour}:00 in ${global.timezone}`;
  }

  function createPanel() {
    const hero = document.querySelector('#insights .intelligence-hero');
    if (!hero || document.querySelector('#agentScheduleControls')) return null;

    const panel = document.createElement('article');
    panel.id = 'agentScheduleControls';
    panel.className = 'panel agent-schedule-panel';
    panel.innerHTML = `
      <div class="panel-head agent-schedule-head">
        <div>
          <span class="panel-kicker">SCHEDULED AGENTS</span>
          <h2>Control automatic AI runs</h2>
          <p>Pause nightly or weekly Financial Center automation without disabling manual runs.</p>
        </div>
        <span id="agentScheduleOverallStatus" class="status-pill neutral">Loading…</span>
      </div>
      <div id="agentScheduleGlobalWarning" class="agent-schedule-warning" hidden></div>
      <div class="agent-schedule-grid">
        <label class="agent-schedule-option">
          <span class="agent-schedule-copy">
            <strong>Nightly Financial Center</strong>
            <small id="agentNightlyTiming">Daily schedule</small>
            <em>State snapshot, From Nirvana's Desk, expense and goal alerts.</em>
          </span>
          <span class="agent-switch">
            <input id="agentNightlyEnabled" type="checkbox">
            <span aria-hidden="true"></span>
          </span>
        </label>
        <label class="agent-schedule-option">
          <span class="agent-schedule-copy">
            <strong>Weekly Financial Center</strong>
            <small id="agentWeeklyTiming">Weekly schedule</small>
            <em>Holding research, forecast, drift, movement analysis and briefing.</em>
          </span>
          <span class="agent-switch">
            <input id="agentWeeklyEnabled" type="checkbox">
            <span aria-hidden="true"></span>
          </span>
        </label>
      </div>
      <div class="agent-schedule-actions">
        <div>
          <strong id="agentSchedulePermission">Household schedule</strong>
          <small id="agentScheduleNote">Manual “Run weekly agents now” remains available.</small>
        </div>
        <div class="inline-actions">
          <button id="pauseScheduledAgents" class="button button-secondary" type="button">Pause both</button>
          <button id="saveScheduledAgents" class="button button-primary" type="button">Save schedule</button>
        </div>
      </div>
      <p class="mini-disclaimer">Trading Desk overnight automation has its own setting under Holdings → Trading Desk → Settings. The server-wide AGENT_SCHEDULER_ENABLED flag remains the emergency kill switch for all scheduled workflows.</p>`;
    hero.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function render(settings) {
    current = settings;
    const nightly = document.querySelector('#agentNightlyEnabled');
    const weekly = document.querySelector('#agentWeeklyEnabled');
    if (!nightly || !weekly) return;

    nightly.checked = Boolean(settings.household?.nightlyEnabled);
    weekly.checked = Boolean(settings.household?.weeklyEnabled);
    document.querySelector('#agentNightlyTiming').textContent = scheduleText(settings, 'nightly');
    document.querySelector('#agentWeeklyTiming').textContent = scheduleText(settings, 'weekly');

    const canEdit = Boolean(settings.canEdit);
    nightly.disabled = !canEdit;
    weekly.disabled = !canEdit;
    document.querySelector('#saveScheduledAgents').disabled = !canEdit;
    document.querySelector('#pauseScheduledAgents').disabled = !canEdit;
    document.querySelector('#agentSchedulePermission').textContent =
      canEdit ? 'Household owner controls' : 'Read-only for shared members';

    const warning = document.querySelector('#agentScheduleGlobalWarning');
    const blocked = [];
    if (!settings.global?.schedulerEnabled) blocked.push('The server-wide scheduler is OFF.');
    else {
      if (!settings.global?.nightlyEnabled) blocked.push('Nightly agents are disabled server-wide.');
      if (!settings.global?.weeklyEnabled) blocked.push('Weekly agents are disabled server-wide.');
    }
    warning.hidden = blocked.length === 0;
    warning.textContent = blocked.join(' ');

    const effectiveNightly = Boolean(settings.effective?.nightlyEnabled);
    const effectiveWeekly = Boolean(settings.effective?.weeklyEnabled);
    const status = document.querySelector('#agentScheduleOverallStatus');
    status.textContent = effectiveNightly && effectiveWeekly
      ? 'Nightly + weekly on'
      : effectiveNightly
        ? 'Nightly only'
        : effectiveWeekly
          ? 'Weekly only'
          : 'Scheduled agents paused';
    status.className = `status-pill ${effectiveNightly || effectiveWeekly ? 'neutral' : 'warning'}`;

    document.querySelector('#agentScheduleNote').textContent = canEdit
      ? `Saved for this household${settings.household?.updatedAt ? ` · updated ${new Date(settings.household.updatedAt).toLocaleString()}` : ''}. Manual runs remain available.`
      : 'Only the primary household owner can change these switches.';
  }

  async function load() {
    createPanel();
    try {
      render(await api('/api/intelligence/agent-settings'));
    } catch (error) {
      const status = document.querySelector('#agentScheduleOverallStatus');
      if (status) {
        status.textContent = 'Could not load';
        status.className = 'status-pill warning';
      }
      console.error('Scheduled-agent settings failed:', error);
    }
  }

  async function save(nightlyEnabled, weeklyEnabled) {
    const saveButton = document.querySelector('#saveScheduledAgents');
    const pauseButton = document.querySelector('#pauseScheduledAgents');
    const original = saveButton?.textContent;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
    }
    if (pauseButton) pauseButton.disabled = true;
    try {
      const settings = await api('/api/intelligence/agent-settings', {
        method: 'PUT',
        body: JSON.stringify({ nightlyEnabled, weeklyEnabled })
      });
      render(settings);
      notify(nightlyEnabled || weeklyEnabled
        ? 'Scheduled-agent settings updated.'
        : 'Nightly and weekly Financial Center agents are paused.');
    } catch (error) {
      notify(error.message);
      if (current) render(current);
    } finally {
      if (saveButton) {
        saveButton.textContent = original || 'Save schedule';
        saveButton.disabled = !current?.canEdit;
      }
      if (pauseButton) pauseButton.disabled = !current?.canEdit;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    createPanel();
    document.querySelector('#saveScheduledAgents')?.addEventListener('click', () => {
      save(
        document.querySelector('#agentNightlyEnabled').checked,
        document.querySelector('#agentWeeklyEnabled').checked
      );
    });
    document.querySelector('#pauseScheduledAgents')?.addEventListener('click', () => {
      if (!window.confirm('Pause both nightly and weekly Financial Center agents for this household?')) return;
      save(false, false);
    });
    document.querySelector('[data-view="insights"]')?.addEventListener('click', load);
    load();
  });
})();
