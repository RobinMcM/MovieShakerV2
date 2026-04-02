"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

type SelectionKey = "the-film-festival";

interface ChatbotConfig {
  selection_key: SelectionKey;
  selection_label: string;
  prompt_information: string;
  prompt_rules: string;
  updated_at: string;
}

interface ChatbotLayoutField {
  field_key: string;
  field_label: string;
}

interface ChatbotLayoutTab {
  tab_key: string;
  tab_label: string;
  fields: ChatbotLayoutField[];
}

interface ChatbotLayoutSchema {
  selection_key: SelectionKey;
  selection_label: string;
  page_title: string;
  tabs: ChatbotLayoutTab[];
  generated_at: string;
}

const DEFAULT_SELECTION: SelectionKey = "the-film-festival";

const defaultConfig: ChatbotConfig = {
  selection_key: DEFAULT_SELECTION,
  selection_label: "The Film Festival",
  prompt_information: "",
  prompt_rules: "",
  updated_at: "",
};

function AdminChatbotPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<SelectionKey>(DEFAULT_SELECTION);
  const [config, setConfig] = useState<ChatbotConfig>(defaultConfig);
  const [layoutJson, setLayoutJson] = useState("");
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api
      .get<{ role?: string }>("/profile/")
      .then((profile) => setAllowed(profile.role === "admin"))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed === false) router.replace("/");
  }, [allowed, router]);

  useEffect(() => {
    if (allowed === true) {
      void loadConfig(selection);
    }
  }, [allowed, selection]);

  async function loadConfig(selectionKey: SelectionKey) {
    try {
      setLoading(true);
      setMessage(null);
      const data = await api.get<ChatbotConfig>(
        `/admin/chatbot/config?selection=${encodeURIComponent(selectionKey)}`
      );
      setConfig(data);
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to load chatbot settings.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    try {
      setSaving(true);
      setMessage(null);
      const updated = await api.put<ChatbotConfig>("/admin/chatbot/config", {
        selection_key: config.selection_key,
        prompt_information: config.prompt_information,
        prompt_rules: config.prompt_rules,
      });
      setConfig(updated);
      setMessage({ kind: "success", text: "Chatbot prompt settings saved." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save chatbot settings.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function generateLayoutJson() {
    try {
      setLayoutLoading(true);
      setMessage(null);
      const schema = await api.get<ChatbotLayoutSchema>(
        `/admin/chatbot/layout?selection=${encodeURIComponent(selection)}`
      );
      setLayoutJson(JSON.stringify(schema, null, 2));
      setMessage({ kind: "success", text: "Page layout JSON generated." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to generate layout JSON.",
      });
    } finally {
      setLayoutLoading(false);
    }
  }

  function downloadLayoutJson() {
    if (!layoutJson) return;
    const blob = new Blob([layoutJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selection}-layout.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  if (allowed !== true) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
          <MessageCircle className="h-8 w-8" />
          Chatbot Prompt Administration
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
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Global Prompt Template Builder</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Prompt Selection</Label>
                <Select
                  value={selection}
                  onValueChange={(value) => setSelection(value as SelectionKey)}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="the-film-festival">The Film Festival</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Auto Generated Key: <span className="font-mono">{config.selection_key}</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="prompt_information">Prompt Information</Label>
                <Textarea
                  id="prompt_information"
                  value={config.prompt_information}
                  onChange={(e) => setConfig((prev) => ({ ...prev, prompt_information: e.target.value }))}
                  className="min-h-[120px]"
                  placeholder="Enter the client-facing setup context for this page."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prompt_rules">Prompt Rules</Label>
                <Textarea
                  id="prompt_rules"
                  value={config.prompt_rules}
                  onChange={(e) => setConfig((prev) => ({ ...prev, prompt_rules: e.target.value }))}
                  className="min-h-[220px]"
                  placeholder="Enter the guard rails and advisor-style flow rules."
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="generated_layout_json">Generated Layout JSON</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={generateLayoutJson}
                      disabled={layoutLoading || loading || saving}
                    >
                      {layoutLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        "Generate Layout JSON"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={downloadLayoutJson}
                      disabled={!layoutJson}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download JSON
                    </Button>
                  </div>
                </div>
                <Textarea
                  id="generated_layout_json"
                  value={layoutJson}
                  readOnly
                  className="min-h-[240px] font-mono text-xs"
                  placeholder="Click 'Generate Layout JSON' to inspect tabs and fields."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveConfig} disabled={saving || loading}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save chatbot prompt settings"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => loadConfig(selection)}
                  disabled={saving || loading}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reload
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default function AdminChatbot() {
  return (
    <SessionAuth>
      <AdminChatbotPage />
    </SessionAuth>
  );
}
