(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const charts = {};
  let latestEstimate = null;
  let running = false;

  async function api(url, options = {}) {
    if (window.nirvanaApi) return window.nirvanaApi(url, options);
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message) {
    if (window.showNirvanaAlert) window.showNirvanaAlert(message);
    else window.alert(message);
  }

  function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function pct(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '—';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function setBusy(active, label = '') {
    running = active;
    ['#estimateSavedProperty', '#runRentalEstimate', '#runRentalScenario', '#resetRentalScenario']
      .forEach((selector) => {
        const button = $(selector);
        if (button) button.disabled = active;
      });
    if (label && $('#rentalEstimateStatus')) $('#rentalEstimateStatus').textContent = label;
  }

  function calculateMortgagePayment(principal, annualRate, termMonths) {
    const amount = Math.max(0, num(principal));
    const months = Math.max(1, Math.floor(num(termMonths, 360)));
    const rate = Math.max(0, num(annualRate)) / 12;
    if (!amount) return 0;
    if (!rate) return amount / months;
    return amount * rate / (1 - ((1 + rate) ** -months));
  }

  function rentalEconomics(values) {
    const rent = Math.max(0, num(values.monthlyRent));
    const vacancy = rent * Math.max(0, num(values.vacancyRate));
    const management = rent * Math.max(0, num(values.managementRate));
    const operating = vacancy + management
      + Math.max(0, num(values.annualPropertyTax)) / 12
      + Math.max(0, num(values.annualInsurance)) / 12
      + Math.max(0, num(values.monthlyHoa))
      + Math.max(0, num(values.monthlyMaintenance));
    const mortgage = Math.max(0, num(values.monthlyMortgagePayment));
    const noi = Math.max(0, rent - operating);
    const cashFlow = rent - operating - mortgage;
    const propertyValue = Math.max(0, num(values.propertyValue));
    const cashInvested = Math.max(0, num(values.cashInvested));
    return {
      operating,
      noi,
      cashFlow,
      capRate: propertyValue ? noi * 12 / propertyValue : null,
      cashOnCash: cashInvested ? cashFlow * 12 / cashInvested : null
    };
  }

  function renderSavedEconomics() {
    const form = $('#accountForm');
    const container = $('#savedRentalEconomics');
    if (!form || !container || !form.isRentalProperty?.checked) {
      if (container) container.replaceChildren();
      return;
    }
    const result = rentalEconomics({
      monthlyRent: form.rentalMonthlyIncome.value,
      vacancyRate: num(form.rentalVacancyRatePct.value) / 100,
      managementRate: num(form.rentalManagementRatePct.value) / 100,
      annualPropertyTax: form.rentalAnnualPropertyTax.value,
      annualInsurance: form.rentalAnnualInsurance.value,
      monthlyHoa: form.rentalMonthlyHoa.value,
      monthlyMaintenance: form.rentalMonthlyMaintenance.value,
      propertyValue: form.currentBalance.value
    });
    container.innerHTML = `
      <div><span>Operating costs / month</span><strong>${money.format(result.operating)}</strong></div>
      <div><span>Net operating income</span><strong>${money.format(result.noi)}</strong></div>
      <div><span>Before-mortgage cash flow</span><strong>${money.format(result.cashFlow)}</strong></div>`;
  }

  function propertyPayload(form) {
    return {
      address: form.propertyAddress.value || null,
      zipCode: form.propertyZip.value,
      homeType: form.propertyHomeType.value,
      bedrooms: form.propertyBedrooms.value || null,
      bathrooms: form.propertyBathrooms.value || null,
      squareFeet: form.propertySquareFeet.value || null,
      propertyValue: form.currentBalance.value || null,
      monthlyRent: form.rentalMonthlyIncome.value || null,
      vacancyRate: form.rentalVacancyRatePct.value === '' ? null : num(form.rentalVacancyRatePct.value) / 100,
      managementRate: form.rentalManagementRatePct.value === '' ? null : num(form.rentalManagementRatePct.value) / 100,
      annualPropertyTax: form.rentalAnnualPropertyTax.value || null,
      annualInsurance: form.rentalAnnualInsurance.value || null,
      monthlyHoa: form.rentalMonthlyHoa.value || null,
      monthlyMaintenance: form.rentalMonthlyMaintenance.value || null,
      rentGrowthRate: form.rentalRentGrowthRatePct.value === '' ? null : num(form.rentalRentGrowthRatePct.value) / 100,
      annualAppreciationRate: form.propertyGrowthRatePct.value === '' ? null : num(form.propertyGrowthRatePct.value) / 100
    };
  }

  function applyEstimateToAccountForm(estimate) {
    const form = $('#accountForm');
    if (!form) return;
    form.propertyGrowthRatePct.value = (num(estimate.annualAppreciationRate, .03) * 100).toFixed(1);
    if (form.isRentalProperty.checked) {
      form.rentalMonthlyIncome.value = Math.round(num(estimate.estimatedMonthlyRent));
      form.rentalRentGrowthRatePct.value = (num(estimate.rentGrowthRate, .03) * 100).toFixed(1);
      form.rentalVacancyRatePct.value = (num(estimate.vacancyRate, .05) * 100).toFixed(1);
      form.rentalManagementRatePct.value = (num(estimate.managementRate, .08) * 100).toFixed(1);
      form.rentalAnnualPropertyTax.value = Math.round(num(estimate.annualPropertyTax));
      form.rentalAnnualInsurance.value = Math.round(num(estimate.annualInsurance));
      form.rentalMonthlyHoa.value = Math.round(num(estimate.monthlyHoa));
      form.rentalMonthlyMaintenance.value = Math.round(num(estimate.monthlyMaintenance));
    }
    form.propertyEstimatePayload.value = JSON.stringify(estimate);
    const status = $('#propertyEstimateStatus');
    status.className = `property-estimate-status ${estimate.source === 'ai_web_research' ? 'success' : 'warning'}`;
    status.textContent = `${estimate.source === 'ai_web_research' ? 'AI ZIP estimate' : 'Planning fallback'} · appreciation ${pct(estimate.annualAppreciationRate)} · ${estimate.summary}`;
    renderSavedEconomics();
  }

  async function estimateSavedProperty() {
    const form = $('#accountForm');
    if (!form || form.accountType.value !== 'property') return;
    if (!form.propertyZip.value) return notify('Enter the property ZIP code first.');
    if (!(num(form.currentBalance.value) > 0)) return notify('Enter the current property value first.');
    setBusy(true);
    const status = $('#propertyEstimateStatus');
    status.textContent = 'Researching the ZIP code, local rent and medium-term appreciation…';
    try {
      const result = await api('/api/real-estate/estimate', {
        method: 'POST', body: JSON.stringify(propertyPayload(form))
      });
      applyEstimateToAccountForm(result.estimate);
    } catch (error) {
      status.className = 'property-estimate-status warning';
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  function populateAccountSelect(select, accounts, options = {}) {
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option(options.placeholder || 'Choose account', ''));
    accounts.filter((account) => {
      if (options.deposit) return ['cash', 'brokerage', 'hsa'].includes(account.account_type);
      return ['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa', 'other_asset'].includes(account.account_type);
    }).forEach((account) => {
      select.add(new Option(`${account.name} · ${account.account_type.replaceAll('_', ' ')} · ${money.format(account.current_balance)}`, account.id));
    });
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function populateAccounts(summary) {
    const accounts = summary?.accounts || [];
    populateAccountSelect($('#rentalDepositAccountSelect'), accounts, { deposit: true, placeholder: 'Use default cash account' });
    populateAccountSelect($('#rentalScenarioDepositAccount'), accounts, { deposit: true, placeholder: 'Use default cash account' });
    populateAccountSelect($('#rentalFundingAccount1'), accounts, { placeholder: 'Choose account' });
    populateAccountSelect($('#rentalFundingAccount2'), accounts, { placeholder: 'Optional second account' });
    const firstBrokerage = accounts.find((account) => account.account_type === 'brokerage');
    if (firstBrokerage && !$('#rentalFundingAccount1').value) $('#rentalFundingAccount1').value = firstBrokerage.id;
    const planAge = Number(summary?.retirementPlan?.current_age || 45);
    const purchaseAge = $('#rentalScenarioForm')?.purchaseAge;
    if (purchaseAge && !purchaseAge.value) purchaseAge.value = planAge + 1;
  }

  function renderEstimate(result) {
    latestEstimate = result.estimate;
    const estimate = result.estimate;
    $('#rentalEstimateStatus').className = `property-estimate-status ${estimate.source === 'ai_web_research' ? 'success' : 'warning'}`;
    $('#rentalEstimateStatus').textContent = `${estimate.source === 'ai_web_research' ? 'AI web-researched estimate' : 'Planning fallback'} · confidence ${pct(estimate.confidence)} · ${estimate.summary}`;
    const economics = result.economics || {};
    $('#rentalEstimateMetrics').innerHTML = `
      <div><span>Estimated monthly rent</span><strong>${money.format(estimate.estimatedMonthlyRent)}</strong></div>
      <div><span>Annual appreciation</span><strong>${pct(estimate.annualAppreciationRate)}</strong></div>
      <div><span>Operating costs / month</span><strong>${money.format(economics.monthlyOperatingExpenses || 0)}</strong></div>
      <div><span>Net operating income</span><strong>${money.format(economics.monthlyNetOperatingIncome || 0)}</strong></div>`;
    const sources = $('#rentalEstimateSources');
    sources.replaceChildren();
    (estimate.sources || []).forEach((source) => {
      const row = document.createElement('div');
      row.className = 'source-item';
      const title = escapeHtml(source.name || source.title || 'Web source');
      row.innerHTML = source.url
        ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${title}</a><small>Property estimate source</small>`
        : `<strong>${title}</strong>`;
      sources.append(row);
    });
    const form = $('#rentalEstimateForm');
    const scenario = $('#rentalScenarioForm');
    ['address', 'homeType', 'bedrooms', 'bathrooms', 'squareFeet', 'propertyValue']
      .forEach((name) => { scenario[name].value = form[name].value || ''; });
    scenario.zipCode.value = estimate.zipCode || form.zipCode.value || '';
    scenario.monthlyRent.value = Math.round(num(estimate.estimatedMonthlyRent));
    scenario.annualAppreciationPct.value = (num(estimate.annualAppreciationRate, .03) * 100).toFixed(1);
    scenario.rentGrowthPct.value = (num(estimate.rentGrowthRate, .03) * 100).toFixed(1);
    scenario.vacancyPct.value = (num(estimate.vacancyRate, .05) * 100).toFixed(1);
    scenario.managementPct.value = (num(estimate.managementRate, .08) * 100).toFixed(1);
    scenario.annualPropertyTax.value = Math.round(num(estimate.annualPropertyTax));
    scenario.annualInsurance.value = Math.round(num(estimate.annualInsurance));
    scenario.monthlyHoa.value = Math.round(num(estimate.monthlyHoa));
    scenario.monthlyMaintenance.value = Math.round(num(estimate.monthlyMaintenance));
    updateMortgagePreview();
  }

  async function runEstimate(event) {
    event.preventDefault();
    if (running) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.address && !values.zipCode) return notify('Enter a property address or ZIP code.');
    setBusy(true, 'Researching current local data…');
    try {
      const result = await api('/api/real-estate/estimate', {
        method: 'POST', body: JSON.stringify(values)
      });
      renderEstimate(result);
    } catch (error) {
      $('#rentalEstimateStatus').className = 'property-estimate-status warning';
      $('#rentalEstimateStatus').textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  function updateMortgagePreview() {
    const form = $('#rentalScenarioForm');
    if (!form) return;
    const price = num(form.propertyValue.value);
    const closing = price * num(form.closingCostPct.value) / 100;
    const funding = num(form.fundingAmount1.value) + num(form.fundingAmount2.value);
    const autoMortgage = Math.max(0, price + closing - funding);
    const mortgage = form.mortgageAmount.value === '' ? autoMortgage : num(form.mortgageAmount.value);
    if (form.mortgageAmount.value === '') form.mortgageAmount.placeholder = money.format(autoMortgage);
    if (form.monthlyMortgagePayment.value === '') {
      const payment = calculateMortgagePayment(
        mortgage,
        num(form.mortgageInterestRatePct.value) / 100,
        form.mortgageTermMonths.value
      );
      form.monthlyMortgagePayment.placeholder = money.format(payment);
    }
  }

  function scenarioPayload(form) {
    const fundingSources = [];
    [[form.fundingAccountId1.value, form.fundingAmount1.value], [form.fundingAccountId2.value, form.fundingAmount2.value]]
      .forEach(([accountId, amount]) => {
        if (accountId && num(amount) > 0) fundingSources.push({ accountId, amount });
      });
    return {
      name: form.name.value,
      purchaseAge: form.purchaseAge.value,
      horizonYears: form.horizonYears.value,
      closingCostPct: num(form.closingCostPct.value) / 100,
      fundingSources,
      mortgageAmount: form.mortgageAmount.value || null,
      mortgageInterestRate: num(form.mortgageInterestRatePct.value) / 100,
      mortgageTermMonths: form.mortgageTermMonths.value,
      monthlyMortgagePayment: form.monthlyMortgagePayment.value || null,
      depositAccountId: form.depositAccountId.value || null,
      property: {
        address: form.address.value || null,
        zipCode: form.zipCode.value,
        homeType: form.homeType.value || 'single_family',
        bedrooms: form.bedrooms.value || null,
        bathrooms: form.bathrooms.value || null,
        squareFeet: form.squareFeet.value || null,
        propertyValue: form.propertyValue.value,
        monthlyRent: form.monthlyRent.value,
        annualAppreciationRate: num(form.annualAppreciationPct.value) / 100,
        rentGrowthRate: num(form.rentGrowthPct.value) / 100,
        vacancyRate: num(form.vacancyPct.value) / 100,
        managementRate: num(form.managementPct.value) / 100,
        annualPropertyTax: form.annualPropertyTax.value || 0,
        annualInsurance: form.annualInsurance.value || 0,
        monthlyHoa: form.monthlyHoa.value || 0,
        monthlyMaintenance: form.monthlyMaintenance.value || 0
      }
    };
  }

  function chartColors() {
    return {
      baselineIncome: '#8ec5f4',
      scenarioIncome: '#075985',
      baselineExpense: '#f5b7b1',
      scenarioExpense: '#b42318',
      baselineNetWorth: '#83b9ed',
      scenarioNetWorth: '#0b3a67',
      property: '#1976c5',
      debt: '#b42318',
      line: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#d8e6f2'
    };
  }

  function replaceChart(name, canvas, config) {
    charts[name]?.destroy();
    if (typeof Chart === 'undefined' || !canvas) return;
    charts[name] = new Chart(canvas, config);
  }

  function renderScenario(result) {
    $('#rentalScenarioEmpty').classList.add('hidden');
    $('#rentalScenarioResults').classList.remove('hidden');
    $('#rentalScenarioTitle').textContent = result.scenario?.title || 'Rental-property scenario';
    $('#rentalScenarioSummary').textContent = result.scenario?.summary || '';
    const assumptions = $('#rentalScenarioAssumptions');
    assumptions.replaceChildren();
    [
      `Purchase: ${money.format(result.property?.propertyValue || 0)}`,
      `Cash funding: ${money.format(result.purchase?.requestedFunding || 0)}`,
      `Mortgage: ${money.format(result.purchase?.mortgageAmount || 0)}`,
      `Rent: ${money.format(result.property?.monthlyRent || 0)} / month`,
      `Appreciation: ${pct(result.property?.annualAppreciationRate)}`
    ].forEach((text) => {
      const chip = document.createElement('span');
      chip.className = 'whatif-assumption-chip';
      chip.textContent = text;
      assumptions.append(chip);
    });
    (result.scenario?.notes || []).forEach((text) => {
      const chip = document.createElement('span');
      chip.className = 'whatif-assumption-chip';
      chip.textContent = text;
      assumptions.append(chip);
    });
    const gap = num(result.metrics?.propertyFundingShortfall);
    $('#rentalScenarioFundingGap').textContent = gap > 0
      ? `Funding gap: ${money.format(gap)}. A selected funding account may appear below zero in the temporary scenario.`
      : 'The modeled purchase is fully funded by selected assets and the scenario mortgage.';
    const economics = result.economics || {};
    $('#rentalMonthlyCashFlow').textContent = money.format(economics.monthlyCashFlow || 0);
    $('#rentalCapRate').textContent = pct(economics.capRate);
    $('#rentalCashOnCash').textContent = pct(economics.cashOnCashReturn);
    $('#rentalNetWorthChange').textContent = money.format(result.metrics?.netWorthAtEndChange || 0);
    $('#rentalMortgageAdded').textContent = money.format(result.purchase?.mortgageAmount || 0);

    const baseline = result.baseline?.timeline || [];
    const scenario = result.alternative?.timeline || [];
    const colors = chartColors();
    const labels = baseline.map((row) => row.year);
    replaceChart('cashflow', $('#realEstateCashflowChart'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Baseline income', data: baseline.map((row) => row.monthlyIncome), borderColor: colors.baselineIncome, backgroundColor: colors.baselineIncome, borderWidth: 2, pointRadius: 0, tension: .2 },
        { label: 'Scenario income', data: scenario.map((row) => row.monthlyIncome), borderColor: colors.scenarioIncome, backgroundColor: colors.scenarioIncome, borderWidth: 3, pointRadius: 0, tension: .2 },
        { label: 'Baseline expenses', data: baseline.map((row) => row.monthlyExpenses), borderColor: colors.baselineExpense, backgroundColor: colors.baselineExpense, borderWidth: 2, pointRadius: 0, tension: .2 },
        { label: 'Scenario expenses', data: scenario.map((row) => row.monthlyExpenses), borderColor: colors.scenarioExpense, backgroundColor: colors.scenarioExpense, borderWidth: 3, pointRadius: 0, tension: .2 }
      ] },
      options: chartOptions(colors, true)
    });
    replaceChart('networth', $('#realEstateNetWorthChart'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Baseline net worth', data: baseline.map((row) => row.netWorth), borderColor: colors.baselineNetWorth, backgroundColor: colors.baselineNetWorth, borderWidth: 2, pointRadius: 0, tension: .2 },
        { label: 'Rental scenario net worth', data: scenario.map((row) => row.netWorth), borderColor: colors.scenarioNetWorth, backgroundColor: colors.scenarioNetWorth, borderWidth: 3, pointRadius: 0, tension: .2 }
      ] },
      options: chartOptions(colors, true)
    });
    replaceChart('assetdebt', $('#realEstateAssetDebtChart'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Scenario real estate', data: scenario.map((row) => row.realEstate), borderColor: colors.property, backgroundColor: colors.property, borderWidth: 3, pointRadius: 0, tension: .2 },
        { label: 'Scenario total debt', data: scenario.map((row) => row.debt), borderColor: colors.debt, backgroundColor: colors.debt, borderWidth: 3, pointRadius: 0, tension: .2 }
      ] },
      options: chartOptions(colors, true)
    });
    window.setTimeout(() => Object.values(charts).forEach((chart) => chart?.resize()), 50);
  }

  function chartOptions(colors, currency) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: colors.line }, ticks: { callback: (value) => currency ? money.format(value) : value } }
      }
    };
  }

  async function runScenario(event) {
    event.preventDefault();
    if (running) return;
    const form = event.currentTarget;
    if (!form.zipCode.value && !form.address.value) return notify('Run the property estimate or enter an address or ZIP code first.');
    setBusy(true);
    try {
      const result = await api('/api/real-estate/scenario', {
        method: 'POST', body: JSON.stringify(scenarioPayload(form))
      });
      renderScenario(result);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  function resetScenario() {
    const form = $('#rentalScenarioForm');
    form.reset();
    form.name.value = 'Scenario rental property';
    form.closingCostPct.value = '3.0';
    form.annualAppreciationPct.value = '3.0';
    form.rentGrowthPct.value = '3.0';
    form.vacancyPct.value = '5.0';
    form.managementPct.value = '8.0';
    form.mortgageInterestRatePct.value = '6.5';
    form.mortgageTermMonths.value = '360';
    form.fundingAmount1.value = '200000';
    $('#rentalScenarioResults').classList.add('hidden');
    $('#rentalScenarioEmpty').classList.remove('hidden');
    Object.values(charts).forEach((chart) => chart?.destroy());
    Object.keys(charts).forEach((key) => delete charts[key]);
    if (window.nirvanaState?.summary) populateAccounts(window.nirvanaState.summary);
  }

  function toggleRentalFields() {
    const form = $('#accountForm');
    if (!form) return;
    const rental = Boolean(form.isRentalProperty?.checked);
    $('#rentalPropertyFields')?.classList.toggle('hidden', !rental);
    if (rental && form.isPrimaryResidence?.checked) form.isPrimaryResidence.checked = false;
    renderSavedEconomics();
  }

  document.addEventListener('nirvana:data-loaded', (event) => populateAccounts(event.detail?.summary));

  document.addEventListener('DOMContentLoaded', () => {
    if ($('#estimateSavedProperty')) $('#estimateSavedProperty').addEventListener('click', estimateSavedProperty);
    if ($('#rentalEstimateForm')) $('#rentalEstimateForm').addEventListener('submit', runEstimate);
    if ($('#rentalScenarioForm')) $('#rentalScenarioForm').addEventListener('submit', runScenario);
    if ($('#resetRentalScenario')) $('#resetRentalScenario').addEventListener('click', resetScenario);

    const accountForm = $('#accountForm');
    if (accountForm) {
      accountForm.isRentalProperty?.addEventListener('change', toggleRentalFields);
      accountForm.isPrimaryResidence?.addEventListener('change', () => {
        if (accountForm.isPrimaryResidence.checked && accountForm.isRentalProperty.checked) {
          accountForm.isRentalProperty.checked = false;
        }
        toggleRentalFields();
      });
      ['rentalMonthlyIncome', 'rentalVacancyRatePct', 'rentalManagementRatePct',
        'rentalAnnualPropertyTax', 'rentalAnnualInsurance', 'rentalMonthlyHoa',
        'rentalMonthlyMaintenance', 'currentBalance']
        .forEach((name) => accountForm[name]?.addEventListener('input', renderSavedEconomics));
    }

    const scenario = $('#rentalScenarioForm');
    if (scenario) {
      ['propertyValue', 'closingCostPct', 'fundingAmount1', 'fundingAmount2',
        'mortgageAmount', 'mortgageInterestRatePct', 'mortgageTermMonths']
        .forEach((name) => scenario[name]?.addEventListener('input', updateMortgagePreview));
    }

    if (window.nirvanaState?.summary) populateAccounts(window.nirvanaState.summary);
    toggleRentalFields();
  });
})();
