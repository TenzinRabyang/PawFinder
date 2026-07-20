import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";
import { z } from "zod";

import DevSandboxClient from "./DevSandboxClient";

const FIXTURE_SCHEMA = z.object({
  scenarios: z.array(
    z.object({
      scenario_id: z.string(),
      description: z.string(),
      input_reviews: z.array(
        z.object({
          review_id: z.string(),
          date: z.string(),
          rating: z.number(),
          author: z.string(),
          text: z.string(),
          business_response: z.string().optional(),
        })
      ),
    })
  ),
});

function formatScenarioReview(review: {
  date: string;
  rating: number;
  author: string;
  text: string;
  business_response?: string;
}) {
  const responseSuffix = review.business_response
    ? ` | Provider response: ${review.business_response}`
    : "";

  return `[${review.date}] ${review.rating}-star review by ${review.author}: ${review.text}${responseSuffix}`;
}

async function loadScenarioOptions() {
  const fixturePath = path.resolve(process.cwd(), "tests/fixtures/review-scenarios.json");
  const raw = await readFile(fixturePath, "utf8");
  const fixture = FIXTURE_SCHEMA.parse(JSON.parse(raw));

  return fixture.scenarios.map((scenario) => ({
    scenarioId: scenario.scenario_id,
    description: scenario.description,
    reviews: scenario.input_reviews.map(formatScenarioReview),
  }));
}

export default async function DevSandboxPage() {
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }

  const scenarios = await loadScenarioOptions();
  const isDevOrPreview =
    process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";

  return (
    <main className="min-h-screen bg-[#F7F3EC] px-4 py-10 text-[#20261F] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[2rem] border border-[#DED4C2] bg-white/90 p-6 shadow-[0_24px_60px_-40px_rgba(32,38,31,0.45)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-4 border-b border-[#EEE5D6] pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">
                Developer Sandbox
              </p>
              <h1 className="mt-3 font-display text-[2rem] leading-tight tracking-[-0.03em] text-[#20261F] sm:text-[2.7rem]">
                Trust &amp; Safety Visual Test Bench
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#4A5147] sm:text-base">
                Load a fixture scenario or paste custom review text to inspect the deterministic trust
                badge output before merging to production.
              </p>
            </div>
            <div className="inline-flex items-center rounded-full border border-[#E2D7C5] bg-[#FAF7F1] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#6A7268]">
              {isDevOrPreview ? "Preview / Dev Access" : "Non-Production Access"}
            </div>
          </div>

          <div className="mt-6">
            <DevSandboxClient scenarios={scenarios} />
          </div>
        </div>
      </div>
    </main>
  );
}
