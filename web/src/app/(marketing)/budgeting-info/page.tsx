import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, DollarSign, TrendingUp, PieChart, FileSpreadsheet } from "lucide-react";
import budgetingWorkspace from "@/assets/budgeting-workspace.jpg";

export default function BudgetingInfoPage() {
    return (
        <div className="min-h-screen bg-background">
            <section className="relative py-20">
                <div className="container mx-auto px-4">
                    <Link href="/"><Button variant="ghost" className="gap-2 mb-8"><ArrowLeft className="h-4 w-4" />Back</Button></Link>
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Production Budgeting</h1>
                            <p className="text-xl text-muted-foreground mb-8">Master your film production finances with comprehensive budgeting tools designed for professionals.</p>
                        </div>
                        <div className="relative overflow-hidden rounded-lg">
                            <img src={budgetingWorkspace.src} alt="Film production budgeting workspace" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4">
                    <h2 className="text-4xl font-bold text-center mb-12">Comprehensive Budget Management</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="bg-card p-6 rounded-lg border"><DollarSign className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Cost Tracking</h3><p className="text-muted-foreground">Monitor every expense in real-time across all departments.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><TrendingUp className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Budget Forecasting</h3><p className="text-muted-foreground">Project future costs and stay ahead of overruns.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><PieChart className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Resource Allocation</h3><p className="text-muted-foreground">Distribute funds efficiently across departments.</p></div>
                        <div className="bg-card p-6 rounded-lg border"><FileSpreadsheet className="h-12 w-12 text-primary mb-4" /><h3 className="text-xl font-semibold mb-3">Financial Reports</h3><p className="text-muted-foreground">Generate reports for stakeholders and audits.</p></div>
                    </div>
                </div>
            </section>
            <section className="py-20 bg-card/50">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold mb-6">Ready to Take Control of Your Budget?</h2>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">Start managing your production finances with confidence</p>
                    <Link href="/auth"><Button size="lg" className="text-lg px-8">Get Started</Button></Link>
                </div>
            </section>
        </div>
    );
}
