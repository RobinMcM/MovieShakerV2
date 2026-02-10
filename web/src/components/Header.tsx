import { Link } from "react-router-dom";
import { Film, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
    // TODO: Add auth state check
    const user = null;

    return (
        <header className="border-b border-white/10 sticky top-0 bg-black/80 backdrop-blur z-50">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">

                {/* Logo */}
                <Link to="/" className="flex items-center gap-2">
                    <Film className="h-6 w-6 text-primary" />
                    <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        MovieShaker
                    </span>
                </Link>

                {/* Actions */}
                <div className="flex items-center gap-4">
                    {user ? (
                        <Button variant="ghost" size="icon">
                            <User className="h-5 w-5" />
                        </Button>
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
