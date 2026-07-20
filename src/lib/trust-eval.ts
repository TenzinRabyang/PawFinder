import { z } from "zod";

export const TRUST_EVAL_OUTPUT_SCHEMA = z.object({
  trust_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY"]),
  audit_reason: z.string().min(1).max(240),
  safety_flags: z.array(z.string().min(1).max(140)).max(4).default([]),
  highlights: z.array(z.string().min(1).max(140)).max(4).default([]),
});

export type TrustEvalOutput = z.infer<typeof TRUST_EVAL_OUTPUT_SCHEMA>;

type AiProviderConfig = {
  provider: "deepseek" | "openai";
  apiKey: string;
  model: string;
  apiUrl: string;
};

function getAiProviderConfig(): AiProviderConfig {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

  if (deepseekApiKey) {
    return {
      provider: "deepseek",
      apiKey: deepseekApiKey,
      model: "deepseek-chat",
      apiUrl: "https://api.deepseek.com/v1/chat/completions",
    };
  }

  if (openAiApiKey) {
    return {
      provider: "openai",
      apiKey: openAiApiKey,
      model: "gpt-4o-mini",
      apiUrl: "https://api.openai.com/v1/chat/completions",
    };
  }

  throw new Error("Missing DEEPSEEK_API_KEY or OPENAI_API_KEY.");
}

export function buildTrustEvaluationSystemPrompt(evaluationDate: string) {
  return [
    "You are PawFinder's deterministic Trust & Safety evaluation engine.",
    "You must classify review sets using only the supplied review data and return JSON only.",
    "Your outputs will be stored in PawFinder's database and must remain compliant with Google Places API terms.",
    "",
    "Strict badge rules:",
    'RULE 1 (Volume Filter): If total reviews < 5, trust_badge MUST be "GRAY".',
    'RULE 2 (Level 3 Critical Safety Issue): Any mention of theft, physical abuse, lost pet, unauthorized access, or unlocked door MUST result in an instant "RED" badge regardless of positive reviews.',
    'RULE 3 (Level 2 Service Pattern): If 2 or more reviews report severe service failures such as rushed visits under 5 minutes, missed feedings, or uncleaned litter boxes, trust_badge MUST be "RED".',
    'RULE 4 (Isolated Incident & Response): If only 1 minor or moderate complaint exists among 10+ positive reviews, or if the provider gave a reasonable response such as a traffic delay, the badge should be "GREEN" or "YELLOW" and the issue should be treated as isolated.',
    "RULE 5 (Recency Decay): Complaints older than 2 years carry minimal weight unless they are Level 3 critical issues.",
    "RULE 6 (No Review Quotes): Never copy, quote, or closely reproduce any raw review sentence, clause, or unique wording.",
    "RULE 7 (Synthetic Summaries Only): safety_flags and highlights must be high-level paraphrased topic summaries such as 'Repeated concerns about missed visits' or 'Frequent praise for calm pet handling'.",
    "RULE 8 (Layman Explanation): audit_reason must be a short 1-2 sentence explanation in plain English that explains why the badge was assigned.",
    "CRITICAL FORMATTING RULE: You MUST return a valid JSON object containing ALL 4 keys: 'trust_badge', 'audit_reason', 'safety_flags', and 'highlights'. If there are no safety flags or highlights, you MUST return an empty array [] for those fields. Never omit a key.",
    "",
    `Use the evaluation date "${evaluationDate}" when applying recency decay.`,
    "Keep audit_reason concise, deterministic, and understandable to non-experts.",
    "Keep each safety_flags or highlights item to one short topic phrase, not a full sentence.",
    "Do not mention rules by number in the output.",
  ].join("\n");
}

function normalizeTopicPoints(points: string[]) {
  const seen = new Set<string>();

  return points
    .map((point) => point.replace(/^["'\s]+|["'\s]+$/g, "").trim())
    .filter(Boolean)
    .filter((point) => {
      const normalized = point.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export async function evaluateTrustReviews({
  reviews,
  evaluationDate = new Date().toISOString().slice(0, 10),
}: {
  reviews: string[];
  evaluationDate?: string;
}): Promise<TrustEvalOutput> {
  const providerConfig = getAiProviderConfig();

  const response = await fetch(providerConfig.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: providerConfig.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildTrustEvaluationSystemPrompt(evaluationDate) },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "Evaluate these reviews and assign a trust badge.",
              evaluation_date: evaluationDate,
              total_reviews: reviews.length,
              reviews,
            },
            null,
            2
          ),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `${providerConfig.provider} trust evaluation failed (${response.status}) using model ${providerConfig.model}: ${rawBody}`
    );
  }

  const parsedBody = JSON.parse(rawBody) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsedBody.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("AI trust evaluation returned no message content.");
  }

  const validated = TRUST_EVAL_OUTPUT_SCHEMA.parse(JSON.parse(content));

  return {
    ...validated,
    audit_reason: validated.audit_reason.trim(),
    safety_flags: normalizeTopicPoints(validated.safety_flags),
    highlights: normalizeTopicPoints(validated.highlights),
  };
}
