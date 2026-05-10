"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionContext } from "supertokens-auth-react/recipe/session";
import { useAuthReady } from "@/contexts/AuthReadyContext";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";

import heroImage from "@/assets/hero-film-production.jpg";
import budgetingWorkspace from "@/assets/budgeting-workspace.jpg";
import schedulingTimeline from "@/assets/scheduling-timeline.jpg";
import shotListPlanning from "@/assets/shot-list-planning.jpg";
import auditionsCasting from "@/assets/auditions-casting.jpg";
import crewCoordination from "@/assets/crew-coordination.jpg";
import moodBoardInspiration from "@/assets/mood-board-inspiration.jpg";

const FEATURES = [
  {
    href: "/budgeting-info",
    title: "Budgeting",
    description: "Track expenses, allocate resources, and manage your production budget efficiently",
    img: budgetingWorkspace,
  },
  {
    href: "/scheduling-info",
    title: "Scheduling",
    description: "Organize shoot days, coordinate crew availability, and optimize your production timeline",
    img: schedulingTimeline,
  },
  {
    href: "/shotlist-info",
    title: "Shot List",
    description: "Plan camera angles, organize scenes, and create detailed shot lists for your production",
    img: shotListPlanning,
  },
  {
    href: "/auditions-info",
    title: "Auditions",
    description: "Manage casting calls, schedule auditions, and organize actor submissions",
    img: auditionsCasting,
  },
  {
    href: "/crew-info",
    title: "Crew Management",
    description: "Organize your team, assign roles, and coordinate crew members across departments",
    img: crewCoordination,
  },
  {
    href: "/moodboard-info",
    title: "Mood Board",
    description: "Collect visual inspiration, create color palettes, and communicate your creative vision",
    img: moodBoardInspiration,
  },
];

function HomePage() {
  const session = useSessionContext();
  const router = useRouter();

  useEffect(() => {
    if (session.loading) return;
    if ("doesSessionExist" in session && session.doesSessionExist) {
      router.replace("/projects");
    }
  }, [session, router]);

  if (session.loading || ("doesSessionExist" in session && session.doesSessionExist)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative h-[600px] flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0">
            <Image
              src={heroImage}
              alt="Professional film production studio"
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background/90 to-background/50" />
          </div>
          <div className="relative container mx-auto px-4 text-center">
            <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Professional Film Production
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Bringing your creative vision to life with cutting-edge technology and expert craftsmanship
            </p>
            <Link href="/auth">
              <Button size="lg" className="text-lg px-8">
                Start Your Project
              </Button>
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 bg-card/50">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl font-bold text-center mb-12">Manage Your Production</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {FEATURES.map((f) => (
                <Link key={f.href} href={f.href} className="group">
                  <div className="relative overflow-hidden rounded-lg mb-4 aspect-[4/3]">
                    <Image
                      src={f.img}
                      alt={f.title}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                  </div>
                  <h3 className="text-2xl font-semibold mb-2">{f.title}</h3>
                  <p className="text-muted-foreground">{f.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default function Home() {
  const authReady = useAuthReady();

  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <HomePage />;
}
