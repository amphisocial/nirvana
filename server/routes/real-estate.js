import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { loadRetirementData } from '../services/retirement-service.js';
import {
  calculateMonthlyMortgagePayment,
  simulateHouseholdWhatIf
} from '../services/what-if-engine.js';
import {
  calculateRentalEconomics,
  estimatePropertyMarket
} from '../services/real-estate-intelligence.js';

export const realEstateRouter = Router();

const propertyInputSchema = z.object({
  address: z.string().max(240).optional().nullable(),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/, 'Enter a valid US ZIP code').optional().nullable(),
  homeType: z.enum(['single_family', 'condo', 'townhome', 'multi_family', 'apartment', 'other']).default('single_family'),
  bedrooms: z.coerce.number().int().min(0).max(20).optional().nullable(),
  bathrooms: z.coerce.number().min(0).max(20).optional().nullable(),
  squareFeet: z.coerce.number().int().min(100).max(100000).optional().nullable(),
  propertyValue: z.coerce.number().min(0).optional().nullable(),
  monthlyRent: z.coerce.number().min(0).optional().nullable(),
  annualPropertyTax: z.coerce.number().min(0).optional().nullable(),
  annualInsurance: z.coerce.number().min(0).optional().nullable(),
  monthlyHoa: z.coerce.number().min(0).optional().nullable(),
  monthlyMaintenance: z.coerce.number().min(0).optional().nullable(),
  vacancyRate: z.coerce.number().min(0).max(0.5).optional().nullable(),
  managementRate: z.coerce.number().min(0).max(0.5).optional().nullable(),
  rentGrowthRate: z.coerce.number().min(-0.1).max(0.2).optional().nullable(),
  annualAppreciationRate: z.coerce.number().min(-0.2).max(0.2).optional().nullable()
});

const fundingSourceSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.coerce.number().min(0)
});

const scenarioSchema = z.object({
  name: z.string().min(1).max(160).default('Scenario rental property'),
  purchaseAge: z.coerce.number().int().min(18).max(120),
  horizonYears: z.coerce.number().int().min(1).max(40).default(10),
  property: propertyInputSchema.extend({
    propertyValue: z.coerce.number().positive(),
    monthlyRent: z.coerce.number().min(0),
    annualAppreciationRate: z.coerce.number().min(-0.2).max(0.2).default(0.03),
    rentGrowthRate: z.coerce.number().min(-0.1).max(0.2).default(0.03),
    vacancyRate: z.coerce.number().min(0).max(0.5).default(0.05),
    managementRate: z.coerce.number().min(0).max(0.5).default(0.08),
    annualPropertyTax: z.coerce.number().min(0).default(0),
    annualInsurance: z.coerce.number().min(0).default(0),
    monthlyHoa: z.coerce.number().min(0).default(0),
    monthlyMaintenance: z.coerce.number().min(0).default(0)
  }),
  closingCostPct: z.coerce.number().min(0).max(0.2).default(0.03),
  fundingSources: z.array(fundingSourceSchema).max(3).default([]),
  mortgageAmount: z.coerce.number().min(0).optional().nullable(),
  mortgageInterestRate: z.coerce.number().min(0).max(0.5).default(0.065),
  mortgageTermMonths: z.coerce.number().int().min(12).max(600).default(360),
  monthlyMortgagePayment: z.coerce.number().min(0).optional().nullable(),
  depositAccountId: z.string().uuid().optional().nullable()
});

function trimAnalysis(analysis, currentAge, horizonYears) {
  const maxAge = currentAge + horizonYears;
  const trim = (simulation) => ({
    ...simulation,
    endAge: Math.min(simulation.endAge, maxAge),
    timeline: simulation.timeline.filter((row) => row.age <= maxAge)
  });
  const baseline = trim(analysis.baseline);
  const alternative = trim(analysis.alternative);
  const baselineEnd = baseline.timeline.at(-1);
  const alternativeEnd = alternative.timeline.at(-1);
  return {
    ...analysis,
    baseline,
    alternative,
    metrics: {
      ...analysis.metrics,
      netWorthAtEndBaseline: Number(baselineEnd?.netWorth || 0),
      netWorthAtEndScenario: Number(alternativeEnd?.netWorth || 0),
      netWorthAtEndChange: Number(alternativeEnd?.netWorth || 0) - Number(baselineEnd?.netWorth || 0)
    }
  };
}

realEstateRouter.post('/estimate', async (req, res, next) => {
  try {
    const value = propertyInputSchema.parse(req.body);
    if (!value.address && !value.zipCode) return res.status(400).json({ error: 'Enter a property address or ZIP code' });
    const estimate = await estimatePropertyMarket(value);
    const economics = calculateRentalEconomics({
      ...estimate,
      propertyValue: value.propertyValue,
      monthlyRent: estimate.estimatedMonthlyRent,
      cashInvested: value.propertyValue
    });
    res.json({ estimate, economics, persisted: false });
  } catch (error) {
    next(error);
  }
});

