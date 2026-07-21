import { z } from "zod";

export const CURRENT_AI_VERSION = 5;
const AUDIT_REASON_SCHEMA_MAX = 360;
const AUDIT_REASON_FINAL_MAX = 280;
const OVERALL_SUMMARY_FINAL_MAX = 420;
const MAX_TOPIC_POINTS = 4;

export const TRUST_EVAL_OUTPUT_SCHEMA = z.object({
  trust_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY", "UNAVAILABLE"]),
  audit_reason: z.string().min(1).max(AUDIT_REASON_SCHEMA_MAX),
  safety_flags: z.array(z.string().min(1).max(140)).max(MAX_TOPIC_POINTS).default([]),
  highlights: z.array(z.string().min(1).max(140)).max(MAX_TOPIC_POINTS).default([]),
  overall_summary: z.string().min(1).max(420),
});

export type TrustEvalOutput = z.infer<typeof TRUST_EVAL_OUTPUT_SCHEMA>;
export type DeterministicBaselineBadge = "GREEN" | "YELLOW" | "RED" | "GRAY";

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
  throw new Error("Use buildHybridTrustEvaluationSystemPrompt instead.");
}

function coerceHybridBadge({
  baselineBadge,
  candidateBadge,
}: {
  baselineBadge: Exclude<DeterministicBaselineBadge, "GRAY">;
  candidateBadge: TrustEvalOutput["trust_badge"];
}): Exclude<TrustEvalOutput["trust_badge"], "GRAY" | "UNAVAILABLE"> {
  if (candidateBadge === "UNAVAILABLE" || candidateBadge === "GRAY") {
    return baselineBadge;
  }

  if (baselineBadge === "GREEN") {
    return candidateBadge;
  }

  if (baselineBadge === "YELLOW") {
    return candidateBadge === "RED" ? "RED" : "YELLOW";
  }

  return "RED";
}

export function calculateBaselineTrustBadge({
  rating,
  userRatingsTotal,
}: {
  rating: number | null;
  userRatingsTotal: number;
}): DeterministicBaselineBadge | null {
  if (userRatingsTotal < 5) {
    return "GRAY";
  }

  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return null;
  }

  if (rating >= 4.5 && userRatingsTotal >= 15) {
    return "GREEN";
  }

  if (rating < 3.8) {
    return "RED";
  }

  return "YELLOW";
}

export function buildBaselineTrustSnapshot({
  baselineBadge,
  rating,
  userRatingsTotal,
  hasSampleReviews,
}: {
  baselineBadge: DeterministicBaselineBadge;
  rating: number | null;
  userRatingsTotal: number;
  hasSampleReviews: boolean;
}): TrustEvalOutput {
  if (baselineBadge === "GRAY") {
    return buildGrayTrustSnapshot({
      auditReason:
        "There are fewer than 5 total Google reviews, so PawFinder does not have enough evidence for a reliable quality assessment yet.",
      overallSummary:
        "This provider has too little review volume for PawFinder to draw a dependable trust conclusion right now.",
    });
  }

  const formattedRating =
    typeof rating === "number" && Number.isFinite(rating) ? rating.toFixed(1) : "an unavailable";
  const sampleSuffix = hasSampleReviews
    ? "PawFinder did not find any critical safety signals in the sampled review text."
    : "A detailed review text sample was not available for additional AI safety analysis.";

  if (baselineBadge === "GREEN") {
    return {
      trust_badge: "GREEN",
      audit_reason: truncateAtWordBoundary(
        `This provider has a strong baseline rating of ${formattedRating} stars across ${userRatingsTotal} Google reviews. ${sampleSuffix}`,
        AUDIT_REASON_FINAL_MAX
      ),
      safety_flags: [],
      highlights: [
        `Strong aggregate rating across ${userRatingsTotal} Google reviews`,
        hasSampleReviews ? "No critical safety hazards detected in sampled reviews" : "Baseline badge derived from aggregate review metrics",
      ],
      overall_summary: truncateAtWordBoundary(
        `The provider has a strong aggregate rating of ${formattedRating} stars across ${userRatingsTotal} Google reviews, which supports a positive baseline trust assessment. ${sampleSuffix}`,
        OVERALL_SUMMARY_FINAL_MAX
      ),
    };
  }

  if (baselineBadge === "RED") {
    return {
      trust_badge: "RED",
      audit_reason: truncateAtWordBoundary(
        `This provider's aggregate Google rating is ${formattedRating} stars across ${userRatingsTotal} reviews, which sets a weak baseline trust score. ${sampleSuffix}`,
        AUDIT_REASON_FINAL_MAX
      ),
      safety_flags: [
        `Low aggregate rating across ${userRatingsTotal} Google reviews`,
      ],
      highlights: [],
      overall_summary: truncateAtWordBoundary(
        `The provider's aggregate rating of ${formattedRating} stars across ${userRatingsTotal} Google reviews creates a weak baseline trust assessment. ${sampleSuffix}`,
        OVERALL_SUMMARY_FINAL_MAX
      ),
    };
  }

  return {
    trust_badge: "YELLOW",
    audit_reason: truncateAtWordBoundary(
      `This provider has a mixed aggregate baseline of ${formattedRating} stars across ${userRatingsTotal} Google reviews. ${sampleSuffix}`,
      AUDIT_REASON_FINAL_MAX
    ),
    safety_flags: [],
    highlights: [
      `Mixed aggregate rating across ${userRatingsTotal} Google reviews`,
      hasSampleReviews ? "Sample review text checked for serious safety issues" : "Baseline badge derived from aggregate review metrics",
    ],
    overall_summary: truncateAtWordBoundary(
      `The provider's aggregate rating of ${formattedRating} stars across ${userRatingsTotal} Google reviews supports a cautionary baseline assessment. ${sampleSuffix}`,
      OVERALL_SUMMARY_FINAL_MAX
    ),
  };
}

