import { Calculator, Cloud, HelpCircle, ScanLine, ShieldCheck, Sparkles } from 'lucide-react';
import { Card } from '../components/UI/Card';

const helpItems = [
    {
        icon: Calculator,
        title: 'How should I start?',
        text: 'Complete your profile first, including equipment, pets, mount, skills, forge level, and current progression. The calculators reuse those values automatically.',
    },
    {
        icon: Cloud,
        title: 'How is my progress saved?',
        text: 'Sign in with ChatGPT and ForgeMaster saves changes to your account automatically. Each user has separate profiles and private account data.',
    },
    {
        icon: ScanLine,
        title: 'What happens when screenshot scanning fails?',
        text: 'Automatic local OCR runs first. Only after it fails will the correction tool appear so you can select a region and enter the correct value manually.',
    },
    {
        icon: ShieldCheck,
        title: 'What is shared anonymously?',
        text: 'Optional community learning shares only stepping-stone outcomes and corrected scanner field metadata. Screenshots and complete profiles are never shared.',
    },
];

export default function FAQ() {
    return (
        <div className="mx-auto max-w-5xl space-y-8 pb-16 animate-fade-in">
            <header className="flex items-center gap-4 border-b border-border pb-6">
                <div className="rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-3">
                    <HelpCircle className="h-8 w-8 text-accent-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-black text-text-primary">Help &amp; About</h1>
                    <p className="mt-1 text-text-muted">Quick answers for using ForgeMaster.</p>
                </div>
            </header>

            <Card className="overflow-hidden border-accent-primary/25 bg-gradient-to-br from-accent-primary/10 to-transparent p-6 sm:p-8">
                <div className="flex items-start gap-4">
                    <Sparkles className="mt-1 h-6 w-6 shrink-0 text-amber-300" />
                    <div>
                        <h2 className="text-xl font-black text-text-primary">Built for practical Forge Master decisions</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
                            ForgeMaster brings your build, progression, comparison tools, and game configuration data together in one account. Recommendations are estimates based on the profile values and calculation options you select.
                        </p>
                    </div>
                </div>
            </Card>

            <section className="grid gap-4 md:grid-cols-2">
                {helpItems.map(item => {
                    const Icon = item.icon;
                    return (
                        <Card key={item.title} className="p-5">
                            <div className="flex items-start gap-3">
                                <div className="rounded-xl bg-bg-input p-2 text-accent-primary"><Icon className="h-5 w-5" /></div>
                                <div>
                                    <h2 className="font-black text-text-primary">{item.title}</h2>
                                    <p className="mt-2 text-sm leading-6 text-text-secondary">{item.text}</p>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </section>

            <div className="rounded-xl border border-border bg-bg-secondary/30 p-4 text-center text-xs leading-5 text-text-muted">
                ForgeMaster is an independent fan-made companion and is not affiliated with the game’s publisher.
            </div>
        </div>
    );
}
