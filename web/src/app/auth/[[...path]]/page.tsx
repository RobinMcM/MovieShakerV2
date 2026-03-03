"use client";

import { useEffect, useState } from "react";
import { redirectToAuth } from "supertokens-auth-react";
import { canHandleRoute, getRoutingComponent } from "supertokens-auth-react/ui";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";

export default function AuthPage() {
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (canHandleRoute([EmailPasswordPreBuiltUI]) === false) {
            redirectToAuth({ redirectBack: false });
        } else {
            setLoaded(true);
        }
    }, []);

    if (!loaded) {
        return null;
    }
    return getRoutingComponent([EmailPasswordPreBuiltUI]);
}
