import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SupertokensProvider } from "@/components/providers/SupertokensProvider";

// Prevent Next.js from serving cached prerendered HTML (avoids "old site" after deploy)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MovieShaker - The Mean Indie Machine",
  description: "Professional film production",
  themeColor: "#1a1a1a",
  viewport: "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MovieShaker",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider defaultTheme="dark" storageKey="movieshaker-ui-theme">
          <SupertokensProvider>{children}</SupertokensProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
