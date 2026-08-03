import { del } from '@vercel/blob';

export const maxDuration = 300;

const MIME_MAP = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

function mimeFromUrl(url, fallback) {
  const match = url.split('?')[0].match(/\.[a-z0-9]+$/i);
  const ext = match ? match[0].toLowerCase() : '';
  return MIME_MAP[ext] || fallback || 'audio/mpeg';
}

async function fetchWithTimeout(url, options, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    console.log(`${label}: ${res.status} in ${Date.now() - started}ms`);
    return res;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${label} timed out after ${ms / 1000}s`);
    throw new Error(`${label} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function uploadToGemini(buffer, mimeType, apiKey) {
  const startRes = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'interview-audio' } }),
    },
    20000,
    'Gemini upload init'
  );
  if (!startRes.ok) throw new Error(`Gemini upload init failed: ${await startRes.text()}`);
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini did not return an upload URL');

  const uploadRes = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: buffer,
    },
    120000,
    'Gemini file byte upload'
  );
  if (!uploadRes.ok) throw new Error(`Gemini upload failed: ${await uploadRes.text()}`);
  const { file } = await uploadRes.json();
  return file;
}

async function waitUntilActive(fileName, apiKey) {
  for (let i = 0; i < 30; i++) {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
      {},
      15000,
      `Gemini file status poll #${i + 1}`
    );
    const data = await res.json();
    if (data.state === 'ACTIVE') return data;
    if (data.state === 'FAILED') throw new Error('Gemini failed to process the uploaded file');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for Gemini to process the file');
}

async function requestTranscript(active, apiKey, temperature) {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { file_data: { mime_type: active.mimeType, file_uri: active.uri } },
          { text: 'Transcribe this interview recording verbatim. Label turns as "Interviewer:" and "Candidate:" where distinguishable. Return only the transcript, no commentary.' }
        ]}],
        generationConfig: { temperature }
      })
    },
    90000,
    `Gemini generateContent (temp=${temperature})`
  );

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini request failed');

  const candidate = data.candidates?.[0];
  const transcript = (candidate?.content?.parts || []).map(p => p.text || '').join('').trim();
  return { transcript, candidate, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { blobUrl, mimeType: clientMimeType } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  let geminiFileName;

  try {
    console.log('Transcribe start, blobUrl:', blobUrl);
    const fileRes = await fetchWithTimeout(blobUrl, {}, 45000, 'Fetching file from Blob storage');
    if (!fileRes.ok) return res.status(500).json({ error: 'Could not fetch uploaded file' });
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    console.log('Fetched blob bytes:', buffer.length);
    const mimeType = mimeFromUrl(blobUrl, clientMimeType);

    const uploaded = await uploadToGemini(buffer, mimeType, apiKey);
    geminiFileName = uploaded.name;
    console.log('Uploaded to Gemini:', uploaded.name, uploaded.state);
    const active = await waitUntilActive(uploaded.name, apiKey);
    console.log('Gemini file ACTIVE:', active.name);

    // temperature 0 is prone to false-positive RECITATION blocks; retry higher if needed
    let { transcript, candidate, data } = await requestTranscript(active, apiKey, 0.2);
    if (!transcript && candidate?.finishReason === 'RECITATION') {
      ({ transcript, candidate, data } = await requestTranscript(active, apiKey, 0.6));
    }

    if (!transcript) {
      console.error('Empty transcript. finishReason:', candidate?.finishReason, 'blockReason:', data.promptFeedback?.blockReason, JSON.stringify(data));
      return res.status(500).json({
        error: `Gemini returned no transcript (${candidate?.finishReason || data.promptFeedback?.blockReason || 'unknown reason'}). Try a different file or format.`
      });
    }

    res.json({ transcript });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    del(blobUrl).catch(() => {});
    if (geminiFileName) {
      fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${apiKey}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}
