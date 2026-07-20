"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  ShieldAlert,
  ShieldQuestion,
  Star,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type TrustBadgeValue = "GREEN" | "YELLOW" | "RED" | "GRAY";

type TrustBadgeProps = {
  trustBadge: TrustBadgeValue;
  className?: string;
};

type ProviderTrustSummaryCardProps = {
  trustBadge?: TrustBadgeValue | null;
  googleRating?: number | null;
  googleReviewCount?: number | null;
  auditReason?: string | null;
  safetyFlags?: string[];
  highlights?: string[];
  className?: string;
};

const TRUST_BADGE_META: Record<
  TrustBadgeValue,
  {
    label: string;
    icon: typeof CheckCircle2;
    shellClassName: string;
    iconClassName: string;
  }
> = {
  GREEN: {
    label: "Consistent Quality Record",
    icon: CheckCircle2,
    shellClassName: "border-[#C4DFC8] bg-[#EEF8F0] text-[#26583A]",
    iconClassName: "text-[#2E8B57]",
  },
  YELLOW: {
    label: "Mixed Feedback / Caution",
    icon: AlertTriangle,
    shellClassName: "border-[#E7D18E] bg-[#FFF8DC] text-[#7A5A11]",
    iconClassName: "text-[#C28712]",
  },
  RED: {
    label: "Safety Warning",
    icon: ShieldAlert,
    shellClassName: "border-[#E2B2A7] bg-[#FDE9E5] text-[#8A2F22]",
    iconClassName: "text-[#C0392B]",
  },
  GRAY: {
    label: "Insufficient Data",
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
          key={`summary-star-${filledStars}-${index}`}
          className={`h-4 w-4 ${
            index < filledStars ? "fill-amber-400 text-amber-400" : "text-[#D9C8A6]"
          }`}
        />
      ))}
    </div>
  );
}

function SafetyScanInfoPopover({
  trustBadge,
  auditReason,
  safetyFlags,
  highlights,
}: {
  trustBadge?: TrustBadgeValue | null;
  auditReason?: string | null;
  safetyFlags: string[];
  highlights: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const badgeMeta = trustBadge ? TRUST_BADGE_META[trustBadge] : null;
  const BadgeIcon = badgeMeta?.icon;
  const badgeEmoji =
    trustBadge === "GREEN"
      ? "🟢"
      : trustBadge === "YELLOW"
        ? "🟡"
        : trustBadge === "RED"
          ? "🔴"
          : trustBadge === "GRAY"
            ? "⚪"
            : "";
  const visibleTakeaways = Array.from(new Set([...safetyFlags, ...highlights].filter(Boolean)));

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#D9C8A6] bg-white/90 text-[#7A5A19] shadow-sm transition hover:border-[#B98B2C] hover:text-[#5F4715] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B98B2C]/40"
        aria-label="Explain Provider Quality Assessment"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-haspopup="dialog"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {isOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-[#2F312E]/28 backdrop-blur-[1px] sm:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            id={popoverId}
            role="dialog"
            aria-label="Quality Assessment Breakdown"
            className="fixed inset-x-4 bottom-4 z-50 rounded-[1.6rem] border border-[#E6D7B9] bg-[#FFFDF8] p-4 text-left shadow-[0_24px_60px_-28px_rgba(87,64,20,0.42)] sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:z-50 sm:mt-2 sm:w-[min(22rem,85vw)] sm:max-w-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#4F3D17]">Quality Assessment Breakdown</p>
                <p className="mt-2 text-sm leading-6 text-[#6A604F]">
                  This view uses the latest saved PawFinder trust snapshot already cached for this provider.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E6D7B9] bg-white text-[#7A5A19] shadow-sm transition hover:border-[#B98B2C] hover:text-[#5F4715] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B98B2C]/40 sm:hidden"
                aria-label="Close quality assessment explanation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {badgeMeta && BadgeIcon ? (
              <div
                className={`mt-4 inline-flex max-w-full items-center gap-2 rounded-[1.1rem] border px-3 py-2 text-xs font-semibold sm:text-sm ${badgeMeta.shellClassName}`}
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm">
                  <BadgeIcon className={`h-4 w-4 ${badgeMeta.iconClassName}`} />
                </span>
                <span className="whitespace-normal leading-5">{badgeEmoji} {trustBadge} - {badgeMeta.label}</span>
              </div>
            ) : (
              <div className="mt-4 inline-flex rounded-full border border-[#D8D8D8] bg-[#F5F5F5] px-3 py-2 text-xs font-semibold text-[#505861] sm:text-sm">
                Quality snapshot unavailable
              </div>
            )}

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8A6D32]">
                Summary Rationale
              </p>
              <p className="mt-2 text-sm leading-6 text-[#4E514B]">
                {auditReason?.trim() || "Not enough saved assessment data is available yet."}
              </p>
            </div>

            {visibleTakeaways.length > 0 ? (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8A6D32]">
                  Key Takeaways
                </p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-[#4E514B]">
                  {visibleTakeaways.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#B98B2C]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export type { TrustBadgeValue };

export function ProviderTrustSummaryCard({
  trustBadge,
  googleRating,
  googleReviewCount,
  auditReason,
  safetyFlags = [],
  highlights = [],
  className = "",
}: ProviderTrustSummaryCardProps) {
  const hasGoogleRating = typeof googleRating === "number" && Number.isFinite(googleRating);
  const formattedRating = hasGoogleRating ? googleRating.toFixed(1) : "N/A";
  const reviewCountLabel =
    typeof googleReviewCount === "number"
      ? `${googleReviewCount} reviews`
      : hasGoogleRating
        ? "Review count unavailable"
        : "Rating unavailable";

  return (
    <div
      className={`rounded-2xl border border-amber-100 bg-amber-50/50 p-3.5 shadow-[0_16px_38px_-30px_rgba(123,90,29,0.35)] sm:p-4 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex items-center gap-2 text-[#7A5A19]">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[1.55rem] font-black tracking-[-0.03em]">{formattedRating}</span>
            <span className="text-sm font-semibold text-[#8E6A20]/80">/ 5</span>
          </div>
        </div>
        <RatingStars rating={googleRating} />
        <span className="text-sm font-medium text-[#6A604F]">{reviewCountLabel}</span>
        <span className="inline-flex rounded-full border border-[#E7D8B8] bg-white/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A5A19]">
          Google Rating
        </span>
      </div>

      <hr className="my-3 border-amber-200/50" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[#4F3D17]">🤖 Provider Quality Assessment</p>
          <SafetyScanInfoPopover
            trustBadge={trustBadge}
            auditReason={auditReason}
            safetyFlags={safetyFlags}
            highlights={highlights}
          />
        </div>

        {trustBadge ? (
          <TrustBadge trustBadge={trustBadge} />
        ) : (
          <span className="text-sm font-medium text-[#8A8176]">Safety scan unavailable</span>
        )}
      </div>
    </div>
  );
}

export default function TrustBadge({ trustBadge, className = "" }: TrustBadgeProps) {
  const meta = TRUST_BADGE_META[trustBadge];
  const Icon = meta.icon;

  return (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-[1.1rem] border px-3 py-2 text-xs font-semibold shadow-[0_12px_28px_-24px_rgba(32,38,31,0.45)] sm:text-sm ${meta.shellClassName} ${className}`.trim()}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm">
        <Icon className={`h-4 w-4 ${meta.iconClassName}`} />
      </span>
      <span className="min-w-0 whitespace-normal leading-5">{meta.label}</span>
    </div>
  );
}
