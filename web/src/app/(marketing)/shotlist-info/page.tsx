import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Camera, Film, Layout, Lightbulb } from "lucide-react";
import shotListPlanning from "@/assets/shot-list-planning.jpg";

export default function ShotListInfoPage() {
    return (
        <div className="min-h-screen bg-background">
            <section className="relative py-20">
                <div className="container mx-auto px-4">
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Shot List Management</h1>
                            <p className="text-xl text-muted-foreground mb-8">Plan every shot with precision using comprehensive shot list tools that bring your creative vision to life.</p>
                        </div>
                        <div className="relative overflow-hidden rounded-lg">
                            <img src={shotListPlanning.src} alt="Shot list and storyboard planning" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4">
                    <h2 className="text-4xl font-bold text-center mb-12">Complete Visual Planning</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="bg-card p-6 rounded-lg border"><Camera className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Shot Details</h3><p className="text-muted-foreground">Document every aspect of your shots including camera angle, lens choice, movement, framing, and technical specifications.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Film className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Scene Breakdown</h3><p className="text-muted-foreground">Organize shots by scene, location, and shooting day. Group similar setups together for efficient production.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Layout className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Storyboarding</h3><p className="text-muted-foreground">Create visual storyboards alongside your shot list. Upload reference images and sketches to communicate your vision.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Lightbulb className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Creative Notes</h3><p className="text-muted-foreground">Add director notes, cinematography ideas, and technical requirements. Share creative vision with your team.</p></div>
                    </div>
                </div>
            </section>
            <section className="py-20">
                <div className="container mx-auto px-4 max-w-4xl">
                    <h2 className="text-4xl font-bold mb-8">Plan Every Frame</h2>
                    <div className="space-y-6 text-lg text-muted-foreground">
                        <p>A well-crafted shot list is your roadmap to capturing exactly what you need on set. Our shot list tools help you plan every frame before you roll camera, ensuring efficient shoots and complete coverage.</p>
                        <p>Create detailed shot descriptions including shot size (wide, medium, close-up), camera angle (high angle, low angle, eye level), camera movement (pan, tilt, dolly, steadicam), and lens specifications.</p>
                        <p>Organize shots logically for efficient filming. Group shots by location, lighting setup, or actor availability. Track shot completion in real-time on set and export in multiple formats for your crew.</p>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold mb-6">Ready to Plan Your Shots?</h2>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">Start creating detailed shot lists for your next production</p>
                    <Link href="/auth"><Button size="lg" className="text-lg px-8">Get Started</Button></Link>
                </div>
            </section>
        </div>
    );
}
