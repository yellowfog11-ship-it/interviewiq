import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import { sql } from '../_db.js';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const ONETIME_PRODUCT = process.env.POLAR_PRODUCT_ONETIME;
const HOURS_LIMIT = Number(process.env.SUBSCRIPTION_HOURS_LIMIT_PLACEHOLDER || 5);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.POLAR_WEBHOOK_SECRET) {
    console.error('POLAR_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const rawBody = await readRawBody(req);

  let event;
  try {
    event = validateEvent(rawBody, req.headers, process.env.POLAR_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
    console.error('Webhook validation error:', err);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  try {
    const eventId = req.headers['webhook-id'] || `${event.type}-${event.data.id}`;
    const inserted = await sql`
      insert into polar_webhook_events (id, type) values (${eventId}, ${event.type})
      on conflict (id) do nothing
      returning id
    `;
    if (inserted.length === 0) return res.status(200).json({ ok: true, deduped: true });

    const userId = event.data.metadata?.clerkUserId || event.data.customer?.externalId;
    if (!userId) {
      console.error('Webhook event with no resolvable user:', event.type, event.data.id);
      return res.status(200).json({ ok: true, warning: 'no user' });
    }

    await sql`insert into users (id) values (${userId}) on conflict (id) do nothing`;
    await sql`insert into entitlements (user_id) values (${userId}) on conflict (user_id) do nothing`;

    switch (event.type) {
      case 'order.paid':
        if (event.data.productId === ONETIME_PRODUCT) {
          await sql`update entitlements set one_time_credits = one_time_credits + 1, updated_at = now() where user_id = ${userId}`;
        }
        break;

      case 'subscription.active':
      case 'subscription.created': {
        const periodEnd = event.data.currentPeriodEnd;
        const existing = await sql`select current_period_end from entitlements where user_id = ${userId}`;
        const isNewPeriod = !existing[0]?.current_period_end ||
          new Date(existing[0].current_period_end).getTime() !== new Date(periodEnd).getTime();
        await sql`
          update entitlements set
            subscription_status = 'active',
            polar_customer_id = ${event.data.customerId},
            polar_subscription_id = ${event.data.id},
            hours_limit = ${HOURS_LIMIT},
            current_period_end = ${periodEnd},
            hours_used = case when ${isNewPeriod} then 0 else hours_used end,
            updated_at = now()
          where user_id = ${userId}
        `;
        break;
      }

      case 'subscription.canceled':
        await sql`update entitlements set subscription_status = 'canceled', updated_at = now() where user_id = ${userId}`;
        break;

      case 'subscription.revoked':
        await sql`update entitlements set subscription_status = 'revoked', updated_at = now() where user_id = ${userId}`;
        break;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
}
