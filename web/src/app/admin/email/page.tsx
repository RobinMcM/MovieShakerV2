"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, Send } from "lucide-react";
import { api } from "@/lib/api";

interface RecipientPreview {
    user_id: string;
    email: string;
}

interface BulkPreviewResponse {
    targeted: number;
    recipients: RecipientPreview[];
}

interface BulkSendResponse {
    targeted: number;
    sent: number;
    failed: number;
    failed_user_ids: string[];
}

interface EmailStatsSummary {
    from_date?: string | null;
    to_date?: string | null;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    failed: number;
    total_events: number;
}

interface EmailRecentSend {
    id: string;
    created_at: string;
    email: string;
    email_type: string;
    subject?: string | null;
    status: string;
    provider_message_id?: string | null;
    error?: string | null;
}

interface EmailStatsRecentResponse {
    sends: EmailRecentSend[];
}

function AdminEmailPage() {
    const router = useRouter();
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [sending, setSending] = useState(false);
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [ctaUrl, setCtaUrl] = useState("");
    const [ctaLabel, setCtaLabel] = useState("");
    const [requireCommunicationEmail, setRequireCommunicationEmail] = useState(false);
    const [preview, setPreview] = useState<BulkPreviewResponse | null>(null);
    const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsSummary, setStatsSummary] = useState<EmailStatsSummary | null>(null);
    const [statsRecent, setStatsRecent] = useState<EmailRecentSend[]>([]);
    const [statsFromDate, setStatsFromDate] = useState("");
    const [statsToDate, setStatsToDate] = useState("");

    useEffect(() => {
        api.get<{ role?: string }>("/profile/")
            .then((p) => setAllowed(p.role === "admin"))
            .catch(() => setAllowed(false));
    }, []);

    useEffect(() => {
        if (allowed === false) router.replace("/");
    }, [allowed, router]);

    useEffect(() => {
        if (allowed === true) {
            void loadPreview(requireCommunicationEmail);
            void loadStats();
        }
    }, [allowed, requireCommunicationEmail]);

    async function loadPreview(requireCommEmail = requireCommunicationEmail) {
        try {
            setLoadingPreview(true);
            const data = await api.get<BulkPreviewResponse>(
                `/admin/email/bulk/preview?require_communication_email=${requireCommEmail ? "true" : "false"}`
            );
            setPreview(data);
        } catch (err) {
            setMessage({
                kind: "error",
                text: err instanceof Error ? err.message : "Failed to load recipient preview.",
            });
        } finally {
            setLoadingPreview(false);
        }
    }

    async function handleSend() {
        const trimmedSubject = subject.trim();
        const trimmedBody = body.trim();
        if (!trimmedSubject || !trimmedBody) {
            setMessage({ kind: "error", text: "Subject and message body are required." });
            return;
        }
        try {
            setSending(true);
            setMessage(null);
            const result = await api.post<BulkSendResponse>("/admin/email/bulk-send", {
                subject: trimmedSubject,
                body: trimmedBody,
                cta_url: ctaUrl.trim() || null,
                cta_label: ctaLabel.trim() || null,
                require_communication_email: requireCommunicationEmail,
            });
            setMessage({
                kind: "success",
                text: `Bulk send complete: ${result.sent}/${result.targeted} sent (${result.failed} failed).`,
            });
            void loadPreview(requireCommunicationEmail);
            void loadStats();
        } catch (err) {
            setMessage({
                kind: "error",
                text: err instanceof Error ? err.message : "Bulk send failed.",
            });
        } finally {
            setSending(false);
        }
    }

    async function loadStats() {
        try {
            setStatsLoading(true);
            const params = new URLSearchParams();
            if (statsFromDate) params.set("from_date", `${statsFromDate}T00:00:00`);
            if (statsToDate) params.set("to_date", `${statsToDate}T23:59:59`);
            const suffix = params.toString() ? `?${params.toString()}` : "";
            const [summary, recent] = await Promise.all([
                api.get<EmailStatsSummary>(`/admin/email/stats/summary${suffix}`),
                api.get<EmailStatsRecentResponse>("/admin/email/stats/recent?limit=20"),
            ]);
            setStatsSummary(summary);
            setStatsRecent(recent.sends || []);
        } catch (err) {
            setMessage({
                kind: "error",
                text: err instanceof Error ? err.message : "Failed to load email statistics.",
            });
        } finally {
            setStatsLoading(false);
        }
    }

    if (allowed !== true) return null;

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
                <h1 className="text-3xl font-bold mb-6 text-primary flex items-center gap-2">
                    <Mail className="h-8 w-8" />
                    Email Management
                </h1>

                {message && (
                    <div
                        className={`mb-4 p-3 rounded-md text-sm ${
                            message.kind === "error"
                                ? "bg-destructive/10 text-destructive border border-destructive/20"
                                : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
                        }`}
                    >
                        {message.text}
                    </div>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Bulk Email Composer</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email-subject">Subject</Label>
                            <Input
                                id="email-subject"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Notification title"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email-body">Message body</Label>
                            <Textarea
                                id="email-body"
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                placeholder="Write your announcement..."
                                className="min-h-[140px]"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="cta-url">CTA URL (optional)</Label>
                                <Input
                                    id="cta-url"
                                    value={ctaUrl}
                                    onChange={(e) => setCtaUrl(e.target.value)}
                                    placeholder="https://movieshaker.com/..."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cta-label">CTA label (optional)</Label>
                                <Input
                                    id="cta-label"
                                    value={ctaLabel}
                                    onChange={(e) => setCtaLabel(e.target.value)}
                                    placeholder="Open Dashboard"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Recipient mode</Label>
                            <Select
                                value={requireCommunicationEmail ? "communication-only" : "communication-or-auth"}
                                onValueChange={(value) =>
                                    setRequireCommunicationEmail(value === "communication-only")
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="communication-or-auth">
                                        Use communication email, fallback to login email
                                    </SelectItem>
                                    <SelectItem value="communication-only">
                                        Communication email only
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" onClick={() => loadPreview()} disabled={loadingPreview}>
                                {loadingPreview ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Refreshing...
                                    </>
                                ) : (
                                    "Refresh Preview"
                                )}
                            </Button>
                            <Button onClick={handleSend} disabled={sending || loadingPreview}>
                                {sending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Send className="h-4 w-4 mr-2" />
                                        Send Bulk Email
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-lg">Recipient Preview</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Targeted recipients: <span className="font-semibold text-foreground">{preview?.targeted ?? 0}</span>
                        </p>
                        {(preview?.recipients || []).length > 0 ? (
                            <div className="space-y-2">
                                {preview!.recipients.map((recipient) => (
                                    <div key={recipient.user_id} className="rounded-md border p-2 text-sm">
                                        {recipient.email}
                                    </div>
                                ))}
                                {preview && preview.targeted > preview.recipients.length && (
                                    <p className="text-xs text-muted-foreground">
                                        Showing first {preview.recipients.length} of {preview.targeted}.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No recipients currently match the active + notifications-enabled filter.
                            </p>
                        )}
                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-lg">Delivery Statistics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Sent</div>
                                <div className="text-xl font-semibold">{statsSummary?.sent ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Delivered</div>
                                <div className="text-xl font-semibold">{statsSummary?.delivered ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Opened</div>
                                <div className="text-xl font-semibold">{statsSummary?.opened ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Clicked</div>
                                <div className="text-xl font-semibold">{statsSummary?.clicked ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Bounced</div>
                                <div className="text-xl font-semibold">{statsSummary?.bounced ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Complained</div>
                                <div className="text-xl font-semibold">{statsSummary?.complained ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Failed</div>
                                <div className="text-xl font-semibold">{statsSummary?.failed ?? 0}</div>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                                <div className="text-muted-foreground">Webhook events</div>
                                <div className="text-xl font-semibold">{statsSummary?.total_events ?? 0}</div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1">
                                <Label htmlFor="stats-from-date">From</Label>
                                <Input
                                    id="stats-from-date"
                                    type="date"
                                    value={statsFromDate}
                                    onChange={(e) => setStatsFromDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="stats-to-date">To</Label>
                                <Input
                                    id="stats-to-date"
                                    type="date"
                                    value={statsToDate}
                                    onChange={(e) => setStatsToDate(e.target.value)}
                                />
                            </div>
                            <Button variant="outline" onClick={() => loadStats()} disabled={statsLoading}>
                                {statsLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    "Refresh Stats"
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-lg">Recent Email Activity</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {statsRecent.length > 0 ? (
                            statsRecent.map((row) => (
                                <div key={row.id} className="rounded-md border p-3 text-sm space-y-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium">{row.email}</span>
                                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                            {row.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {new Date(row.created_at).toLocaleString()} · {row.email_type}
                                    </div>
                                    {row.subject && (
                                        <div className="text-xs">{row.subject}</div>
                                    )}
                                    {row.error && (
                                        <div className="text-xs text-destructive">Error: {row.error}</div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No email activity yet.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </div>
    );
}

export default function AdminEmail() {
    return (
        <SessionAuth>
            <AdminEmailPage />
        </SessionAuth>
    );
}
