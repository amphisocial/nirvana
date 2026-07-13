import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMonthlyMortgagePayment,
  simulateHouseholdWhatIf
} from '../server/services/what-if-engine.js';
import {
  calculateRentalEconomics,
  normalizePropertyEstimate
} from '../server/services/real-estate-intelligence.js';

function fixture() {
  return {
    plan: {
      current_age: 50,
      retirement_age: 65,
      plan_end_age: 62,
      effective_tax_rate: 0.15
    },
    accounts: [
      { id: 'cash', name: 'Checking', account_type: 'cash', current_balance: 75000, expected_return: 0 },
      { id: 'stocks', name: 'Brokerage', account_type: 'brokerage', current_balance: 500000, expected_return: 0.06 }
    ],
    liabilities: [],
    incomes: [
      {
        id: 'salary',
        name: 'Salary',
        annual_amount: 150000,
        taxable: true,
        inflation_rate: 0,
        ends_at_retirement: true,
        deposit_account_id: 'cash'
      }
    ],
    expenses: [
      {
        id: 'living',
        name: 'Living expenses',
        category: 'other',
        annual_amount: 60000,
        inflation_rate: 0,
        retirement_behavior: 'same',
        payment_account_id: 'cash'
      }
    ],
    contributions: []
  };
}

test('mortgage payment calculation handles amortizing and zero-rate loans', () => {
  const payment = calculateMonthlyMortgagePayment(300000, 0.06, 360);
  assert.ok(payment > 1700 && payment < 1900);
  assert.equal(calculateMonthlyMortgagePayment(120000, 0, 120), 1000);
});

test('rental economics separates operating expenses from mortgage cash flow', () => {
  const result = calculateRentalEconomics({
    propertyValue: 500000,
    monthlyRent: 4000,
    vacancyRate: 0.05,
    managementRate: 0.08,
    annualPropertyTax: 6000,
    annualInsurance: 2400,
    monthlyHoa: 100,
    monthlyMaintenance: 350,
    monthlyMortgagePayment: 1800,
    cashInvested: 150000
  });
  assert.equal(Math.round(result.monthlyOperatingExpenses), 1670);
  assert.equal(Math.round(result.monthlyNetOperatingIncome), 2330);
  assert.equal(Math.round(result.monthlyCashFlow), 530);
  assert.ok(result.capRate > 0.05 && result.capRate < 0.06);
});

test('property estimate normalization keeps bounded planning assumptions', () => {
  const estimate = normalizePropertyEstimate({
    annualAppreciationRate: 0.5,
    estimatedMonthlyRent: 3200,
    vacancyRate: 0.04,
    confidence: 0.7
  }, {
    zipCode: '01845',
    propertyValue: 450000
  }, { source: 'ai_web_research' });
  assert.equal(estimate.zipCode, '01845');
  assert.equal(estimate.annualAppreciationRate, 0.2);
  assert.equal(estimate.estimatedMonthlyRent, 3200);
  assert.equal(estimate.source, 'ai_web_research');
});

test('rental purchase what-if liquidates assets, adds property and mortgage, and remains temporary', () => {
  const data = fixture();
  const original = structuredClone(data);
  const monthlyMortgagePayment = calculateMonthlyMortgagePayment(300000, 0.06, 360);
  const result = simulateHouseholdWhatIf(data, {
    title: 'Buy rental at 52',
    propertyPurchases: [{
      name: 'Scenario rental',
      purchaseAge: 52,
      propertyValue: 500000,
      closingCosts: 15000,
      annualAppreciationRate: 0.03,
      monthlyRent: 4000,
      rentGrowthRate: 0.03,
      vacancyRate: 0.05,
      managementRate: 0.08,
      annualPropertyTax: 6000,
      annualInsurance: 2400,
      monthlyHoa: 100,
      monthlyMaintenance: 350,
      fundingSources: [{ accountId: 'stocks', accountName: 'Brokerage', amount: 215000 }],
      mortgageAmount: 300000,
      mortgageInterestRate: 0.06,
      mortgageTermMonths: 360,
      monthlyMortgagePayment,
      depositAccountId: 'cash'
    }]
  });

  const baseline52 = result.baseline.timeline.find((row) => row.age === 52);
  const scenario52 = result.alternative.timeline.find((row) => row.age === 52);
  assert.ok(scenario52.realEstate >= 500000);
  assert.ok(scenario52.debt >= 300000);
  assert.ok(scenario52.fundingAccountBalance < baseline52.stockAccounts);
  assert.ok(scenario52.scenarioMonthlyRentalIncome > 0);
  assert.ok(scenario52.scenarioMonthlyPropertyExpenses > 0);
  assert.ok(scenario52.scenarioMonthlyMortgagePayment > 0);
  assert.equal(result.metrics.propertyCashInvested, 215000);
  assert.equal(result.metrics.propertyMortgageAdded, 300000);
  assert.deepEqual(data, original);
});

test('insufficient property funding is visible as a gap instead of shrinking the purchase', () => {
  const data = fixture();
  data.accounts.find((row) => row.id === 'stocks').current_balance = 50000;
  const result = simulateHouseholdWhatIf(data, {
    propertyPurchases: [{
      name: 'Underfunded rental',
      purchaseAge: 51,
      propertyValue: 300000,
      closingCosts: 9000,
      monthlyRent: 2500,
      fundingSources: [{ accountId: 'stocks', amount: 109000 }],
      mortgageAmount: 200000,
      mortgageInterestRate: 0.06,
      mortgageTermMonths: 360
    }]
  });
  const age51 = result.alternative.timeline.find((row) => row.age === 51);
  assert.ok(result.metrics.propertyFundingShortfall > 0);
  assert.ok(age51.fundingAccountBalance < 0);
  assert.ok(age51.realEstate >= 300000);
});
