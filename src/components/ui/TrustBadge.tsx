import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldQuestion } from "lucide-react";

type TrustBadgeValue = "GREEN" | "YELLOW" | "RED" | "GRAY";

type TrustBadgeProps = {
  trustBadge: TrustBadgeValue;
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
    label: "Mixed Feedback / Review Details",
    icon: AlertTriangle,
    shellClassName: "border-[#E7D18E] bg-[#FFF8DC] text-[#7A5A11]",
    iconClassName: "text-[#C28712]",
  },
  RED: {
    label: "Safety Flags Detected",
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

export type { TrustBadgeValue };

export default function TrustBadge({ trustBadge, className = "" }: TrustBadgeProps) {
  const meta = TRUST_BADGE_META[trustBadge];
  const Icon = meta.icon;

  return (
    <div
      className={`inline-flex items-center gap-3 rounded-[1.2rem] border px-4 py-3 shadow-[0_16px_34px_-28px_rgba(32,38,31,0.45)] ${meta.shellClassName} ${className}`.trim()}
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 shadow-sm">
        <Icon className={`h-5 w-5 ${meta.iconClassName}`} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{trustBadge}</p>
        <p className="text-sm font-semibold sm:text-base">{meta.label}</p>
      </div>
    </div>
  );
}
