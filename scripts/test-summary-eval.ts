import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const OUTPUT_SCHEMA = z.object({
  trust_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY"]),
  audit_reason: z.string().describe("Short explanation for the badge assignment"),
  safety_flags: z
    .array(z.string())
    .describe("Direct quote substrings of any Level 2 or Level 3 safety/service issues found"),
  highlights: z.array(z.string()).describe("Key positive takeaways from the reviews"),
});

const REVIEW_SCHEMA = z.object({
  review_id: z.string(),
  date: z.string(),
  rating: z.number(),
  author: z.string(),
  text: z.string(),
  business_response: z.string().optional(),
});

const SCENARIO_SCHEMA = z.object({
  scenario_id: z.string(),
  description: z.string(),
  input_reviews: z.array(REVIEW_SCHEMA),
  expected_output: z.object({
    expected_badge: z.enum(["GREEN", "YELLOW", "RED", "GRAY"]),
    expected_flags_count: z.number().optional(),
    expected_severity: z.string().optional(),
    expected_flag_substring: z.string().optional(),
    reason: z.string().optional(),
  }),
});

const FIXTURE_SCHEMA = z.object({
  schema_version: z.number(),
  generated_for: z.string(),
  description: z.string(),
  scenarios: z.array(SCENARIO_SCHEMA),
});

type Review = z.infer<typeof REVIEW_SCHEMA>;
type Scenario = z.infer<typeof SCENARIO_SCHEMA>;
type EvalResult = z.infer<typeof OUTPUT_SCHEMA>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.resolve(__dirname, "../tests/fixtures/review-scenarios.json");
const MODEL_NAME = "deepseek-chat";
const API_URL = "https://api.deepseek.com/v1/chat/completions";
const EVALUATION_DATE = "2026-07-19";

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
    "",
    'Use the evaluation date "' + EVALUATION_DATE + '" when applying recency decay.',
    "Keep audit_reason concise and deterministic.",
    "Do not mention rules by number in the output.",
  ].join("\n");
}

function buildUserPrompt(scenario: Scenario) {
  return JSON.stringify(
    {
      task: "Evaluate these reviews and assign a trust badge.",
      evaluation_date: EVALUATION_DATE,
      scenario_id: scenario.scenario_id,
      scenario_description: scenario.description,
      total_reviews: scenario.input_reviews.length,
      reviews: scenario.input_reviews,
    },
    null,
    2
  );
}

function collectReviewTexts(reviews: Review[]) {
  return reviews.map((review) => review.text);
}

function normalizeSafetyFlags(flags: string[], reviews: Review[]) {
  const reviewTexts = collectReviewTexts(reviews);

  return flags.filter((flag, index, array) => {
    const trimmed = flag.trim();
    if (!trimmed) return false;
    if (array.indexOf(flag) !== index) return false;

    return reviewTexts.some((text) => text.includes(trimmed));
  });
}

async function loadFixtures() {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  return FIXTURE_SCHEMA.parse(JSON.parse(raw));
}

async function evaluateScenario(scenario: Scenario): Promise<EvalResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY environment variable.");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(scenario) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`DeepSeek evaluation failed (${response.status}): ${rawBody}`);
  }

  const parsedBody = JSON.parse(rawBody) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsedBody.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("DeepSeek evaluation returned no message content.");
  }

  const validated = OUTPUT_SCHEMA.parse(JSON.parse(content));

  return {
    ...validated,
    safety_flags: normalizeSafetyFlags(validated.safety_flags, scenario.input_reviews),
  };
}

function formatDiagnostics(result: EvalResult, scenario: Scenario) {
  const diagnostics: string[] = [];

  if (
    typeof scenario.expected_output.expected_flags_count === "number" &&
    result.safety_flags.length !== scenario.expected_output.expected_flags_count
  ) {
    diagnostics.push(
      `flags_count expected ${scenario.expected_output.expected_flags_count}, got ${result.safety_flags.length}`
    );
  }

  if (
    scenario.expected_output.expected_flag_substring &&
    !result.safety_flags.some((flag) => flag.includes(scenario.expected_output.expected_flag_substring!))
  ) {
    diagnostics.push(
      `expected flag substring missing: "${scenario.expected_output.expected_flag_substring}"`
    );
  }

  if (
    scenario.expected_output.expected_severity &&
    !result.audit_reason.toLowerCase().includes(scenario.expected_output.expected_severity.toLowerCase())
  ) {
    diagnostics.push(`audit_reason does not mention "${scenario.expected_output.expected_severity}"`);
  }

  if (
    scenario.expected_output.reason &&
    !result.audit_reason.toLowerCase().includes(scenario.expected_output.reason.toLowerCase())
  ) {
    diagnostics.push(`audit_reason does not mention "${scenario.expected_output.reason}"`);
  }

  return diagnostics;
}

async function main() {
  const fixture = await loadFixtures();
  let passCount = 0;

  console.log(`Running trust evaluation scenarios from ${path.relative(process.cwd(), FIXTURE_PATH)}`);
  console.log(`Model: ${MODEL_NAME}`);
  console.log("");

  for (const scenario of fixture.scenarios) {
    try {
      const result = await evaluateScenario(scenario);
      const passed = result.trust_badge === scenario.expected_output.expected_badge;
      if (passed) {
        passCount += 1;
      }

      const tag = passed ? "[PASS]" : "[FAIL]";
      const diagnostics = formatDiagnostics(result, scenario);

      console.log(`${tag} ${scenario.scenario_id} - ${scenario.description}`);
      console.log(
        `  Expected Badge: ${scenario.expected_output.expected_badge} | Actual Badge: ${result.trust_badge}`
      );
      console.log(`  Audit Reason: ${result.audit_reason}`);
      console.log(
        `  Safety Flags: ${result.safety_flags.length > 0 ? result.safety_flags.join(" | ") : "[]"}`
      );
      console.log(
        `  Highlights: ${result.highlights.length > 0 ? result.highlights.join(" | ") : "[]"}`
      );

      if (diagnostics.length > 0) {
        console.log(`  Notes: ${diagnostics.join("; ")}`);
      }

      console.log("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

      console.log(`[FAIL] ${scenario.scenario_id} - ${scenario.description}`);
      console.log(`  Expected Badge: ${scenario.expected_output.expected_badge} | Actual Badge: ERROR`);
      console.log(`  Audit Reason: ${message}`);
      console.log("  Safety Flags: []");
      console.log("  Highlights: []");
      console.log("");
    }
  }

  const total = fixture.scenarios.length;
  const percentage = total === 0 ? 0 : Math.round((passCount / total) * 100);

  console.log(`Pass Rate: ${passCount}/${total} (${percentage}%)`);

  if (passCount !== total) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown fatal error";
  console.error(`Fatal evaluation runner error: ${message}`);
  process.exitCode = 1;
});
