import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SupertokensProvider } from "@/components/providers/SupertokensProvider";

// Prevent Next.js from serving cached prerendered HTML (avoids "old site" after deploy)
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1a1a1a",
};

export const metadata: Metadata = {
  title: "MovieShaker - The Mean Indie Machine",
  description: "Professional film production",
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
