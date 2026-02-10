import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SuperTokensWrapper } from "supertokens-auth-react";
import { getSuperTokensRoutesForReactRouterDom } from "supertokens-auth-react/ui";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";
import * as reactRouterDom from "react-router-dom";
import { SessionAuth } from "supertokens-auth-react/recipe/session";

import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';

import Users from './pages/Users';

function App() {
    return (
        <SuperTokensWrapper>
            <Router>
                <Routes>
                    {/* SuperTokens Auth Routes (Login, Signup, etc.) */}
                    {getSuperTokensRoutesForReactRouterDom(reactRouterDom, [EmailPasswordPreBuiltUI])}

                    {/* Public Routes */}
                    <Route path="/" element={<Landing />} />
                    <Route path="/users" element={<Users />} />

                    {/* Protected Routes */}
                    <Route
                        path="/dashboard"
                        element={
                            <SessionAuth>
                                <Dashboard />
                            </SessionAuth>
                        }
                    />
                </Routes>
            </Router>
        </SuperTokensWrapper>
    );
}

export default App;
