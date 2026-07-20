import { z } from "zod";

export const CURRENT_AI_VERSION = 4;

export const TRUST_EVAL_OUTPUT_SCHEMA = z.object({
  trust_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY", "UNAVAILABLE"]),
  audit_reason: z.string().min(1).max(240),
  safety_flags: z.array(z.string().min(1).max(140)).max(4).default([]),
  highlights: z.array(z.string().min(1).max(140)).max(4).default([]),
  overall_summary: z.string().min(1).max(420),
});

export type TrustEvalOutput = z.infer<typeof TRUST_EVAL_OUTPUT_SCHEMA>;

const DEFAULT_GRAY_AUDIT_REASON =
  "There are not enough reliable review details available right now for PawFinder to make a confident quality assessment.";

const DEFAULT_GRAY_SUMMARY =
  "PawFinder could not complete a reliable trust analysis from the available review data, so this provider is shown with an insufficient-data assessment for now.";

const DEFAULT_UNAVAILABLE_AUDIT_REASON =
  "Quality assessment temporarily unavailable.";

const DEFAULT_UNAVAILABLE_SUMMARY =
  "PawFinder could not complete the provider quality assessment right now because the AI trust evaluation is temporarily unavailable.";

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

export function buildTrustEvaluationSystemPrompt(evaluationDate: string, userRatingsTotal: number) {
  return [
    "You are PawFinder's deterministic Trust & Safety evaluation engine.",
    "You must classify review sets using only the supplied review data and return JSON only.",
    "Your outputs will be stored in PawFinder's database and must remain compliant with Google Places API terms.",
    "You MUST assign the trust badge, audit_reason, safety_flags, highlights, and overall_summary in one single evaluation so they never contradict each other.",
    `Note: This business has ${userRatingsTotal} total reviews on Google. You are evaluating a sample of the most recent reviews.`,
    "",
    "Strict badge rules:",
    'RULE 1 (Volume Filter): If total reviews < 5, trust_badge MUST be "GRAY".',
    'RULE 1B (Sample Context): If Google total reviews are 5 or more, do not assign "GRAY" solely because the provided review sample is small. Only use "GRAY" when the supplied sample genuinely lacks enough information for a reliable conclusion.',
    'RULE 2 (Level 3 Critical Safety Issue): Any mention of theft, physical abuse, lost pet, unauthorized access, or unlocked door MUST result in an instant "RED" badge regardless of positive reviews.',
    'RULE 3 (Level 2 Service Pattern): If 2 or more reviews report severe service failures such as rushed visits under 5 minutes, missed feedings, or uncleaned litter boxes, trust_badge MUST be "RED".',
    'RULE 4 (Isolated Incident & Response): If only 1 minor or moderate complaint exists among 10+ positive reviews, or if the provider gave a reasonable response such as a traffic delay, the badge should be "GREEN" or "YELLOW" and the issue should be treated as isolated.',
    "RULE 5 (Recency Decay): Complaints older than 2 years carry minimal weight unless they are Level 3 critical issues.",
    "RULE 6 (No Review Quotes): Never copy, quote, or closely reproduce any raw review sentence, clause, or unique wording.",
    "RULE 7 (Synthetic Summaries Only): safety_flags and highlights must be high-level paraphrased topic summaries such as 'Repeated concerns about missed visits' or 'Frequent praise for calm pet handling'.",
    "RULE 8 (Layman Explanation): audit_reason must be a short 1-2 sentence explanation in plain English that explains why the badge was assigned.",
    "RULE 9 (Consistency): overall_summary must align with trust_badge and audit_reason without softening, contradicting, or ignoring the main concern.",
    'RULE 10 (RED Summary): If trust_badge is "RED", overall_summary MUST lead with the critical safety or repeated severe service issue before mentioning any positive feedback.',
    'RULE 11 (YELLOW Summary): If trust_badge is "YELLOW", overall_summary MUST mention the isolated complaint or mixed concern alongside the broader positive or mixed feedback.',
    'RULE 12 (GREEN Summary): If trust_badge is "GREEN", overall_summary MUST emphasize a clean record, reliability, and strong customer satisfaction.',
    'RULE 13 (GRAY Summary): If trust_badge is "GRAY", overall_summary MUST explain that there are fewer than 5 reviews or otherwise not enough review volume for a reliable conclusion.',
    "CRITICAL FORMATTING RULE: You MUST return a valid JSON object containing ALL 5 keys: 'trust_badge', 'audit_reason', 'safety_flags', 'highlights', and 'overall_summary'. If there are no safety flags or highlights, you MUST return an empty array [] for those fields. Never omit a key.",
    "",
    `Use the evaluation date "${evaluationDate}" when applying recency decay.`,
    "Keep audit_reason concise, deterministic, and understandable to non-experts.",
    "Keep each safety_flags or highlights item to one short topic phrase, not a full sentence.",
    "Keep overall_summary to 2-3 plain-English sentences maximum.",
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

export function buildGrayTrustSnapshot({
  auditReason = DEFAULT_GRAY_AUDIT_REASON,
  overallSummary = DEFAULT_GRAY_SUMMARY,
}: {
  auditReason?: string;
  overallSummary?: string;
} = {}): TrustEvalOutput {
  return {
    trust_badge: "GRAY",
    audit_reason: auditReason.trim(),
    safety_flags: [],
    highlights: [],
    overall_summary: overallSummary.trim(),
  };
}

export function buildUnavailableTrustSnapshot({
  auditReason = DEFAULT_UNAVAILABLE_AUDIT_REASON,
  overallSummary = DEFAULT_UNAVAILABLE_SUMMARY,
}: {
  auditReason?: string;
  overallSummary?: string;
} = {}): TrustEvalOutput {
  return {
    trust_badge: "UNAVAILABLE",
    audit_reason: auditReason.trim(),
    safety_flags: [],
    highlights: [],
    overall_summary: overallSummary.trim(),
  };
}

export function sanitizeTrustReviewInputs(reviews: string[]) {
  return reviews
    .map((review) => (typeof review === "string" ? review.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
}

export async function evaluateTrustReviews({
  reviews,
  userRatingsTotal,
  evaluationDate = new Date().toISOString().slice(0, 10),
}: {
  reviews: string[];
  userRatingsTotal: number;
  evaluationDate?: string;
}): Promise<TrustEvalOutput> {
  const sanitizedReviews = sanitizeTrustReviewInputs(reviews);

  if (sanitizedReviews.length === 0) {
    console.warn("[trust-eval:input] No usable review text remained after sanitization.");
    return buildGrayTrustSnapshot({
      auditReason:
        "There are not enough usable written reviews for PawFinder to make a reliable quality assessment.",
      overallSummary:
        "The available review data is missing meaningful written feedback, so PawFinder cannot draw a reliable overall conclusion yet.",
    });
  }

  try {
    const providerConfig = getAiProviderConfig();

    let response: Response;
    try {
      response = await fetch(providerConfig.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: providerConfig.model,
          temperature: 0,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildTrustEvaluationSystemPrompt(evaluationDate, userRatingsTotal) },
            {
              role: "user",
              content: JSON.stringify(
                {
                  task: "Evaluate these reviews and assign a trust badge.",
                  evaluation_date: evaluationDate,
                  total_reviews: sanitizedReviews.length,
                  reviews: sanitizedReviews,
                },
                null,
                2
              ),
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      console.error("[trust-eval:ai-request] Failed to reach trust evaluation model.", {
        error: error instanceof Error ? error.message : String(error),
        review_count: sanitizedReviews.length,
      });
      return buildUnavailableTrustSnapshot();
    }

    const rawBody = await response.text();
    if (!response.ok) {
      console.error("[trust-eval:ai-response] Trust evaluation model returned a non-OK status.", {
        status: response.status,
        provider: providerConfig.provider,
        model: providerConfig.model,
        body_preview: rawBody.slice(0, 500),
      });
      return buildUnavailableTrustSnapshot();
    }

    let parsedBody: {
      choices?: Array<{ message?: { content?: string } }>;
    };
    try {
      parsedBody = JSON.parse(rawBody) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
    } catch (error) {
      console.error("[trust-eval:response-parse] Failed to parse raw AI response JSON.", {
        error: error instanceof Error ? error.message : String(error),
        body_preview: rawBody.slice(0, 500),
      });
      return buildUnavailableTrustSnapshot();
    }

    const content = parsedBody.choices?.[0]?.message?.content;

    if (!content?.trim()) {
      console.error("[trust-eval:response-content] AI trust evaluation returned no usable message content.", {
        body_preview: rawBody.slice(0, 500),
      });
      return buildUnavailableTrustSnapshot();
    }

    let structuredContent: unknown;
    try {
      structuredContent = JSON.parse(content);
    } catch (error) {
      console.error("[trust-eval:content-parse] Failed to parse AI message content as JSON.", {
        error: error instanceof Error ? error.message : String(error),
        content_preview: content.slice(0, 500),
      });
      return buildUnavailableTrustSnapshot();
    }

    const validated = TRUST_EVAL_OUTPUT_SCHEMA.safeParse(structuredContent);
    if (!validated.success) {
      console.error("[trust-eval:zod] AI trust output failed schema validation.", {
        issues: validated.error.issues,
        content_preview: content.slice(0, 500),
      });
      return buildUnavailableTrustSnapshot();
    }

    return {
      ...validated.data,
      audit_reason: validated.data.audit_reason.trim(),
      safety_flags: normalizeTopicPoints(validated.data.safety_flags),
      highlights: normalizeTopicPoints(validated.data.highlights),
      overall_summary: validated.data.overall_summary.trim(),
    };
  } catch (error) {
    console.error("[trust-eval:unexpected] Unexpected trust evaluation failure.", {
      error: error instanceof Error ? error.message : String(error),
      review_count: sanitizedReviews.length,
    });
    return buildUnavailableTrustSnapshot();
  }
}
