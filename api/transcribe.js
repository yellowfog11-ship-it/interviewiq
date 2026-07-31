import { del } from '@vercel/blob';

export const maxDuration = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { blobUrl, mimeType } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const fileRes = await fetch(blobUrl);
    if (!fileRes.ok) return res.status(500).json({ error: 'Could not fetch uploaded file' });
    const audioBase64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');

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

    const candidate = data.candidates?.[0];
    const transcript = (candidate?.content?.parts || []).map(p => p.text || '').join('').trim();

    if (!transcript) {
      console.error('Empty transcript. finishReason:', candidate?.finishReason, 'blockReason:', data.promptFeedback?.blockReason, JSON.stringify(data));
      return res.status(500).json({
        error: `Gemini returned no transcript (${candidate?.finishReason || data.promptFeedback?.blockReason || 'unknown reason'}). Try a different file or format.`
      });
    }

    res.json({ transcript });
  } finally {
    del(blobUrl).catch(() => {});
  }
}
