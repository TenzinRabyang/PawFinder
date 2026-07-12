"use client";

import { PawPrint, SendHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "Hi, I can help you narrow things down. Try asking for needs like a calm waiting room, gentle handling, or breed-specific experience.",
  },
];

const SUGGESTED_REPLY =
  "Thanks, I’ve saved that request in this prototype chat. Next we can connect this bubble to search and provider recommendations.";

export default function ChatBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isOpen]);

  const messageCountLabel = useMemo(() => {
    const count = messages.length;
    return count === 1 ? "1 note" : `${count} notes`;
  }, [messages.length]);

  const handleSend = () => {
    const trimmedDraft = draft.trim();

    if (!trimmedDraft) return;

    const timestamp = Date.now();

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `user-${timestamp}`,
        role: "user",
        content: trimmedDraft,
      },
      {
        id: `assistant-${timestamp}`,
        role: "assistant",
        content: SUGGESTED_REPLY,
      },
    ]);
    setDraft("");
    setIsOpen(true);
  };

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex items-end justify-end sm:bottom-6 sm:right-6">
      <div className="pointer-events-auto flex flex-col items-end gap-3">
        {isOpen ? (
          <section
            id="pawfinder-assistant-panel"
            aria-label="PawFinder Assistant"
            className="pawfinder-fade-up w-[calc(100vw-2.5rem)] max-w-sm overflow-hidden rounded-[1.75rem] border border-[#DCD3BE] bg-[#FFFDFC] shadow-[0_30px_70px_-34px_rgba(32,38,31,0.42)]"
          >
            <div className="border-b border-[#E8DECC] bg-[linear-gradient(180deg,rgba(250,247,241,0.96),rgba(255,253,252,0.98))] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[#B14A2B]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3E0D9]">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#8C5B4D]">
                      Local Search Help
                    </p>
                  </div>
                  <h2 className="mt-3 font-display text-[1.45rem] leading-none tracking-[-0.03em] text-[#20261F]">
                    PawFinder Assistant
                  </h2>
                  <p className="mt-2 max-w-[18rem] text-sm leading-6 text-[#5B6258]">
                    Ask for specific conditions, e.g., &quot;vets with a quiet waiting area&quot;.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#E6DECD] bg-white text-[#6E7C5B] transition hover:border-[#D0C4AE] hover:text-[#20261F]"
                  aria-label="Close assistant"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-b border-[#EEE6D7] bg-[#FAF7F1]/88 px-5 py-2.5 text-xs uppercase tracking-[0.2em] text-[#7B8278]">
              {messageCountLabel}
            </div>

            <div
              ref={scrollContainerRef}
              className="max-h-80 space-y-3 overflow-y-auto bg-[linear-gradient(180deg,#FFFDFC_0%,#FAF7F1_100%)] px-4 py-4"
            >
              {messages.map((message) => {
                const isAssistant = message.role === "assistant";

                return (
                  <div
                    key={message.id}
                    className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-[1.35rem] px-4 py-3 text-sm leading-6 shadow-[0_12px_24px_-20px_rgba(32,38,31,0.38)] ${
                        isAssistant
                          ? "border border-[#E4DBCA] bg-[#FFF8F1] text-[#394136]"
                          : "border border-[#7F8A72] bg-[#6E7C5B] text-[#FDFBF7]"
                      }`}
                    >
                      <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] opacity-75">
                        {isAssistant ? "Assistant" : "You"}
                      </p>
                      <p>{message.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
              className="border-t border-[#E9E0D1] bg-[#FFFDFC] p-4"
            >
              <div className="flex items-end gap-3">
                <label htmlFor="pawfinder-assistant-input" className="sr-only">
                  Ask the PawFinder Assistant
                </label>
                <div className="relative flex-1">
                  <input
                    id="pawfinder-assistant-input"
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Describe the care you need..."
                    className="w-full rounded-[1.15rem] border border-[#DCD3BE] bg-[#FAF7F1] px-4 py-3 pr-11 text-sm text-[#20261F] outline-none transition placeholder:text-[#7D837B] focus:border-[#B14A2B] focus:bg-white"
                  />
                  <PawPrint className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B14A2B]" />
                </div>
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="inline-flex h-12 items-center gap-2 rounded-[1.1rem] bg-[#B14A2B] px-4 text-sm font-semibold text-[#FFF8F2] shadow-[0_18px_34px_-22px_rgba(177,74,43,0.8)] transition hover:bg-[#973D24] disabled:cursor-not-allowed disabled:bg-[#CFA393] disabled:shadow-none"
                >
                  <span>Send</span>
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <button
          type="button"
          onClick={() => setIsOpen((currentValue) => !currentValue)}
          aria-expanded={isOpen}
          aria-controls="pawfinder-assistant-panel"
          className="group relative inline-flex h-16 w-16 items-center justify-center rounded-full border border-[#D6C8B3] bg-[radial-gradient(circle_at_30%_30%,#F7E5DD_0%,#B14A2B_68%,#93391F_100%)] text-[#FFF8F2] shadow-[0_24px_44px_-24px_rgba(177,74,43,0.75)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_48px_-22px_rgba(177,74,43,0.8)]"
        >
          <span className="absolute inset-1 rounded-full border border-white/20" />
          <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-[#DCD3BE] bg-[#F7F1E5] text-[#6E7C5B] shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <PawPrint className="h-7 w-7 transition duration-200 group-hover:scale-105" />
          <span className="sr-only">Toggle PawFinder Assistant</span>
        </button>
      </div>
    </div>
  );
}
