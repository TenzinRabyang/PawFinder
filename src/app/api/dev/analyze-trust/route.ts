import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateTrustReviews } from "@/lib/trust-eval";

const REQUEST_SCHEMA = z.object({
  reviews: z.array(z.string().min(1)).min(1),
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

    const validated = await evaluateTrustReviews({
      reviews: payload.data.reviews,
      userRatingsTotal: payload.data.reviews.length,
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
