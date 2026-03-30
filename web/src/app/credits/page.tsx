"use client";

import { useEffect, useState } from "react";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { CreditCard, Loader2, Wallet } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

interface ProfileData {
  ai_credits?: number;
}

const QUICK_AMOUNTS = [25, 50, 100];

function CreditsPageContent() {
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [aiCredits, setAiCredits] = useState<number>(0);
  const [purchaseAmount, setPurchaseAmount] = useState("25");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadProfile = async () => {
      try {
        setLoading(true);
        const data = await api.get<ProfileData>("/profile/");
        if (!mounted) return;
        setAiCredits(typeof data.ai_credits === "number" ? data.ai_credits : 0);
      } catch {
        if (!mounted) return;
        setMessage({ kind: "error", text: "Could not load credits balance." });
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  const isDeficit = aiCredits < 0;

  function handleQuickAmount(amount: number) {
    setPurchaseAmount(String(amount));
    setMessage(null);
  }

  async function handleBuyCreditsPlaceholder() {
    const amount = Number.parseInt(purchaseAmount, 10);
    if (!Number.isFinite(amount) || amount <= 10) {
      setMessage({ kind: "error", text: "Minimum credit purchase is greater than 10 credits." });
      return;
    }

    try {
      setBuying(true);
      setMessage(null);
      setMessage({
        kind: "success",
        text: `Checkout is coming soon. Placeholder accepted for ${amount} credits.`,
      });
    } finally {
      setBuying(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <AppHeader />
        <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <div className="flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Credits Management
          </h1>
        </div>

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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Balance</CardTitle>
            <CardDescription>Available credits for AI features across MovieShaker.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <span className="text-sm text-muted-foreground">AI credits</span>
              <span className={`text-xl font-bold ${isDeficit ? "text-destructive" : "text-foreground"}`}>
                {aiCredits}
              </span>
            </div>
            {isDeficit && (
              <p className="mt-3 text-sm text-destructive">
                Your account is in deficit. Please purchase credits to continue AI generation.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Buy Credits</CardTitle>
            <CardDescription>Placeholder flow for upcoming checkout integration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="creditAmount">Credit amount</Label>
              <Input
                id="creditAmount"
                type="number"
                min={11}
                value={purchaseAmount}
                onChange={(e) => setPurchaseAmount(e.target.value)}
                placeholder="Enter credits to buy"
              />
              <p className="text-xs text-muted-foreground">Minimum purchase is greater than 10 credits.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickAmount(amount)}
                >
                  +{amount}
                </Button>
              ))}
            </div>

            <Button type="button" onClick={handleBuyCreditsPlaceholder} disabled={buying} className="w-full sm:w-auto">
              {buying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Buy credits
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Credit Activity</CardTitle>
            <CardDescription>Placeholder transaction history (live data coming soon).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              No transactions yet.
            </div>
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              Activity history API will be connected in a later phase.
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}

export default function CreditsPage() {
  return (
    <SessionAuth>
      <CreditsPageContent />
    </SessionAuth>
  );
}
