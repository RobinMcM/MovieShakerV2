import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";

// Assets
import heroImage from "@/assets/hero-film-production.jpg";
import budgetingWorkspace from "@/assets/budgeting-workspace.jpg";
import schedulingTimeline from "@/assets/scheduling-timeline.jpg";
import shotListPlanning from "@/assets/shot-list-planning.jpg";
import auditionsCasting from "@/assets/auditions-casting.jpg";
import crewCoordination from "@/assets/crew-coordination.jpg";
import moodBoardInspiration from "@/assets/mood-board-inspiration.jpg";

export default function Landing() {
    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <Header />

            {/* Main Content */}
            <main className="flex-1">
                {/* Hero Section */}
                <section className="relative h-[600px] flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 z-0">
                        <img
                            src={heroImage}
                            alt="Professional film production studio"
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-r from-background/90 to-background/50" />
                    </div>

                    <div className="relative z-10 container mx-auto px-4 text-center animate-fade-in">
                        <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            Professional Film Production
                        </h1>
                        <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                            Bringing your creative vision to life with cutting-edge technology and expert craftsmanship
                        </p>
                        <Link to="/auth">
                            <Button size="lg" className="text-lg px-8">
                                Start Your Project
                            </Button>
                        </Link>
                    </div>
                </section>

                {/* Features Section */}
                <section className="py-20 bg-card/50">
                    <div className="container mx-auto px-4">
                        <h2 className="text-4xl font-bold text-center mb-12">
                            Manage Your Production
                        </h2>
                        <div className="grid md:grid-cols-3 gap-8">

                            <FeatureCard
                                to="/budgeting-info"
                                image={budgetingWorkspace}
                                title="Budgeting"
                                description="Track expenses, allocate resources, and manage your production budget efficiently"
                            />

                            <FeatureCard
                                to="/scheduling-info"
                                image={schedulingTimeline}
                                title="Scheduling"
                                description="Organize shoot days, coordinate crew availability, and optimize your production timeline"
                            />

                            <FeatureCard
                                to="/shotlist-info"
                                image={shotListPlanning}
                                title="Shot List"
                                description="Plan camera angles, organize scenes, and create detailed shot lists for your production"
                            />

                            <FeatureCard
                                to="/auditions-info"
                                image={auditionsCasting}
                                title="Auditions"
                                description="Manage casting calls, schedule auditions, and organize actor submissions"
                            />

                            <FeatureCard
                                to="/crew-info"
                                image={crewCoordination}
                                title="Crew Management"
                                description="Organize your team, assign roles, and coordinate crew members across departments"
                            />

                            <FeatureCard
                                to="/moodboard-info"
                                image={moodBoardInspiration}
                                title="Mood Board"
                                description="Collect visual inspiration, create color palettes, and communicate your creative vision"
                            />

                        </div>
                    </div>
                </section>
            </main>

            <Footer />
        </div>
    );
}

// Helper Component for Features
function FeatureCard({ to, image, title, description }: { to: string, image: string, title: string, description: string }) {
    return (
        <Link to={to} className="group block">
            <div className="relative overflow-hidden rounded-lg mb-4 aspect-[4/3] border-none">
                <img
                    src={image}
                    alt={title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
            </div>
            <h3 className="text-2xl font-semibold mb-2">{title}</h3>
            <p className="text-muted-foreground">
                {description}
            </p>
        </Link>
    )
}
