"use client";

import { ExternalLink, PawPrint, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import LocationSearchControl, {
  type LocationSearchContext,
} from "@/components/location/LocationSearchControl";
import { consumeDailyUsage, getDailyUsageState } from "@/lib/daily-client-limits";
import { createClient } from "@/utils/supabase/client";

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

const INITIAL_MESSAGES: ChatMessage[] = [];
type FeedbackReason = "wrong_info" | "confusing" | "broken_link";

type MessageFeedbackState = {
  status: "idle" | "choosing_reason" | "submitting" | "submitted";
  selectedReason?: FeedbackReason;
  error?: string;
};

const ASSISTANT_LOCATION_SESSION_KEY = "pawfinder:assistant-location-context";
const CHAT_SESSION_STORAGE_KEY = "pawfinder_chat_session";
const CHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 18000;
const TIMEOUT_MESSAGE = "Connection timed out. Please check your signal and try again.";
const DUPLICATE_MESSAGE_WARNING =
  "It looks like you've sent the same question! Please try rephrasing or asking something new.";
const PROVIDER_LINK_REGEX =
  /\*\*\[([^\]]+)\]\(provider:([^)]+)\)\*\*|\[([^\]]+)\]\(provider:([^)]+)\)/g;
const QUICK_STARTER_CHIPS = [
  "Vets in Sheffield",
  "Cattery nearby",
  "Dog walkers",
];
const QUICK_PROMPT_CHIPS = [
  { label: "🔍 Find groomers near me", prompt: "Find groomers near me" },
  { label: "🐕 Top dog walkers", prompt: "Top dog walkers" },
  { label: "⭐ Highest-rated boarders", prompt: "Highest-rated boarders" },
];
const CHAT_DAILY_LIMIT = 5;
const CHAT_DAILY_LIMIT_STORAGE_KEY = "pawfinder_chat_count";
const AI_WELCOME_STORAGE_KEY = "hasSeenAIWelcome";
const AI_WELCOME_MESSAGE =
  "💬 Hi! Looking for local pet care? Try asking me: 'Find 5-star dog walkers near me' or 'Who is the closest groomer?'";
const FEEDBACK_THANK_YOU_MESSAGE = "Thank you for your feedback! ❤️";
const FEEDBACK_ERROR_MESSAGE = "Couldn’t save feedback. Please try again.";
const CHAT_ONE_LEFT_WARNING_MESSAGE =
  "⚠️ Note: You have 1 free AI search remaining today.";
const CHAT_LIMIT_REACHED_MESSAGE =
  "❌ Daily Limit Reached. You have used your 5 free AI matches for today to protect our beta server. Please come back tomorrow!";
const FEEDBACK_REASONS: Array<{ label: string; value: FeedbackReason }> = [
  { label: "Wrong Info", value: "wrong_info" },
  { label: "Confusing", value: "confusing" },
  { label: "Broken Link", value: "broken_link" },
];

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
    const name = match[1] || match[3];
    const providerId = match[2] || match[4];
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

function renderInlineFormattedText(value: string, keyPrefix: string) {
  const tokens = value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

  return tokens.map((token, index) => {
    const tokenKey = `${keyPrefix}-${index}`;

    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return (
        <strong key={tokenKey} className="font-semibold text-[#20261F]">
          {token.slice(2, -2)}
        </strong>
      );
    }

    return <span key={tokenKey}>{token}</span>;
  });
}

