import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SuperTokensWrapper } from "supertokens-auth-react";
import { getSuperTokensRoutesForReactRouterDom } from "supertokens-auth-react/ui";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";
import * as reactRouterDom from "react-router-dom";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { ThemeProvider } from "@/components/theme-provider";

import Landing from './pages/Landing';
import Projects from './pages/Projects';
import Profile from './pages/Profile';
import Users from './pages/Users';

function App() {
    return (
        <SuperTokensWrapper>
            <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
                <Router>
                    <Routes>
                        {/* SuperTokens Auth Routes (Login, Signup, etc.) */}
                        {getSuperTokensRoutesForReactRouterDom(reactRouterDom, [EmailPasswordPreBuiltUI])}

                        {/* Public Routes */}
                        <Route path="/" element={<Landing />} />
                        <Route path="/users" element={<Users />} />

                        {/* Protected Routes */}
                        <Route
                            path="/projects"
                            element={
                                <SessionAuth>
                                    <Projects />
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
                    </Routes>
                </Router>
            </ThemeProvider>
        </SuperTokensWrapper>
    );
}

export default App;
