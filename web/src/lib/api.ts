const API_URL = "http://localhost:8000";

type RequestMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface RequestOptions {
    method?: RequestMethod;
    headers?: Record<string, string>;
    body?: any;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    const config: RequestInit = {
        method: options.method || "GET",
        headers,
        credentials: "include", // Critical for SuperTokens cookies
    };

    if (options.body) {
        config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
        // Handle auth errors (401) potentially by redirecting or letting the UI handle it
        if (response.status === 401) {
            // Optional: window.location.href = "/auth"; 
            // Better to let the component handle unauthorized state via SessionAuth wrapper
        }

        const errorData = await response.json().catch(() => ({ detail: "An unknown error occurred" }));
        const message =
            response.status === 500 && errorData.error
                ? `${errorData.detail}: ${errorData.error}`
                : errorData.detail || `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return {} as T;
    }

    return response.json();
}

export const api = {
    get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: "GET" }),
    post: <T>(endpoint: string, body: any) => apiRequest<T>(endpoint, { method: "POST", body }),
    put: <T>(endpoint: string, body: any) => apiRequest<T>(endpoint, { method: "PUT", body }),
    delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: "DELETE" }),
};
