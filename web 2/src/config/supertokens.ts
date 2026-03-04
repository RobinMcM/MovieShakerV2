import SuperTokens from "supertokens-auth-react";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import Session from "supertokens-auth-react/recipe/session";

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
    recipeList: [EmailPassword.init(), Session.init()],
};

let initDone = false;

/**
 * Initialize SuperTokens. Must be called before rendering app.
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
