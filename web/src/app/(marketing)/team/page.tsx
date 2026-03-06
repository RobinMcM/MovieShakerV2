import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TeamPage() {
    return (
        <div className="min-h-screen bg-background">
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Link href="/"><Button variant="ghost" className="gap-2 mb-8"><ArrowLeft className="h-4 w-4" />Back</Button></Link>
                <h1 className="text-4xl font-bold mb-6">Our Team</h1>
                <p className="text-lg text-muted-foreground">Meet the people behind MovieShaker. Our team is dedicated to building tools that support filmmakers and production teams.</p>
            </div>
        </div>
    );
}
