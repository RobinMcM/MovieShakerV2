"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";

/** Legacy /users route: redirect to admin User Management. Non-admins get 403 from API and are redirected. */
export default function Users() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/admin/users");
    }, [router]);

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
                <p className="text-muted-foreground">Redirecting to User Management...</p>
            </main>
            <Footer />
        </div>
    );
}
