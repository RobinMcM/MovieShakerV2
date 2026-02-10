import { LayoutDashboard } from "lucide-react";

export default function Dashboard() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
            <div className="text-center">
                <LayoutDashboard className="mx-auto h-16 w-16 text-slate-700" />
                <h2 className="mt-4 text-2xl font-bold">Dashboard</h2>
                <p className="text-slate-400">Coming soon...</p>
            </div>
        </div>
    );
}
