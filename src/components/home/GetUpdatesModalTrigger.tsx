"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import WaitlistForm from "@/components/waitlist/WaitlistForm";

const MODAL_EXIT_DURATION_MS = 220;

export default function GetUpdatesModalTrigger() {
  const closeTimeoutRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    document.body.style.overflow = "hidden";

    const animationFrame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleOpen = () => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setIsOpen(true);
  };

  const handleClose = () => {
    setIsVisible(false);

    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimeoutRef.current = null;
    }, MODAL_EXIT_DURATION_MS);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-full border border-[#D9CDBB] bg-white/85 px-4 py-2 text-sm font-semibold text-[#20261F] shadow-[0_14px_28px_-22px_rgba(32,38,31,0.35)] backdrop-blur transition hover:-translate-y-0.5 hover:border-[#B14A2B] hover:text-[#B14A2B]"
      >
        <span>Get Updates</span>
        <span aria-hidden="true">🔔</span>
      </button>

      {isOpen ? (
        <div
          className={`fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm transition duration-200 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
          onClick={handleClose}
          role="presentation"
        >
          <div
            className={`relative w-full max-w-xl transition duration-200 ease-out ${
              isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-[0.98] opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Get updates"
          >
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E6DECD] bg-white/95 text-[#6E7C5B] shadow-sm transition hover:border-[#B14A2B] hover:text-[#B14A2B]"
              aria-label="Close updates popup"
            >
              <X className="h-4 w-4" />
            </button>
            <WaitlistForm />
          </div>
        </div>
      ) : null}
    </>
  );
}
