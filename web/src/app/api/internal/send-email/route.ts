import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { VerificationEmail } from "@/emails/VerificationEmail";
import { NotificationEmail } from "@/emails/NotificationEmail";
import React from "react";

const resend = new Resend(process.env.RESEND_API_KEY);

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

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
  if (type === "verification") {
    return handleVerification(body);
  }
  if (type === "notification") {
    return handleNotification(body);
  }

  return NextResponse.json(
    { error: "Missing or invalid type (verification | notification)" },
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
