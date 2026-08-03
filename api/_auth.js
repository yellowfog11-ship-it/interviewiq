import { verifyToken } from '@clerk/backend';
import { sql } from './_db.js';

export async function verifyClerkToken(token) {
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    const user = { id: payload.sub, email: payload.email || null };
    await sql`
      insert into users (id, email) values (${user.id}, ${user.email})
      on conflict (id) do update set email = coalesce(excluded.email, users.email)
    `;
    return user;
  } catch {
    return null;
  }
}

export function requireUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return verifyClerkToken(token);
}
