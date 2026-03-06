import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function CookiesPage() {
    return (
        <div className="min-h-screen bg-background">
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Link href="/"><Button variant="ghost" className="gap-2 mb-8"><ArrowLeft className="h-4 w-4" />Back</Button></Link>
                <h1 className="text-4xl font-bold mb-8">Cookie Policy</h1>
                <div className="space-y-6 text-muted-foreground">
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">1. What Are Cookies</h2>
                        <p>Cookies are small text files that are placed on your device when you visit our website. They help us provide you with a better experience by remembering your preferences and understanding how you use our services.</p>
                    </section>
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">2. Types of Cookies We Use</h2>
                        <div className="space-y-4">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground mb-2">Essential Cookies</h3>
                                <p>These cookies are necessary for the website to function properly. They enable core functionality such as security, network management, and accessibility.</p>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-foreground mb-2">Performance Cookies</h3>
                                <p>These cookies collect information about how visitors use our website, such as which pages are visited most often. This helps us improve the website&apos;s performance.</p>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-foreground mb-2">Functionality Cookies</h3>
                                <p>These cookies allow the website to remember choices you make and provide enhanced, more personalized features.</p>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-foreground mb-2">Targeting Cookies</h3>
                                <p>These cookies may be set through our site by our advertising partners to build a profile of your interests and show you relevant advertisements.</p>
                            </div>
                        </div>
                    </section>
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">3. Third-Party Cookies</h2>
                        <p>Some cookies on our website are placed by third-party services. We use these services to analyze website traffic, provide social media features, and deliver targeted advertising.</p>
                    </section>
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">4. How to Control Cookies</h2>
                        <p>You can control and manage cookies in various ways. Most browsers allow you to refuse cookies or delete specific cookies. You can usually find these settings in your browser&apos;s options or preferences menu. Please note that removing or blocking cookies may impact your user experience.</p>
                    </section>
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">5. Cookie Duration</h2>
                        <p>Some cookies are session cookies, which expire when you close your browser. Others are persistent cookies that remain on your device for a set period or until you delete them.</p>
                    </section>
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">6. Updates to This Policy</h2>
                        <p>We may update this Cookie Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons.</p>
                    </section>
                    <section>
                        <h2 className="text-2xl font-semibold text-foreground mb-3">7. Contact Us</h2>
                        <p>If you have any questions about our use of cookies, please contact us through our contact page.</p>
                    </section>
                    <p className="text-sm mt-8"><strong>Last Updated:</strong> January 2025</p>
                </div>
            </div>
        </div>
    );
}
