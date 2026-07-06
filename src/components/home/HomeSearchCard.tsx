'use client';

import { MapPin, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

const PLACEHOLDER_EXAMPLES = [
  "Try 'S1' or 'Chorlton'",
  "Try 'S10 1BD'",
  "Try 'Sheffield'",
];

export default function HomeSearchCard() {
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);
  const [suppressAutocomplete, setSuppressAutocomplete] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const requestCounterRef = useRef(0);
  const postcodePattern = "[A-Za-z]{1,2}[0-9][A-Za-z0-9]?\\s?[0-9][A-Za-z]{2}";
  const normalizedPostcode = postcode.trim().toUpperCase().replace(/\s+/g, "");

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPlaceholderIndex((currentIndex) => (currentIndex + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 2400);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (suppressAutocomplete) return;

    const trimmedValue = postcode.trim();

    if (trimmedValue.length < 3) return;

    const currentRequestId = requestCounterRef.current + 1;
    requestCounterRef.current = currentRequestId;

    const timeoutId = window.setTimeout(async () => {
      setIsLoadingSuggestions(true);
      setAutocompleteError("");

      try {
        const response = await fetch(`/api/location-autocomplete?input=${encodeURIComponent(trimmedValue)}`, {
          cache: "no-store",
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
        console.error("[home-page] autocomplete request failed", fetchError);

        if (requestCounterRef.current !== currentRequestId) {
          return;
        }

        setSuggestions([]);
        setShowSuggestions(false);
        setAutocompleteError("Location suggestions are unavailable right now.");
      } finally {
        if (requestCounterRef.current === currentRequestId) {
          setIsLoadingSuggestions(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [postcode, suppressAutocomplete]);

  const helperText = useMemo(() => {
    if (postcode.trim().length < 3) {
      return "Search by full postcode, postcode area, town, or city.";
    }

    if (isLoadingSuggestions) {
      return "Loading UK location suggestions...";
    }

    return autocompleteError || "Suggestions are limited to UK towns, cities, and postcode areas.";
  }, [autocompleteError, isLoadingSuggestions, postcode]);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (selectedLocation) {
      const params = new URLSearchParams({
        location: selectedLocation.description,
        lat: String(selectedLocation.lat),
        lng: String(selectedLocation.lng),
      });

      const debugPayload = {
        path: "selected-location",
        selectedLocation,
        searchUrl: `/search?${params.toString()}`,
      };

      console.log("[home-page] handleSearch selected-location submit", debugPayload);
      sessionStorage.setItem("pawfinder:lastHandleSearchSubmit", JSON.stringify(debugPayload));
      window.location.assign(`/search?${params.toString()}`);
      return;
    }

    const trimmedPostcode = postcode.trim();

    if (!trimmedPostcode) {
      setError("Please enter a postcode.");
      return;
    }

    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
    if (!postcodeRegex.test(trimmedPostcode)) {
      setError("Please enter a full, valid UK postcode (e.g. S10 1BD). Outcodes like 'S10' are not sufficient.");
      return;
    }

    const normalizedInput = trimmedPostcode.toUpperCase().replace(/\s+/g, "");
    const debugPayload = {
      path: "postcode",
      postcodeInput: trimmedPostcode,
      normalizedInput,
      searchUrl: `/search?postcode=${encodeURIComponent(normalizedInput)}`,
    };

    console.log("[home-page] handleSearch postcode submit", debugPayload);
    sessionStorage.setItem("pawfinder:lastHandleSearchSubmit", JSON.stringify(debugPayload));
    window.location.assign(`/search?postcode=${encodeURIComponent(normalizedInput)}`);
  };

  return (
    <div className="rounded-[2rem] border border-[#DCD3BE] bg-white p-4 shadow-[0_20px_50px_-30px_rgba(32,38,31,0.35)] sm:p-5">
      <form action="/search" method="GET" onSubmit={handleSearch} className="space-y-3">
        <div className="relative">
          <label htmlFor="homepage-location" className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">
            Search your area
          </label>
          <div className="flex items-center gap-3 rounded-[1.4rem] border border-[#DCD3BE] bg-[#FAF7F1] px-4 py-3.5">
            <MapPin className="h-5 w-5 flex-shrink-0 text-[#B14A2B]" />
            <input
              id="homepage-location"
              type="text"
              value={postcode}
              onChange={(e) => {
                const nextValue = e.target.value;
                setSuppressAutocomplete(false);
                setPostcode(nextValue);
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
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              pattern={selectedLocation ? undefined : postcodePattern}
              title={selectedLocation ? "Search for the selected UK location." : "Please enter a full UK postcode, for example S10 1BD."}
              className="w-full bg-transparent text-base text-[#20261F] outline-none placeholder:text-[#7D837B]"
            />
            <input type="hidden" name="postcode" value={normalizedPostcode} />
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
                        setError("");
                        setAutocompleteError("");
                        setShowSuggestions(false);
                        setSuppressAutocomplete(true);
                        setPostcode(suggestion.description);
                        setSuggestions([]);
                        setIsLoadingSuggestions(false);

                        try {
                          const response = await fetch(
                            `/api/location-details?placeId=${encodeURIComponent(suggestion.place_id)}`,
                            { cache: "no-store" }
                          );

                          if (!response.ok) {
                            throw new Error("Failed to load location details");
                          }

                          const details = await response.json();
                          setSelectedLocation({
                            description: suggestion.description,
                            place_id: suggestion.place_id,
                            lat: details.lat,
                            lng: details.lng,
                          });
                        } catch (detailsError) {
                          console.error("[home-page] location details request failed", detailsError);
                          setSelectedLocation(null);
                          setAutocompleteError("We couldn't prepare that location. Please try again.");
                        }
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
          type="submit"
          className="pressable-soft inline-flex w-full items-center justify-center rounded-[1.35rem] bg-[#B14A2B] px-5 py-3.5 text-base font-semibold text-white shadow-[0_18px_36px_-24px_rgba(177,74,43,0.9)] transition hover:bg-[#9E4126]"
        >
          Find care near me
        </button>
      </form>
      <div className="mt-3 text-sm text-[#4A5147]">{helperText}</div>
      {error && (
        <div className="mt-4 rounded-[1rem] border border-[#EAB3A4] bg-[#FFF3EF] px-4 py-3 text-sm font-medium text-[#9E4126]">
          {error}
        </div>
      )}
    </div>
  );
}
