import { Router } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { pool } from '../db.js';

export const stripeRouter = Router();
let stripe;

function getStripe() {
  if (!config.stripe.enabled || !config.stripe.secretKey) throw new Error('Stripe is not enabled or configured');
  stripe ||= new Stripe(config.stripe.secretKey);
  return stripe;
}

stripeRouter.get('/config', (req, res) => {
  res.json({ enabled: config.stripe.enabled, publishableKey: config.stripe.publishableKey || null });
});

stripeRouter.post('/checkout', async (req, res, next) => {
  try {
    if (!config.stripe.proPriceId) return res.status(503).json({ error: 'STRIPE_PRICE_PRO is not configured' });
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: config.stripe.proPriceId, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      customer_email: req.user?.email,
      client_reference_id: req.householdId,
      metadata: { household_id: req.householdId }
    });
    res.json({ url: session.url });
  } catch (error) { next(error); }
});

export async function stripeWebhookHandler(req, res) {
  if (!config.stripe.enabled || !config.stripe.webhookSecret) return res.status(503).send('Stripe webhook is not configured');
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (error) {
    return res.status(400).send(`Webhook signature verification failed: ${error.message}`);
  }

  try {
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const subscription = event.data.object;
      const householdId = subscription.metadata?.household_id;
      if (householdId) {
        await pool.query(`
          INSERT INTO subscriptions (household_id, stripe_customer_id, stripe_subscription_id, plan_code, status, current_period_end, updated_at)
          VALUES ($1, $2, $3, 'pro', $4, to_timestamp($5), now())
          ON CONFLICT (household_id) DO UPDATE SET
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            plan_code = EXCLUDED.plan_code,
            status = EXCLUDED.status,
            current_period_end = EXCLUDED.current_period_end,
            updated_at = now()`,
          [householdId, String(subscription.customer), subscription.id, subscription.status, subscription.current_period_end]
        );
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing failed', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
