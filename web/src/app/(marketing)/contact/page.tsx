"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send } from "lucide-react";
import { api } from "@/lib/api";

const COOLDOWN_MS = 60_000;

export default function ContactPage() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [honeypot, setHoneypot] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [statusMessage, setStatusMessage] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (honeypot.trim()) {
            setStatus("success");
            setStatusMessage("Thank you for contacting us.");
            return;
        }
        const last = typeof window !== "undefined" ? localStorage.getItem("lastContactSubmission") : null;
        if (last) {
            const elapsed = Date.now() - parseInt(last, 10);
            if (elapsed < COOLDOWN_MS) {
                setStatus("error");
                setStatusMessage(`Please wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)} seconds before sending again.`);
                return;
            }
        }
        if (!name.trim() || !email.trim() || message.trim().length < 10) {
            setStatus("error");
            setStatusMessage("Please fill in name, a valid email, and a message of at least 10 characters.");
            return;
        }
        if (message.length > 1000) {
            setStatus("error");
            setStatusMessage("Message must be 1000 characters or less.");
            return;
        }
        setIsSubmitting(true);
        setStatus("idle");
        setStatusMessage("");
        try {
            await api.post("/contact", { name: name.trim(), email: email.trim(), message: message.trim(), honeypot: honeypot || null });
            if (typeof window !== "undefined") localStorage.setItem("lastContactSubmission", Date.now().toString());
            setStatus("success");
            setStatusMessage("Thank you for contacting us. We'll get back to you soon.");
            setName("");
            setEmail("");
            setMessage("");
            setHoneypot("");
        } catch (err) {
            setStatus("error");
            setStatusMessage(err instanceof Error ? err.message : "Failed to send message. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="text-center space-y-2 mb-8">
                    <h1 className="text-4xl font-bold text-foreground">Contact Us</h1>
                    <p className="text-muted-foreground">Have a question or want to work with us? Send us a message and we&apos;ll respond as soon as possible.</p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-6 bg-card p-8 rounded-lg border shadow-sm">
                    <div className="relative overflow-hidden h-0 opacity-0 pointer-events-none" aria-hidden>
                        <Label htmlFor="website">Website (leave blank)</Label>
                        <Input id="website" type="text" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required maxLength={100} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required maxLength={255} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="message">Message</Label>
                        <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what you're thinking..." required minLength={10} maxLength={1000} rows={6} className="resize-none" />
                        <p className="text-sm text-muted-foreground text-right">{message.length}/1000</p>
                    </div>
                    {status === "success" && <p className="text-sm text-green-600 dark:text-green-400">{statusMessage}</p>}
                    {status === "error" && <p className="text-sm text-destructive">{statusMessage}</p>}
                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Sending..." : <><Send className="h-4 w-4 mr-2 inline" />Send Message</>}
                    </Button>
                </form>
            </div>
        </div>
    );
}
