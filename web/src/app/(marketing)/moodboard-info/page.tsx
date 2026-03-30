import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Palette, Image, Lightbulb, Share2 } from "lucide-react";
import moodBoardInspiration from "@/assets/mood-board-inspiration.jpg";

export default function MoodBoardInfoPage() {
    return (
        <div className="min-h-screen bg-background">
            <section className="relative py-20">
                <div className="container mx-auto px-4">
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Mood Board Creation</h1>
                            <p className="text-xl text-muted-foreground mb-8">Visualize your creative vision with collaborative mood boards that inspire and align your entire production team.</p>
                        </div>
                        <div className="relative overflow-hidden rounded-lg">
                            <img src={moodBoardInspiration.src} alt="Creative mood board and visual references" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4">
                    <h2 className="text-4xl font-bold text-center mb-12">Visual Storytelling Tools</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="bg-card p-6 rounded-lg border"><Image className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Visual Library</h3><p className="text-muted-foreground">Collect and organize images, screenshots, paintings, and photographs that capture the look and feel of your project.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Palette className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Color Palettes</h3><p className="text-muted-foreground">Create and save color schemes that define your visual style. Extract palettes from reference images automatically.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Lightbulb className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Scene References</h3><p className="text-muted-foreground">Link mood board elements directly to specific scenes. Help your DP, production designer, and wardrobe understand the vision.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><Share2 className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Team Collaboration</h3><p className="text-muted-foreground">Share boards with your entire creative team. Gather feedback, suggestions, and additional references from collaborators.</p></div>
                    </div>
                </div>
            </section>
            <section className="py-20">
                <div className="container mx-auto px-4 max-w-4xl">
                    <h2 className="text-4xl font-bold mb-8">Why Visual References Matter</h2>
                    <div className="space-y-6 text-lg text-muted-foreground">
                        <p>A picture is worth a thousand words, especially in film production. Mood boards help you communicate your creative vision clearly and effectively to everyone involved in bringing your story to life.</p>
                        <p>Collect inspiration from films, photography, art, fashion, and real locations. Share your vision with the director of photography, production designer, and wardrobe. Create separate boards for different aspects of your production.</p>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold mb-6">Ready to Visualize Your Story?</h2>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">Start creating inspiring mood boards for your production</p>
                    <Link href="/auth"><Button size="lg" className="text-lg px-8">Get Started</Button></Link>
                </div>
            </section>
        </div>
    );
}
