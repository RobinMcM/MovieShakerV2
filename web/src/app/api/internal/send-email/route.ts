import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { VerificationEmail } from "@/emails/VerificationEmail";
import { NotificationEmail } from "@/emails/NotificationEmail";
import { RegistrationConfirmationEmail } from "@/emails/RegistrationConfirmationEmail";
import { PasswordResetConfirmationEmail } from "@/emails/PasswordResetConfirmationEmail";
import React from "react";

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Email sending not configured (RESEND_API_KEY)");
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

export async function POST(request: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email sending not configured (RESEND_API_KEY)" },
      { status: 503 }
    );
  }
  const key = request.headers.get("x-internal-api-key");
  if (!INTERNAL_API_KEY || key !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const type = body && typeof body === "object" && "type" in body && body.type;
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (type === "verification" && payload) {
    return handleVerification(payload);
  }
  if (type === "notification" && payload) {
    return handleNotification(payload);
  }
  if (type === "registration_confirmation" && payload) {
    return handleRegistrationConfirmation(payload);
  }
  if (type === "password_reset_confirmation" && payload) {
    return handlePasswordResetConfirmation(payload);
  }

  return NextResponse.json(
    {
      error:
        "Missing or invalid type (verification | notification | registration_confirmation | password_reset_confirmation)",
    },
    { status: 400 }
  );
}

async function handleVerification(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email : null;
  const verifyUrl =
    typeof body.verifyUrl === "string" ? body.verifyUrl : null;

  if (!email || !verifyUrl) {
    return NextResponse.json(
      { error: "Verification requires email and verifyUrl" },
      { status: 400 }
    );
  }

  const resend = getResendClient();
  const from =
    process.env.RESEND_FROM ?? "MovieShaker <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [email],
    subject: "Verify your email – MovieShaker",
    react: React.createElement(VerificationEmail, {
      verifyUrl,
      email,
    }),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}

async function handleNotification(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email : null;
  const title = typeof body.title === "string" ? body.title : null;
  const bodyText = typeof body.body === "string" ? body.body : null;

  if (!email || !title || bodyText === null) {
    return NextResponse.json(
      { error: "Notification requires email, title, and body" },
      { status: 400 }
    );
  }

  const ctaUrl =
    typeof body.ctaUrl === "string" && body.ctaUrl ? body.ctaUrl : undefined;
  const ctaLabel =
    typeof body.ctaLabel === "string" && body.ctaLabel ? body.ctaLabel : undefined;

  const resend = getResendClient();
  const from =
    process.env.RESEND_FROM ?? "MovieShaker <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [email],
    subject: title,
    react: React.createElement(NotificationEmail, {
      title,
      body: bodyText,
      ctaUrl,
      ctaLabel,
    }),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}

async function handleRegistrationConfirmation(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email : null;
  if (!email) {
    return NextResponse.json(
      { error: "Registration confirmation requires email" },
      { status: 400 }
    );
  }

  const resend = getResendClient();
  const from =
    process.env.RESEND_FROM ?? "MovieShaker <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [email],
    subject: "Welcome to MovieShaker",
    react: React.createElement(RegistrationConfirmationEmail, { email }),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}

async function handlePasswordResetConfirmation(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email : null;
  if (!email) {
    return NextResponse.json(
      { error: "Password reset confirmation requires email" },
      { status: 400 }
    );
  }

  const resend = getResendClient();
  const from =
    process.env.RESEND_FROM ?? "MovieShaker <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [email],
    subject: "Password reset confirmed",
    react: React.createElement(PasswordResetConfirmationEmail, { email }),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}
