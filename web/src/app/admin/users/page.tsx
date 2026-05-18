"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface UserWithProfile {
    user_id: string;
    email: string;
    time_joined: number;
    phone_number: string | null;
    role: string;
    producer_tier: string;
    blocked: boolean;
}

function AdminUsersPage() {
    const router = useRouter();
    const [users, setUsers] = useState<UserWithProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);

    useEffect(() => {
        fetchUsers();
    }, []);

    async function fetchUsers() {
        try {
            setLoading(true);
            const data = await api.get<UserWithProfile[]>("/admin/users");
            setUsers(Array.isArray(data) ? data : []);
            setError(null);
        } catch (err) {
            if (err instanceof Error && err.message.includes("403")) {
                router.replace("/");
                return;
            }
            setError(err instanceof Error ? err.message : "Failed to load users");
        } finally {
            setLoading(false);
        }
    }

    async function updateUser(
        user_id: string,
        updates: { role?: string; producer_tier?: string; blocked?: boolean }
    ) {
        try {
            setUpdating(user_id);
            await api.patch(`/admin/users/${user_id}`, updates);
            await fetchUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Update failed");
        } finally {
            setUpdating(null);
        }
    }

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-6 text-primary">User Management</h1>
                <p className="text-muted-foreground mb-6">
                    Assign Admin roles, set Producer tier, and block users.
                </p>

                {loading && <p>Loading users...</p>}
                {error && (
                    <p className="text-destructive mb-4">Error: {error}</p>
                )}

                {!loading && !error && (
                    <div className="space-y-4">
                        {users.map((user) => (
                            <Card key={user.user_id} className="bg-card/50">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        {user.email || "No email"}
                                        {user.blocked && (
                                            <span className="text-xs font-normal text-destructive bg-destructive/20 px-2 py-0.5 rounded">
                                                Blocked
                                            </span>
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <p className="text-sm text-muted-foreground">
                                        ID: {user.user_id} · Joined:{" "}
                                        {new Date(user.time_joined).toLocaleDateString()}
                                    </p>
                                    <div className="flex flex-wrap gap-4 items-center">
                                        <div className="flex items-center gap-2">
                                            <label className="text-sm font-medium">Role</label>
                                            <select
                                                value={user.role}
                                                disabled={updating === user.user_id}
                                                onChange={(e) =>
                                                    updateUser(user.user_id, {
                                                        role: e.target.value as "admin" | "producer" | "super_user" | "user",
                                                    })
                                                }
                                                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                                            >
                                                <option value="user">User</option>
                                                <option value="producer">Producer</option>
                                                <option value="admin">Admin</option>
                                                <option value="super_user">Super User</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="text-sm font-medium">Tier</label>
                                            <select
                                                value={user.producer_tier}
                                                disabled={updating === user.user_id}
                                                onChange={(e) =>
                                                    updateUser(user.user_id, {
                                                        producer_tier: e.target
                                                            .value as
                                                            | "standard"
                                                            | "indie"
                                                            | "production_company",
                                                    })
                                                }
                                                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                                            >
                                                <option value="standard">Standard (5 projects)</option>
                                                <option value="indie">Indie (25 projects)</option>
                                                <option value="production_company">
                                                    Production Company
                                                </option>
                                            </select>
                                        </div>
                                        <Button
                                            variant={user.blocked ? "default" : "destructive"}
                                            size="sm"
                                            disabled={updating === user.user_id}
                                            onClick={() =>
                                                updateUser(user.user_id, {
                                                    blocked: !user.blocked,
                                                })
                                            }
                                        >
                                            {user.blocked ? "Unblock" : "Block"}
                                        </Button>
                                    </div>
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

export default function AdminUsers() {
    return (
        <SessionAuth>
            <AdminUsersPage />
        </SessionAuth>
    );
}
