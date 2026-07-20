"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, ShieldQuestion, Star } from "lucide-react";
import { useMemo, useState } from "react";

export type TrustBadgeValue = "GREEN" | "YELLOW" | "RED" | "GRAY";

type TrustAndReviewsCardProps = {
  trustBadge?: TrustBadgeValue | null;
  googleRating?: number | null;
  googleReviewCount?: number | null;
  auditReason?: string | null;
  safetyFlags?: string[];
  highlights?: string[];
  reviewSummary?: string | null;
  isLoading?: boolean;
  hasError?: boolean;
  className?: string;
};

const TRUST_BADGE_META: Record<
  TrustBadgeValue,
  {
    label: string;
    emoji: string;
    icon: typeof CheckCircle2;
    shellClassName: string;
    iconClassName: string;
  }
> = {
  GREEN: {
    label: "Consistent Quality Record",
    emoji: "🟢",
    icon: CheckCircle2,
    shellClassName: "border-[#C4DFC8] bg-[#EEF8F0] text-[#26583A]",
    iconClassName: "text-[#2E8B57]",
  },
  YELLOW: {
    label: "Mixed Feedback / Caution",
    emoji: "🟡",
    icon: AlertTriangle,
    shellClassName: "border-[#E7D18E] bg-[#FFF8DC] text-[#7A5A11]",
    iconClassName: "text-[#C28712]",
  },
  RED: {
    label: "Safety Warning",
    emoji: "🔴",
    icon: ShieldAlert,
    shellClassName: "border-[#E2B2A7] bg-[#FDE9E5] text-[#8A2F22]",
    iconClassName: "text-[#C0392B]",
  },
  GRAY: {
    label: "Insufficient Data",
    emoji: "⚪",
    icon: ShieldQuestion,
    shellClassName: "border-[#D8D8D8] bg-[#F5F5F5] text-[#505861]",
    iconClassName: "text-[#79808A]",
  },
};

function RatingStars({ rating }: { rating?: number | null }) {
  const safeRating = typeof rating === "number" && Number.isFinite(rating) ? rating : 0;
  const filledStars = Math.max(0, Math.min(5, Math.round(safeRating)));

  return (
    <div className="flex items-center gap-1" aria-label={`${filledStars} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={`trust-rating-star-${filledStars}-${index}`}
          className={`h-3.5 w-3.5 ${
            index < filledStars ? "fill-amber-400 text-amber-400" : "text-[#D9C8A6]"
          }`}
        />
      ))}
    </div>
  );
}

export default function TrustAndReviewsCard({
  trustBadge,
  googleRating,
  googleReviewCount,
  auditReason,
  safetyFlags = [],
  highlights = [],
  reviewSummary,
  isLoading = false,
  hasError = false,
  className = "",
}: TrustAndReviewsCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasGoogleRating = typeof googleRating === "number" && Number.isFinite(googleRating);
  const formattedRating = hasGoogleRating ? googleRating.toFixed(1) : "N/A";
  const reviewCountLabel =
    typeof googleReviewCount === "number"
      ? `${googleReviewCount} Google Reviews`
      : hasGoogleRating
        ? "Google review count unavailable"
        : "Google rating unavailable";
  const visibleTakeaways = useMemo(
    () => Array.from(new Set((safetyFlags.length > 0 ? safetyFlags : highlights).filter(Boolean))),
    [highlights, safetyFlags]
  );
  const badgeMeta = trustBadge ? TRUST_BADGE_META[trustBadge] : null;
  const BadgeIcon = badgeMeta?.icon;
  const rationale =
    auditReason?.trim() ||
    (hasError
      ? "We could not load the provider quality assessment right now."
      : isLoading
        ? "We are analyzing the latest provider record now."
        : "We are still gathering enough feedback to explain this provider clearly.");
  const expandedSummary =
    reviewSummary?.trim() ||
    (hasError
      ? "Review summary is temporarily unavailable."
      : "We are still gathering enough review detail to show a broader summary for this business.");

  return (
    <div
      className={`space-y-3 rounded-2xl border border-amber-100 bg-amber-50/40 p-4 shadow-[0_16px_38px_-30px_rgba(123,90,29,0.35)] sm:p-5 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-2 text-[#7A5A19]">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[1.4rem] font-black tracking-[-0.03em] sm:text-[1.55rem]">
              {formattedRating}
            </span>
            <span className="text-sm font-semibold text-[#8E6A20]/80">/ 5</span>
          </div>
        </div>
        <RatingStars rating={googleRating} />
        <span className="text-xs font-semibold text-[#6A604F] sm:text-sm">({reviewCountLabel})</span>
      </div>

      <hr className="border-amber-200/50" />

      <div className="space-y-3">
        {isLoading && !trustBadge ? (
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#E7D8B8] bg-white/80 px-4 py-2 text-xs font-semibold text-[#7A5A19] animate-pulse sm:text-sm">
            <span aria-hidden="true">🔄</span>
            <span>Analyzing provider record...</span>
          </div>
        ) : badgeMeta && BadgeIcon ? (
          <div
            className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-[1.1rem] border px-3 py-2 text-xs font-semibold sm:text-sm ${badgeMeta.shellClassName}`}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm">
              <BadgeIcon className={`h-4 w-4 ${badgeMeta.iconClassName}`} />
            </span>
            <span className="whitespace-normal leading-5">
              {badgeMeta.emoji} {trustBadge} · {badgeMeta.label}
            </span>
          </div>
        ) : hasError ? (
          <div className="inline-flex min-h-11 items-center rounded-full border border-[#D8D8D8] bg-[#F5F5F5] px-4 py-2 text-xs font-semibold text-[#505861] sm:text-sm">
            Safety scan unavailable
          </div>
        ) : (
          <div className="inline-flex min-h-11 items-center rounded-full border border-[#D8D8D8] bg-[#F5F5F5] px-4 py-2 text-xs font-semibold text-[#505861] sm:text-sm">
            Assessment pending
          </div>
        )}

        <p className="text-sm leading-6 text-[#4E514B] sm:text-[0.95rem]">{rationale}</p>
      </div>

      <div className="overflow-hidden rounded-[1.1rem] border border-[#E7D8B8]/80 bg-white/55">
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-[#6A5121] transition-colors hover:bg-white/50"
        >
          <span>{isExpanded ? "Hide Details" : "See Quality Takeaways & Review Summary"}</span>
          {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </button>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-4 border-t border-amber-200/60 px-4 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8A6D32]">
                  Key Takeaways
                </p>
                {visibleTakeaways.length > 0 ? (
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-[#4E514B]">
                    {visibleTakeaways.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#B98B2C]" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-[#6A604F]">
                    We have not identified any standout quality takeaways yet.
                  </p>
                )}
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8A6D32]">
                  Overall Review Summary
                </p>
                <p className="mt-2 text-sm leading-6 text-[#4E514B]">{expandedSummary}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
