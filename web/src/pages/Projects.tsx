import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogTrigger, DialogFooter
} from "@/components/ui/dialog";
// Import Lucide icons
import { Loader2, Plus, Pencil, Trash2, Calendar as CalendarIcon, Film, Clapperboard } from "lucide-react";
import { api } from "@/lib/api";

// Types matching Backend
interface Project {
    id: string;
    name: string;
    description?: string;
    status: string;
    start_date?: string;
    end_date?: string;
    director?: string;
    film_type?: string;
    series?: string;
    episode?: string;
    aspect_ratio: string;
    role: string;
}

const statusOptions = [
    { value: "planning", label: "Planning" },
    { value: "pre-production", label: "Pre-Production" },
    { value: "production", label: "Production" },
    { value: "post-production", label: "Post-Production" },
    { value: "distribution", label: "Distribution" },
    { value: "completed", label: "Completed" },
];

const filmTypeOptions = [
    "Feature Film", "Short", "Series", "Documentary", "Commercial", "Music Video"
];

const aspectRatioOptions = ["16:9", "9:16", "2.35:1", "4:3", "1:1"];

export default function Projects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Dialog State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        status: "planning",
        start_date: "",
        end_date: "",
        director: "",
        film_type: "",
        series: "",
        episode: "",
        aspect_ratio: "16:9"
    });

    useEffect(() => {
        fetchProjects();
    }, []);

    async function fetchProjects() {
        try {
            setLoading(true);
            const data = await api.get<Project[]>("/projects/");
            setProjects(data);
            setError(null);
        } catch (err) {
            console.error(err);
            const message = err instanceof Error ? err.message : "Failed to load projects. Please try again.";
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData({
            name: "",
            description: "",
            status: "planning",
            start_date: "",
            end_date: "",
            director: "",
            film_type: "",
            series: "",
            episode: "",
            aspect_ratio: "16:9"
        });
        setApiError(null);
    };

    const handleEditClick = (project: Project) => {
        setEditingId(project.id);
        setFormData({
            name: project.name,
            description: project.description || "",
            status: project.status,
            start_date: project.start_date ? new Date(project.start_date).toISOString().split('T')[0] : "",
            end_date: project.end_date ? new Date(project.end_date).toISOString().split('T')[0] : "",
            director: project.director || "",
            film_type: project.film_type || "",
            series: project.series || "",
            episode: project.episode || "",
            aspect_ratio: project.aspect_ratio || "16:9"
        });
        setIsDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setApiError(null);

        if (!formData.name.trim()) {
            setApiError("Project Name is required");
            return;
        }

        try {
            setIsSaving(true);

            // Prepare payload (convert empty strings to null where appropriate for optional fields)
            const payload: any = { ...formData };
            if (!payload.start_date) delete payload.start_date;
            if (!payload.end_date) delete payload.end_date;

            if (editingId) {
                await api.put<Project>(`/projects/${editingId}`, payload);
            } else {
                await api.post<Project>("/projects/", payload);
            }

            setIsDialogOpen(false);
            resetForm();
            fetchProjects(); // Reload list
        } catch (err) {
            setApiError(err instanceof Error ? err.message : "Failed to save project");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click
        if (!window.confirm("Are you sure you want to delete this project? This cannot be undone.")) return;

        try {
            await api.delete(`/projects/${id}`);
            fetchProjects();
        } catch (err) {
            alert("Failed to delete project");
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8">

                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-primary">My Projects</h1>
                        <p className="text-muted-foreground mt-1">Manage your film and series productions</p>
                    </div>

                    <Dialog open={isDialogOpen} onOpenChange={(open: boolean) => {
                        setIsDialogOpen(open);
                        if (!open) resetForm();
                    }}>
                        <DialogTrigger asChild>
                            <Button size="lg">
                                <Plus className="mr-2 h-4 w-4" /> New Project
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader className="pb-0 text-center sm:text-center">
                                <DialogTitle className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                    {editingId ? "Edit Project" : "Create New Project"}
                                </DialogTitle>
                            </DialogHeader>

                            <form onSubmit={handleSubmit} className="space-y-6 -mt-4 pt-0 pb-4">
                                {apiError && (
                                    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                                        {apiError}
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2 col-span-2">
                                        <Label htmlFor="name">Project Name *</Label>
                                        <Input id="name" name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. The Great Movie" />
                                    </div>

                                    <div className="space-y-2 col-span-2">
                                        <Label htmlFor="description">Description</Label>
                                        <Input id="description" name="description" value={formData.description} onChange={handleInputChange} placeholder="Brief logline or summary" />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="film_type">Film Type</Label>
                                        <select
                                            id="film_type"
                                            name="film_type"
                                            value={formData.film_type}
                                            onChange={handleInputChange}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <option value="">Select Type...</option>
                                            {filmTypeOptions.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="status">Status</Label>
                                        <select
                                            id="status"
                                            name="status"
                                            value={formData.status}
                                            onChange={handleInputChange}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {statusOptions.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="director">Director</Label>
                                        <Input id="director" name="director" value={formData.director} onChange={handleInputChange} placeholder="Director's Name" />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="aspect_ratio">Aspect Ratio</Label>
                                        <select
                                            id="aspect_ratio"
                                            name="aspect_ratio"
                                            value={formData.aspect_ratio}
                                            onChange={handleInputChange}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {aspectRatioOptions.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {formData.film_type === "Series" && (
                                        <>
                                            <div className="space-y-2">
                                                <Label htmlFor="series">Series Name</Label>
                                                <Input id="series" name="series" value={formData.series} onChange={handleInputChange} placeholder="e.g. Season 1" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="episode">Episode</Label>
                                                <Input id="episode" name="episode" value={formData.episode} onChange={handleInputChange} placeholder="e.g. Episode 1" />
                                            </div>
                                        </>
                                    )}

                                    <div className="space-y-2">
                                        <Label htmlFor="start_date">Start Date</Label>
                                        <div className="relative">
                                            <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                id="start_date"
                                                name="start_date"
                                                type="date"
                                                value={formData.start_date}
                                                onChange={handleInputChange}
                                                className="pl-9"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="end_date">End Date</Label>
                                        <div className="relative">
                                            <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                id="end_date"
                                                name="end_date"
                                                type="date"
                                                value={formData.end_date}
                                                onChange={handleInputChange}
                                                className="pl-9"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>Cancel</Button>
                                    <Button type="submit" disabled={isSaving}>
                                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        {editingId ? "Update Project" : "Create Project"}
                                    </Button>
                                </DialogFooter>

                            </form>
                        </DialogContent>
                    </Dialog>
                </div>

                {loading && (
                    <div className="flex justify-center p-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}

                {!loading && !error && projects.length === 0 && (
                    <div className="text-center py-20 border rounded-lg bg-card/50 border-dashed">
                        <Film className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium">No projects yet</h3>
                        <p className="text-muted-foreground mb-6">Start your first production today.</p>
                        <Button onClick={() => setIsDialogOpen(true)} variant="outline">Create Project</Button>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((project) => (
                        <Link key={project.id} to={`/project/${project.id}`} className="block">
                            <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:border-primary/50">
                                <CardHeader className="pb-3">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="line-clamp-1 text-xl">{project.name}</CardTitle>
                                        {project.role === 'owner' && (
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.preventDefault()}>
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleEditClick(project); }}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(project.id, e); }}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    <CardDescription className="line-clamp-2 min-h-[40px]">
                                        {project.description || "No description provided."}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
                                            {project.status}
                                        </span>
                                        {project.film_type && (
                                            <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary hover:bg-primary/20">
                                                {project.film_type}
                                            </span>
                                        )}
                                        <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-muted text-muted-foreground">
                                            {project.role}
                                        </span>
                                    </div>

                                    <div className="space-y-1 text-sm text-muted-foreground">
                                        {project.director && (
                                            <div className="flex items-center gap-2">
                                                <Clapperboard className="h-3 w-3" />
                                                <span>Dir. {project.director}</span>
                                            </div>
                                        )}
                                        {project.start_date && (
                                            <div className="flex items-center gap-2">
                                                <CalendarIcon className="h-3 w-3" />
                                                <span>
                                                    {new Date(project.start_date).toLocaleDateString()}
                                                    {project.end_date ? ` - ${new Date(project.end_date).toLocaleDateString()}` : ''}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>

            </main>
            <Footer />
        </div>
    );
}
