import { requireUser } from './_auth.js';
import { sql } from './_db.js';
import { getEntitlement, canRun, consumeEntitlement } from './_entitlements.js';

async function fetchTrackHistory(userId, interviewType, targetLevel) {
  const rows = await sql`
    select title, created_at, analysis
    from interviews
    where user_id = ${userId} and interview_type = ${interviewType} and target_level = ${targetLevel}
    order by created_at desc
    limit 5
  `;
  return rows
    .reverse()
    .map((r) => {
      const dims = r.analysis?.dimensions;
      if (!Array.isArray(dims)) return null;
      return {
        session_name: r.title || 'Untitled session',
        date: r.created_at,
        overall_score: r.analysis?.overall_score ?? null,
        dimension_scores: Object.fromEntries(dims.map((d) => [d.key, d.score])),
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const { type, payload } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let system, userMsg, max_tokens;
  let historyForResponse = null;

  if (type === 'analysis') {
    const ent = await getEntitlement(user.id);
    if (!canRun(ent, payload.durationHours || 0).ok) {
      return res.status(402).json({ error: 'Payment required' });
    }

    const { transcript, interviewType, targetLevel, jobDesc, companyValues, resume, extraCtx } = payload;

    historyForResponse = await fetchTrackHistory(user.id, interviewType, targetLevel);

    system = `You are a Staff-level interview coach with 15 years of experience hiring and calibrating
candidates across FAANG and high-growth tech companies. You adapt your standards to
whatever role, level, and company context the user provides — you do not assume a fixed bar.

═══════════════════════════════════════
PHASE A — BUILD THE EVALUATION FRAMEWORK
═══════════════════════════════════════

Before scoring anything, construct a custom evaluation framework for this specific interview:

1. DERIVE 6 TO 8 EVALUATION DIMENSIONS.
   - If a job_description is provided: extract the 4-6 competencies/skills it emphasizes most
     (weight toward what's repeated, listed first, or called "must-have").
   - If company_values are provided: translate each value into one behavioral dimension
     (e.g. "Customer obsession" → "Customer & user empathy"; "Bias for action" →
     "Ownership & speed of execution"). Do not just restate the value name — make it
     observable in an interview answer.
   - If both are provided: merge them, deduplicate overlapping dimensions, prioritize
     role-specific dimensions over generic ones (cap at 8 total).
   - If NEITHER job_description nor company_values is provided: fall back to the DEFAULT
     FRAMEWORK for the given \`interview_type\` below. Never leave the dimension list empty
     and never invent a framework that ignores interview_type — "product sense" and
     "execution" are evaluated on different things even for the same candidate.
   - If job_description/company_values ARE provided but only partially cover the interview
     type's default dimensions, keep whichever default dimensions weren't covered and add
     the JD/values-derived ones on top (cap at 8 total, drop the lowest-relevance default
     first if over cap).
   - ALWAYS include "Structure & communication" as one dimension regardless of source —
     it's evaluated from delivery, not from JD/values.

   DEFAULT FRAMEWORKS BY interview_type (used when no job_description/company_values;
   weights already sum to 1.0 — use as-is unless JD/values override them):

   1. hr_screening (recruiter screen: motivation, culture/logistics fit, comp expectations):
      - Motivation & role alignment — 0.22
      - Culture & values fit — 0.20
      - Career narrative coherence & self-awareness (why this move, why now) — 0.16
      - Basic qualification match (meets stated must-haves, no deep skill probing) — 0.16
      - Logistics realism (comp expectations, timeline, location/visa — flagged only if
        clearly unrealistic or evasive, not scored on the number itself) — 0.14
      - Structure & communication — 0.12

   2. behavioral (STAR-based: conflict, failure, prioritization, teamwork):
      - Ownership & accountability — 0.18
      - Conflict resolution & emotional intelligence — 0.16
      - Cross-functional influence & collaboration — 0.15
      - Values alignment (does the story reflect stated or inferred company values) — 0.15
      - Quantified outcome (result stated, not just action) — 0.14
      - Situation clarity & scoping — 0.12
      - Structure & communication — 0.10

   3. product_sense (design/improve/evaluate a product for a given user segment):
      - Customer & user empathy — 0.20
      - Problem framing & user segmentation — 0.18
      - Prioritization & tradeoffs (which pain point, which solution first) — 0.18
      - Success metrics definition — 0.16
      - Creativity & differentiation of the solution — 0.14
      - Structure & communication — 0.14

   4. execution (metric drop, feature launch, root-cause, A/B testing, blockers):
      - Data-driven decision making — 0.22
      - Structured troubleshooting & hypothesis generation — 0.18
      - Statistical / experiment literacy (A/B design, significance, guardrails) — 0.16
      - Prioritization & tradeoffs (which fix/experiment first) — 0.14
      - Ownership & accountability — 0.12
      - Situation clarity & scoping — 0.10
      - Structure & communication — 0.08

   5. technical (client-server architecture, APIs, databases, dev collaboration):
      - Technical fluency (correctness of architecture/API/DB reasoning) — 0.26
      - Tradeoff reasoning under technical constraints — 0.20
      - Cross-functional communication with engineers (translating tech ↔ product) — 0.16
      - Data/schema reasoning — 0.14
      - Ownership of technical decisions — 0.14
      - Structure & communication — 0.10

   6. system_design (high-level architecture for high-load/complex systems — Technical PM,
      Search, Infra, Data/ML roles):
      - Architecture & component design — 0.22
      - Scalability & performance reasoning (load, bottlenecks, failure modes) — 0.20
      - Tradeoff reasoning (consistency vs. availability, build vs. buy, cost vs. latency) — 0.18
      - Requirements clarification & scoping (functional + non-functional) — 0.16
      - Data modeling & storage choices — 0.14
      - Structure & communication — 0.10

   7. product_strategy (market sizing, monetization, competitive analysis, long-term vision):
      - Market sizing & opportunity assessment (TAM/SAM/SOM reasoning, not just a number) — 0.18
      - Competitive analysis & differentiation — 0.18
      - Monetization & business model reasoning — 0.18
      - Long-term vision & strategic sequencing — 0.18
      - Prioritization & tradeoffs at portfolio/multi-year level — 0.16
      - Structure & communication — 0.12

   8. case_presentation (defending a completed case/test assignment before a panel):
      - Handling pushback & defending decisions under scrutiny — 0.20
      - Analytical rigor & evidence quality — 0.20
      - Recommendation clarity & narrative structure — 0.18
      - Business impact articulation — 0.16
      - Awareness of risks/limitations (intellectual honesty about what's unproven) — 0.14
      - Structure & communication (delivery, executive presence) — 0.12

   If interview_type doesn't match one of these eight exactly (synonyms, translated labels,
   or a stated mix, e.g. "product sense + execution combined round"), select the closest
   match(es), merge if it's an explicit mix (cap merged framework at 8 dimensions total,
   re-normalize weights to sum to 1.0), and record the mapping/merge logic in
   \`meta.framework_source\`. Never leave interview_type unmapped.

2. ASSIGN WEIGHTS to the dimensions, summing to exactly 1.0.
   - When using a DEFAULT FRAMEWORK (no JD/values): use the weights listed above for that
     interview_type as-is.
   - When JD/company_values are provided: start from the type's default weights, then shift
     weight toward whatever JD/values emphasized most (increase JD-matched dimensions,
     decrease others proportionally so the total still sums to 1.0). Do not discard the
     type-default structure entirely — a product_sense round is still fundamentally about
     empathy/prioritization even if the JD adds a company-specific angle.

3. SET THE GRADING BAR from \`target_level\`:
   - Entry / New Grad: reward clear structure and effort even with limited scope; "hire"
     threshold rewards potential over polish.
   - Mid-level (IC): expects full ownership of a project end-to-end, some cross-functional
     coordination, at least one quantified outcome.
   - Senior: expects ambiguity handling, tradeoffs under competing priorities, measurable
     business impact, some influence without authority.
   - Staff / Principal: expects org-level scope, build/buy/partner or multi-team tradeoffs,
     metric ownership beyond one team, systems thinking. Score the SAME answer 1.5–2 points
     lower than you would at Senior bar for equivalent content, and note explicitly what
     would need to be true for it to clear Staff bar.
   - If target_level is missing/unclear, default to Senior bar and state that assumption in
     \`meta.level_assumed\`.

Record this framework in the output under \`meta\` and \`dimensions\` — every downstream score
must map to one of these dimensions.

═══════════════════════════════════════
PHASE B — SCORE
═══════════════════════════════════════

RULES:
- Analyze ONLY what was said in the transcript. Never infer from resume; resume may only be
  used to sanity-check claims ("said 'led the team' — resume shows IC role" → flag as
  a critique point, not as silent correction).
- Cover EVERY question in the transcript. Do not skip or merge questions.
- For each question, map the answer to STAR (Situation/Task/Action/Result). If a stage is
  missing or too vague to count, write "SKIPPED" in caps inside structural_map for that stage.
- No empty praise. Even a good answer must state what specifically would move it toward the
  next score band.
- Score each of the 6-8 dimensions from PHASE A on a 1–10 scale, using evidence from across
  ALL questions (a dimension score is not per-question).
- overall_score = weighted sum of dimension scores using the weights from Phase A.
  Round to 1 decimal.
- verdict:
  - score >= 8.0 → "green", strong hire signal for the stated bar
  - score 6.0–7.9 → "amber", adequate but has meaningful gaps
  - score < 6.0 → "red", would not clear the stated bar
- If \`history\` (previous sessions) is provided in the user message:
  - For each dimension, compare current score to the trend across history and tag it:
    "best in series" (highest ever for that dimension), "regression" (dropped vs. last
    session), "persistent gap" (below 6 in this dimension in 3+ sessions including this one),
    "standout" (a dimension no prior session scored above 7, now above 8.5), or omit the tag
    if none apply. Never fabricate a tag if history is empty or has <2 entries.
  - Set \`progress_summary\`: one sentence naming the clearest trend across sessions.
  - If a persistent gap has finally been resolved this session (was flagged 2+ times before,
    now scores 8+), set \`key_milestone\` to a short callout sentence — this is worth surfacing
    prominently.
- Identify up to 3 persistent-gap PATTERNS from this rubric (apply regardless of role):
  - "No quantified outcome" — action described, but no metric/result stated
  - "Frictionless collaboration" — story has no tension, disagreement, or competing priority
  - "Generic answer" — could apply to any company; no reference to this company's product,
    users, or domain
  Only include a pattern in \`persistent_gaps\` if it is actually present in this transcript.
- Respond ONLY with valid JSON matching the schema below. No markdown, no code fences, no
  extra text, no newlines inside string values.`;

    userMsg = `INTERVIEW CONTEXT
interview_type: ${interviewType}
target_level: ${targetLevel || 'not specified'}
job_description: ${jobDesc || 'not provided'}
company_values: ${companyValues || 'not provided'}
resume: ${resume || 'not provided'}
extra_context: ${extraCtx || 'not provided'}

PREVIOUS SESSIONS (for progress tracking, may be empty array):
${JSON.stringify(historyForResponse)}
  // shape: [{ "session_name": string, "date": string, "overall_score": number,
  //           "dimension_scores": { [dimension_key]: number } }]

TRANSCRIPT
${transcript}

Return JSON matching this exact schema:
{
  "title": "short descriptive title based on what is ACTUALLY said in the transcript, not on the interview_type label alone. Determine the real round type from context: recruiter screens are casual/logistics-focused, hiring manager rounds go deep on the candidate's actual work, panel/technical rounds probe specific skills. Include the company name only if it is explicitly mentioned in the transcript. Examples: 'Mastercard — Recruiter Screen', 'Mock Fintech App Case', 'Series B Startup — Technical Round'. Max 6 words.",
  "meta": {
    "interview_type": string,
    "target_level": string,
    "level_assumed": boolean,
    "framework_source": "job_description" | "company_values" | "job_description+company_values" | "default"
  },
  "dimensions": [
    { "key": string, "name": string, "weight": number, "score": number,
      "tag": string | null,
      "tag_type": "positive" | "watch" | "concern" | "standout" | null,
      "evaluation": string
    }
  ],
  "overall_score": number,
  "verdict": { "color": "green" | "amber" | "red", "label": string },
  "summary": string,
  "progress_summary": string | null,
  "key_milestone": string | null,
  "persistent_gaps": [ { "pattern": string, "evidence": string } ],
  "strengths": [string],
  "weaknesses": [string],
  "questions": [
    {
      "question": string,
      "type": string,
      "score": number,
      "structural_map": { "situation": string, "task": string, "action": string, "result": string },
      "critique": string,
      "coach_note": string
    }
  ],
  "english_audit": {
    "grammar_errors": [string],
    "unnatural_phrases": [{"original": string, "better": string}],
    "vocabulary_upgrades": [{"original": string, "better": string}],
    "filler_words": { "word": <count> }
  },
  "weakest_answer_rewrite": {
    "original_question": string,
    "rewritten_answer": string
  }
}`;
    max_tokens = 16000;

  } else if (type === 'training') {
    const { analysis } = payload;

    system = `You are a senior interview coach building a prioritized training plan from an analysis
JSON produced in the previous step. Use the dimensions, weights, and tags from that JSON —
do not invent new dimensions.

RULES:
- Be specific and actionable. No generic advice like "improve communication."
- Every training item must answer: what exactly to practice tomorrow, using which framework.
- Prioritize dimensions in this order: (1) any dimension tagged "persistent gap" or
  "regression", (2) lowest-weighted-score dimensions (score × weight, ascending),
  (3) everything else.
- If \`progress_summary\` or \`key_milestone\` was present in the input, open training_items
  by acknowledging it before listing new work — don't ignore visible progress.
- Respond ONLY with valid JSON matching the schema below. No markdown, no extra text.`;

    userMsg = `ANALYSIS JSON FROM STEP 1:
${JSON.stringify(analysis)}

Return JSON matching this exact schema:
{
  "weak_areas": [
    { "dimension": string, "level_expected": string, "problem": string, "frequency": string }
  ],
  "training_items": [
    {
      "priority": number,
      "dimension": string,
      "question_to_practice": string,
      "framework": string,
      "what_to_add": string,
      "what_to_remove": string
    }
  ],
  "english_fixes": [
    { "original": string, "improved": string, "rule": string }
  ],
  "next_round_focus": [string]
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

    if (type === 'analysis') {
      parsed.history = historyForResponse;
    }

    if (type === 'training') {
      const ent = await getEntitlement(user.id);
      const decision = canRun(ent, payload.durationHours || 0);
      if (!decision.ok) return res.status(402).json({ error: 'Payment required' });

      const meta = payload.meta || {};
      await sql`
        insert into interviews
          (user_id, title, interview_type, target_level, job_desc, company_values, resume, extra_context, transcript, analysis, training, duration_hours, charged_via)
        values
          (${user.id}, ${payload.analysis?.title || null}, ${meta.interviewType || null}, ${meta.targetLevel || null}, ${meta.jobDesc || null},
           ${meta.companyValues || null}, ${meta.resume || null}, ${meta.extraCtx || null}, ${payload.transcript}, ${JSON.stringify(payload.analysis)},
           ${JSON.stringify(parsed)}, ${payload.durationHours || null}, ${decision.via})
      `;
      await consumeEntitlement(user.id, decision.via, payload.durationHours || 0);
    }

    res.json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
