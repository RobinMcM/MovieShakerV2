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

export interface PasswordResetConfirmationEmailProps {
  email?: string;
}

export function PasswordResetConfirmationEmail({
  email,
}: PasswordResetConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Password reset confirmed</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Password reset confirmed</Heading>
          <Text style={text}>
            {email
              ? `The password for ${email} was successfully reset.`
              : "Your MovieShaker password was successfully reset."}
          </Text>
          <Text style={text}>
            If this was not you, please contact support immediately.
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

export default PasswordResetConfirmationEmail;
