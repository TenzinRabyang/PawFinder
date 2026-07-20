import { NextResponse } from "next/server";
import { z } from "zod";

const REQUEST_SCHEMA = z.object({
  reviews: z.array(z.string().min(1)).min(1),
});

const OUTPUT_SCHEMA = z.object({
  trust_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY"]),
  audit_reason: z.string(),
  safety_flags: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
});

type AiProviderConfig = {
  provider: "deepseek" | "openai";
  apiKey: string;
  model: string;
  apiUrl: string;
};

const EVALUATION_DATE = "2026-07-19";

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

  throw new Error("Missing DEEPSEEK_API_KEY or OPENAI_API_KEY for dev trust analysis.");
}

function buildSystemPrompt() {
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
    `Use the evaluation date "${EVALUATION_DATE}" when applying recency decay.`,
    "Keep audit_reason concise and deterministic.",
    "Do not mention rules by number in the output.",
  ].join("\n");
}

function normalizeSafetyFlags(flags: string[], reviews: string[]) {
  return flags.filter((flag, index, array) => {
    const trimmed = flag.trim();
    if (!trimmed) return false;
    if (array.indexOf(flag) !== index) return false;

    return reviews.some((review) => review.includes(trimmed));
  });
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => null);
    const payload = REQUEST_SCHEMA.safeParse(body);

    if (!payload.success) {
      return NextResponse.json({ error: "Invalid reviews payload." }, { status: 400 });
    }

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
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: JSON.stringify(
              {
                task: "Evaluate these reviews and assign a trust badge.",
                evaluation_date: EVALUATION_DATE,
                total_reviews: payload.data.reviews.length,
                reviews: payload.data.reviews,
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
      return NextResponse.json(
        {
          error: `${providerConfig.provider} trust analysis failed (${response.status}).`,
          detail: rawBody,
        },
        { status: 502 }
      );
    }

    const parsedBody = JSON.parse(rawBody) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = parsedBody.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: "AI response was empty." }, { status: 502 });
    }

    const validated = OUTPUT_SCHEMA.parse(JSON.parse(content));

    return NextResponse.json({
      ...validated,
      safety_flags: normalizeSafetyFlags(validated.safety_flags, payload.data.reviews),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
