import { requireUser } from './_auth.js';
import { sql } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const { id } = req.query;

  if (id) {
    const rows = await sql`
      select * from interviews where id = ${id} and user_id = ${user.id}
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  }

  const rows = await sql`
    select id, created_at, title, interview_type, target_level,
           analysis->>'overall_score' as overall_score,
           analysis->>'overall_verdict' as overall_verdict
    from interviews
    where user_id = ${user.id}
    order by created_at desc
  `;
  res.json(rows);
}
