"use client";

import { ExternalLink, PawPrint, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import LocationSearchControl, {
  type LocationSearchContext,
} from "@/components/location/LocationSearchControl";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  providers?: AssistantProviderCard[];
};

type AssistantProviderCard = {
  id: string;
  name: string;
  category: string | null;
};

type AssistantApiResponse = {
  reply?: string;
  error?: string;
  needs_location?: boolean;
  providers?: AssistantProviderCard[];
};

type StoredChatSession = {
  timestamp: number;
  messages: ChatMessage[];
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "Hi, I can help you narrow things down. Try asking for needs like a calm waiting room, gentle handling, or breed-specific experience.",
  },
];

const ASSISTANT_LOCATION_SESSION_KEY = "pawfinder:assistant-location-context";
const CHAT_SESSION_STORAGE_KEY = "pawfinder_chat_session";
const CHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 18000;
const TIMEOUT_MESSAGE = "Connection timed out. Please check your signal and try again.";
const DUPLICATE_MESSAGE_WARNING =
  "It looks like you've sent the same question! Please try rephrasing or asking something new.";
const PROVIDER_LINK_REGEX = /\[([^\]]+)\]\(provider:([^)]+)\)/g;

type MessageSegment =
  | { type: "text"; value: string }
  | { type: "provider"; name: string; providerId: string };

function isValidProviderCardArray(value: unknown): value is AssistantProviderCard[] {
  return Array.isArray(value) && value.every((provider) => {
    if (!provider || typeof provider !== "object") return false;

    const candidate = provider as Partial<AssistantProviderCard>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      (typeof candidate.category === "string" || candidate.category === null || candidate.category === undefined)
    );
  });
}

function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(PROVIDER_LINK_REGEX)) {
    const matchedText = match[0];
    const name = match[1];
    const providerId = match[2];
    const matchIndex = match.index ?? -1;

    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        value: content.slice(lastIndex, matchIndex),
      });
    }

    segments.push({
      type: "provider",
      name,
      providerId,
    });
    lastIndex = matchIndex + matchedText.length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      value: content.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

function isValidChatMessageArray(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.every((message) => {
    if (!message || typeof message !== "object") return false;

    const candidate = message as Partial<ChatMessage>;
    return (
      (candidate.role === "assistant" || candidate.role === "user") &&
      typeof candidate.id === "string" &&
      typeof candidate.content === "string" &&
      (candidate.providers === undefined || isValidProviderCardArray(candidate.providers))
    );
  });
}

function getInitialMessages() {
  if (typeof window === "undefined") {
    return INITIAL_MESSAGES;
  }

  const rawSession = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY);

  if (!rawSession) {
    return INITIAL_MESSAGES;
  }

  try {
    const parsed = JSON.parse(rawSession) as Partial<StoredChatSession>;

    if (
      typeof parsed.timestamp !== "number" ||
      Date.now() - parsed.timestamp > CHAT_SESSION_TTL_MS ||
      !isValidChatMessageArray(parsed.messages)
    ) {
      window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
      return INITIAL_MESSAGES;
    }

    return parsed.messages.length > 0 ? parsed.messages : INITIAL_MESSAGES;
  } catch {
    window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
    return INITIAL_MESSAGES;
  }
}

function isValidLocationContext(value: unknown): value is LocationSearchContext {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<LocationSearchContext>;

  if (candidate.kind === "postcode") {
    return typeof candidate.label === "string" && typeof candidate.postcode === "string";
  }

  if (candidate.kind === "place") {
    return (
      typeof candidate.label === "string" &&
      typeof candidate.place_id === "string" &&
      typeof candidate.lat === "number" &&
      typeof candidate.lng === "number"
    );
  }

  return false;
}

function getLocationContextFromSearchParams(
  searchParams: ReturnType<typeof useSearchParams>
): LocationSearchContext | null {
  const postcode = searchParams.get("postcode")?.trim();

  if (postcode) {
    return {
      kind: "postcode",
      label: postcode,
      postcode,
    };
  }

  const location = searchParams.get("location")?.trim();
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (location && Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      kind: "place",
      label: location,
      place_id: `search-${location}-${lat}-${lng}`,
      lat,
      lng,
    };
  }

  return null;
}

