import { Film } from "lucide-react";
import { Link } from "react-router-dom";

export function Footer() {
    return (
        <footer className="border-t border-border py-8 bg-card/30">
            <div className="container mx-auto px-4">
                <div className="flex flex-col items-center gap-6 mb-8">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <Film className="h-5 w-5 text-primary" />
                            <span className="font-bold">MovieShaker</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Professional film production services for creators worldwide
                        </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                        <Link to="#" className="hover:text-primary transition-colors">About Us</Link>
                        <Link to="#" className="hover:text-primary transition-colors">Our Team</Link>
                        <Link to="#" className="hover:text-primary transition-colors">Careers</Link>
                        <Link to="/contact" className="hover:text-primary transition-colors">
                            Contact
                        </Link>
                        <Link to="/privacy" className="hover:text-primary transition-colors">
                            Privacy Policy
                        </Link>
                        <Link to="/terms" className="hover:text-primary transition-colors">
                            Terms of Service
                        </Link>
                        <Link to="/cookies" className="hover:text-primary transition-colors">
                            Cookie Policy
                        </Link>
                    </div>
                </div>
                <div className="pt-8 border-t border-border text-center text-sm text-muted-foreground">
                    <p>&copy; 2025 MovieShaker. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
}
