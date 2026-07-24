import { Router } from 'express';
import { z } from 'zod';
import {
  getHouseholdAgentSettings,
  saveHouseholdAgentSettings
} from '../services/agent-settings.js';

export const agentSettingsRouter = Router();

const settingsSchema = z.object({
  nightlyEnabled: z.boolean(),
  weeklyEnabled: z.boolean()
});

function options(req) {
  return { canEdit: req.householdRole === 'owner' };
}

agentSettingsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await getHouseholdAgentSettings(req.householdId, options(req)));
  } catch (error) {
    next(error);
  }
});

agentSettingsRouter.put('/', async (req, res, next) => {
  try {
    if (req.householdRole !== 'owner') {
      return res.status(403).json({ error: 'Only the household owner can change scheduled agents.' });
    }
    const value = settingsSchema.parse(req.body || {});
    res.json(await saveHouseholdAgentSettings(
      req.householdId,
      req.user?.id || null,
      value,
      options(req)
    ));
  } catch (error) {
    next(error);
  }
});
