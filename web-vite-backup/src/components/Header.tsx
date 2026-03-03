import { Link, useNavigate } from "react-router-dom";
import { Film, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionContext, signOut } from "supertokens-auth-react/recipe/session";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuthReady } from "@/contexts/AuthReadyContext";

/** Guest header when auth is not ready (no SuperTokens wrapper). No session hooks. */
export function HeaderGuest() {
    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>
                <div className="flex items-center gap-4">
                    <ModeToggle />
                    <Link to="/auth">
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

export function Header() {
    const session = useSessionContext();
    const navigate = useNavigate();

    async function onLogout() {
        await signOut();
        navigate("/");
    }

    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">

                {/* Logo */}
                <Link to="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>

                <div className="flex items-center gap-4">
                    <ModeToggle />
                    {!session.loading && session.doesSessionExist ? (
                        <>
                            <Link to="/projects">
                                <Button variant="ghost">Projects</Button>
                            </Link>
                            <Link to="/profile">
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
                        <Link to="/auth">
                            <Button variant="outline">Sign In</Button>
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
}
