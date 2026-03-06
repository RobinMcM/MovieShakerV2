import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-background">
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Link href="/"><Button variant="ghost" className="gap-2 mb-8"><ArrowLeft className="h-4 w-4" />Back</Button></Link>
                <h1 className="text-4xl font-bold mb-6">About Us</h1>
                <p className="text-lg text-muted-foreground">MovieShaker provides professional film production tools to help creators bring their projects to life. Learn more about our team and mission on this page.</p>
            </div>
        </div>
    );
}
