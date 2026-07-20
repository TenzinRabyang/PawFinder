"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
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
    label: "Consistent Record",
    icon: CheckCircle2,
    shellClassName: "border-[#C4DFC8] bg-[#EEF8F0] text-[#26583A]",
    iconClassName: "text-[#2E8B57]",
  },
  YELLOW: {
    label: "Caution / Mixed",
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

function SafetyScanInfoPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#D9C8A6] bg-white/90 text-[#7A5A19] shadow-sm transition hover:border-[#B98B2C] hover:text-[#5F4715] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B98B2C]/40"
        aria-label="Explain PawFinder AI Safety Scan"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-haspopup="dialog"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {isOpen ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label="How PawFinder AI Safety Scan Works"
          className="absolute left-0 top-full z-20 mt-2 w-[min(21rem,calc(100vw-2.5rem))] rounded-2xl border border-[#E6D7B9] bg-[#FFFDF8] p-4 text-left shadow-[0_22px_50px_-26px_rgba(87,64,20,0.35)] sm:left-auto sm:right-0"
        >
          <p className="text-sm font-semibold text-[#4F3D17]">How PawFinder AI Safety Scan Works</p>
          <p className="mt-2 text-sm leading-6 text-[#6A604F]">
            Our AI scans raw customer reviews to flag safety concerns or service pattern issues.
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#4E514B]">
            <li>🟢 Green (Consistent Record): Clean history, high satisfaction, 0 safety flags.</li>
            <li>🟡 Yellow (Caution / Mixed): Isolated complaint or mixed overall review sentiment.</li>
            <li>
              🔴 Red (Safety Warning): Critical issues reported (e.g., severe neglect, lost pets,
              unlocked doors) or recurring service patterns.
            </li>
            <li>⚪ Gray (Insufficient Data): Fewer than 5 reviews available for scan.</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export type { TrustBadgeValue };

export function ProviderTrustSummaryCard({
  trustBadge,
  googleRating,
  googleReviewCount,
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
          <p className="text-sm font-semibold text-[#4F3D17]">🤖 AI Safety Assessment</p>
          <SafetyScanInfoPopover />
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
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold shadow-[0_12px_28px_-24px_rgba(32,38,31,0.45)] ${meta.shellClassName} ${className}`.trim()}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm">
        <Icon className={`h-4 w-4 ${meta.iconClassName}`} />
      </span>
      <span className="min-w-0 truncate">{meta.label}</span>
    </div>
  );
}
