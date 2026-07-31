import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['audio/*', 'video/mp4', 'video/webm', 'application/octet-stream'],
        addRandomSuffix: true,
        maximumSizeInBytes: 300 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
