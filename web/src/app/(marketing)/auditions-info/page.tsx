import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, Calendar, Star, Video } from "lucide-react";
import auditionsCasting from "@/assets/auditions-casting.jpg";

export default function AuditionsInfoPage() {
    return (
        <div className="min-h-screen bg-background">
            <section className="relative py-20">
                <div className="container mx-auto px-4">
                    <Link href="/"><Button variant="ghost" className="gap-2 mb-8"><ArrowLeft className="h-4 w-4" />Back</Button></Link>
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Casting & Auditions</h1>
                            <p className="text-xl text-muted-foreground mb-8">Streamline your casting process with comprehensive audition management tools designed for modern film production.</p>
                        </div>
                        <div className="relative overflow-hidden rounded-lg">
                            <img src={auditionsCasting.src} alt="Audition and casting sessions" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4">
                    <h2 className="text-4xl font-bold text-center mb-12">Complete Casting Management</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="bg-card p-6 rounded-lg border"><Users className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Actor Database</h3><p className="text-muted-foreground">Organize actor profiles with headshots, resumes, and previous work. Search and filter by age, experience, skills, and availability.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Calendar className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Schedule Management</h3><p className="text-muted-foreground">Coordinate audition times, send automated reminders, and manage multiple casting sessions across different locations.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Video className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Self-Tape Reviews</h3><p className="text-muted-foreground">Accept and review video auditions from actors anywhere in the world. Rate, comment, and share with your creative team.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Star className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Callback Tracking</h3><p className="text-muted-foreground">Track which actors advance to callbacks. Compare performances side-by-side and make confident casting decisions.</p></div>
                    </div>
                </div>
            </section>
            <section className="py-20">
                <div className="container mx-auto px-4 max-w-4xl">
                    <h2 className="text-4xl font-bold mb-8">Why Professional Casting Matters</h2>
                    <div className="space-y-6 text-lg text-muted-foreground">
                        <p>Finding the right talent is crucial to bringing your story to life. Our audition management system helps you discover, evaluate, and select the perfect cast for your production.</p>
                        <p>From initial casting calls to final selections, manage the entire process in one place. Collaborate seamlessly with directors, producers, and casting directors. Support both in-person and remote auditions.</p>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold mb-6">Ready to Find Your Perfect Cast?</h2>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">Start organizing your casting process with professional tools</p>
                    <Link href="/auth"><Button size="lg" className="text-lg px-8">Get Started</Button></Link>
                </div>
            </section>
        </div>
    );
}
