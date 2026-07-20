import { z } from "zod";

export const TRUST_EVAL_OUTPUT_SCHEMA = z.object({
  trust_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY"]),
  audit_reason: z.string(),
  safety_flags: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
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
    "",
    "Strict badge rules:",
    'RULE 1 (Volume Filter): If total reviews < 5, trust_badge MUST be "GRAY".',
    'RULE 2 (Level 3 Critical Safety Issue): Any mention of theft, physical abuse, lost pet, unauthorized access, or unlocked door MUST result in an instant "RED" badge regardless of positive reviews.',
    'RULE 3 (Level 2 Service Pattern): If 2 or more reviews report severe service failures such as rushed visits under 5 minutes, missed feedings, or uncleaned litter boxes, trust_badge MUST be "RED".',
    'RULE 4 (Isolated Incident & Response): If only 1 minor or moderate complaint exists among 10+ positive reviews, or if the provider gave a reasonable response such as a traffic delay, the badge should be "GREEN" or "YELLOW" and the issue should be treated as isolated.',
    "RULE 5 (Recency Decay): Complaints older than 2 years carry minimal weight unless they are Level 3 critical issues.",
    "RULE 6 (Anti-Hallucination): Every entry in safety_flags MUST be an exact substring copied from the raw review text. If there is no qualifying issue, return an empty array.",
    "CRITICAL FORMATTING RULE: You MUST return a valid JSON object containing ALL 4 keys: 'trust_badge', 'audit_reason', 'safety_flags', and 'highlights'. If there are no safety flags or highlights, you MUST return an empty array [] for those fields. Never omit a key.",
    "",
    `Use the evaluation date "${evaluationDate}" when applying recency decay.`,
    "Keep audit_reason concise and deterministic.",
    "Do not mention rules by number in the output.",
  ].join("\n");
}

export function normalizeSafetyFlags(flags: string[], reviews: string[]) {
  return flags.filter((flag, index, array) => {
    const trimmed = flag.trim();
    if (!trimmed) return false;
    if (array.indexOf(flag) !== index) return false;

    return reviews.some((review) => review.includes(trimmed));
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
    safety_flags: normalizeSafetyFlags(validated.safety_flags, reviews),
  };
}