function renderTextSegmentBlock(value: string, keyPrefix: string) {
  const blocks = value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, blockIndex) => {
    const blockKey = `${keyPrefix}-block-${blockIndex}`;
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 1 && /^---+$/.test(lines[0])) {
      return <hr key={blockKey} className="border-[#E2D6C5]" />;
    }

    if (lines.every((line) => /^[-*•]\s+/.test(line))) {
      return (
        <ul key={blockKey} className="space-y-2 pl-5 text-left">
          {lines.map((line, lineIndex) => (
            <li key={`${blockKey}-item-${lineIndex}`} className="marker:text-[#B14A2B]">
              {renderInlineFormattedText(line.replace(/^[-*•]\s+/, ""), `${blockKey}-item-${lineIndex}`)}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <div key={blockKey} className="space-y-2">
        {lines.map((line, lineIndex) => (
          <p key={`${blockKey}-line-${lineIndex}`} className="whitespace-pre-wrap">
            {renderInlineFormattedText(line, `${blockKey}-line-${lineIndex}`)}
          </p>
        ))}
      </div>
    );
  });
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

function getFeedbackPreview(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 100);
}

function isChatLimitBlockMessage(message: string) {
  return /daily limit|limit reached|free ai match|free ai search/i.test(message);
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(getInitialMessages);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, MessageFeedbackState>>(
    {}
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isCollectingLocation, setIsCollectingLocation] = useState(false);
  const [isChatLimitReached, setIsChatLimitReached] = useState(() =>
    getDailyUsageState(CHAT_DAILY_LIMIT_STORAGE_KEY, CHAT_DAILY_LIMIT).isLimited
  );
  const [chatRemainingMessages, setChatRemainingMessages] = useState(() =>
    getDailyUsageState(CHAT_DAILY_LIMIT_STORAGE_KEY, CHAT_DAILY_LIMIT).remaining
  );
  const [showWelcomePreview, setShowWelcomePreview] = useState(false);
  const [playBubbleNudge, setPlayBubbleNudge] = useState(false);
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

  useEffect(() => {
    if (typeof window === "undefined" || pathname !== "/") return;

    const hasSeenWelcome = window.localStorage.getItem(AI_WELCOME_STORAGE_KEY) === "true";

    if (hasSeenWelcome) {
      return;
    }

    const nudgeTimer = window.setTimeout(() => {
      setPlayBubbleNudge(true);
    }, 120);

    const animationTimer = window.setTimeout(() => {
      setPlayBubbleNudge(false);
    }, 2320);

    const previewTimer = window.setTimeout(() => {
      setShowWelcomePreview(true);
      window.localStorage.setItem(AI_WELCOME_STORAGE_KEY, "true");
    }, 3000);

    return () => {
      window.clearTimeout(nudgeTimer);
      window.clearTimeout(animationTimer);
      window.clearTimeout(previewTimer);
    };
  }, [pathname]);

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

  const activeLocationLabel = useMemo(() => {
    if (!activeLocationContext) return null;

    return activeLocationContext.kind === "postcode"
      ? `Using postcode ${activeLocationContext.postcode}`
      : `Using area ${activeLocationContext.label}`;
  }, [activeLocationContext]);
  const hasConversation = messages.length > 0;
  const showOneLeftWarning = chatRemainingMessages === 1 && !isChatLimitReached;

  const syncChatUsageState = () => {
    const nextUsage = getDailyUsageState(CHAT_DAILY_LIMIT_STORAGE_KEY, CHAT_DAILY_LIMIT);
    setIsChatLimitReached(nextUsage.isLimited);
    setChatRemainingMessages(nextUsage.remaining);
    return nextUsage;
  };

  const consumeChatAllowance = () => {
    const nextUsage = consumeDailyUsage(CHAT_DAILY_LIMIT_STORAGE_KEY, CHAT_DAILY_LIMIT);
    setIsChatLimitReached(nextUsage.isLimited);
    setChatRemainingMessages(nextUsage.remaining);
    return nextUsage;
  };

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
          id: `assistant-${crypto.randomUUID()}`,
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

  const submitMessage = async (
    rawDraft: string,
    locationContextOverride: LocationSearchContext | null = activeLocationContext
  ) => {
    const trimmedDraft = rawDraft.trim();

    if (!trimmedDraft || isLoading) return;
    setShowResetConfirm(false);

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");

    if (lastUserMessage?.content.trim() === trimmedDraft) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-duplicate-${crypto.randomUUID()}`,
          role: "assistant",
          content: DUPLICATE_MESSAGE_WARNING,
        },
      ]);
      setDraft("");
      setIsOpen(true);
      return;
    }

    const nextUsage = consumeChatAllowance();

    if (!nextUsage.allowed) {
      setDraft("");
      setIsOpen(true);
      return;
    }

    const userMessageId = `user-${crypto.randomUUID()}`;
    const assistantErrorId = `assistant-error-${crypto.randomUUID()}`;
    const nextMessages = [
      ...messages,
      {
        id: userMessageId,
        role: "user" as const,
        content: trimmedDraft,
      },
    ];

    setMessages(nextMessages);
    setDraft("");
    setIsOpen(true);

    try {
      setIsLoading(true);
      await sendConversation(nextMessages, locationContextOverride);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The assistant hit a temporary problem. Please try again in a moment.";

      if (isChatLimitBlockMessage(errorMessage)) {
        setIsChatLimitReached(true);
        setChatRemainingMessages(0);
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: assistantErrorId,
          role: "assistant",
          content: errorMessage,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    await submitMessage(draft, activeLocationContext);
  };

  const handlePromptShortcut = async (prompt: string) => {
    setDraft(prompt);
    await submitMessage(prompt, activeLocationContext);
  };

  const handleOpenAssistant = () => {
    setShowWelcomePreview(false);
    syncChatUsageState();
    setIsOpen((currentValue) => !currentValue);
  };

  const handleResolvedLocation = async (nextLocationContext: LocationSearchContext) => {
    const nextUsage = consumeChatAllowance();

    if (!nextUsage.allowed) {
      return;
    }

    const locationMessage: ChatMessage =
      nextLocationContext.kind === "postcode"
        ? {
            id: `user-location-${crypto.randomUUID()}`,
            role: "user",
            content: `My postcode is ${nextLocationContext.postcode}.`,
          }
        : {
            id: `user-location-${crypto.randomUUID()}`,
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

      if (isChatLimitBlockMessage(errorMessage)) {
        setIsChatLimitReached(true);
        setChatRemainingMessages(0);
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-location-error-${crypto.randomUUID()}`,
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
    setFeedbackByMessageId({});
    setDraft("");
    setIsCollectingLocation(false);
    setShowResetConfirm(false);
    window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
    syncChatUsageState();
  };

  const setFeedbackState = (messageId: string, nextState: MessageFeedbackState) => {
    setFeedbackByMessageId((currentState) => ({
      ...currentState,
      [messageId]: nextState,
    }));
  };

  const submitFeedback = async (
    message: ChatMessage,
    rating: "thumb_up" | "thumb_down",
    reason?: FeedbackReason
  ) => {
    const nextSubmittingState: MessageFeedbackState = {
      status: "submitting",
      ...(reason ? { selectedReason: reason } : {}),
    };

    setFeedbackState(message.id, nextSubmittingState);

    const insertPayload: {
      feedback_type: string;
      rating: "thumb_up" | "thumb_down";
      reason?: FeedbackReason;
      metadata?: {
        message_id: string;
        preview_text: string;
      };
    } = {
      feedback_type: "ai_chat",
      rating,
    };

    if (reason) {
      insertPayload.reason = reason;
      insertPayload.metadata = {
        message_id: message.id,
        preview_text: getFeedbackPreview(message.content),
      };
    }

    try {
      const { error } = await supabase.from("user_feedback").insert(insertPayload);

      if (error) {
        console.error("Failed to save assistant feedback");
        setFeedbackState(message.id, {
          status: reason ? "choosing_reason" : "idle",
          ...(reason ? { selectedReason: reason } : {}),
          error: FEEDBACK_ERROR_MESSAGE,
        });
        return;
      }

      setFeedbackState(message.id, {
        status: "submitted",
        ...(reason ? { selectedReason: reason } : {}),
      });
    } catch {
      console.error("Failed to save assistant feedback");
      setFeedbackState(message.id, {
        status: reason ? "choosing_reason" : "idle",
        ...(reason ? { selectedReason: reason } : {}),
        error: FEEDBACK_ERROR_MESSAGE,
      });
    }
  };

  const handleThumbUp = async (message: ChatMessage) => {
    const currentState = feedbackByMessageId[message.id];

    if (currentState?.status === "submitted" || currentState?.status === "submitting") {
      return;
    }

    await submitFeedback(message, "thumb_up");
  };

  const handleThumbDown = (messageId: string) => {
    const currentState = feedbackByMessageId[messageId];

    if (currentState?.status === "submitted" || currentState?.status === "submitting") {
      return;
    }

    setFeedbackState(messageId, {
      status: "choosing_reason",
    });
  };

  const handleFeedbackReason = async (message: ChatMessage, reason: FeedbackReason) => {
    const currentState = feedbackByMessageId[message.id];

    if (currentState?.status === "submitted" || currentState?.status === "submitting") {
      return;
    }

    await submitFeedback(message, "thumb_down", reason);
  };

  const renderFeedbackUI = (message: ChatMessage) => {
    const feedbackState = feedbackByMessageId[message.id] ?? { status: "idle" as const };
    const isSubmitting = feedbackState.status === "submitting";
    const showReasonChips =
      feedbackState.status === "choosing_reason" ||
      (feedbackState.status === "submitting" && Boolean(feedbackState.selectedReason));

    if (feedbackState.status === "submitted") {
      return (
        <p className="mt-3 text-xs font-medium text-[#6C7468]">
          {FEEDBACK_THANK_YOU_MESSAGE}
        </p>
      );
    }

    return (
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2.5 text-lg leading-none text-[#9AA095]">
          <button
            type="button"
            onClick={() => void handleThumbUp(message)}
            disabled={isSubmitting}
            aria-label="Mark assistant response as helpful"
            className="transition hover:scale-105 hover:text-[#5B6258] disabled:cursor-wait disabled:opacity-50"
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => handleThumbDown(message.id)}
            disabled={isSubmitting}
            aria-label="Mark assistant response as unhelpful"
            className="transition hover:scale-105 hover:text-[#5B6258] disabled:cursor-wait disabled:opacity-50"
          >
            👎
          </button>
          {isSubmitting ? (
            <span className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[#9AA095]">
              Saving
            </span>
          ) : null}
        </div>

        {showReasonChips ? (
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_REASONS.map((option) => {
              const isSelected = feedbackState.selectedReason === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void handleFeedbackReason(message, option.value)}
                  disabled={isSubmitting}
                  className={`rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] transition ${
                    isSelected
                      ? "border-[#B14A2B] bg-[#F7E5DD] text-[#8C5B4D]"
                      : "border-[#D9D2C4] bg-white/85 text-[#6C7468] hover:border-[#BCA88B] hover:text-[#394136]"
                  } disabled:cursor-wait disabled:opacity-50`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {feedbackState.error ? (
          <p className="text-xs font-medium text-[#A15237]">{feedbackState.error}</p>
        ) : null}
      </div>
    );
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
              <div key={`${message.id}-text-${index}`} className="space-y-3">
                {renderTextSegmentBlock(segment.value.trim(), `${message.id}-text-${index}`)}
              </div>
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
                href={`/provider/${segment.providerId}?featured=1`}
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

  const renderSystemAlert = (variant: "warning" | "error") => {
    const isWarning = variant === "warning";

    return (
      <div className="flex justify-center">
        <div
          className={`w-full max-w-[92%] rounded-[1.2rem] border px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_-20px_rgba(32,38,31,0.4)] ${
            isWarning
              ? "border-[#E7C978] bg-[#FFF5CC] text-[#7A5711]"
              : "border-2 border-[#D88B7B] bg-[#FDE5E1] text-[#8B3324]"
          }`}
        >
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] opacity-80">
            System Message
          </p>
          <p className="mt-1 font-medium">
            {isWarning ? CHAT_ONE_LEFT_WARNING_MESSAGE : CHAT_LIMIT_REACHED_MESSAGE}
          </p>
        </div>
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
            className="pawfinder-fade-up fixed top-16 bottom-24 left-4 right-4 z-[81] flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-[#DCD3BE] bg-[#FFFDFC] shadow-[0_30px_70px_-34px_rgba(32,38,31,0.42)] md:top-auto md:bottom-28 md:left-auto md:w-[400px] md:h-[600px] md:max-h-[80vh]"
          >
            <div className="shrink-0 border-b border-[#E8DECC] bg-[linear-gradient(180deg,rgba(250,247,241,0.96),rgba(255,253,252,0.98))] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F3E0D9] text-[#B14A2B]">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-lg leading-none tracking-[-0.03em] text-[#20261F]">
                        PawFinder Assistant
                      </h2>
                      <p className="mt-1 truncate text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#7B8278]">
                        {activeLocationLabel || "History saved for 24 hours"}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm((currentValue) => !currentValue)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#E6DECD] bg-white text-[#8C5B4D] transition hover:border-[#D0C4AE] hover:text-[#20261F]"
                    aria-label="Reset chat history"
                  >
                    <Trash2 className="h-4 w-4" />
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
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,#FFFDFC_0%,#FAF7F1_100%)] px-4 py-4"
            >
              {!hasConversation && !isLoading ? (
                <div className="flex min-h-full items-center justify-center">
                  <div className="w-full max-w-sm rounded-[1.6rem] border border-[#E6DCCD] bg-[#FFFCF8] p-5 text-center shadow-[0_18px_34px_-28px_rgba(32,38,31,0.25)]">
                    <p className="font-display text-[1.35rem] tracking-[-0.03em] text-[#20261F]">
                      PawFinder Assistant
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#5B6258]">
                      Ask me anything about local pet care services.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {QUICK_STARTER_CHIPS.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          onClick={() => {
                            void handlePromptShortcut(starter);
                          }}
                          disabled={isLoading || isChatLimitReached}
                          className="rounded-full border border-[#DED3C5] bg-white px-3 py-2 text-xs font-semibold text-[#5B6258] transition hover:border-[#B14A2B] hover:text-[#B14A2B] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {starter === "Vets in Sheffield"
                            ? "🐶 Vets in Sheffield"
                            : starter === "Cattery nearby"
                              ? "🐱 Cattery nearby"
                              : "🦮 Dog walkers"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
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
                          {isAssistant ? renderFeedbackUI(message) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {showOneLeftWarning ? renderSystemAlert("warning") : null}
              {isChatLimitReached ? renderSystemAlert("error") : null}
              {isLoading ? (
                <div className="mt-3 flex justify-start">
                  <div
                    className="max-w-[85%] rounded-[1.35rem] border border-[#E4DBCA] bg-[#FFF8F1] px-4 py-3 text-sm leading-6 text-[#394136] shadow-[0_12px_24px_-20px_rgba(32,38,31,0.38)]"
                  >
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
                    disabled={isLoading || isChatLimitReached}
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
                  className="space-y-3"
                >
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PROMPT_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          void handlePromptShortcut(chip.prompt);
                        }}
                        disabled={isLoading || isChatLimitReached}
                        className="rounded-full border border-[#E1D7C8] bg-[#FFFCF8] px-3 py-1.5 text-xs font-semibold text-[#5B6258] transition hover:border-[#B14A2B] hover:text-[#B14A2B] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
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
                        disabled={isLoading || isChatLimitReached}
                        className="w-full rounded-[1.15rem] border border-[#DCD3BE] bg-[#FAF7F1] px-4 py-3 pr-11 text-sm text-[#20261F] outline-none transition placeholder:text-[#7D837B] focus:border-[#B14A2B] focus:bg-white"
                      />
                      <PawPrint className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B14A2B]" />
                    </div>
                    <button
                      type="submit"
                      disabled={!draft.trim() || isLoading || isChatLimitReached}
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

        {!isOpen && showWelcomePreview ? (
          <div className="relative max-w-[18rem] rounded-[1.2rem] border border-[#E4D7C6] bg-[#FFFDF9] px-4 py-3 text-left text-sm leading-5 text-[#394136] shadow-[0_20px_40px_-28px_rgba(32,38,31,0.4)]">
            <div className="absolute -bottom-1.5 right-5 h-3 w-3 rotate-45 border-b border-r border-[#E4D7C6] bg-[#FFFDF9]" />
            <p>{AI_WELCOME_MESSAGE}</p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleOpenAssistant}
          aria-expanded={isOpen}
          aria-controls="pawfinder-assistant-panel"
          className={`group relative inline-flex h-16 w-16 items-center justify-center rounded-full border border-[#D6C8B3] bg-[radial-gradient(circle_at_30%_30%,#F7E5DD_0%,#B14A2B_68%,#93391F_100%)] text-[#FFF8F2] shadow-[0_24px_44px_-24px_rgba(177,74,43,0.75)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_48px_-22px_rgba(177,74,43,0.8)] ${
            playBubbleNudge ? "motion-safe:animate-pulse ring-4 ring-[#F7E5DD]/80 ring-offset-2 ring-offset-transparent" : ""
          }`}
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
