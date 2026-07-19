"use client";

import type { FormEvent } from "react";
import { useId, useState } from "react";

type WaitlistUserType = "pet_owner" | "pet_business";

type WaitlistFormProps = {
  compact?: boolean;
  className?: string;
};

type WaitlistApiResponse = {
  error?: string;
  message?: string;
};

const ROLE_OPTIONS: Array<{ label: string; value: WaitlistUserType }> = [
  { label: "I am a Pet Owner", value: "pet_owner" },
  { label: "I have Pet Business / Provider", value: "pet_business" },
];

const EMAIL_PLACEHOLDER = "Enter your email";

export default function WaitlistForm({ compact = false, className = "" }: WaitlistFormProps) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState<WaitlistUserType>("pet_owner");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "duplicate" | "error">("idle");
  const [message, setMessage] = useState("");

  const isSubmitting = status === "loading";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) return;

    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          user_type: userType,
        }),
      });

      const payload = ((await response.json().catch(() => ({}))) || {}) as WaitlistApiResponse;

      if (!response.ok) {
        const errorMessage =
          typeof payload.error === "string" ? payload.error : "Something went wrong. Please try again.";
        const isDuplicate = response.status === 409;
        setStatus(isDuplicate ? "duplicate" : "error");
        setMessage(errorMessage);
        return;
      }

      setStatus("success");
      setMessage(
        typeof payload.message === "string"
          ? payload.message
          : "Awesome! You're signed up for launch alerts."
      );
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  };

  return (
    <div
      className={`rounded-[1.6rem] border border-[#DCD3BE] bg-[linear-gradient(180deg,rgba(255,253,249,0.98),rgba(250,247,241,0.98))] shadow-[0_24px_50px_-30px_rgba(32,38,31,0.35)] ${className}`}
    >
      <div className={compact ? "p-4" : "p-5 sm:p-6"}>
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#F3E0D9] text-lg text-[#B14A2B] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            ✉️
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">
              Get Updates
            </p>
            <h3
              className={`mt-1 font-display tracking-[-0.03em] text-[#20261F] ${
                compact ? "text-[1.2rem] leading-6" : "text-[1.65rem] leading-8"
              }`}
            >
              Be the first to know when new features launch.
            </h3>
            <p className={`mt-2 text-[#4A5147] ${compact ? "text-sm leading-6" : "text-base leading-7"}`}>
              Tell us whether you are looking for care or offering it, and we will send launch alerts your way.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-2">
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]">
              Your role
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_OPTIONS.map((option) => {
                const isActive = userType === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setUserType(option.value)}
                    className={`rounded-[1rem] border px-4 py-3 text-left text-sm font-semibold transition ${
                      isActive
                        ? "border-[#B14A2B] bg-[#FFF1EA] text-[#8C5B4D] shadow-[0_12px_24px_-20px_rgba(177,74,43,0.45)]"
                        : "border-[#E1D7C8] bg-white text-[#4A5147] hover:border-[#C9B8A0] hover:text-[#20261F]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <label
              htmlFor={emailId}
              className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7A7F74]"
            >
              Email address
            </label>
            <div className={`flex ${compact ? "flex-col gap-3" : "flex-col gap-3 sm:flex-row sm:items-end"}`}>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={EMAIL_PLACEHOLDER}
                autoComplete="email"
                required
                disabled={isSubmitting}
                className="min-w-0 flex-1 rounded-[1rem] border border-[#DCD3BE] bg-white px-4 py-3 text-sm text-[#20261F] outline-none transition placeholder:text-[#8B8F87] focus:border-[#B14A2B]"
              />
              <button
                type="submit"
                disabled={isSubmitting || email.trim().length === 0}
                className="inline-flex h-12 items-center justify-center rounded-[1rem] bg-[#B14A2B] px-5 text-sm font-semibold text-[#FFF8F2] shadow-[0_20px_35px_-24px_rgba(177,74,43,0.75)] transition hover:bg-[#973D24] disabled:cursor-not-allowed disabled:bg-[#CFA393] disabled:shadow-none"
              >
                {isSubmitting ? "Submitting..." : "Get Updates"}
              </button>
            </div>
          </div>

          {message ? (
            <p
              className={`rounded-[1rem] border px-4 py-3 text-sm font-medium ${
                status === "success"
                  ? "border-[#B8D9BE] bg-[#ECFAEF] text-[#27563A]"
                  : status === "duplicate"
                    ? "border-[#D7C7A4] bg-[#FFF7E2] text-[#7A5C1A]"
                    : "border-[#E2B8B0] bg-[#FDEDEC] text-[#8B3324]"
              }`}
            >
              {message}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
