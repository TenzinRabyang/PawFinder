import { NextResponse } from "next/server";

import {
  getProviderForPlaceIdRecovery,
  resolvePlaceDetailsWithAutoHeal,
} from "@/lib/provider-place-id-recovery";
import { evaluateTrustReviews, type TrustEvalOutput } from "@/lib/trust-eval";
import { createAdminClient } from "@/utils/supabase/admin";

type ProviderTrustRecord = {
  id: string;
  google_place_id: string | null;
  name: string | null;
  trust_badge?: string | null;
  audit_reason?: string | null;
  safety_flags?: unknown;
  highlights?: unknown;
  ai_version?: number | null;
};

type NativeReviewRecord = {
  created_at: string;
  comment?: string | null;
  pf_profiles?: { full_name: string | null } | null;
};

const TRUST_AI_VERSION = 2;

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getCachedTrustPayload(provider: ProviderTrustRecord): TrustEvalOutput | null {
  if (
    provider.ai_version &&
    provider.ai_version >= TRUST_AI_VERSION &&
    typeof provider.trust_badge === "string" &&
    typeof provider.audit_reason === "string"
  ) {
    return {
      trust_badge: provider.trust_badge as TrustEvalOutput["trust_badge"],
      audit_reason: provider.audit_reason,
      safety_flags: normalizeStringArray(provider.safety_flags),
      highlights: normalizeStringArray(provider.highlights),
    };
  }

  return null;
}

function formatGoogleReview(review: {
  author_name?: string;
  rating?: number | null;
  text?: string;
  relative_time_description?: string;
}) {
  const parts = [
    review.relative_time_description ? `[${review.relative_time_description}]` : null,
    typeof review.rating === "number" ? `${review.rating}-star review` : "Review",
    review.author_name ? `by ${review.author_name}` : null,
    review.text?.trim() || null,
  ].filter(Boolean);

  return parts.join(" ");
}

function formatNativeReview(review: NativeReviewRecord) {
  if (!review.comment?.trim()) return null;
  const authorName = review.pf_profiles?.full_name || "PawFinder reviewer";
  return `[${review.created_at.slice(0, 10)}] Review by ${authorName}: ${review.comment.trim()}`;
}

async function fetchGoogleReviewTexts(provider: ProviderTrustRecord, googleApiKey: string) {
  const placeId = provider.google_place_id?.trim();
  if (!placeId) return [];

  const supabaseAdmin = createAdminClient();
  const resolvedDetails = await resolvePlaceDetailsWithAutoHeal({
    requestedPlaceId: placeId,
    fields: "place_id,name,reviews",
    googleApiKey,
    provider: await getProviderForPlaceIdRecovery(supabaseAdmin, placeId).then(({ data }) => data),
    supabase: supabaseAdmin,
    source: "provider-trust-snapshot",
  });

  if (resolvedDetails.status !== "OK") {
    return [];
  }

  const rawReviews = Array.isArray(resolvedDetails.result?.reviews)
    ? (resolvedDetails.result?.reviews as Array<Record<string, unknown>>)
    : [];

  return rawReviews
    .map((review) =>
      formatGoogleReview({
        author_name: typeof review.author_name === "string" ? review.author_name : undefined,
        rating: typeof review.rating === "number" ? review.rating : null,
        text: typeof review.text === "string" ? review.text : undefined,
        relative_time_description:
          typeof review.relative_time_description === "string" ? review.relative_time_description : undefined,
      })
    )
    .filter(Boolean) as string[];
}

async function fetchNativeReviewTexts(providerId: string) {
  const supabaseAdmin = createAdminClient();
  const { data } = await supabaseAdmin
    .from("pf_reviews")
    .select("created_at, comment, user_id")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false });

  const reviewRows = ((data || []) as Array<{ created_at: string; comment?: string | null; user_id?: string | null }>);
  const reviewerIds = [...new Set(reviewRows.map((review) => review.user_id).filter(Boolean))] as string[];
  let reviewerMap = new Map<string, { full_name: string | null }>();

  if (reviewerIds.length > 0) {
    const { data: reviewerRows } = await supabaseAdmin
      .from("pf_profiles")
      .select("id, full_name")
      .in("id", reviewerIds);

    reviewerMap = new Map(
      ((reviewerRows || []) as Array<{ id: string; full_name: string | null }>).map((row) => [
        row.id,
        { full_name: row.full_name },
      ])
    );
  }

  return reviewRows
    .map((review) =>
      formatNativeReview({
        created_at: review.created_at,
        comment: review.comment,
        pf_profiles: review.user_id ? reviewerMap.get(review.user_id) || null : null,
      })
    )
    .filter(Boolean) as string[];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const fallbackPlaceId = searchParams.get("place_id")?.trim() || null;

    const supabaseAdmin = createAdminClient();
    let provider: ProviderTrustRecord | null = null;

    if (isUuidLike(id)) {
      const { data } = await supabaseAdmin
        .from("pf_providers")
        .select("id, google_place_id, name, trust_badge, audit_reason, safety_flags, highlights, ai_version")
        .eq("id", id)
        .maybeSingle();

      provider = (data as ProviderTrustRecord | null) || null;
    }

    if (!provider) {
      const placeIdToLookup = fallbackPlaceId || id;
      const { data } = await supabaseAdmin
        .from("pf_providers")
        .select("id, google_place_id, name, trust_badge, audit_reason, safety_flags, highlights, ai_version")
        .eq("google_place_id", placeIdToLookup)
        .maybeSingle();

      provider = (data as ProviderTrustRecord | null) || null;
    }

    if (!provider) {
      return NextResponse.json({ error: "Provider not found." }, { status: 404 });
    }

    const cached = getCachedTrustPayload(provider);
    if (cached) {
      return NextResponse.json({
        ...cached,
        ai_version: provider.ai_version ?? TRUST_AI_VERSION,
        refreshed: false,
      });
    }

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    const googleReviewTexts = googleApiKey ? await fetchGoogleReviewTexts(provider, googleApiKey) : [];
    const nativeReviewTexts = await fetchNativeReviewTexts(provider.id);
    const reviewTexts = [...googleReviewTexts, ...nativeReviewTexts];

    const evaluated = await evaluateTrustReviews({ reviews: reviewTexts });

    const { error: updateError } = await supabaseAdmin
      .from("pf_providers")
      .update({
        trust_badge: evaluated.trust_badge,
        audit_reason: evaluated.audit_reason,
        safety_flags: evaluated.safety_flags,
        highlights: evaluated.highlights,
        ai_version: TRUST_AI_VERSION,
      })
      .eq("id", provider.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to persist trust snapshot." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...evaluated,
      ai_version: TRUST_AI_VERSION,
      refreshed: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
