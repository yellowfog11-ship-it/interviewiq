import { requireUser } from './_auth.js';
import { getEntitlement, canRun } from './_entitlements.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const ent = await getEntitlement(user.id);
  res.json({
    credits: ent?.one_time_credits ?? 0,
    subscription: {
      status: ent?.subscription_status ?? 'none',
      hoursUsed: ent ? Number(ent.hours_used) : 0,
      hoursLimit: ent?.hours_limit != null ? Number(ent.hours_limit) : null,
      currentPeriodEnd: ent?.current_period_end ?? null,
    },
    canRunAnalysis: canRun(ent).ok,
  });
}
