import { sql } from './_db.js';

const HOURS_LIMIT_DEFAULT = Number(process.env.SUBSCRIPTION_HOURS_LIMIT_PLACEHOLDER || 5);

export async function getEntitlement(userId) {
  const rows = await sql`select * from entitlements where user_id = ${userId}`;
  return rows[0] || null;
}

export function canRun(ent, estimatedHours = 0) {
  if (!ent) return { ok: false };
  if (ent.one_time_credits > 0) return { ok: true, via: 'credit' };

  const subUsable = ent.subscription_status === 'active' || ent.subscription_status === 'canceled';
  const withinPeriod = ent.current_period_end && new Date(ent.current_period_end) > new Date();
  const hoursLimit = Number(ent.hours_limit ?? HOURS_LIMIT_DEFAULT);
  if (subUsable && withinPeriod && Number(ent.hours_used) + estimatedHours <= hoursLimit) {
    return { ok: true, via: 'subscription' };
  }
  return { ok: false };
}

export async function consumeEntitlement(userId, via, hours = 0) {
  if (via === 'credit') {
    await sql`
      update entitlements set one_time_credits = one_time_credits - 1, updated_at = now()
      where user_id = ${userId} and one_time_credits > 0
    `;
  } else {
    await sql`
      update entitlements set hours_used = hours_used + ${hours}, updated_at = now()
      where user_id = ${userId}
    `;
  }
}
