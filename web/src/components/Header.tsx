"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, User, LogOut, Users, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionContext, signOut } from "supertokens-auth-react/recipe/session";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuthReady } from "@/contexts/AuthReadyContext";
import { api } from "@/lib/api";

/** Guest header when auth is not ready (no SuperTokens wrapper). No session hooks. */
export function HeaderGuest() {
    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>
                <div className="flex items-center gap-4">
                    <ModeToggle />
                    <Link href="/auth">
                        <Button variant="outline">Sign In</Button>
                    </Link>
                </div>
            </div>
        </header>
    );
}

/** Picks Header (with session) when auth is ready, HeaderGuest otherwise. Use this in pages. */
export function AppHeader() {
    const authReady = useAuthReady();
    if (!authReady) return <HeaderGuest />;
    return <Header />;
}

interface ProfileRole {
    role?: string;
    ai_credits?: number;
}

export function Header() {
    const session = useSessionContext();
    const router = useRouter();
    const [profile, setProfile] = useState<ProfileRole | null>(null);

    const hasSession =
        !session.loading &&
        "doesSessionExist" in session &&
        (session as { doesSessionExist: boolean }).doesSessionExist;

    useEffect(() => {
        if (hasSession) {
            api.get<ProfileRole>("/profile/").then(setProfile).catch(() => setProfile(null));
        } else {
            setProfile(null);
        }
    }, [hasSession]);

    async function onLogout() {
        await signOut();
        router.push("/");
    }

    const isAdmin = profile?.role === "admin";

    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>
                <div className="flex items-center gap-4">
                    <ModeToggle />
                    {hasSession ? (
                        <>
                            <Link href="/projects">
                                <Button variant="ghost">Projects</Button>
                            </Link>
                            <span className="text-xs font-semibold px-2 py-1 rounded bg-muted text-muted-foreground">
                                Credits: {typeof profile?.ai_credits === "number" ? profile.ai_credits : 0}
                            </span>
                            {isAdmin && (
                                <>
                                    <Link href="/admin/users">
                                        <Button variant="ghost" size="sm" title="User Management">
                                            <Users className="h-4 w-4 mr-1" />
                                            User Management
                                        </Button>
                                    </Link>
                                    <Link href="/admin/email">
                                        <Button variant="ghost" size="sm" title="Email Management">
                                            <Mail className="h-4 w-4 mr-1" />
                                            Email Management
                                        </Button>
                                    </Link>
                                </>
                            )}
                            <Link href="/profile">
                                <Button variant="ghost" size="icon" title="Profile">
                                    <User className="h-5 w-5" />
                                </Button>
                            </Link>
                            <Button variant="outline" onClick={onLogout} title="Sign Out">
                                <LogOut className="h-4 w-4 mr-2" />
                                Sign Out
                            </Button>
                        </>
                    ) : (
                        <Link href="/auth">
                            <Button variant="outline">Sign In</Button>
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
}
