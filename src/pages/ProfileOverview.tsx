import { Link } from 'react-router-dom';
import {
    ArrowRight,
    CheckCircle2,
    Cloud,
    Heart,
    Pencil,
    ShieldCheck,
    Sparkles,
    Swords,
    Target,
    TrendingUp,
    Trophy,
    Users,
    Wand2,
    Zap,
} from 'lucide-react';
import { useProfile } from '../context/ProfileContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useGlobalStats } from '../hooks/useGlobalStats';
import { useSkinSets } from '../hooks/useSkinSets';
import { useGameData } from '../hooks/useGameData';
import { getPerfection } from '../utils/itemCalculations';
import { formatCompactNumber } from '../utils/statsCalculator';
import { ProfileIcon } from '../components/Profile/ProfileHeaderPanel';
import { BuildAnalytics } from '../components/Profile/BuildAnalytics';

const SLOT_LABELS: Record<string, string> = {
    Weapon: 'Weapon', Helmet: 'Helmet', Body: 'Armour', Gloves: 'Gloves',
    Belt: 'Belt', Necklace: 'Necklace', Ring: 'Ring', Shoe: 'Shoes',
};

export default function ProfileOverview() {
    const { profile } = useProfile();
    const account = useCloudSync();
    const stats = useGlobalStats(false);
    const { sets } = useSkinSets();
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');

    const equipment = Object.entries(profile.items);
    const equippedCount = equipment.filter(([, item]) => Boolean(item)).length;
    const weakestItem = equipment
        .map(([slot, item]) => ({ slot, item, perfection: item ? getPerfection(item, secondaryStatLibrary) : null }))
        .filter(entry => entry.item && entry.perfection !== null)
        .sort((a, b) => (a.perfection ?? 101) - (b.perfection ?? 101))[0];
    const averagePerfectionValues = equipment
        .map(([, item]) => item ? getPerfection(item, secondaryStatLibrary) : null)
        .filter((value): value is number => value !== null);
    const averagePerfection = averagePerfectionValues.length
        ? averagePerfectionValues.reduce((sum, value) => sum + value, 0) / averagePerfectionValues.length
        : null;

    const tracker = profile.misc.steppingStones;
    const attempts = tracker?.attempts ?? [];
    const currentAttempt = attempts.find(attempt => attempt.id === tracker?.currentAttemptId);
    const safeStones = currentAttempt?.entries.filter(entry => entry.outcome === 'safe').length ?? 0;
    const targetStones = tracker?.targetStones ?? 10;
    const bestSet = sets[0];

    const readinessPoints = equippedCount
        + Math.min(3, profile.pets.active.length)
        + Math.min(3, profile.skills.equipped.length)
        + (profile.mount.active ? 1 : 0);
    const readiness = Math.round((readinessPoints / 15) * 100);

    const recommendation = getRecommendation({
        equippedCount,
        weakestSlot: weakestItem?.slot,
        weakestPerfection: weakestItem?.perfection,
        activePets: profile.pets.active.length,
        activeSkills: profile.skills.equipped.length,
        hasMount: Boolean(profile.mount.active),
        hasStoneRun: Boolean(currentAttempt),
    });

    const accountStatus = {
        connecting: 'Connecting…', saving: 'Saving…', saved: 'Saved',
        offline: 'Safe on this device', error: 'Sync needs attention',
    }[account.status];

    return (
        <div className="mx-auto max-w-[96rem] space-y-6 px-1 pb-14 animate-fade-in sm:px-3">
            <section className="relative overflow-hidden rounded-3xl border border-accent-primary/25 bg-gradient-to-br from-bg-secondary via-bg-secondary to-cyan-950/35 p-5 shadow-2xl sm:p-7">
                <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-primary/10 blur-3xl" />
                <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
                    <div className="flex items-center gap-4 sm:gap-5">
                        <ProfileIcon iconIndex={profile.iconIndex} size={72} className="shadow-xl" />
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-accent-primary">ForgeMaster overview</p>
                            <h1 className="mt-1 text-3xl font-black text-text-primary sm:text-4xl">Welcome back, {profile.name}</h1>
                            <p className="mt-2 text-sm text-text-muted sm:text-base">
                                Forge level {profile.misc.forgeLevel + 1} · {readiness}% loadout readiness
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Link to="/profile" className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-5 py-3 font-bold text-white shadow-lg transition hover:brightness-110">
                            <Pencil className="h-4 w-4" /> Edit profile
                        </Link>
                        <Link to="/progress-prediction" className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-primary/60 px-5 py-3 font-bold text-text-primary transition hover:border-accent-primary/50">
                            <TrendingUp className="h-4 w-4" /> Predict progress
                        </Link>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Total power" value={stats ? formatCompactNumber(stats.power) : '—'} icon={<Zap className="h-5 w-5" />} color="text-purple-300" />
                <StatCard label="Damage" value={stats ? formatCompactNumber(stats.totalDamage) : '—'} icon={<Swords className="h-5 w-5" />} color="text-red-300" />
                <StatCard label="Health" value={stats ? formatCompactNumber(stats.totalHealth) : '—'} icon={<Heart className="h-5 w-5" />} color="text-emerald-300" />
                <StatCard label="Real-time DPS" value={stats ? formatCompactNumber(stats.realTotalDps) : '—'} icon={<Sparkles className="h-5 w-5" />} color="text-cyan-300" />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
                <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/35 to-bg-secondary p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                        <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300"><Wand2 className="h-7 w-7" /></div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-400">What to work on next</p>
                            <h2 className="mt-2 text-2xl font-black text-white">{recommendation.title}</h2>
                            <p className="mt-2 leading-6 text-slate-300">{recommendation.description}</p>
                            <Link to={recommendation.path} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 font-black text-amber-950 transition hover:bg-amber-300">
                                {recommendation.action} <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-bg-secondary p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Profile readiness</p>
                            <p className="mt-1 text-3xl font-black text-white">{readiness}%</p>
                        </div>
                        <div className="rounded-full border-4 border-cyan-500/30 p-3 text-cyan-300"><ShieldCheck className="h-7 w-7" /></div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-input">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all" style={{ width: `${readiness}%` }} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                        <MiniMetric value={`${equippedCount}/8`} label="Gear" />
                        <MiniMetric value={`${profile.pets.active.length}/3`} label="Pets" />
                        <MiniMetric value={`${profile.skills.equipped.length}/3`} label="Skills" />
                    </div>
                </div>
            </section>

            <BuildAnalytics profile={profile} stats={stats} />

            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                <OverviewCard title="Equipment" icon={<Trophy className="h-5 w-5 text-amber-300" />} action="Edit gear" path="/profile">
                    <div className="grid grid-cols-2 gap-3">
                        <MiniMetric value={`${equippedCount}/8`} label="Slots equipped" />
                        <MiniMetric value={averagePerfection === null ? '—' : `${Math.round(averagePerfection)}%`} label="Avg. perfection" />
                    </div>
                    <p className="mt-4 text-sm text-text-muted">
                        {weakestItem
                            ? `${SLOT_LABELS[weakestItem.slot]} is your weakest rolled piece at ${Math.round(weakestItem.perfection ?? 0)}% perfection.`
                            : equippedCount < 8 ? 'Fill your empty equipment slots to strengthen the build.' : 'Add secondary stats to compare item perfection.'}
                    </p>
                </OverviewCard>

                <OverviewCard title="Active lineup" icon={<Users className="h-5 w-5 text-violet-300" />} action="Manage lineup" path="/profile">
                    <div className="space-y-3">
                        <ProgressRow label="Pets" value={profile.pets.active.length} max={3} />
                        <ProgressRow label="Skills" value={profile.skills.equipped.length} max={3} />
                        <ProgressRow label="Mount" value={profile.mount.active ? 1 : 0} max={1} />
                    </div>
                </OverviewCard>

                <OverviewCard title="Skin sets" icon={<Sparkles className="h-5 w-5 text-pink-300" />} action="Browse skins" path="/skins">
                    {bestSet ? (
                        <>
                            <p className="text-lg font-bold text-white">{bestSet.setId.replace(/Set$/, '')}</p>
                            <p className="mt-1 text-sm text-text-muted">{bestSet.equippedCount} of {bestSet.totalPieces} pieces equipped</p>
                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-input">
                                <div className="h-full rounded-full bg-pink-400" style={{ width: `${Math.min(100, bestSet.equippedCount / bestSet.totalPieces * 100)}%` }} />
                            </div>
                        </>
                    ) : <p className="text-sm leading-6 text-text-muted">Equip matching skins to activate your first set bonus.</p>}
                </OverviewCard>

                <OverviewCard title="Stepping Stones" icon={<Target className="h-5 w-5 text-cyan-300" />} action={currentAttempt ? 'Continue run' : 'Open tracker'} path="/calculators/stepping-stones">
                    <div className="grid grid-cols-2 gap-3">
                        <MiniMetric value={`${safeStones}/${targetStones}`} label="Current run" />
                        <MiniMetric value={String(attempts.length)} label="Attempts saved" />
                    </div>
                    <p className="mt-4 text-sm text-text-muted">The tracker can recommend whether to try up or down next.</p>
                </OverviewCard>

                <OverviewCard title="Account saving" icon={<Cloud className="h-5 w-5 text-emerald-300" />} action="View sync" path="/account">
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-3">
                        <CheckCircle2 className={`h-5 w-5 ${account.status === 'saved' ? 'text-emerald-300' : 'text-amber-300'}`} />
                        <div>
                            <p className="font-bold text-white">{accountStatus}</p>
                            <p className="text-xs text-text-muted">Your device safety copy stays on too.</p>
                        </div>
                    </div>
                </OverviewCard>

                <OverviewCard title="Quick tools" icon={<Zap className="h-5 w-5 text-yellow-300" />}>
                    <div className="grid grid-cols-2 gap-2">
                        <QuickLink to="/forge-calculator" label="Forge" />
                        <QuickLink to="/calculators/loadout" label="Loadout" />
                        <QuickLink to="/progress-prediction" label="Progress" />
                        <QuickLink to="/calculators/substats" label="Substats" />
                    </div>
                </OverviewCard>
            </section>
        </div>
    );
}

