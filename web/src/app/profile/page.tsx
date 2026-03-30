"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    notifications_opt_in?: boolean;
    ai_credits?: number;
    model_fiab_text?: string | null;
    model_visualize_video?: string | null;
    model_object_image?: string | null;
    model_sound_music?: string | null;
    project_limit?: number;
    owned_project_count?: number;
    created_at?: string | null;
    updated_at?: string | null;
}

interface ConfigStatusResponse {
    success: boolean;
    config: {
        models: Array<{ id: string; name?: string; provider?: string }>;
        soundMusicModels?: Array<{
            id: string;
            name?: string;
            provider?: string;
            media_type_support?: string[];
            required_inputs?: string[];
            optional_inputs?: string[];
            status?: string;
            default_for_media_type?: string | null;
            cost_tier?: string;
            speed_tier?: string;
            quality_tier?: string;
            docs_url?: string | null;
        }>;
        fiabTextModels?: Array<{
            id: string;
            name?: string;
            provider?: string;
            cost_rank?: number;
            creativity_rank?: number;
            categories?: string[];
        }>;
    };
}

type FiabCategory =
    | "script_creative_writing"
    | "budget_financial_planning"
    | "funding_pitch_development"
    | "marketing_promotion";

const FIAB_CATEGORY_OPTIONS: Array<{ id: FiabCategory; label: string }> = [
    { id: "script_creative_writing", label: "📝 Script & Creative Writing" },
    { id: "budget_financial_planning", label: "💰 Budget & Financial Planning" },
    { id: "funding_pitch_development", label: "💼 Funding & Pitch Development" },
    { id: "marketing_promotion", label: "🎨 Marketing & Promotion" },
];
const ALL_FIAB_CATEGORIES: FiabCategory[] = FIAB_CATEGORY_OPTIONS.map((option) => option.id);

type ProfileModelOption = {
    id: string;
    name?: string;
    provider?: string;
    media_type_support?: string[];
    required_inputs?: string[];
    optional_inputs?: string[];
    status?: string;
    default_for_media_type?: string | null;
    cost_tier?: string;
    speed_tier?: string;
    quality_tier?: string;
    docs_url?: string | null;
};

function optionSummary(model: ProfileModelOption): string {
    const supports = Array.isArray(model.media_type_support) && model.media_type_support.length > 0
        ? model.media_type_support.join(", ")
        : "unspecified";
    const quality = model.quality_tier ? `quality ${model.quality_tier}` : null;
    const speed = model.speed_tier ? `speed ${model.speed_tier}` : null;
    const bits = [supports, quality, speed].filter(Boolean);
    return bits.join(" · ");
}

