import { Router } from 'express';
import { config } from '../config.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json({
    aiProvider: config.ai.provider,
    aiModel: config.ai.model,
    enabledSkills: config.ai.enabledSkills,
    marketDataProvider: config.market.provider,
    plaid: {
      enabled: config.plaid.enabled,
      aggregationMode: config.plaid.aggregationMode,
      environment: config.plaid.environment,
      phase: config.plaid.enabled ? 2 : 1,
      message: config.plaid.enabled
        ? 'Plaid connectivity is enabled.'
        : 'Phase 1 uses manual entry and CSV import. Plaid is configured as a Phase 2 feature flag.'
    },
    stripeEnabled: config.stripe.enabled,
    disclaimer: config.disclaimer
  });
});

settingsRouter.get('/plaid/status', (req, res) => {
  res.json({
    enabled: config.plaid.enabled,
    aggregationMode: config.plaid.aggregationMode,
    products: config.plaid.products,
    countryCodes: config.plaid.countryCodes,
    implementationStatus: config.plaid.enabled ? 'configuration-present-integration-required' : 'phase-2-disabled'
  });
});
