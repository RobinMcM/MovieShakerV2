"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, User, LogOut, Users, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSessionContext, signOut } from "supertokens-auth-react/recipe/session";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuthReady } from "@/contexts/AuthReadyContext";
import { api } from "@/lib/api";

/** Guest header when auth is not ready (no SuperTokens wrapper). No session hooks. */
export function HeaderGuest() {
    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <Link href="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-lg sm:text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>
                <div className="w-full sm:w-auto flex items-center justify-end gap-3">
                    <ModeToggle />
                    <Link href="/auth" className="shrink-0">
                        <Button variant="outline" size="sm">Sign In</Button>
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
    const [userMenuOpen, setUserMenuOpen] = useState(false);

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
        setUserMenuOpen(false);
        await signOut();
        router.push("/");
    }

    const isAdmin = profile?.role === "admin";

    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <Link href="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-lg sm:text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>
                <div className="w-full sm:w-auto flex items-center justify-end gap-2 sm:gap-3">
                    {hasSession ? (
                        <>
                            <Link href="/projects">
                                <Button variant="ghost" size="sm">Projects</Button>
                            </Link>
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Open user menu"
                                onClick={() => setUserMenuOpen((prev) => !prev)}
                                aria-expanded={userMenuOpen}
                                aria-label={userMenuOpen ? "Close user menu" : "Open user menu"}
                            >
                                <User className="h-5 w-5" />
                            </Button>
                            <Dialog open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                                <DialogContent className="top-0 right-0 left-auto bottom-0 h-screen max-h-screen w-[86vw] max-w-[340px] rounded-none border-l p-0">
                                    <DialogTitle className="sr-only">User Menu</DialogTitle>
                                    <div className="h-full overflow-y-auto p-4 space-y-5">
                                        <div className="flex items-center justify-between">
                                            <h2 className="text-base font-semibold">User Menu</h2>
                                            <span className="text-xs font-semibold px-2 py-1 rounded bg-muted text-muted-foreground">
                                                Credits: {typeof profile?.ai_credits === "number" ? profile.ai_credits : 0}
                                            </span>
                                        </div>

                                        <div className="space-y-2">
                                            <Link
                                                href="/profile"
                                                onClick={() => setUserMenuOpen(false)}
                                                className="flex items-center gap-2 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                                            >
                                                <User className="h-4 w-4" />
                                                <span>Profile</span>
                                            </Link>
                                            {isAdmin && (
                                                <>
                                                    <Link
                                                        href="/admin/users"
                                                        onClick={() => setUserMenuOpen(false)}
                                                        className="flex items-center gap-2 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                                                    >
                                                        <Users className="h-4 w-4" />
                                                        <span>User Management</span>
                                                    </Link>
                                                    <Link
                                                        href="/admin/email"
                                                        onClick={() => setUserMenuOpen(false)}
                                                        className="flex items-center gap-2 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                                                    >
                                                        <Mail className="h-4 w-4" />
                                                        <span>Email Management</span>
                                                    </Link>
                                                </>
                                            )}
                                        </div>

                                        <div className="pt-3 border-t">
                                            <div className="px-2.5 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                                                Preferences
                                            </div>
                                            <div className="px-2.5 py-2">
                                                <ModeToggle />
                                            </div>
                                        </div>

                                        <div className="pt-3 border-t">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={onLogout}
                                                className="w-full justify-start"
                                                title="Sign Out"
                                            >
                                                <LogOut className="h-4 w-4 mr-2" />
                                                <span>Sign Out</span>
                                            </Button>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </>
                    ) : (
                        <>
                            <ModeToggle />
                            <Link href="/auth">
                                <Button variant="outline" size="sm">Sign In</Button>
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}
