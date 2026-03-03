"use client";

import { useEffect, useState } from "react";
import { SuperTokensWrapper } from "supertokens-auth-react";
import { initSuperTokens, isSuperTokensReady } from "@/config/supertokens";
import { AuthReadyProvider } from "@/contexts/AuthReadyContext";

export function SupertokensProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        initSuperTokens();
        setReady(isSuperTokensReady());
    }, []);

    return (
        <AuthReadyProvider value={ready}>
            {ready ? <SuperTokensWrapper>{children}</SuperTokensWrapper> : children}
        </AuthReadyProvider>
    );
}
