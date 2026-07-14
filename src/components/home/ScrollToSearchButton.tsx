"use client";

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

type ScrollToSearchButtonProps = {
  targetId: string;
  className?: string;
  children?: ReactNode;
};

export default function ScrollToSearchButton({
  targetId,
  className,
  children = "Browse providers",
}: ScrollToSearchButtonProps) {
  const handleClick = () => {
    const input = document.getElementById(targetId) as HTMLInputElement | null;

    if (!input) return;

    input.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    window.setTimeout(() => {
      input.focus();
    }, 450);
  };

  return (
    <button type="button" onClick={handleClick} className={className}>
      <span>{children}</span>
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}
