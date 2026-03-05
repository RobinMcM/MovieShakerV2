"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail } from "lucide-react";
import { api } from "@/lib/api";

function AdminEmailPage() {
    const router = useRouter();
    const [allowed, setAllowed] = useState<boolean | null>(null);

    useEffect(() => {
        api.get<{ role?: string }>("/profile/")
            .then((p) => setAllowed(p.role === "admin"))
            .catch(() => setAllowed(false));
    }, []);

    useEffect(() => {
        if (allowed === false) router.replace("/");
    }, [allowed, router]);

    if (allowed !== true) return null;

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
                <h1 className="text-3xl font-bold mb-6 text-primary flex items-center gap-2">
                    <Mail className="h-8 w-8" />
                    Email Management
                </h1>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Email configuration</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-muted-foreground">
                        <p>
                            Email is sent via Resend. Configure <code className="bg-muted px-1 rounded">RESEND_API_KEY</code> in the
                            environment for the web app.
                        </p>
                        <p>
                            Verification and notification emails use the internal send-email API;
                            ensure <code className="bg-muted px-1 rounded">INTERNAL_API_KEY</code> and{" "}
                            <code className="bg-muted px-1 rounded">WEB_INTERNAL_URL</code> are set on the engine.
                        </p>
                        <p className="text-sm">
                            For deliverability, verify your domain in the Resend dashboard.
                        </p>
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </div>
    );
}

export default function AdminEmail() {
    return (
        <SessionAuth>
            <AdminEmailPage />
        </SessionAuth>
    );
}