function getRecommendation(input: {
    equippedCount: number; weakestSlot?: string; weakestPerfection?: number | null;
    activePets: number; activeSkills: number; hasMount: boolean; hasStoneRun: boolean;
}) {
    if (input.equippedCount < 8) return { title: 'Complete your equipment', description: `You still have ${8 - input.equippedCount} empty gear slot${8 - input.equippedCount === 1 ? '' : 's'}. Filling them is the clearest immediate upgrade.`, action: 'Equip missing gear', path: '/profile' };
    if (input.weakestSlot && input.weakestPerfection !== undefined && input.weakestPerfection !== null && input.weakestPerfection < 70) return { title: `Improve your ${SLOT_LABELS[input.weakestSlot]}`, description: `It is currently your weakest secondary-stat roll at ${Math.round(input.weakestPerfection)}% perfection. Compare replacements before spending resources.`, action: 'Compare substats', path: '/calculators/substats' };
    if (input.activePets < 3) return { title: 'Fill your active pet team', description: `You have ${input.activePets} of 3 pet slots filled. A complete team will improve both damage and survivability.`, action: 'Choose pets', path: '/profile' };
    if (input.activeSkills < 3) return { title: 'Equip a complete skill set', description: `You have ${input.activeSkills} of 3 active skills equipped. Fill the remaining slots before fine-tuning the build.`, action: 'Choose skills', path: '/profile' };
    if (!input.hasMount) return { title: 'Choose an active mount', description: 'Your mount slot is empty. Add one to include its stats and skills in every calculation.', action: 'Choose a mount', path: '/profile' };
    if (input.hasStoneRun) return { title: 'Continue your Stepping Stones run', description: 'You have a run in progress. Record the next result and let ForgeMaster update its suggestion.', action: 'Continue tracker', path: '/calculators/stepping-stones' };
    return { title: 'Optimize your complete loadout', description: 'Your core lineup is filled. Run the optimizer to find the strongest combination among your saved pets and mount.', action: 'Open optimizer', path: '/calculators/loadout' };
}

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
    return <div className="rounded-2xl border border-border bg-bg-secondary p-4 sm:p-5"><div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${color}`}>{icon}{label}</div><div className="mt-3 text-2xl font-black text-white sm:text-3xl">{value}</div></div>;
}

function MiniMetric({ value, label }: { value: string; label: string }) {
    return <div className="rounded-xl border border-border/70 bg-bg-primary/50 p-3"><div className="font-black text-white">{value}</div><div className="mt-1 text-[11px] uppercase tracking-wide text-text-muted">{label}</div></div>;
}

function ProgressRow({ label, value, max }: { label: string; value: number; max: number }) {
    return <div><div className="mb-1 flex justify-between text-sm"><span className="text-text-muted">{label}</span><span className="font-bold text-white">{value}/{max}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-bg-input"><div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, value / max * 100)}%` }} /></div></div>;
}

function OverviewCard({ title, icon, action, path, children }: { title: string; icon: React.ReactNode; action?: string; path?: string; children: React.ReactNode }) {
    return <article className="flex min-h-56 flex-col rounded-2xl border border-border bg-bg-secondary p-5 shadow-lg"><div className="mb-5 flex items-center gap-2"><span className="rounded-lg bg-bg-input p-2">{icon}</span><h2 className="text-lg font-black text-white">{title}</h2></div><div className="flex-1">{children}</div>{action && path && <Link to={path} className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-accent-primary hover:text-accent-secondary">{action}<ArrowRight className="h-4 w-4" /></Link>}</article>;
}

function QuickLink({ to, label }: { to: string; label: string }) {
    return <Link to={to} className="flex items-center justify-between rounded-xl border border-border bg-bg-primary/50 px-3 py-3 text-sm font-bold text-text-primary transition hover:border-accent-primary/50 hover:text-accent-primary">{label}<ArrowRight className="h-3.5 w-3.5" /></Link>;
}
