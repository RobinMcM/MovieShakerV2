export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type RequestMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface RequestOptions {
    method?: RequestMethod;
    headers?: Record<string, string>;
    body?: unknown;
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

    if (options.body !== undefined) {
        config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
        if (response.status === 401) {
            // Let the component handle unauthorized state via SessionAuth wrapper
        }

        const errorData = await response.json().catch(() => ({ detail: "An unknown error occurred" }));
        const message =
            response.status === 500 && (errorData as { error?: string }).error
                ? `${(errorData as { detail?: string }).detail}: ${(errorData as { error?: string }).error}`
                : (errorData as { detail?: string }).detail || `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    if (response.status === 204) {
        return {} as T;
    }

    return response.json();
}

/** POST multipart/form-data (e.g. file upload). Do not set Content-Type; browser sets boundary. */
export async function apiPostForm<T>(endpoint: string, formData: FormData): Promise<T> {
    const url = `${API_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const response = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Request failed" }));
        const message =
            response.status === 500 && (errorData as { error?: string }).error
                ? `${(errorData as { detail?: string }).detail}: ${(errorData as { error?: string }).error}`
                : (errorData as { detail?: string }).detail || `Request failed with status ${response.status}`;
        throw new Error(message);
    }
    return response.json();
}

/** Build full URL for stored image (moodboard/objects). Paths are served at /api/storage/{path}. */
export function storageImageUrl(pathOrUrl: string | null | undefined): string | null {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith("http")) return pathOrUrl;
    return `${API_URL}/api/storage/${pathOrUrl}`;
}

export const api = {
    get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: "GET" }),
    post: <T>(endpoint: string, body: unknown) => apiRequest<T>(endpoint, { method: "POST", body }),
    put: <T>(endpoint: string, body: unknown) => apiRequest<T>(endpoint, { method: "PUT", body }),
    patch: <T>(endpoint: string, body: unknown) => apiRequest<T>(endpoint, { method: "PATCH", body }),
    delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: "DELETE" }),
    postForm: apiPostForm,
};
