import { Polar } from '@polar-sh/sdk';
import { requireUser } from './_auth.js';

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: process.env.POLAR_SERVER || 'sandbox',
});

const PRODUCTS = {
  onetime: process.env.POLAR_PRODUCT_ONETIME,
  subscription: process.env.POLAR_PRODUCT_SUBSCRIPTION,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const { plan } = req.body;
  const productId = PRODUCTS[plan];
  if (!productId) return res.status(400).json({ error: 'Invalid plan' });

  try {
    const origin = `https://${req.headers.host}`;
    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl: `${origin}/?checkout=success`,
      externalCustomerId: user.id,
      customerEmail: user.email || undefined,
      metadata: { clerkUserId: user.id, plan },
    });
    res.json({ url: checkout.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
}
