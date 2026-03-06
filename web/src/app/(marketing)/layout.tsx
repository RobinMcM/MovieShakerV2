import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function MarketingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1">{children}</main>
            <Footer />
        </div>
    );
}
