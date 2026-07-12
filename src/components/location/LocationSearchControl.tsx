"use client";

import { MapPin, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type LocationSearchContext =
  | {
      kind: "postcode";
      label: string;
      postcode: string;
    }
  | {
      kind: "place";
      label: string;
      place_id: string;
      lat: number;
      lng: number;
    };

type LocationSuggestion = {
  description: string;
  place_id: string;
  main_text: string;
  secondary_text: string;
};

type SelectedLocation = {
  description: string;
  place_id: string;
  lat: number;
  lng: number;
};

type LocationSearchControlProps = {
  id: string;
  label: string;
  submitLabel: string;
  onResolved: (context: LocationSearchContext) => Promise<void> | void;
  initialQuery?: string;
  variant?: "homepage" | "assistant";
  autoSubmitOnSelect?: boolean;
  disabled?: boolean;
};

const PLACEHOLDER_EXAMPLES = [
  "Try 'S1' or 'Chorlton'",
  "Try 'S10 1BD'",
  "Try 'Sheffield'",
];
const REQUEST_TIMEOUT_MS = 15000;
const TIMEOUT_MESSAGE = "Connection timed out. Please check your signal and try again.";

export default function LocationSearchControl({
  id,
  label,
  submitLabel,
  onResolved,
  initialQuery = "",
  variant = "homepage",
  autoSubmitOnSelect = false,
  disabled = false,
}: LocationSearchControlProps) {
  const [query, setQuery] = useState(initialQuery);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);
  const [suppressAutocomplete, setSuppressAutocomplete] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestCounterRef = useRef(0);
  const postcodePattern = "[A-Za-z]{1,2}[0-9][A-Za-z0-9]?\\s?[0-9][A-Za-z]{2}";

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPlaceholderIndex((currentIndex) => (currentIndex + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 2400);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (suppressAutocomplete || disabled) return;

    const trimmedValue = query.trim();

    if (trimmedValue.length < 3) return;

    const currentRequestId = requestCounterRef.current + 1;
    requestCounterRef.current = currentRequestId;

    const timeoutId = window.setTimeout(async () => {
      setIsLoadingSuggestions(true);
      setAutocompleteError("");
      const controller = new AbortController();
      const abortTimeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`/api/location-autocomplete?input=${encodeURIComponent(trimmedValue)}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to load suggestions");
        }

        const data = await response.json();

        if (requestCounterRef.current !== currentRequestId) {
          return;
        }

        const nextSuggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(nextSuggestions);
        setShowSuggestions(nextSuggestions.length > 0);
      } catch (fetchError) {
        console.error("[location-search-control] autocomplete request failed", fetchError);

        if (requestCounterRef.current !== currentRequestId) {
          return;
        }

        setSuggestions([]);
        setShowSuggestions(false);
        setAutocompleteError(
          fetchError instanceof DOMException && fetchError.name === "AbortError"
            ? TIMEOUT_MESSAGE
            : "Location suggestions are unavailable right now."
        );
      } finally {
        window.clearTimeout(abortTimeoutId);
        if (requestCounterRef.current === currentRequestId) {
          setIsLoadingSuggestions(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [disabled, query, suppressAutocomplete]);

  const helperText = useMemo(() => {
    if (query.trim().length < 3) {
      return "Search by full postcode, postcode area, town, or city.";
    }

    if (isLoadingSuggestions) {
      return "Loading UK location suggestions...";
    }

    return autocompleteError || "Suggestions are limited to UK towns, cities, and postcode areas.";
  }, [autocompleteError, isLoadingSuggestions, query]);

  const submitResolvedContext = async (context: LocationSearchContext) => {
    setIsSubmitting(true);
    setError("");

    try {
      await onResolved(context);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectSuggestion = async (suggestion: LocationSuggestion) => {
    setError("");
    setAutocompleteError("");
    setShowSuggestions(false);
    setSuppressAutocomplete(true);
    setQuery(suggestion.description);
    setSuggestions([]);
    setIsLoadingSuggestions(false);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `/api/location-details?placeId=${encodeURIComponent(suggestion.place_id)}`,
        { cache: "no-store", signal: controller.signal }
      );

      if (!response.ok) {
        throw new Error("Failed to load location details");
      }

      const details = await response.json();
      const resolvedLocation = {
        description: suggestion.description,
        place_id: suggestion.place_id,
        lat: details.lat,
        lng: details.lng,
      } satisfies SelectedLocation;

      setSelectedLocation(resolvedLocation);

      if (autoSubmitOnSelect) {
        await submitResolvedContext({
          kind: "place",
          label: resolvedLocation.description,
          place_id: resolvedLocation.place_id,
          lat: resolvedLocation.lat,
          lng: resolvedLocation.lng,
        });
      }
    } catch (detailsError) {
      console.error("[location-search-control] location details request failed", detailsError);
      setSelectedLocation(null);
      setAutocompleteError(
        detailsError instanceof DOMException && detailsError.name === "AbortError"
          ? TIMEOUT_MESSAGE
          : "We couldn't prepare that location. Please try again."
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleSubmit = async () => {
    if (disabled || isSubmitting) return;

    if (selectedLocation) {
      await submitResolvedContext({
        kind: "place",
        label: selectedLocation.description,
        place_id: selectedLocation.place_id,
        lat: selectedLocation.lat,
        lng: selectedLocation.lng,
      });
      return;
    }

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Please enter a postcode.");
      return;
    }

    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
    if (!postcodeRegex.test(trimmedQuery)) {
      setError("Please enter a full, valid UK postcode (e.g. S10 1BD). Outcodes like 'S10' are not sufficient.");
      return;
    }

    await submitResolvedContext({
      kind: "postcode",
      label: trimmedQuery,
      postcode: trimmedQuery.toUpperCase().replace(/\s+/g, ""),
    });
  };

  const isAssistantVariant = variant === "assistant";
  const inputShellClassName = isAssistantVariant
    ? "flex items-center gap-3 rounded-[1.15rem] border border-[#DCD3BE] bg-[#FAF7F1] px-4 py-3"
    : "flex items-center gap-3 rounded-[1.4rem] border border-[#DCD3BE] bg-[#FAF7F1] px-4 py-3.5";
  const submitButtonClassName = isAssistantVariant
    ? "pressable-soft inline-flex w-full items-center justify-center rounded-[1.15rem] bg-[#6E7C5B] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-24px_rgba(110,124,91,0.8)] transition hover:bg-[#5C694D] disabled:cursor-not-allowed disabled:bg-[#B8BFAF] disabled:shadow-none"
    : "pressable-soft inline-flex w-full items-center justify-center rounded-[1.35rem] bg-[#B14A2B] px-5 py-3.5 text-base font-semibold text-white shadow-[0_18px_36px_-24px_rgba(177,74,43,0.9)] transition hover:bg-[#9E4126] disabled:cursor-not-allowed disabled:bg-[#CFA393] disabled:shadow-none";

  return (
    <div className="space-y-3">
      <div className="relative">
        <label
          htmlFor={id}
          className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-[#B14A2B]"
        >
          {label}
        </label>
        <div className={inputShellClassName}>
          <MapPin className="h-5 w-5 flex-shrink-0 text-[#B14A2B]" />
          <input
            id={id}
            type="text"
            value={query}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSuppressAutocomplete(false);
              setQuery(nextValue);
              setError("");
              setSelectedLocation(null);

              if (nextValue.trim().length < 3) {
                setSuggestions([]);
                setShowSuggestions(false);
                setIsLoadingSuggestions(false);
                setAutocompleteError("");
              }
            }}
            onFocus={() => {
              if (suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setShowSuggestions(false);
              }, 150);
            }}
            placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            pattern={selectedLocation ? undefined : postcodePattern}
            title={
              selectedLocation
                ? "Search for the selected UK location."
                : "Please enter a full UK postcode, for example S10 1BD."
            }
            disabled={disabled || isSubmitting}
            className="w-full bg-transparent text-base text-[#20261F] outline-none placeholder:text-[#7D837B]"
          />
        </div>
        {showSuggestions && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-[1.5rem] border border-[#DCD3BE] bg-white text-left shadow-[0_18px_36px_-22px_rgba(32,38,31,0.42)]">
            <div className="border-b border-[#EEE7D6] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#7D837B]">
              UK location suggestions
            </div>
            <ul className="max-h-80 overflow-y-auto py-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion.place_id}>
                  <button
                    type="button"
                    onMouseDown={async (event) => {
                      event.preventDefault();
                      await handleSelectSuggestion(suggestion);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#FAF7F1]"
                  >
                    <Search className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#9AA092]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[#20261F]">
                        {suggestion.main_text}
                      </span>
                      {suggestion.secondary_text && (
                        <span className="block truncate text-xs text-[#4A5147]">
                          {suggestion.secondary_text}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          void handleSubmit();
        }}
        disabled={disabled || isSubmitting}
        className={submitButtonClassName}
      >
        {isSubmitting ? "Applying location..." : submitLabel}
      </button>

      <div className="text-sm text-[#4A5147]">{helperText}</div>
      {error ? (
        <div className="rounded-[1rem] border border-[#EAB3A4] bg-[#FFF3EF] px-4 py-3 text-sm font-medium text-[#9E4126]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
