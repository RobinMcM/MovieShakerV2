"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Shield } from "lucide-react";
import { api } from "@/lib/api";

interface AuthConfig {
  email_password_enabled: boolean;
  allow_sign_up: boolean;
  password_min_length: number;
  password_require_uppercase: boolean;
  password_require_lowercase: boolean;
  password_require_number: boolean;
  password_require_special: boolean;
  registration_subject: string;
  registration_body: string;
  welcome_subject: string;
  welcome_body: string;
  reset_confirmation_subject: string;
  reset_confirmation_body: string;
  updated_at: string;
}

const defaultConfig: AuthConfig = {
  email_password_enabled: true,
  allow_sign_up: true,
  password_min_length: 8,
  password_require_uppercase: false,
  password_require_lowercase: false,
  password_require_number: false,
  password_require_special: false,
  registration_subject: "Registration confirmed",
  registration_body: "Your MovieShaker registration was successful.",
  welcome_subject: "Welcome to MovieShaker",
  welcome_body: "Welcome aboard. Your account is ready to use.",
  reset_confirmation_subject: "Password reset confirmed",
  reset_confirmation_body: "Your password was reset successfully.",
  updated_at: "",
};

function AdminAuthPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AuthConfig>(defaultConfig);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api
      .get<{ role?: string }>("/profile/")
      .then((p) => setAllowed(p.role === "admin"))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed === false) router.replace("/");
  }, [allowed, router]);

  useEffect(() => {
    if (allowed === true) {
      void loadConfig();
    }
  }, [allowed]);

  async function loadConfig() {
    try {
      setLoading(true);
      const data = await api.get<AuthConfig>("/admin/auth/config");
      setConfig(data);
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to load auth settings.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    try {
      setSaving(true);
      setMessage(null);
      const updated = await api.put<AuthConfig>("/admin/auth/config", config);
      setConfig(updated);
      setMessage({ kind: "success", text: "Authentication settings saved." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save auth settings.",
      });
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof AuthConfig>(key: K, value: AuthConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  if (allowed !== true) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
          <Shield className="h-8 w-8" />
          Authentication Management
        </h1>

        {message && (
          <div
            className={`p-3 rounded-md text-sm ${
              message.kind === "error"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
            }`}
          >
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Login Types & Requirements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.email_password_enabled}
                      onChange={(e) => update("email_password_enabled", e.target.checked)}
                    />
                    Enable Email/Password login
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.allow_sign_up}
                      onChange={(e) => update("allow_sign_up", e.target.checked)}
                    />
                    Allow new sign-ups
                  </label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password_min_length">Password minimum length</Label>
                  <Input
                    id="password_min_length"
                    type="number"
                    min={6}
                    value={config.password_min_length}
                    onChange={(e) => update("password_min_length", Number.parseInt(e.target.value || "8", 10))}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.password_require_uppercase}
                      onChange={(e) => update("password_require_uppercase", e.target.checked)}
                    />
                    Require uppercase letter
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.password_require_lowercase}
                      onChange={(e) => update("password_require_lowercase", e.target.checked)}
                    />
                    Require lowercase letter
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.password_require_number}
                      onChange={(e) => update("password_require_number", e.target.checked)}
                    />
                    Require number
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.password_require_special}
                      onChange={(e) => update("password_require_special", e.target.checked)}
                    />
                    Require special character
                  </label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Email Templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>Registration email subject</Label>
                  <Input
                    value={config.registration_subject}
                    onChange={(e) => update("registration_subject", e.target.value)}
                  />
                  <Label>Registration email body</Label>
                  <Textarea
                    value={config.registration_body}
                    onChange={(e) => update("registration_body", e.target.value)}
                    className="min-h-[90px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Welcome email subject</Label>
                  <Input
                    value={config.welcome_subject}
                    onChange={(e) => update("welcome_subject", e.target.value)}
                  />
                  <Label>Welcome email body</Label>
                  <Textarea
                    value={config.welcome_body}
                    onChange={(e) => update("welcome_body", e.target.value)}
                    className="min-h-[90px]"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveConfig} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save authentication settings"
                )}
              </Button>
              <Button variant="outline" onClick={() => loadConfig()} disabled={loading || saving}>
                Reload
              </Button>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default function AdminAuth() {
  return (
    <SessionAuth>
      <AdminAuthPage />
    </SessionAuth>
  );
}
