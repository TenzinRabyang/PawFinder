'use client';

import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

export default function Home() {
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);
  const [suppressAutocomplete, setSuppressAutocomplete] = useState(false);
  const requestCounterRef = useRef(0);
  const postcodePattern = "[A-Za-z]{1,2}[0-9][A-Za-z0-9]?\\s?[0-9][A-Za-z]{2}";
  const normalizedPostcode = postcode.trim().toUpperCase().replace(/\s+/g, "");

  useEffect(() => {
    if (suppressAutocomplete) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setAutocompleteError("");
      return;
    }

    const trimmedValue = postcode.trim();

    if (trimmedValue.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setAutocompleteError("");
      return;
    }

    const currentRequestId = requestCounterRef.current + 1;
    requestCounterRef.current = currentRequestId;
    setIsLoadingSuggestions(true);
    setAutocompleteError("");

    const timeoutId = window.setTimeout(async () => {
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
        path: 'selected-location',
        selectedLocation,
        searchUrl: `/search?${params.toString()}`,
      };

      console.log("[home-page] handleSearch selected-location submit", debugPayload);
      sessionStorage.setItem('pawfinder:lastHandleSearchSubmit', JSON.stringify(debugPayload));

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
      path: 'postcode',
      postcodeInput: trimmedPostcode,
      normalizedInput,
      searchUrl: `/search?postcode=${encodeURIComponent(normalizedInput)}`,
    };
    console.log("[home-page] handleSearch postcode submit", debugPayload);
    sessionStorage.setItem('pawfinder:lastHandleSearchSubmit', JSON.stringify(debugPayload));
    window.location.assign(`/search?postcode=${encodeURIComponent(normalizedInput)}`);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-[#FAF9F6] pb-24 pt-14 sm:pt-18 lg:pb-32 lg:pt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="mb-6 text-4xl font-extrabold tracking-tight text-stone-800 font-sans sm:text-5xl md:text-6xl">
              Find the perfect care for your best friend.
            </h1>
            <p className="mb-8 text-base text-stone-600 sm:text-lg md:mb-10 md:text-xl">
              Trusted vets, groomers, walkers, and kennels near you—with verified temperament reviews from real pet owners.
            </p>

            {/* Search Box */}
            <div className="max-w-2xl mx-auto">
              <form action="/search" method="GET" onSubmit={handleSearch} className="relative flex flex-col gap-3 rounded-[2rem] border border-stone-200 bg-white p-3 shadow-lg sm:flex-row sm:items-center sm:gap-0 sm:p-2">
                <div className="relative flex flex-1 items-center px-2 sm:px-4">
                  <Search className="mr-3 h-5 w-5 flex-shrink-0 text-stone-400" />
                  <input 
                    type="text" 
                    value={postcode}
                    onChange={(e) => {
                      setSuppressAutocomplete(false);
                      setPostcode(e.target.value);
                      setError("");
                      setSelectedLocation(null);
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
                    placeholder="Enter a UK postcode, town or city" 
                    required
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                    pattern={selectedLocation ? undefined : postcodePattern}
                    title={selectedLocation ? "Search for the selected UK location." : "Please enter a full UK postcode, for example S10 1BD."}
                    className="w-full bg-transparent border-none text-base text-stone-800 outline-none focus:ring-0 sm:text-lg"
                  />
                  <input type="hidden" name="postcode" value={normalizedPostcode} />
                  {showSuggestions && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-3xl border border-stone-200 bg-white text-left shadow-xl">
                      <div className="border-b border-stone-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                        UK Location Suggestions
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
                              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-stone-50"
                            >
                              <Search className="mt-0.5 h-4 w-4 flex-shrink-0 text-stone-300" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-stone-800">
                                  {suggestion.main_text}
                                </span>
                                {suggestion.secondary_text && (
                                  <span className="block truncate text-xs text-stone-500">
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
                <button type="submit" className="w-full rounded-full bg-[#e07a5f] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#d06950] sm:w-auto sm:px-8">
                  Search
                </button>
              </form>
              {postcode.trim().length >= 3 && (
                <div className="mt-3 text-sm text-stone-500">
                  {isLoadingSuggestions
                    ? "Loading UK location suggestions..."
                    : autocompleteError || "Suggestions are limited to UK towns, cities, and postcode areas."}
                </div>
              )}
              {error && (
                <div className="mt-4 inline-block rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-500 sm:text-base">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Background decorative elements */}
        <div className="absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 w-96 h-96 bg-[#829e8d]/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/4 right-0 -translate-y-1/2 translate-x-1/3 w-[500px] h-[500px] bg-[#e07a5f]/10 rounded-full blur-3xl"></div>
      </section>

      {/* Animal Categories */}
      <section className="bg-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="mb-10 text-center text-2xl font-bold text-stone-800 sm:mb-12 sm:text-3xl">What kind of pet do you have?</h2>
          
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
            {['Dog', 'Cat', 'Rabbit', 'Small Pet'].map((animal) => (
              <Link href={`/search?animal=${animal.toLowerCase()}`} key={animal} className="group relative rounded-2xl overflow-hidden aspect-square bg-stone-100 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors z-10"></div>
                {/* Replace with actual photography later */}
                <div className="relative z-20 px-3 text-center text-lg font-bold tracking-wide text-white sm:text-2xl">
                  {animal}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      
      {/* Value Prop */}
      <section className="bg-[#829e8d] py-18 text-white sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="mb-6 text-3xl font-bold md:text-4xl">Not just another directory.</h2>
          <p className="mx-auto mb-10 max-w-2xl text-base text-[#e8eee9] sm:text-lg md:text-xl">
            PawFinder is built differently. Read pf_reviews specifically tailored to your pet's breed and temperament. Does your anxious rescue need a calm handler? We've got you covered.
          </p>
          <Link href="/search" className="inline-flex rounded-full bg-white px-6 py-3 font-bold text-[#829e8d] transition-colors hover:bg-stone-100 sm:px-8">
            Browse Providers
          </Link>
        </div>
      </section>
    </div>
  );
}
