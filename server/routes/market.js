import { Router } from 'express';
import { getHistory, getQuote, getResearch } from '../services/market/index.js';

export const marketRouter = Router();

marketRouter.get('/:symbol/history', async (req, res, next) => {
  try {
    const range = ['3m', '6m', 'ytd', '1y'].includes(req.query.range) ? req.query.range : '3m';
    res.json(await getHistory(req.params.symbol, range));
  } catch (error) { next(error); }
});

marketRouter.get('/:symbol/quote', async (req, res, next) => {
  try { res.json(await getQuote(req.params.symbol)); } catch (error) { next(error); }
});

marketRouter.get('/:symbol/research', async (req, res, next) => {
  try { res.json(await getResearch(req.params.symbol)); } catch (error) { next(error); }
});
