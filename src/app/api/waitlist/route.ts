import { NextResponse } from "next/server";

import { createAdminClient } from "@/utils/supabase/admin";

type WaitlistPayload = {
  email?: unknown;
  user_type?: unknown;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const DUPLICATE_MESSAGE = "You're already signed up for updates. We'll be in touch soon.";
const SUCCESS_MESSAGE = "Awesome! You're signed up for launch alerts.";

function isValidUserType(value: unknown): value is "pet_owner" | "pet_business" {
  return value === "pet_owner" || value === "pet_business";
}

function isDuplicateWaitlistError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("duplicate key"))
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as WaitlistPayload | null;

    if (!body) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const userType = body.user_type;

    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    if (!isValidUserType(userType)) {
      return NextResponse.json({ error: "Please select a valid role." }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin.from("waitlist").insert({
      email,
      user_type: userType,
    });

    if (error) {
      if (isDuplicateWaitlistError(error)) {
        return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      }

      console.error("[waitlist] Failed to insert waitlist entry");
      return NextResponse.json(
        { error: "We couldn't save your details just now. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: SUCCESS_MESSAGE });
  } catch {
    console.error("[waitlist] Unexpected waitlist error");
    return NextResponse.json(
      { error: "We couldn't save your details just now. Please try again." },
      { status: 500 }
    );
  }
}
