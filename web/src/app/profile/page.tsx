"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, User, CheckCircle2, Mail } from "lucide-react";
import { api } from "@/lib/api";

interface Profile {
    user_id: string;
    name?: string | null;
    company?: string | null;
    auth_email_masked?: string | null;
    communication_email?: string | null;
    email_verified_at?: string | null;
    username?: string | null;
    phone?: string | null;
    address?: string | null;
    role?: string;
    producer_tier?: string;
    blocked?: boolean;
    project_limit?: number;
    owned_project_count?: number;
    created_at?: string | null;
    updated_at?: string | null;
}

function ProfilePage() {
    const searchParams = useSearchParams();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [verifiedBanner, setVerifiedBanner] = useState<"success" | "error" | null>(null);

    const [formData, setFormData] = useState({
        name: "",
        company: "",
        communication_email: "",
        username: "",
        phone: "",
        address: "",
    });

    useEffect(() => {
        fetchProfile();
    }, []);

    useEffect(() => {
        const v = searchParams.get("verified");
        if (v === "1") setVerifiedBanner("success");
        else if (v === "error") setVerifiedBanner("error");
    }, [searchParams]);

    async function fetchProfile() {
        try {
            setLoading(true);
            const data = await api.get<Profile>("/profile/");
            setProfile(data);
            setFormData({
                name: data.name ?? "",
                company: data.company ?? "",
                communication_email: data.communication_email ?? "",
                username: data.username ?? "",
                phone: data.phone ?? "",
                address: data.address ?? "",
            });
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load profile.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        try {
            setSaving(true);
            const data = await api.put<Profile>("/profile/", formData);
            setProfile(data);
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to save profile.";
            setError(message);
        } finally {
            setSaving(false);
        }
    }

    async function handleResendVerification() {
        if (!profile?.communication_email) return;
        try {
            setResending(true);
            const data = await api.post<Profile>("/profile/send-verification-email", {});
            setProfile(data);
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to send verification email.";
            setError(message);
        } finally {
            setResending(false);
        }
    }

    const communicationEmailVerified = !!profile?.email_verified_at;

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex flex-col font-sans">
                <AppHeader />
                <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
                <div className="flex items-center gap-2 mb-6">
                    <User className="h-8 w-8 text-primary" />
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        Profile
                    </h1>
                    <span className="text-xs font-semibold px-2 py-1 rounded bg-muted text-muted-foreground capitalize">
                        {profile?.role === "admin" ? "Admin" : "Producer"}
                        {profile?.role === "producer" && profile?.producer_tier && (
                            <> · {profile.producer_tier.replace("_", " ")}</>
                        )}
                    </span>
                    {profile?.role === "producer" &&
                        typeof profile?.owned_project_count === "number" &&
                        typeof profile?.project_limit === "number" && (
                            <span className="text-xs text-muted-foreground">
                                {profile.owned_project_count} / {profile.project_limit} projects
                            </span>
                        )}
                </div>

                {verifiedBanner === "success" && (
                    <div className="mb-4 p-3 text-sm text-green-700 dark:text-green-400 bg-green-500/10 rounded-md border border-green-500/20 flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 shrink-0" />
                        Email verified. You can close this page.
                    </div>
                )}
                {verifiedBanner === "error" && (
                    <div className="mb-4 p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                        Verification link invalid or expired. Request a new one below.
                    </div>
                )}
                {error && (
                    <div className="mb-4 p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                        {error}
                    </div>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">User details</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {profile?.auth_email_masked && (
                                <div className="space-y-2">
                                    <Label>Login email (hidden from others)</Label>
                                    <Input value={profile.auth_email_masked} readOnly disabled className="bg-muted" />
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    placeholder="Your name"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="company">Company</Label>
                                <Input
                                    id="company"
                                    name="company"
                                    value={formData.company}
                                    onChange={handleChange}
                                    placeholder="Company or production"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="communication_email">Email for communications</Label>
                                <div className="flex flex-col gap-2">
                                    <Input
                                        id="communication_email"
                                        name="communication_email"
                                        type="email"
                                        value={formData.communication_email}
                                        onChange={handleChange}
                                        placeholder="Shown to collaborators; can differ from login email"
                                    />
                                    {profile?.communication_email && (
                                        <div className="flex items-center gap-2 text-sm">
                                            {communicationEmailVerified ? (
                                                <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    Verified
                                                </span>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={resending}
                                                    onClick={handleResendVerification}
                                                    className="w-fit"
                                                >
                                                    {resending ? (
                                                        <>
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                            Sending…
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Mail className="mr-2 h-4 w-4" />
                                                            Resend verification email
                                                        </>
                                                    )}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input
                                    id="username"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    placeholder="Display name or handle"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone</Label>
                                <Input
                                    id="phone"
                                    name="phone"
                                    type="tel"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    placeholder="Phone number"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="address">Address</Label>
                                <textarea
                                    id="address"
                                    name="address"
                                    value={formData.address}
                                    onChange={handleChange}
                                    placeholder="Address (multiple lines allowed)"
                                    rows={3}
                                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                />
                            </div>

                            <Button type="submit" disabled={saving}>
                                {saving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Saving…
                                    </>
                                ) : (
                                    "Save profile"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </div>
    );
}

export default function Profile() {
    return (
        <SessionAuth>
            <ProfilePage />
        </SessionAuth>
    );
}