function ProfilePage() {
    const searchParams = useSearchParams();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [verifiedBanner, setVerifiedBanner] = useState<"success" | "error" | null>(null);
    const [gatewayModels, setGatewayModels] = useState<Array<{ id: string; name?: string; provider?: string }>>([]);
    const [soundMusicModels, setSoundMusicModels] = useState<ProfileModelOption[]>([]);
    const [fiabTextModels, setFiabTextModels] = useState<Array<{
        id: string;
        name?: string;
        provider?: string;
        cost_rank?: number;
        creativity_rank?: number;
        categories?: string[];
    }>>([]);
    const [selectedFiabCategory, setSelectedFiabCategory] = useState<FiabCategory>("script_creative_writing");
    const [fiabCostSort, setFiabCostSort] = useState<"desc" | "asc">("desc");
    const [savingModels, setSavingModels] = useState(false);

    const [formData, setFormData] = useState({
        name: "",
        company: "",
        communication_email: "",
        username: "",
        phone: "",
        address: "",
        model_fiab_text: "",
        model_sound_music: "",
        notifications_opt_in: true,
    });

    useEffect(() => {
        fetchProfile();
        loadConfigModels();
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
                model_fiab_text: data.model_fiab_text ?? "",
                model_sound_music: data.model_sound_music ?? "",
                notifications_opt_in: data.notifications_opt_in ?? true,
            });
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load profile.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    async function loadConfigModels() {
        try {
            const data = await api.get<ConfigStatusResponse>("/api/config/status");
            const models = Array.isArray(data?.config?.models) ? data.config.models : [];
            const musicModels = Array.isArray(data?.config?.soundMusicModels) ? data.config.soundMusicModels : [];
            const fiabModels = Array.isArray(data?.config?.fiabTextModels) ? data.config.fiabTextModels : [];
            setGatewayModels(models);
            setSoundMusicModels(musicModels.map((m) => ({ ...m })));
            setFiabTextModels(fiabModels);
        } catch {
            setGatewayModels([]);
            setSoundMusicModels([]);
            setFiabTextModels([]);
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleModelChange = (field: "model_fiab_text" | "model_sound_music", value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value === "__none__" ? "" : value }));
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
    const isDeficit = (profile?.ai_credits ?? 0) < 0;
    const orderedFiabModels = useMemo(() => {
        const source = fiabTextModels.length > 0
            ? fiabTextModels
            : gatewayModels.map((model) => ({
                ...model,
                cost_rank: 0,
                creativity_rank: 0,
                categories: ALL_FIAB_CATEGORIES,
            }));
        const filtered = source.filter((model) => {
            const categories = model.categories;
            if (!Array.isArray(categories) || categories.length === 0) {
                // Backward-compatible fallback when backend category metadata is unavailable.
                return true;
            }
            return categories.includes(selectedFiabCategory);
        });
        const sorted = [...filtered];
        sorted.sort((a, b) =>
            ((fiabCostSort === "desc"
                ? Number(b.cost_rank || 0) - Number(a.cost_rank || 0)
                : Number(a.cost_rank || 0) - Number(b.cost_rank || 0)))
            || String(a.name || a.id).localeCompare(String(b.name || b.id))
        );
        return sorted;
    }, [fiabCostSort, fiabTextModels, gatewayModels, selectedFiabCategory]);
    const soundMusicModelsForSelect = useMemo(() => {
        const current = (formData.model_sound_music || "").trim();
        if (!current) return soundMusicModels;
        if (soundMusicModels.some((model) => model.id === current)) return soundMusicModels;
        return [
            {
                id: current,
                name: `${current} (legacy/unavailable)`,
                provider: "unknown",
            },
            ...soundMusicModels,
        ];
    }, [formData.model_sound_music, soundMusicModels]);

    async function handleSaveModelSettings() {
        try {
            setSavingModels(true);
            const data = await api.put<Profile>("/profile/", {
                model_fiab_text: formData.model_fiab_text || null,
                model_sound_music: formData.model_sound_music || null,
            });
            setProfile(data);
            setFormData((prev) => ({
                ...prev,
                model_fiab_text: data.model_fiab_text ?? "",
                model_sound_music: data.model_sound_music ?? "",
            }));
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to save model settings.";
            setError(message);
        } finally {
            setSavingModels(false);
        }
    }

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
            <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
                <div className="flex items-center gap-2 mb-6 flex-wrap">
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

                            <div className="space-y-2">
                                <Label>Email notifications</Label>
                                <Select
                                    value={formData.notifications_opt_in ? "enabled" : "disabled"}
                                    onValueChange={(value) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            notifications_opt_in: value === "enabled",
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="enabled">Enabled</SelectItem>
                                        <SelectItem value="disabled">Disabled</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Enabled by default. Admin bulk announcements only go to users with notifications enabled.
                                </p>
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

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-lg">Billing</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Current credits</span>
                            <span className={`text-sm font-semibold ${isDeficit ? "text-destructive" : "text-foreground"}`}>
                                {profile?.ai_credits ?? 0}
                            </span>
                        </div>

                        {isDeficit && (
                            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                                Your account is in deficit. Please purchase credits to clear the balance before generating again.
                            </div>
                        )}

                        <div className="pt-2 border-t">
                            <Button asChild type="button" variant="outline" className="w-full sm:w-auto">
                                <Link href="/credits">Manage Credits</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-lg">a Film in a Box Model Choice</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Option choice</Label>
                            <Select value={selectedFiabCategory} onValueChange={(value) => setSelectedFiabCategory(value as FiabCategory)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FIAB_CATEGORY_OPTIONS.map((option) => (
                                        <SelectItem key={option.id} value={option.id}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Model for a Film in a Box (Text)</Label>
                            <Select value={fiabCostSort} onValueChange={(value) => setFiabCostSort(value as "desc" | "asc")}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="desc">Cost: High to Low</SelectItem>
                                    <SelectItem value="asc">Cost: Low to High</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select
                                value={formData.model_fiab_text || "__none__"}
                                onValueChange={(value) => handleModelChange("model_fiab_text", value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select text model" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No default</SelectItem>
                                    {orderedFiabModels.map((model) => (
                                        <SelectItem key={`fiab-${model.id}`} value={model.id}>
                                            {model.name || model.id}
                                            {model.provider ? ` (${model.provider})` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {fiabCostSort === "desc" ? "Ordered by cost high to low." : "Ordered by cost low to high."}
                            </p>
                            {orderedFiabModels.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    No models found for this category.
                                </p>
                            )}
                        </div>

                        <Button type="button" onClick={handleSaveModelSettings} disabled={savingModels}>
                            {savingModels ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving…
                                </>
                            ) : (
                                "Save a Film in a Box model"
                            )}
                        </Button>
                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-lg">Media Model Selection</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Model for Sound (Music)</Label>
                            <Select
                                value={formData.model_sound_music || "__none__"}
                                onValueChange={(value) => handleModelChange("model_sound_music", value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select music model" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No default</SelectItem>
                                    {soundMusicModelsForSelect.map((model) => (
                                        <SelectItem key={`music-${model.id}`} value={model.id}>
                                            {model.name || model.id}
                                            {model.provider ? ` (${model.provider})` : ""}
                                            {` · ${optionSummary(model)}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <Button type="button" onClick={handleSaveModelSettings} disabled={savingModels}>
                            {savingModels ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving…
                                </>
                            ) : (
                                "Save media model choice"
                            )}
                        </Button>
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
