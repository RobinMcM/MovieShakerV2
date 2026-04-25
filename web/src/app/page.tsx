"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionContext } from "supertokens-auth-react/recipe/session";
import { useAuthReady } from "@/contexts/AuthReadyContext";
import { Loader2 } from "lucide-react";

function RootRedirect() {
    const session = useSessionContext();
    const router = useRouter();

    useEffect(() => {
        if (session.loading) return;
        if ("doesSessionExist" in session && session.doesSessionExist) {
            router.replace("/projects");
        } else {
            router.replace("/auth");
        }
    }, [session, router]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    );
}

export default function Home() {
    const authReady = useAuthReady();

    if (!authReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return <RootRedirect />;
}