export function buildHybridTrustEvaluationSystemPrompt({
  evaluationDate,
  rating,
  userRatingsTotal,
  baselineBadge,
}: {
  evaluationDate: string;
  rating: number;
  userRatingsTotal: number;
  baselineBadge: Exclude<DeterministicBaselineBadge, "GRAY">;
}) {
  return [
    "You are PawFinder's deterministic Trust & Safety override engine.",
    "You must classify review sets using only the supplied review data and return JSON only.",
    "Your outputs will be stored in PawFinder's database and must remain compliant with Google Places API terms.",
    `You are evaluating a sample of Google reviews for a provider with a total rating of ${rating.toFixed(1)} stars across ${userRatingsTotal} reviews.`,
    `Calculated Baseline Badge: ${baselineBadge}.`,
    "",
    "YOUR ROLE:",
    "- Act as a safety and risk auditor.",
    "- Summarize the customer consensus into a unified overall_summary.",
    "- Use the deterministic baseline badge as the starting point instead of deciding from scratch.",
    "",
    "STRICT OVERRIDE RULES:",
    '- If Baseline is GREEN: keep GREEN unless the review sample contains explicit critical safety hazards such as pet escape, injury, unauthorized treatment, abuse, theft, physical harm, or severe systemic failure. Downgrade GREEN to RED for critical safety hazards or to YELLOW for severe service failures. Do not downgrade GREEN for minor inconveniences such as parking, pricing, or small scheduling delays.',
    "- If Baseline is YELLOW: keep YELLOW unless the review sample shows critical safety hazards or severe systemic failure that justify RED.",
    "- If Baseline is RED: keep RED. Do not upgrade RED from the review sample.",
    '- Never return GRAY when total Google reviews are 5 or more.',
    "",
    "Additional rules:",
    "Complaints older than 2 years carry minimal weight unless they are critical safety issues.",
    "Never copy or quote raw review wording. Use only synthetic summaries.",
    "safety_flags and highlights must be short paraphrased topic phrases, not full sentences.",
    `Return at most ${MAX_TOPIC_POINTS} safety_flags and at most ${MAX_TOPIC_POINTS} highlights.`,
    "audit_reason must be a short plain-English explanation for the final badge.",
    "overall_summary must align with the final trust_badge and audit_reason.",
    'If trust_badge is "RED", overall_summary must lead with the critical safety or severe systemic issue.',
    'If trust_badge is "YELLOW", overall_summary must mention the complaint or caution alongside broader sentiment.',
    'If trust_badge is "GREEN", overall_summary must emphasize reliability and strong customer satisfaction.',
    "CRITICAL FORMATTING RULE: Return a valid JSON object containing all 5 keys: trust_badge, audit_reason, safety_flags, highlights, and overall_summary. If there are no safety flags or highlights, return an empty array [].",
    "",
    `Use the evaluation date "${evaluationDate}" when applying recency decay.`,
    "Prefer a single plain-English sentence for audit_reason and keep it under 180 characters whenever possible.",
    "Keep each safety_flags or highlights item to one short topic phrase.",
    "Keep overall_summary to 2-3 plain-English sentences maximum.",
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

function truncateAtWordBoundary(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const truncated = normalized.slice(0, maxLength + 1);
  const lastSentenceBoundary = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf("; "));
  if (lastSentenceBoundary >= Math.floor(maxLength * 0.6)) {
    return truncated.slice(0, lastSentenceBoundary + 1).trim();
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLength * 0.6)) {
    return `${truncated.slice(0, lastSpace).trim()}...`;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function normalizeTrustEvalCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }

  const normalized = { ...(candidate as Record<string, unknown>) };

  if (typeof normalized.audit_reason === "string") {
    normalized.audit_reason = truncateAtWordBoundary(normalized.audit_reason, AUDIT_REASON_SCHEMA_MAX);
  }

  if (typeof normalized.overall_summary === "string") {
    normalized.overall_summary = truncateAtWordBoundary(normalized.overall_summary, OVERALL_SUMMARY_FINAL_MAX);
  }

  if (Array.isArray(normalized.safety_flags)) {
    normalized.safety_flags = normalizeTopicPoints(
      normalized.safety_flags.filter((item): item is string => typeof item === "string")
    ).slice(0, MAX_TOPIC_POINTS);
  }

  if (Array.isArray(normalized.highlights)) {
    normalized.highlights = normalizeTopicPoints(
      normalized.highlights.filter((item): item is string => typeof item === "string")
    ).slice(0, MAX_TOPIC_POINTS);
  }

  return normalized;
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
  rating,
  userRatingsTotal,
  baselineBadge,
  evaluationDate = new Date().toISOString().slice(0, 10),
}: {
  reviews: string[];
  rating: number;
  userRatingsTotal: number;
  baselineBadge: Exclude<DeterministicBaselineBadge, "GRAY">;
  evaluationDate?: string;
}): Promise<TrustEvalOutput> {
  const sanitizedReviews = sanitizeTrustReviewInputs(reviews);

  if (sanitizedReviews.length === 0) {
    console.warn("[trust-eval:input] No usable review text remained after sanitization. Returning baseline-only snapshot.", {
      baseline_badge: baselineBadge,
      rating,
      user_ratings_total: userRatingsTotal,
    });
    return buildBaselineTrustSnapshot({
      baselineBadge,
      rating,
      userRatingsTotal,
      hasSampleReviews: false,
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
            {
              role: "system",
              content: buildHybridTrustEvaluationSystemPrompt({
                evaluationDate,
                rating,
                userRatingsTotal,
                baselineBadge,
              }),
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  task: "Audit these sampled reviews and decide whether to keep or override the deterministic baseline badge.",
                  evaluation_date: evaluationDate,
                  baseline_badge: baselineBadge,
                  google_rating: rating,
                  total_google_reviews: userRatingsTotal,
                  review_sample_count: sanitizedReviews.length,
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

    const validated = TRUST_EVAL_OUTPUT_SCHEMA.safeParse(normalizeTrustEvalCandidate(structuredContent));
    if (!validated.success) {
      console.error("[trust-eval:zod] AI trust output failed schema validation.", {
        issues: validated.error.issues,
        content_preview: content.slice(0, 500),
      });
      return buildUnavailableTrustSnapshot();
    }

    const trustBadge = coerceHybridBadge({
      baselineBadge,
      candidateBadge: validated.data.trust_badge,
    });

    return {
      ...validated.data,
      trust_badge: trustBadge,
      audit_reason: truncateAtWordBoundary(validated.data.audit_reason, AUDIT_REASON_FINAL_MAX),
      safety_flags: normalizeTopicPoints(validated.data.safety_flags).slice(0, MAX_TOPIC_POINTS),
      highlights: normalizeTopicPoints(validated.data.highlights).slice(0, MAX_TOPIC_POINTS),
      overall_summary: truncateAtWordBoundary(validated.data.overall_summary, OVERALL_SUMMARY_FINAL_MAX),
    };
  } catch (error) {
    console.error("[trust-eval:unexpected] Unexpected trust evaluation failure.", {
      error: error instanceof Error ? error.message : String(error),
      review_count: sanitizedReviews.length,
    });
    return buildUnavailableTrustSnapshot();
  }
}
