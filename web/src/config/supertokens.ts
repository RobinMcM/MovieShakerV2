import SuperTokens from "supertokens-auth-react";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import Session from "supertokens-auth-react/recipe/session";

const crudApiDomain = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const authApiDomain = process.env.NEXT_PUBLIC_AUTH_API_URL || crudApiDomain;
const websiteDomain = process.env.NEXT_PUBLIC_WEBSITE_DOMAIN || "http://localhost:3000";

export const SuperTokensConfig = {
    appInfo: {
        appName: "MovieShaker",
        apiDomain: authApiDomain,
        websiteDomain,
        apiBasePath: "/auth",
        websiteBasePath: "/auth",
    },
    getRedirectionURL: async (context: { action: string; newSessionCreated?: boolean; redirectToPath?: string }) => {
        if (context.action !== "SUCCESS" || !context.newSessionCreated) {
            return undefined;
        }
        // Admin check — profile/role stays on the CRUD API.
        try {
            const profileRes = await fetch(`${crudApiDomain}/profile/`, { credentials: "include" });
            if (profileRes.ok) {
                const profile = await profileRes.json();
                if (profile?.role === "admin") {
                    return "/admin/users";
                }
            }
        } catch {
            // fall through
        }
        // Smart redirect: most-recent project → scheduling if current script exists, else scripts.
        try {
            const projectsRes = await fetch(`${crudApiDomain}/projects/`, { credentials: "include" });
            if (projectsRes.ok) {
                const projects = await projectsRes.json();
                if (Array.isArray(projects) && projects.length > 0) {
                    const projectId = projects[0].id as string;
                    try {
                        const scriptsRes = await fetch(`${crudApiDomain}/projects/${projectId}/scripts`, { credentials: "include" });
                        if (scriptsRes.ok) {
                            const scriptsData = await scriptsRes.json();
                            const scripts: Array<{ is_current: boolean }> = scriptsData.scripts ?? [];
                            const hasCurrent = scripts.some((s) => s.is_current);
                            return hasCurrent
                                ? `/project/${projectId}/scheduling`
                                : `/project/${projectId}/scripts`;
                        }
                    } catch {
                        // fall through to project scripts page
                    }
                    return `/project/${projectId}/scripts`;
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
