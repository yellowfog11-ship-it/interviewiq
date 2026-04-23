export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, payload } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let system, userMsg, max_tokens;

  if (type === 'analysis') {
    const { transcript, interviewType, targetLevel, jobDesc, resume, extraCtx } = payload;

    system = `You are a Staff Product Manager with 15 years of FAANG experience acting as a strict interview coach. Your evaluation bar is Staff/Principal PM at FAANG.

RULES:
- Analyze ONLY what was said in the transcript. Never infer from resume.
- If a STAR stage is missing, write "SKIPPED" in caps inside structural_map.
- Cover EVERY question. Do not skip or merge questions.
- No empty praise. Even good answers must show how to reach Staff level.
- Respond ONLY with valid JSON matching the exact schema. No markdown, no extra text, no newlines inside string values.

GRADING:
- No Hire: execution-focused, no KPIs, no business context
- Lean Hire: clear STAR, product ownership, impact limited to one team
- Strong Hire: org-level impact, high ambiguity, VP/C-level stakeholders, systems thinking`;

    userMsg = `Analyze this PM interview transcript.
${interviewType ? `Interview type: ${interviewType}` : ''}
${targetLevel ? `Target level: ${targetLevel}` : ''}
${jobDesc ? `Job description: ${jobDesc}` : ''}
${resume ? `Resume: ${resume}` : ''}
${extraCtx ? `Additional context: ${extraCtx}` : ''}

TRANSCRIPT:
${transcript}

Return ONLY this exact JSON (no markdown, no extra text):
{
  "overall_score": <integer 1-10>,
  "communication_score": <integer 1-10>,
  "content_score": <integer 1-10>,
  "confidence_score": <integer 1-10>,
  "overall_verdict": "Strong Hire or Lean Hire or No Hire",
  "summary": "2-3 sentence executive summary",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2", "weakness 3"],
  "questions": [
    {
      "question": "exact question text",
      "type": "Behavioral or Elevator Pitch or Case or Product Sense or Strategy or Other",
      "score": "Strong Hire or Lean Hire or No Hire",
      "structural_map": "STAR mapping with SKIPPED in caps for missing stages",
      "critique": "brutal expert critique no praise",
      "coach_note": "exact framework and specific fix"
    }
  ],
  "english_audit": {
    "grammar_errors": ["error arrow correction"],
    "unnatural_phrases": [{"original": "phrase", "better": "improved"}],
    "vocabulary_upgrades": [{"original": "word", "better": "professional"}],
    "filler_words": {"like": 0, "um": 0, "basically": 0}
  },
  "weakest_answer_rewrite": {
    "original_question": "the question",
    "rewritten_answer": "model answer at Strong Hire level"
  }
}`;
    max_tokens = 16000;

  } else if (type === 'training') {
    const { analysis } = payload;

    system = `You are a senior PM interview coach. Build a prioritized training plan based on the interview analysis provided.

RULES:
- Be specific and actionable. No generic advice like "improve communication".
- Every item must answer: what exactly to practice tomorrow.
- Respond ONLY with valid JSON matching the exact schema. No markdown, no extra text, no newlines inside string values.`;

    userMsg = `Build a training plan based on this interview analysis:

${JSON.stringify(analysis)}

Return ONLY this exact JSON (no markdown, no extra text):
{
  "weak_areas": [
    {
      "level": "critical or important or polish",
      "problem": "one sentence what exactly is wrong",
      "frequency": "how often this appeared in the interview"
    }
  ],
  "training_items": [
    {
      "priority": 1,
      "question": "exact question as asked",
      "framework": "STAR or DIGS or CIRCLES or BUS or 4P or Elevator Pitch",
      "what_to_add": "exactly what to add to the answer",
      "what_to_remove": "exactly what to cut"
    }
  ],
  "english_fixes": [
    {
      "original": "exact phrase from transcript",
      "improved": "corrected native-sounding version",
      "rule": "one sentence explaining why"
    }
  ],
  "next_round_focus": [
    "specific actionable tip for the next interview round"
  ]
}`;
    max_tokens = 8000;

  } else {
    return res.status(400).json({ error: 'Invalid type' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message });

    const raw = data.content?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        console.error('RAW RESPONSE:', raw);
        return res.status(500).json({ error: 'Could not parse Claude response' });
      }
    }

    res.json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
