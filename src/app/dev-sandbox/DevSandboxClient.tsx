"use client";

import { useMemo, useState } from "react";
import type { TrustSafetyFlag } from "@/lib/trust-eval";

type ScenarioOption = {
  scenarioId: string;
  description: string;
  reviews: string[];
};

type TrustAnalysisResult = {
  trust_badge: "GREEN" | "YELLOW" | "RED" | "GRAY";
  audit_reason: string;
  safety_flags: TrustSafetyFlag[];
  highlights: string[];
};

type DevSandboxClientProps = {
  scenarios: ScenarioOption[];
};

function formatSafetyCategoryLabel(category: string) {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getConfidenceLabel(flag: TrustSafetyFlag) {
  if (flag.confidence === "confirmed") {
    return flag.excerpt_count >= 2 ? "Confirmed by multiple reviews" : "Confirmed severe-harm report";
  }

  return "Single report - unverified";
}

const BADGE_STYLES: Record<
  TrustAnalysisResult["trust_badge"],
  {
    label: string;
    icon: string;
    shellClassName: string;
    chipClassName: string;
  }
> = {
  GREEN: {
    label: "Consistent Quality Record",
    icon: "🟢",
    shellClassName: "border-[#B9D8C1] bg-[#ECF8F0] text-[#21593A]",
    chipClassName: "border-[#C7E4CE] bg-white/80 text-[#21593A]",
  },
  YELLOW: {
    label: "Mixed Feedback / Review Details",
    icon: "🟡",
    shellClassName: "border-[#E7D18E] bg-[#FFF8DC] text-[#7A5A11]",
    chipClassName: "border-[#F0DEAA] bg-white/80 text-[#7A5A11]",
  },
  RED: {
    label: "Safety Flags Detected",
    icon: "🔴",
    shellClassName: "border-[#E2B2A7] bg-[#FDE9E5] text-[#8A2F22]",
    chipClassName: "border-[#EDC4BA] bg-white/80 text-[#8A2F22]",
  },
  GRAY: {
    label: "Insufficient Data",
    icon: "⚪",
    shellClassName: "border-[#D9D9D9] bg-[#F6F6F6] text-[#4E545C]",
    chipClassName: "border-[#E3E3E3] bg-white/80 text-[#4E545C]",
  },
};

export default function DevSandboxClient({ scenarios }: DevSandboxClientProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(scenarios[0]?.scenarioId ?? "");
  const [customReviewText, setCustomReviewText] = useState("");
  const [analysis, setAnalysis] = useState<TrustAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId) ?? null,
    [scenarios, selectedScenarioId]
  );

  const previewReviewText = useMemo(() => {
    if (customReviewText.trim().length > 0) {
      return customReviewText.trim();
    }

    return selectedScenario ? selectedScenario.reviews.join("\n\n") : "";
  }, [customReviewText, selectedScenario]);

  const handleAnalyze = async () => {
    const customReviews = customReviewText
      .split(/\n{2,}/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    const reviews = customReviews.length > 0 ? customReviews : selectedScenario?.reviews ?? [];

    if (reviews.length === 0) {
      setError("Add some review text or select a fixture scenario before running the analysis.");
      setAnalysis(null);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/dev/analyze-trust", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reviews }),
      });

      const payload = (await response.json().catch(() => ({}))) as
        | TrustAnalysisResult
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Trust analysis failed."
        );
      }

      setAnalysis(payload as TrustAnalysisResult);
    } catch (analysisError) {
      setAnalysis(null);
      setError(
        analysisError instanceof Error ? analysisError.message : "Trust analysis failed unexpectedly."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const badgeMeta = analysis ? BADGE_STYLES[analysis.trust_badge] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="rounded-[1.7rem] border border-[#E8DECD] bg-[#FFFCF8] p-5 shadow-[0_18px_40px_-34px_rgba(32,38,31,0.35)] sm:p-6">
        <div className="grid gap-5">
          <div>
            <label
              htmlFor="scenario-selector"
              className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]"
            >
              Scenario Selector
            </label>
            <select
              id="scenario-selector"
              value={selectedScenarioId}
              onChange={(event) => setSelectedScenarioId(event.target.value)}
              className="mt-2 w-full rounded-[1rem] border border-[#DCD3BE] bg-white px-4 py-3 text-sm text-[#20261F] outline-none transition focus:border-[#B14A2B]"
            >
              {scenarios.map((scenario) => (
                <option key={scenario.scenarioId} value={scenario.scenarioId}>
                  {scenario.scenarioId} - {scenario.description}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-[1.25rem] border border-[#EEE5D6] bg-[#FAF7F1] p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]">
              Loaded Fixture Reviews
            </p>
            <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[1rem] border border-[#E7DDCB] bg-white px-4 py-3 text-sm leading-6 text-[#465046]">
              {selectedScenario ? selectedScenario.reviews.join("\n\n") : "No scenario selected."}
            </div>
          </div>

          <div>
            <label
              htmlFor="custom-review-text"
              className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]"
            >
              Custom Raw Review Text
            </label>
            <textarea
              id="custom-review-text"
              value={customReviewText}
              onChange={(event) => setCustomReviewText(event.target.value)}
              rows={10}
              placeholder="Paste one review block per paragraph. Leave blank to analyze the selected fixture scenario."
              className="mt-2 w-full rounded-[1rem] border border-[#DCD3BE] bg-white px-4 py-3 text-sm leading-6 text-[#20261F] outline-none transition placeholder:text-[#8C9288] focus:border-[#B14A2B]"
            />
            <p className="mt-2 text-xs leading-5 text-[#6A7268]">
              Custom review text overrides the selected scenario when present.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleAnalyze();
            }}
            disabled={isLoading}
            className="inline-flex items-center justify-center rounded-[1rem] bg-[#20261F] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_32px_-24px_rgba(32,38,31,0.8)] transition hover:bg-[#111611] disabled:cursor-not-allowed disabled:bg-[#98A094] disabled:shadow-none"
          >
            {isLoading ? "Analyzing..." : "Analyze Sitter"}
          </button>

          {error ? (
            <div className="rounded-[1rem] border border-[#E2B8B0] bg-[#FDEDEC] px-4 py-3 text-sm font-medium text-[#8B3324]">
              {error}
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-[1.7rem] border border-[#E8DECD] bg-[#FFFCF8] p-5 shadow-[0_18px_40px_-34px_rgba(32,38,31,0.35)] sm:p-6">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]">
          Trust Badge Output
        </p>

        {analysis && badgeMeta ? (
          <div className="mt-4 space-y-4">
            <div className={`rounded-[1.35rem] border px-5 py-5 ${badgeMeta.shellClassName}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">
                  {badgeMeta.icon}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
                    {analysis.trust_badge}
                  </p>
                  <h2 className="mt-1 font-display text-[1.55rem] leading-tight tracking-[-0.03em]">
                    {badgeMeta.label}
                  </h2>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7">{analysis.audit_reason}</p>
            </div>

            <div className="rounded-[1.25rem] border border-[#EEE5D6] bg-[#FAF7F1] p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]">
                Safety Evidence
              </p>
              <div className="mt-3 space-y-3">
                {analysis.safety_flags.length > 0 ? (
                  analysis.safety_flags.map((flag) => (
                    <div key={`${flag.category}-${flag.confidence}`} className="rounded-[1rem] border border-[#E7DDCB] bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-2 text-xs font-semibold ${badgeMeta.chipClassName}`}>
                          {formatSafetyCategoryLabel(flag.category)}
                        </span>
                        <span className="text-xs font-medium text-[#6B725E]">{getConfidenceLabel(flag)}</span>
                      </div>
                      {flag.excerpts.length > 0 ? (
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#465046]">
                          {flag.excerpts.map((excerpt) => (
                            <li key={`${flag.category}-${excerpt}`} className="rounded-[0.9rem] border border-[#EFE4D2] bg-[#FAF7F1] px-3 py-2">
                              &ldquo;{excerpt}&rdquo;
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-[#5D665B]">No supporting excerpt was returned.</p>
                      )}
                    </div>
                  ))
                ) : (
                  <span className="text-sm text-[#5D665B]">No direct safety flag quotes detected.</span>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-[#EEE5D6] bg-[#FAF7F1] p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]">
                Positive Highlights
              </p>
              {analysis.highlights.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#465046]">
                  {analysis.highlights.map((highlight) => (
                    <li key={highlight} className="rounded-[1rem] border border-[#E7DDCB] bg-white px-4 py-3">
                      {highlight}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#5D665B]">No positive highlights were returned.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-[1.35rem] border border-dashed border-[#D9CFBF] bg-[#FAF7F1] px-5 py-8 text-sm leading-7 text-[#60685E]">
            Choose a fixture scenario or paste custom raw review text, then run the analysis to see the
            trust badge, audit reason, safety quotes, and highlights here.
            <div className="mt-4 whitespace-pre-wrap rounded-[1rem] border border-[#E7DDCB] bg-white px-4 py-3 text-xs leading-6 text-[#72796F]">
              {previewReviewText || "No review text loaded yet."}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
