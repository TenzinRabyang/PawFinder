'use client';

import LocationSearchControl, {
  type LocationSearchContext,
} from "@/components/location/LocationSearchControl";

type HomeSearchCardProps = {
  inputId?: string;
};

export default function HomeSearchCard({
  inputId = "homepage-search-input",
}: HomeSearchCardProps) {
  const handleResolvedLocation = async (context: LocationSearchContext) => {
    if (context.kind === "place") {
      const params = new URLSearchParams({
        location: context.label,
        lat: String(context.lat),
        lng: String(context.lng),
      });

      const debugPayload = {
        path: "selected-location",
        selectedLocation: context,
        searchUrl: `/search?${params.toString()}`,
      };

      console.log("[home-page] handleSearch selected-location submit", debugPayload);
      sessionStorage.setItem("pawfinder:lastHandleSearchSubmit", JSON.stringify(debugPayload));
      window.location.assign(`/search?${params.toString()}`);
      return;
    }

    const debugPayload = {
      path: "postcode",
      postcodeInput: context.label,
      normalizedInput: context.postcode,
      searchUrl: `/search?postcode=${encodeURIComponent(context.postcode)}`,
    };

    console.log("[home-page] handleSearch postcode submit", debugPayload);
    sessionStorage.setItem("pawfinder:lastHandleSearchSubmit", JSON.stringify(debugPayload));
    window.location.assign(`/search?postcode=${encodeURIComponent(context.postcode)}`);
  };

  return (
    <div className="rounded-[2rem] border border-[#DCD3BE] bg-white p-4 shadow-[0_20px_50px_-30px_rgba(32,38,31,0.35)] sm:p-5">
      <LocationSearchControl
        id={inputId}
        label="Search your area"
        submitLabel="Find care near me"
        onResolved={handleResolvedLocation}
      />
    </div>
  );
}
