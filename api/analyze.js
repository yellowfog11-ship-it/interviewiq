export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, system, max_tokens = 16000 } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const body = { model: 'claude-sonnet-4-6', max_tokens, messages };
  if (system) body.system = system + '\n\nCRITICAL: Your response must be valid JSON. Escape all quotes inside strings. No newlines inside string values.';

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

  const analysisText = data.content?.[0]?.text || '{}';
  let analysis;
  try {
    const cleaned = analysisText
      .replace(/```json|```/g, '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .trim();
    analysis = JSON.parse(cleaned);
  } catch (e) {
    // extract just the JSON object if there's extra text around it
    const match = analysisText.match(/\{[\s\S]*\}/);
    if (match) {
      analysis = JSON.parse(match[0]);
    } else {
      throw new Error('Could not parse analysis response');
    }
  }

  res.json(analysis);
}