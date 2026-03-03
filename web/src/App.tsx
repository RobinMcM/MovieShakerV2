import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SuperTokensWrapper } from "supertokens-auth-react";
import { getSuperTokensRoutesForReactRouterDom } from "supertokens-auth-react/ui";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";
import * as reactRouterDom from "react-router-dom";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { ThemeProvider } from "@/components/theme-provider";

import { initSuperTokens, isSuperTokensReady } from './config/supertokens';
import Landing from './pages/Landing';
import Projects from './pages/Projects';
import Project from './pages/Project';
import Profile from './pages/Profile';
import Users from './pages/Users';

function AuthUnavailable() {
    return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
            <p>Sign in is temporarily unavailable. You can still browse the rest of the site.</p>
        </div>
    );
}

function App() {
    const [, setInitDone] = useState(false);

    useEffect(() => {
        initSuperTokens();
        setInitDone(true);
    }, []);

    const authOk = isSuperTokensReady();

    const publicAndFallbackRoutes = (
        <>
            <Route path="/" element={<Landing />} />
            <Route path="/users" element={<Users />} />
            <Route path="/auth/*" element={<AuthUnavailable />} />
            <Route path="/projects" element={<AuthUnavailable />} />
            <Route path="/project/:projectId" element={<AuthUnavailable />} />
            <Route path="/profile" element={<AuthUnavailable />} />
        </>
    );

    const themeAndRouter = (
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <Router>
                <Routes>
                    {authOk ? (
                        <>
                            {getSuperTokensRoutesForReactRouterDom(reactRouterDom, [EmailPasswordPreBuiltUI])}
                            <Route path="/" element={<Landing />} />
                            <Route path="/users" element={<Users />} />
                            <Route
                                path="/projects"
                                element={
                                    <SessionAuth>
                                        <Projects />
                                    </SessionAuth>
                                }
                            />
                            <Route
                                path="/project/:projectId"
                                element={
                                    <SessionAuth>
                                        <Project />
                                    </SessionAuth>
                                }
                            />
                            <Route
                                path="/profile"
                                element={
                                    <SessionAuth>
                                        <Profile />
                                    </SessionAuth>
                                }
                            />
                        </>
                    ) : (
                        publicAndFallbackRoutes
                    )}
                </Routes>
            </Router>
        </ThemeProvider>
    );

    if (authOk) {
        return <SuperTokensWrapper>{themeAndRouter}</SuperTokensWrapper>;
    }
    return themeAndRouter;
}

export default App;
