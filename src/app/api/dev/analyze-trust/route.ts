import { NextResponse } from "next/server";
import { z } from "zod";
import {
  calculateBaselineTrustBadge,
  evaluateTrustReviews,
} from "@/lib/trust-eval";

const REQUEST_SCHEMA = z.object({
  reviews: z.array(z.string().min(1)).min(1),
  rating: z.number().finite().min(0).max(5).optional(),
  userRatingsTotal: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => null);
    const payload = REQUEST_SCHEMA.safeParse(body);

    if (!payload.success) {
      return NextResponse.json({ error: "Invalid reviews payload." }, { status: 400 });
    }

    const rating = payload.data.rating ?? 4.2;
    const userRatingsTotal = payload.data.userRatingsTotal ?? payload.data.reviews.length;
    const baselineBadge = calculateBaselineTrustBadge({
      rating,
      userRatingsTotal,
    });

    if (!baselineBadge || baselineBadge === "GRAY") {
      return NextResponse.json(
        {
          error: "This dev endpoint requires enough aggregate review data to produce a non-GRAY baseline.",
        },
        { status: 400 }
      );
    }

    const validated = await evaluateTrustReviews({
      reviews: payload.data.reviews,
      rating,
      userRatingsTotal,
      baselineBadge,
      evaluationDate: "2026-07-19",
    });

    return NextResponse.json({
      ...validated,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
