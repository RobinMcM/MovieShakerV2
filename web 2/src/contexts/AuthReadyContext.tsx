import { createContext, useContext, type ReactNode } from "react";

export const AuthReadyContext = createContext(false);

export function useAuthReady(): boolean {
    return useContext(AuthReadyContext);
}

export function AuthReadyProvider({ children, value }: { children: ReactNode; value: boolean }) {
    return (
        <AuthReadyContext.Provider value={value}>
            {children}
        </AuthReadyContext.Provider>
    );
}
