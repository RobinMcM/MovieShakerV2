import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import * as React from "react";

export interface RegistrationConfirmationEmailProps {
  email?: string;
  heading?: string;
  bodyText?: string;
}

export function RegistrationConfirmationEmail({
  email,
  heading,
  bodyText,
}: RegistrationConfirmationEmailProps) {
  const resolvedHeading = heading || "Registration confirmed";
  const resolvedBody =
    bodyText ||
    (email
      ? `Your account (${email}) has been created successfully.`
      : "Your MovieShaker account has been created successfully.");
  return (
    <Html>
      <Head />
      <Preview>{resolvedHeading}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{resolvedHeading}</Heading>
          <Text style={text}>{resolvedBody}</Text>
          <Text style={text}>
            You can now sign in and start building your projects.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>MovieShaker</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 20px",
  marginBottom: "64px",
  borderRadius: "8px",
  maxWidth: "480px",
};

const h1 = {
  color: "#333",
  fontSize: "24px",
  fontWeight: "600" as const,
  lineHeight: "1.3",
  margin: "0 0 20px",
};

const text = {
  color: "#555",
  fontSize: "16px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "24px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0",
};

export default RegistrationConfirmationEmail;