export default function ChatBubble() {
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(getInitialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [isCollectingLocation, setIsCollectingLocation] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const urlLocationContext = useMemo(
    () => getLocationContextFromSearchParams(searchParams),
    [searchParams]
  );

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [isLoading, isOpen, messages]);

  useEffect(() => {
    if (!urlLocationContext) return;

    window.sessionStorage.setItem(
      ASSISTANT_LOCATION_SESSION_KEY,
      JSON.stringify(urlLocationContext)
    );
  }, [urlLocationContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const payload: StoredChatSession = {
      timestamp: Date.now(),
      messages,
    };

    window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, JSON.stringify(payload));
  }, [messages]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    document.body.style.overflow = isOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const activeLocationContext = (() => {
    if (urlLocationContext) {
      return urlLocationContext;
    }

    if (typeof window === "undefined") {
      return null;
    }

    const storedContext = window.sessionStorage.getItem(ASSISTANT_LOCATION_SESSION_KEY);

    if (!storedContext) {
      return null;
    }

    try {
      const parsed = JSON.parse(storedContext);
      return isValidLocationContext(parsed) ? parsed : null;
    } catch {
      window.sessionStorage.removeItem(ASSISTANT_LOCATION_SESSION_KEY);
      return null;
    }
  })();

  const messageCountLabel = useMemo(() => {
    const count = messages.length;
    return count === 1 ? "1 note" : `${count} notes`;
  }, [messages.length]);

  const activeLocationLabel = useMemo(() => {
    if (!activeLocationContext) return null;

    return activeLocationContext.kind === "postcode"
      ? `Using postcode ${activeLocationContext.postcode}`
      : `Using area ${activeLocationContext.label}`;
  }, [activeLocationContext]);

  const sendConversation = async (
    conversationMessages: ChatMessage[],
    nextLocationContext: LocationSearchContext | null
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const locationPayload =
      nextLocationContext?.kind === "postcode"
        ? { postcode: nextLocationContext.postcode }
        : nextLocationContext
          ? {
              location: nextLocationContext.label,
              lat: nextLocationContext.lat,
              lng: nextLocationContext.lng,
            }
          : {};

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: conversationMessages
            .slice(-10)
            .map(({ role, content }) => ({ role, content })),
          ...locationPayload,
        }),
      });

      const payload = ((await response.json().catch(() => ({}))) || {}) as AssistantApiResponse;

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "The assistant could not answer just now."
        );
      }

      const reply =
        typeof payload?.reply === "string" && payload.reply.trim().length > 0
          ? payload.reply.trim()
          : "I couldn’t generate a recommendation just now. Please try again.";
      const providerCards = isValidProviderCardArray(payload.providers)
        ? payload.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            category: provider.category ?? null,
          }))
        : undefined;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: reply,
          providers: providerCards,
        },
      ]);
      setIsCollectingLocation(Boolean(payload.needs_location));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(TIMEOUT_MESSAGE);
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleSend = async () => {
    const trimmedDraft = draft.trim();

    if (!trimmedDraft || isLoading) return;
    setShowResetConfirm(false);

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");

    if (lastUserMessage?.content.trim() === trimmedDraft) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-duplicate-${Date.now()}`,
          role: "assistant",
          content: DUPLICATE_MESSAGE_WARNING,
        },
      ]);
      setDraft("");
      setIsOpen(true);
      return;
    }

    const timestamp = Date.now();
    const nextMessages = [
      ...messages,
      {
        id: `user-${timestamp}`,
        role: "user" as const,
        content: trimmedDraft,
      },
    ];

    setMessages(nextMessages);
    setDraft("");
    setIsOpen(true);

    try {
      setIsLoading(true);
      await sendConversation(nextMessages, activeLocationContext);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The assistant hit a temporary problem. Please try again in a moment.";

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-error-${timestamp}`,
          role: "assistant",
          content: errorMessage,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolvedLocation = async (nextLocationContext: LocationSearchContext) => {
    const locationMessage: ChatMessage =
      nextLocationContext.kind === "postcode"
        ? {
            id: `user-location-${Date.now()}`,
            role: "user",
            content: `My postcode is ${nextLocationContext.postcode}.`,
          }
        : {
            id: `user-location-${Date.now()}`,
            role: "user",
            content: `I'm looking around ${nextLocationContext.label}.`,
          };

    const nextMessages = [...messages, locationMessage];

    window.sessionStorage.setItem(
      ASSISTANT_LOCATION_SESSION_KEY,
      JSON.stringify(nextLocationContext)
    );
    setMessages(nextMessages);
    setShowResetConfirm(false);

    try {
      setIsLoading(true);
      setIsCollectingLocation(false);
      await sendConversation(nextMessages, nextLocationContext);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The assistant hit a temporary problem. Please try again in a moment.";

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-location-error-${Date.now()}`,
          role: "assistant",
          content: errorMessage,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetConversation = () => {
    setMessages(INITIAL_MESSAGES);
    setDraft("");
    setIsCollectingLocation(false);
    setShowResetConfirm(false);
    window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
  };

  const renderMessageBody = (message: ChatMessage) => {
    const providerMap = new Map(
      (message.providers || []).map((provider) => [provider.id, provider] as const)
    );
    const segments = parseMessageSegments(message.content);

    return (
      <div className="space-y-2.5">
        {segments.map((segment, index) => {
          if (segment.type === "text") {
            if (!segment.value.trim()) return null;

            return (
              <p key={`${message.id}-text-${index}`} className="whitespace-pre-wrap">
                {segment.value.trim()}
              </p>
            );
          }

          const provider = providerMap.get(segment.providerId);

          return (
            <div
              key={`${message.id}-provider-${segment.providerId}-${index}`}
              className="rounded-[1rem] border border-[#DCCFB7] bg-[#FFFCF7] p-3 text-[#20261F] shadow-[0_12px_24px_-22px_rgba(32,38,31,0.35)]"
            >
              <p className="font-semibold leading-5 text-[#20261F]">
                {provider?.name || segment.name}
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-[#7B8278]">
                {provider?.category || "Category unavailable"}
              </p>
              <a
                href={`/provider/${segment.providerId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#D6C8B3] bg-white px-3 py-1.5 text-xs font-semibold text-[#B14A2B] transition hover:border-[#B14A2B] hover:text-[#973D24]"
              >
                <span>View Profile</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex items-end justify-end sm:bottom-6 sm:right-6">
      <div className="pointer-events-auto flex flex-col items-end gap-3">
        {isOpen ? (
          <section
            id="pawfinder-assistant-panel"
            aria-label="PawFinder Assistant"
            className="pawfinder-fade-up fixed bottom-24 left-4 right-4 z-[81] flex max-h-[calc(100vh-120px)] min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-[#DCD3BE] bg-[#FFFDFC] shadow-[0_30px_70px_-34px_rgba(32,38,31,0.42)] md:left-auto md:w-[400px]"
          >
            <div className="shrink-0 border-b border-[#E8DECC] bg-[linear-gradient(180deg,rgba(250,247,241,0.96),rgba(255,253,252,0.98))] px-5 py-4">
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
                  <p className="mt-2 font-sans text-[0.78rem] leading-5 text-[#6C7468]">
                    History saved on device for 24 hours.
                  </p>
                  <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#7B8278]">
                    {activeLocationLabel || "Ask first, then add your postcode or city when needed"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm((currentValue) => !currentValue)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-[#E6DECD] bg-white px-3 text-[#8C5B4D] transition hover:border-[#D0C4AE] hover:text-[#20261F]"
                    aria-label="Reset chat history"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-[0.14em]">Reset</span>
                  </button>
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
            </div>

            <div className="shrink-0 border-b border-[#EEE6D7] bg-[#FAF7F1]/88 px-5 py-2.5 text-xs uppercase tracking-[0.2em] text-[#7B8278]">
              {messageCountLabel}
            </div>

            {showResetConfirm ? (
              <div className="shrink-0 border-b border-[#EEE6D7] bg-[#FFF7F2] px-5 py-4">
                <p className="text-sm font-medium leading-6 text-[#7A3E2C]">
                  Are you sure you want to permanently delete your chat history?
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetConversation}
                    className="inline-flex items-center rounded-full bg-[#B14A2B] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#FFF8F2] transition hover:bg-[#973D24]"
                  >
                    Yes, Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    className="inline-flex items-center rounded-full border border-[#D9CBB6] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#5B6258] transition hover:border-[#BCA88B] hover:text-[#20261F]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div
              ref={scrollContainerRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,#FFFDFC_0%,#FAF7F1_100%)] px-4 py-4"
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
                      {renderMessageBody(message)}
                    </div>
                  </div>
                );
              })}
              {isLoading ? (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-[1.35rem] border border-[#E4DBCA] bg-[#FFF8F1] px-4 py-3 text-sm leading-6 text-[#394136] shadow-[0_12px_24px_-20px_rgba(32,38,31,0.38)]">
                    <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] opacity-75">
                      Assistant
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="animate-pulse">Assistant is thinking...</span>
                      <span className="flex items-center gap-1" aria-hidden="true">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#B14A2B] animate-pulse" />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#B14A2B] animate-pulse"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#B14A2B] animate-pulse"
                          style={{ animationDelay: "300ms" }}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-[#E9E0D1] bg-[#FFFDFC] p-4">
              {isCollectingLocation ? (
                <div className="rounded-[1.35rem] border border-[#E6DECD] bg-[#FFFCF8] p-3 shadow-[0_18px_34px_-28px_rgba(32,38,31,0.25)]">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#8C5B4D]">
                    Add your postcode or city
                  </p>
                  <LocationSearchControl
                    key={activeLocationContext?.label || "assistant-location-control"}
                    id="assistant-location"
                    label="Location for nearby matches"
                    submitLabel="Use this location"
                    variant="assistant"
                    autoSubmitOnSelect
                    disabled={isLoading}
                    initialQuery={activeLocationContext?.label || ""}
                    onResolved={handleResolvedLocation}
                  />
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSend();
                  }}
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
                        maxLength={1000}
                        placeholder="Describe the care you need..."
                        disabled={isLoading}
                        className="w-full rounded-[1.15rem] border border-[#DCD3BE] bg-[#FAF7F1] px-4 py-3 pr-11 text-sm text-[#20261F] outline-none transition placeholder:text-[#7D837B] focus:border-[#B14A2B] focus:bg-white"
                      />
                      <PawPrint className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B14A2B]" />
                    </div>
                    <button
                      type="submit"
                      disabled={!draft.trim() || isLoading}
                      className="inline-flex h-12 items-center gap-2 rounded-[1.1rem] bg-[#B14A2B] px-4 text-sm font-semibold text-[#FFF8F2] shadow-[0_18px_34px_-22px_rgba(177,74,43,0.8)] transition hover:bg-[#973D24] disabled:cursor-not-allowed disabled:bg-[#CFA393] disabled:shadow-none"
                    >
                      <span>Send</span>
                      <SendHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              )}
            </div>
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
