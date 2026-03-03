import { useEffect, useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface User {
    user_id: string;
    time_joined: number;
    email: string;
    phone_number: string | null;
}

export default function Users() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchUsers() {
            try {
                const response = await fetch("http://localhost:8000/users");
                if (!response.ok) {
                    throw new Error("Failed to fetch users");
                }
                const data = await response.json();
                setUsers(data.users);
            } catch (err) {
                setError(err instanceof Error ? err.message : "An unknown error occurred");
            } finally {
                setLoading(false);
            }
        }

        fetchUsers();
    }, []);

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-6 text-primary">Registered Users</h1>

                {loading && <p>Loading users...</p>}
                {error && <p className="text-destructive">Error: {error}</p>}

                {!loading && !error && (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {users.map((user) => (
                            <Card key={user.user_id} className="bg-card/50 border-white/10">
                                <CardHeader>
                                    <CardTitle className="text-lg font-medium text-foreground">
                                        {user.email || "No Email"}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">ID: {user.user_id}</p>
                                    <p className="text-sm text-muted-foreground">
                                        Joined: {new Date(user.time_joined).toLocaleDateString()}
                                    </p>
                                </CardContent>
                            </Card>
                        ))}

                        {users.length === 0 && (
                            <p className="text-muted-foreground">No users found.</p>
                        )}
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
}
