export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, system, max_tokens = 4000 } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const body = { model: 'claude-sonnet-4-6', max_tokens, messages };
  if (system) body.system = system;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) return res.status(500).json({ error: data.error?.message });

  res.json(data);
}