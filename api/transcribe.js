export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { audioBase64, mimeType } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: audioBase64 } },
          { text: 'Transcribe this interview recording verbatim. Label turns as "Interviewer:" and "Candidate:" where distinguishable. Return only the transcript, no commentary.' }
        ]}],
        generationConfig: { temperature: 0 }
      })
    }
  );

  const data = await response.json();
  if (!response.ok) return res.status(500).json({ error: data.error?.message });

  const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  res.json({ transcript });
}