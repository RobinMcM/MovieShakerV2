const apiDomain = import.meta.env.VITE_API_URL || "http://localhost:8000";
const websiteDomain = import.meta.env.VITE_WEBSITE_DOMAIN || "http://localhost:5173";

export const SuperTokensConfig = {
    appInfo: {
        appName: "MovieShaker",
        apiDomain,
        websiteDomain,
        apiBasePath: "/auth",
        websiteBasePath: "/auth",
    },
    recipeList: [] as unknown[],
};

/**
 * Initialize SuperTokens using dynamic imports so the production bundle
 * loads the module before calling init (avoids "undefined.init" when chunking breaks static imports).
 */
export async function initSuperTokens(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
        const [SuperTokensMod, EmailPasswordMod, SessionMod] = await Promise.all([
            import("supertokens-auth-react"),
            import("supertokens-auth-react/recipe/emailpassword"),
            import("supertokens-auth-react/recipe/session"),
        ]);
        const SuperTokens = SuperTokensMod.default;
        const EmailPassword = EmailPasswordMod.default;
        const Session = SessionMod.default;
        if (!SuperTokens?.init) {
            console.error("MovieShaker: SuperTokens.init is not available.");
            return;
        }
        const recipeList: ReturnType<typeof EmailPassword.init>[] = [];
        if (typeof EmailPassword?.init === "function") recipeList.push(EmailPassword.init());
        if (typeof Session?.init === "function") recipeList.push(Session.init());
        if (recipeList.length === 0) {
            console.error("MovieShaker: SuperTokens recipes (EmailPassword/Session) failed to load. Auth will not work.");
            return;
        }
        SuperTokens.init({
            ...SuperTokensConfig,
            recipeList: recipeList as Parameters<typeof SuperTokens.init>[0]["recipeList"],
        });
    } catch (e) {
        console.error("MovieShaker: SuperTokens init failed", e);
    }
}
