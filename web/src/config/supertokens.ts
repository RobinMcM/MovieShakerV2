import SuperTokens from "supertokens-auth-react";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import Session from "supertokens-auth-react/recipe/session";

const apiDomain = import.meta.env.VITE_API_URL || "http://localhost:8000";
const websiteDomain = import.meta.env.VITE_WEBSITE_DOMAIN || "http://localhost:5173";

const recipeList = [];
if (typeof EmailPassword?.init === "function") {
    recipeList.push(EmailPassword.init());
}
if (typeof Session?.init === "function") {
    recipeList.push(Session.init());
}

export const SuperTokensConfig = {
    appInfo: {
        appName: "MovieShaker",
        apiDomain,
        websiteDomain,
        apiBasePath: "/auth",
        websiteBasePath: "/auth",
    },
    recipeList,
};

export const initSuperTokens = () => {
    if (typeof window === "undefined") return;
    if (recipeList.length === 0) {
        console.error("MovieShaker: SuperTokens recipes failed to load (EmailPassword/Session undefined). Auth will not work.");
        return;
    }
    SuperTokens.init(SuperTokensConfig);
};
