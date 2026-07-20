import { NextResponse } from "next/server";

import {
  getProviderForPlaceIdRecovery,
  resolvePlaceDetailsWithAutoHeal,
} from "@/lib/provider-place-id-recovery";
import {
  buildGrayTrustSnapshot,
  buildUnavailableTrustSnapshot,
  CURRENT_AI_VERSION,
  evaluateTrustReviews,
  sanitizeTrustReviewInputs,
  type TrustEvalOutput,
} from "@/lib/trust-eval";
import { createAdminClient } from "@/utils/supabase/admin";

type ProviderTrustRecord = {
  id: string;
  google_place_id: string | null;
  name: string | null;
  trust_badge?: string | null;
  audit_reason?: string | null;
  safety_flags?: unknown;
  highlights?: unknown;
  overall_summary?: string | null;
  ai_version?: number | null;
};

type NativeReviewRecord = {
  created_at: string;
  comment?: string | null;
  pf_profiles?: { full_name: string | null } | null;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function buildRouteFallbackSnapshot(reason?: string): TrustEvalOutput {
  return buildUnavailableTrustSnapshot({
    auditReason:
      reason || "Quality assessment temporarily unavailable.",
    overallSummary:
      "PawFinder could not finish the AI provider quality assessment right now, so the trust summary is temporarily unavailable.",
  });
}

function buildSnapshotResponse(snapshot: TrustEvalOutput, options?: { aiVersion?: number | null; refreshed?: boolean }) {
  return NextResponse.json({
    ...snapshot,
    ai_version: options?.aiVersion ?? null,
    refreshed: options?.refreshed ?? false,
  });
}

function getCachedTrustPayload(provider: ProviderTrustRecord): TrustEvalOutput | null {
  if (
    provider.ai_version &&
    provider.ai_version >= CURRENT_AI_VERSION &&
    typeof provider.trust_badge === "string" &&
    provider.trust_badge !== "UNAVAILABLE" &&
    typeof provider.audit_reason === "string" &&
    typeof provider.overall_summary === "string"
  ) {
    return {
      trust_badge: provider.trust_badge as TrustEvalOutput["trust_badge"],
      audit_reason: provider.audit_reason,
      safety_flags: normalizeStringArray(provider.safety_flags),
      highlights: normalizeStringArray(provider.highlights),
      overall_summary: provider.overall_summary,
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
  const trimmedText = review.text?.trim();
  if (!trimmedText) return null;

  const parts = [
    review.relative_time_description ? `[${review.relative_time_description}]` : null,
    typeof review.rating === "number" ? `${review.rating}-star review` : "Unrated review",
    `by ${review.author_name?.trim() || "Google reviewer"}`,
    trimmedText,
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
  if (!placeId) {
    return {
      reviewTexts: [],
      userRatingsTotal: null,
    };
  }

  try {
    const supabaseAdmin = createAdminClient();
    const resolvedDetails = await resolvePlaceDetailsWithAutoHeal({
      requestedPlaceId: placeId,
      fields: "place_id,name,reviews,user_ratings_total",
      googleApiKey,
      provider: await getProviderForPlaceIdRecovery(supabaseAdmin, placeId).then(({ data }) => data),
      supabase: supabaseAdmin,
      source: "provider-trust-snapshot",
    });

    if (resolvedDetails.status !== "OK") {
      console.warn("[trust-snapshot:google-fetch] Google review fetch did not return OK.", {
        provider_id: provider.id,
        place_id: placeId,
        status: resolvedDetails.status,
        error_message: "errorMessage" in resolvedDetails ? resolvedDetails.errorMessage ?? null : null,
      });
      return {
        reviewTexts: [],
        userRatingsTotal: null,
      };
    }

    const rawReviews = Array.isArray(resolvedDetails.result?.reviews)
      ? (resolvedDetails.result?.reviews as Array<Record<string, unknown>>)
      : [];
    const userRatingsTotal =
      typeof resolvedDetails.result?.user_ratings_total === "number"
        ? resolvedDetails.result.user_ratings_total
        : null;

    const mappedReviews = rawReviews
      .map((review, index) => {
        try {
          return formatGoogleReview({
            author_name: typeof review.author_name === "string" ? review.author_name : undefined,
            rating: typeof review.rating === "number" ? review.rating : null,
            text: typeof review.text === "string" ? review.text : undefined,
            relative_time_description:
              typeof review.relative_time_description === "string" ? review.relative_time_description : undefined,
          });
        } catch (error) {
          console.error("[trust-snapshot:google-map] Failed to map a Google review.", {
            provider_id: provider.id,
            place_id: placeId,
            review_index: index,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
      .filter((review): review is string => Boolean(review));

    const sanitizedReviews = sanitizeTrustReviewInputs(mappedReviews);
    console.info("[trust-snapshot:google-map] Sanitized Google reviews for trust evaluation.", {
      provider_id: provider.id,
      place_id: placeId,
      user_ratings_total: userRatingsTotal,
      raw_count: rawReviews.length,
      mapped_count: mappedReviews.length,
      sanitized_count: sanitizedReviews.length,
    });

    return {
      reviewTexts: sanitizedReviews,
      userRatingsTotal,
    };
  } catch (error) {
    console.error("[trust-snapshot:google-fetch] Failed to fetch or sanitize Google reviews.", {
      provider_id: provider.id,
      place_id: placeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      reviewTexts: [],
      userRatingsTotal: null,
    };
  }
}

async function fetchNativeReviewTexts(providerId: string) {
  try {
    const supabaseAdmin = createAdminClient();
    const { data, error } = await supabaseAdmin
      .from("pf_reviews")
      .select("created_at, comment, user_id")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[trust-snapshot:native-fetch] Failed to fetch native reviews.", {
        provider_id: providerId,
        error: error.message,
      });
      return [];
    }

    const reviewRows = ((data || []) as Array<{ created_at: string; comment?: string | null; user_id?: string | null }>);
    const reviewerIds = [...new Set(reviewRows.map((review) => review.user_id).filter(Boolean))] as string[];
    let reviewerMap = new Map<string, { full_name: string | null }>();

    if (reviewerIds.length > 0) {
      const { data: reviewerRows, error: reviewerError } = await supabaseAdmin
        .from("pf_profiles")
        .select("id, full_name")
        .in("id", reviewerIds);

      if (reviewerError) {
        console.error("[trust-snapshot:native-fetch] Failed to fetch native review authors.", {
          provider_id: providerId,
          error: reviewerError.message,
        });
      } else {
        reviewerMap = new Map(
          ((reviewerRows || []) as Array<{ id: string; full_name: string | null }>).map((row) => [
            row.id,
            { full_name: row.full_name },
          ])
        );
      }
    }

    const mappedReviews = reviewRows
      .map((review, index) => {
        try {
          return formatNativeReview({
            created_at: review.created_at,
            comment: review.comment,
            pf_profiles: review.user_id ? reviewerMap.get(review.user_id) || null : null,
          });
        } catch (error) {
          console.error("[trust-snapshot:native-map] Failed to map a native review.", {
            provider_id: providerId,
            review_index: index,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
      .filter((review): review is string => Boolean(review));

    const sanitizedReviews = sanitizeTrustReviewInputs(mappedReviews);
    console.info("[trust-snapshot:native-map] Sanitized native reviews for trust evaluation.", {
      provider_id: providerId,
      raw_count: reviewRows.length,
      mapped_count: mappedReviews.length,
      sanitized_count: sanitizedReviews.length,
    });

    return sanitizedReviews;
  } catch (error) {
    console.error("[trust-snapshot:native-fetch] Failed to fetch or sanitize native reviews.", {
      provider_id: providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const fallbackPlaceId = searchParams.get("place_id")?.trim() || null;
    const placeIdFromRequest = !isUuidLike(id) ? id : null;
    const resolvedPlaceId = fallbackPlaceId || placeIdFromRequest;

    const supabaseAdmin = createAdminClient();
    let provider: ProviderTrustRecord | null = null;

    try {
      if (isUuidLike(id)) {
        const { data, error } = await supabaseAdmin
          .from("pf_providers")
          .select("id, google_place_id, name, trust_badge, audit_reason, safety_flags, highlights, overall_summary, ai_version")
          .eq("id", id)
          .maybeSingle();

        if (error) {
          console.error("[trust-snapshot:provider-fetch] Failed to fetch provider by UUID.", {
            provider_id: id,
            error: error.message,
          });
        }

        provider = (data as ProviderTrustRecord | null) || null;
      }

      if (!provider) {
        const placeIdToLookup = fallbackPlaceId || id;
        const { data, error } = await supabaseAdmin
          .from("pf_providers")
          .select("id, google_place_id, name, trust_badge, audit_reason, safety_flags, highlights, overall_summary, ai_version")
          .eq("google_place_id", placeIdToLookup)
          .maybeSingle();

        if (error) {
          console.error("[trust-snapshot:provider-fetch] Failed to fetch provider by place ID.", {
            place_id: placeIdToLookup,
            error: error.message,
          });
        }

        provider = (data as ProviderTrustRecord | null) || null;
      }
    } catch (error) {
      console.error("[trust-snapshot:provider-fetch] Unexpected provider lookup failure.", {
        provider_id: id,
        fallback_place_id: fallbackPlaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return buildSnapshotResponse(buildRouteFallbackSnapshot(), { refreshed: false });
    }

    console.log("[Trust Engine] Provider DB Row fetched:", provider ? {
      id: provider.id,
      google_place_id: provider.google_place_id,
      trust_badge: provider.trust_badge,
      ai_version: provider.ai_version,
    } : null);

    const cached = provider ? getCachedTrustPayload(provider) : null;
    console.log("[Trust Engine] AI Version check result:", {
      ai_version: provider?.ai_version ?? null,
      has_cached_snapshot: Boolean(cached),
      trust_badge: provider?.trust_badge ?? null,
    });

    if (cached && provider) {
      return buildSnapshotResponse(cached, {
        aiVersion: provider.ai_version ?? CURRENT_AI_VERSION,
        refreshed: false,
      });
    }

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    const googleReviewContext =
      googleApiKey && (provider?.google_place_id || resolvedPlaceId)
        ? await fetchGoogleReviewTexts(
            {
              id: provider?.id || "ephemeral",
              google_place_id: provider?.google_place_id || resolvedPlaceId || null,
              name: provider?.name || null,
            },
            googleApiKey
          )
        : {
            reviewTexts: [],
            userRatingsTotal: null,
          };
    const googleReviewTexts = googleReviewContext.reviewTexts;
    const nativeReviewTexts = provider ? await fetchNativeReviewTexts(provider.id) : [];
    const reviewTexts = sanitizeTrustReviewInputs([...googleReviewTexts, ...nativeReviewTexts]);
    const userRatingsTotal =
      typeof googleReviewContext.userRatingsTotal === "number"
        ? googleReviewContext.userRatingsTotal
        : reviewTexts.length;

    console.info("[trust-snapshot:reviews] Prepared review inputs for trust evaluation.", {
      provider_id: provider?.id ?? null,
      resolved_place_id: resolvedPlaceId,
      user_ratings_total: userRatingsTotal,
      google_count: googleReviewTexts.length,
      native_count: nativeReviewTexts.length,
      combined_count: reviewTexts.length,
    });

    if (!provider && !resolvedPlaceId) {
      console.warn("[trust-snapshot:provider-missing] No provider row or place ID was available for trust evaluation.", {
        request_id: id,
      });
      return buildSnapshotResponse(
        buildRouteFallbackSnapshot("PawFinder could not resolve enough provider data to run the quality assessment."),
        { refreshed: false }
      );
    }

    if (reviewTexts.length === 0) {
      const emptySnapshot = buildGrayTrustSnapshot({
        auditReason: "There are not enough saved reviews yet for PawFinder to make a reliable quality assessment.",
        overallSummary:
          "There are fewer than 5 usable written reviews available, so PawFinder cannot draw a reliable overall conclusion yet.",
      });

      if (provider) {
        try {
          const { error: updateError } = await supabaseAdmin
            .from("pf_providers")
            .update({
              trust_badge: emptySnapshot.trust_badge,
              audit_reason: emptySnapshot.audit_reason,
              safety_flags: emptySnapshot.safety_flags,
              highlights: emptySnapshot.highlights,
              overall_summary: emptySnapshot.overall_summary,
              ai_version: CURRENT_AI_VERSION,
            })
            .eq("id", provider.id);

          if (updateError) {
            console.error("[trust-snapshot:db-upsert] Failed to persist empty trust snapshot.", {
              provider_id: provider.id,
              error: updateError.message,
            });
          }
        } catch (error) {
          console.error("[trust-snapshot:db-upsert] Unexpected failure while persisting empty trust snapshot.", {
            provider_id: provider.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      console.log("[Trust Engine] API Refresh status code and payload:", 200, {
        refreshed: false,
        reason: "no_review_text_available",
        trust_badge: emptySnapshot.trust_badge,
      });

      return buildSnapshotResponse(emptySnapshot, {
        aiVersion: provider ? CURRENT_AI_VERSION : null,
        refreshed: Boolean(provider),
      });
    }

    let evaluated: TrustEvalOutput;
    try {
      evaluated = await evaluateTrustReviews({
        reviews: reviewTexts,
        userRatingsTotal,
      });
    } catch (error) {
      console.error("[trust-snapshot:ai-eval] Unexpected failure bubbled out of trust evaluation.", {
        provider_id: provider?.id ?? null,
        resolved_place_id: resolvedPlaceId,
        review_count: reviewTexts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      evaluated = buildRouteFallbackSnapshot();
    }

    if (provider && evaluated.trust_badge !== "UNAVAILABLE") {
      try {
        const { error: updateError } = await supabaseAdmin
          .from("pf_providers")
          .update({
            trust_badge: evaluated.trust_badge,
            audit_reason: evaluated.audit_reason,
            safety_flags: evaluated.safety_flags,
            highlights: evaluated.highlights,
            overall_summary: evaluated.overall_summary,
            ai_version: CURRENT_AI_VERSION,
          })
          .eq("id", provider.id);

        if (updateError) {
          console.error("[trust-snapshot:db-upsert] Failed to persist evaluated trust snapshot.", {
            provider_id: provider.id,
            error: updateError.message,
            trust_badge: evaluated.trust_badge,
          });
        }
      } catch (error) {
        console.error("[trust-snapshot:db-upsert] Unexpected failure while persisting evaluated trust snapshot.", {
          provider_id: provider.id,
          error: error instanceof Error ? error.message : String(error),
          trust_badge: evaluated.trust_badge,
        });
      }
    }

    console.log("[Trust Engine] API Refresh status code and payload:", 200, {
      refreshed: Boolean(provider),
      trust_badge: evaluated.trust_badge,
      ai_version: provider ? CURRENT_AI_VERSION : null,
      review_count: reviewTexts.length,
    });

    return buildSnapshotResponse(evaluated, {
      aiVersion: provider ? CURRENT_AI_VERSION : null,
      refreshed: Boolean(provider),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error.";

    console.log("[Trust Engine] API Refresh status code and payload:", 200, {
      error: message,
    });

    return buildSnapshotResponse(buildRouteFallbackSnapshot(), { refreshed: false });
  }
}
