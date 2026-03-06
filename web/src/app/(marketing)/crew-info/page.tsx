import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, UsersRound, Briefcase, Network, MessageSquare } from "lucide-react";
import crewCoordination from "@/assets/crew-coordination.jpg";

export default function CrewInfoPage() {
    return (
        <div className="min-h-screen bg-background">
            <section className="relative py-20">
                <div className="container mx-auto px-4">
                    <Link href="/"><Button variant="ghost" className="gap-2 mb-8"><ArrowLeft className="h-4 w-4" />Back</Button></Link>
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Crew Management</h1>
                            <p className="text-xl text-muted-foreground mb-8">Coordinate your production team efficiently with powerful crew management and collaboration tools.</p>
                        </div>
                        <div className="relative overflow-hidden rounded-lg">
                            <img src={crewCoordination.src} alt="Film crew coordination and teamwork" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4">
                    <h2 className="text-4xl font-bold text-center mb-12">Complete Team Coordination</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="bg-card p-6 rounded-lg border"><UsersRound className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Team Directory</h3><p className="text-muted-foreground">Maintain detailed profiles for all crew members with contact information, skills, certifications, and availability.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Briefcase className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Role Assignment</h3><p className="text-muted-foreground">Organize crew by department and role. Track positions from director to PA with clear hierarchies and responsibilities.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Network className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Department Structure</h3><p className="text-muted-foreground">Set up camera, sound, lighting, art, wardrobe, and production departments with dedicated leads and team members.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><MessageSquare className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Communication Hub</h3><p className="text-muted-foreground">Share call sheets, updates, and important information with entire departments or individual crew members instantly.</p></div>
                    </div>
                </div>
            </section>
            <section className="py-20">
                <div className="container mx-auto px-4 max-w-4xl">
                    <h2 className="text-4xl font-bold mb-8">Why Crew Management Is Essential</h2>
                    <div className="space-y-6 text-lg text-muted-foreground">
                        <p>A well-coordinated crew is the backbone of any successful production. Our crew management system ensures everyone knows their role, schedule, and responsibilities at all times.</p>
                        <p>Build your production team by department, manage availability and prevent scheduling conflicts, and streamline communication across your entire production.</p>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold mb-6">Ready to Build Your Dream Team?</h2>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">Start coordinating your crew with professional management tools</p>
                    <Link href="/auth"><Button size="lg" className="text-lg px-8">Get Started</Button></Link>
                </div>
            </section>
        </div>
    );
}
