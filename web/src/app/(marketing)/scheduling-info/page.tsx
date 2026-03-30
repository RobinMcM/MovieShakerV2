import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Users, MapPin } from "lucide-react";
import schedulingTimeline from "@/assets/scheduling-timeline.jpg";

export default function SchedulingInfoPage() {
    return (
        <div className="min-h-screen bg-background">
            <section className="relative py-20">
                <div className="container mx-auto px-4">
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Production Scheduling</h1>
                            <p className="text-xl text-muted-foreground mb-8">Organize complex production timelines with powerful scheduling tools that keep your entire team synchronized.</p>
                        </div>
                        <div className="relative overflow-hidden rounded-lg">
                            <img src={schedulingTimeline.src} alt="Production scheduling and timeline" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4">
                    <h2 className="text-4xl font-bold text-center mb-12">Streamlined Production Planning</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="bg-card p-6 rounded-lg border"><Calendar className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Smart Scheduling</h3><p className="text-muted-foreground">Create detailed shoot schedules that automatically optimize for location availability, actor schedules, and crew assignments.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Clock className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Time Management</h3><p className="text-muted-foreground">Track shoot day progress in real-time. Monitor if you&apos;re ahead or behind schedule and adjust plans accordingly.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Users className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Crew Coordination</h3><p className="text-muted-foreground">Manage crew availability and assignments. Send automated call sheets and schedule updates to keep everyone informed.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><MapPin className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Location Planning</h3><p className="text-muted-foreground">Coordinate multiple locations efficiently. Group scenes by location to minimize travel time and maximize productivity.</p></div>
                    </div>
                </div>
            </section>
            <section className="py-20">
                <div className="container mx-auto px-4 max-w-4xl">
                    <h2 className="text-4xl font-bold mb-8">Master Your Production Timeline</h2>
                    <div className="space-y-6 text-lg text-muted-foreground">
                        <p>Effective scheduling is the backbone of any successful production. Our scheduling tools help you create realistic timelines that account for every aspect of your shoot, from pre-production prep to final wrap.</p>
                        <p>Break down your script by scenes and create detailed shooting schedules that optimize for efficiency. Our intelligent scheduling engine considers factors like location availability, actor schedules, equipment needs, and weather conditions to suggest the most efficient shooting order.</p>
                        <p>Coordinate complex productions with multiple units shooting simultaneously. Track what each unit is filming, who&apos;s on set, and what equipment is being used. Avoid conflicts and ensure smooth operations across all units.</p>
                        <p>When changes happen (and they always do), update your schedule once and notify everyone instantly. Integration with your budget tracking means you can see the financial implications of schedule changes in real-time.</p>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold mb-6">Ready to Optimize Your Schedule?</h2>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">Start planning your production timeline with professional tools</p>
                    <Link href="/auth"><Button size="lg" className="text-lg px-8">Get Started</Button></Link>
                </div>
            </section>
        </div>
    );
}
