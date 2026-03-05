import SuperTokens from "supertokens-auth-react";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import Session from "supertokens-auth-react/recipe/session";

const apiDomain = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const websiteDomain = process.env.NEXT_PUBLIC_WEBSITE_DOMAIN || "http://localhost:3000";

export const SuperTokensConfig = {
    appInfo: {
        appName: "MovieShaker",
        apiDomain,
        websiteDomain,
        apiBasePath: "/auth",
        websiteBasePath: "/auth",
    },
    getRedirectionURL: async (context: { action: string; newSessionCreated?: boolean; redirectToPath?: string }) => {
        if (context.action !== "SUCCESS" || !context.newSessionCreated) {
            return undefined;
        }
        try {
            const res = await fetch(`${apiDomain}/profile/`, { credentials: "include" });
            if (res.ok) {
                const profile = await res.json();
                if (profile?.role === "admin") {
                    return "/admin/users";
                }
            }
        } catch {
            // fall through to default
        }
        return context.redirectToPath ?? "/projects";
    },
    recipeList: [EmailPassword.init(), Session.init()],
};

let initDone = false;

/**
 * Initialize SuperTokens. Must be called on the client before rendering auth UI.
 * Returns true if init succeeded, false otherwise.
 */
export function initSuperTokens(): boolean {
    if (typeof window === "undefined") return false;
    if (initDone) return true;
    try {
        SuperTokens.init(SuperTokensConfig);
        initDone = true;
        return true;
    } catch (e) {
        console.error("MovieShaker: SuperTokens init failed", e);
        return false;
    }
}

export function isSuperTokensReady(): boolean {
    return initDone;
}