realEstateRouter.post('/scenario', async (req, res, next) => {
  try {
    const value = scenarioSchema.parse(req.body);
    if (!value.property.address && !value.property.zipCode) return res.status(400).json({ error: 'Enter a property address or ZIP code' });
    const accountIds = [...new Set([
      ...value.fundingSources.map((row) => row.accountId),
      value.depositAccountId
    ].filter(Boolean))];
    const ownedAccounts = accountIds.length
      ? await pool.query(
          `SELECT id, name, account_type, current_balance::float8 AS current_balance
           FROM accounts WHERE household_id=$1 AND id = ANY($2::uuid[])`,
          [req.householdId, accountIds]
        )
      : { rows: [] };
    const accountMap = new Map(ownedAccounts.rows.map((row) => [row.id, row]));
    for (const id of accountIds) {
      if (!accountMap.has(id)) return res.status(400).json({ error: 'A selected funding or deposit account is unavailable' });
    }

    const totalCost = value.property.propertyValue * (1 + value.closingCostPct);
    const requestedFunding = value.fundingSources.reduce((sum, row) => sum + row.amount, 0);
    const mortgageAmount = value.mortgageAmount == null
      ? Math.max(0, totalCost - requestedFunding)
      : value.mortgageAmount;
    const monthlyMortgagePayment = value.monthlyMortgagePayment == null
      ? calculateMonthlyMortgagePayment(mortgageAmount, value.mortgageInterestRate, value.mortgageTermMonths)
      : value.monthlyMortgagePayment;
    const closingCosts = value.property.propertyValue * value.closingCostPct;

    const data = await loadRetirementData(req.householdId);
    const currentAge = Number(data.plan?.current_age || 45);
    const propertyPurchase = {
      name: value.name,
      purchaseAge: value.purchaseAge,
      propertyValue: value.property.propertyValue,
      closingCosts,
      annualAppreciationRate: value.property.annualAppreciationRate,
      monthlyRent: value.property.monthlyRent,
      rentGrowthRate: value.property.rentGrowthRate,
      vacancyRate: value.property.vacancyRate,
      managementRate: value.property.managementRate,
      annualPropertyTax: value.property.annualPropertyTax,
      annualInsurance: value.property.annualInsurance,
      monthlyHoa: value.property.monthlyHoa,
      monthlyMaintenance: value.property.monthlyMaintenance,
      expenseGrowthRate: 0.03,
      fundingSources: value.fundingSources.map((row) => ({
        ...row,
        accountName: accountMap.get(row.accountId)?.name || 'Selected account'
      })),
      mortgageAmount,
      mortgageInterestRate: value.mortgageInterestRate,
      mortgageTermMonths: value.mortgageTermMonths,
      monthlyMortgagePayment,
      depositAccountId: value.depositAccountId || null,
      zipCode: value.property.zipCode,
      address: value.property.address || null,
      homeType: value.property.homeType,
      bedrooms: value.property.bedrooms,
      bathrooms: value.property.bathrooms,
      squareFeet: value.property.squareFeet
    };
    const analysis = simulateHouseholdWhatIf(data, {
      title: `Buy ${value.name}`,
      summary: `Purchase a ${value.property.homeType.replaceAll('_', ' ')} rental property for $${Math.round(value.property.propertyValue).toLocaleString('en-US')}.`,
      propertyPurchases: [propertyPurchase],
      notes: [
        'The property, mortgage, rental income and operating expenses are temporary scenario entries and are not saved.',
        'Rental income uses the household effective tax-rate assumption. Deductibility, depreciation, closing-cost tax treatment and sale taxes are excluded.',
        'Retirement-account liquidations do not include taxes or early-withdrawal penalties.'
      ]
    });
    const trimmed = trimAnalysis(analysis, currentAge, value.horizonYears);
    const economics = calculateRentalEconomics({
      propertyValue: value.property.propertyValue,
      monthlyRent: value.property.monthlyRent,
      vacancyRate: value.property.vacancyRate,
      managementRate: value.property.managementRate,
      annualPropertyTax: value.property.annualPropertyTax,
      annualInsurance: value.property.annualInsurance,
      monthlyHoa: value.property.monthlyHoa,
      monthlyMaintenance: value.property.monthlyMaintenance,
      monthlyMortgagePayment,
      cashInvested: Math.max(0, totalCost - mortgageAmount)
    });

    res.json({
      persisted: false,
      purchase: {
        totalCost,
        closingCosts,
        requestedFunding,
        mortgageAmount,
        monthlyMortgagePayment,
        fundingSources: propertyPurchase.fundingSources
      },
      property: value.property,
      economics,
      ...trimmed
    });
  } catch (error) {
    next(error);
  }
});
