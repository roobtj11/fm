import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, Crosshair, Droplets, Gauge, Swords } from 'lucide-react';
import type { AggregatedStats } from '../../utils/statEngine';
import type { UserProfile } from '../../types/Profile';

interface BuildAnalyticsProps {
    profile: UserProfile;
    stats: AggregatedStats | null;
}

interface ProgressStat {
    label: string;
    value: number;
    target: number;
    display: string;
    targetDisplay: string;
    tone: 'good' | 'warn' | 'neutral';
}

const AGE_NAMES = ['Primitive', 'Medieval', 'Early-Modern', 'Modern', 'Space', 'Interstellar', 'Multiverse', 'Quantum', 'Underworld', 'Divine'];
const AGE_COLORS = ['#b7b1aa', '#67c7f0', '#53d98a', '#e9d74d', '#ed725f', '#b477e9', '#70e0d7', '#8468ef', '#b47778', '#f7a52b'];
const RARITY_COLORS: Record<string, string> = {
    Common: '#b7b1aa', Rare: '#67c7f0', Epic: '#53d98a', Legendary: '#e9d74d', Ultimate: '#ed725f', Mythic: '#b477e9',
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function BuildAnalytics({ profile, stats }: BuildAnalyticsProps) {
    const [sortByGap, setSortByGap] = useState(true);

    const analytics = useMemo(() => {
        if (!stats) return null;

        const attackSpeedBonus = Math.max(0, stats.attackSpeedMultiplier - 1);
        const weaponBonus = stats.isRangedWeapon ? stats.rangedDamageMultiplier : stats.meleeDamageMultiplier;
        const relevantDamageLabel = stats.isRangedWeapon ? 'Ranged Damage' : 'Melee Damage';
        const progress: ProgressStat[] = [
            { label: 'Critical Chance', value: stats.criticalChance, target: 1, display: pct(stats.criticalChance), targetDisplay: '100%', tone: stats.criticalChance >= 1 ? 'good' : 'warn' },
            { label: 'Critical Damage', value: Math.max(0, stats.criticalDamage - 1), target: 2.5, display: pct(stats.criticalDamage), targetDisplay: '350%', tone: stats.criticalDamage >= 3.5 ? 'good' : 'warn' },
            { label: 'Lifesteal', value: stats.lifeSteal, target: .3, display: pct(stats.lifeSteal), targetDisplay: '30%', tone: stats.lifeSteal >= .3 ? 'good' : 'warn' },
            { label: 'Double Chance', value: stats.doubleDamageChance, target: 1, display: pct(stats.doubleDamageChance), targetDisplay: '100%', tone: stats.doubleDamageChance >= 1 ? 'good' : 'warn' },
            { label: 'Attack Speed', value: attackSpeedBonus, target: 1, display: `+${pct(attackSpeedBonus)}`, targetDisplay: '+100%', tone: attackSpeedBonus >= 1 ? 'good' : 'warn' },
            { label: relevantDamageLabel, value: weaponBonus, target: 1, display: pct(weaponBonus), targetDisplay: '100%', tone: weaponBonus >= 1 ? 'good' : 'neutral' },
        ];

        const damageIndex = Math.max(.01, stats.attackSpeedMultiplier)
            * (1 + Math.min(1, stats.criticalChance) * Math.max(0, stats.criticalDamage - 1))
            * (1 + Math.min(1, stats.doubleDamageChance))
            * (1 + Math.max(0, weaponBonus));
        const sustainIndex = Math.round(Math.min(100, Math.max(0,
            stats.lifeSteal * 100 * stats.attackSpeedMultiplier * (1 + Math.min(1, stats.doubleDamageChance))
        )));

        const baseIndex = damageIndex;
        const gain = (next: { crit?: number; attack?: number; double?: number; weapon?: number }) => {
            const test = Math.max(.01, stats.attackSpeedMultiplier + (next.attack ?? 0))
                * (1 + Math.min(1, stats.criticalChance + (next.crit ?? 0)) * Math.max(0, stats.criticalDamage - 1))
                * (1 + Math.min(1, stats.doubleDamageChance + (next.double ?? 0)))
                * (1 + Math.max(0, weaponBonus + (next.weapon ?? 0)));
            return Math.max(0, (test / baseIndex - 1) * 100);
        };
        const marginal = [
            { label: 'Critical Chance', value: gain({ crit: .1 }) },
            { label: 'Attack Speed', value: gain({ attack: .1 }) },
            { label: relevantDamageLabel, value: gain({ weapon: .1 }) },
            { label: 'Double Chance', value: gain({ double: .1 }) },
            // +10 points are additive to the existing skill multiplier, so the
            // return diminishes as Skill Damage is already stacked.
            { label: 'Skill Damage', value: stats.realTotalDps > 0 ? Math.max(0, stats.skillDps / stats.realTotalDps * (.1 / Math.max(1, stats.skillDamageMultiplier)) * 100) : 0 },
            { label: 'Critical Damage', value: stats.criticalDamage > 1 ? Math.max(0, Math.min(1, stats.criticalChance) * 10 / stats.criticalDamage) : 0 },
        ].sort((a, b) => b.value - a.value);

        const balance = [
            { label: 'Offense', value: Math.min(100, damageIndex / 5 * 100), color: '#fb7134' },
            { label: 'Sustain', value: sustainIndex, color: '#4ade80' },
            { label: 'Crit', value: Math.min(100, stats.criticalChance * 100), color: '#facc15' },
            { label: 'Speed', value: Math.min(100, attackSpeedBonus * 100), color: '#38bdf8' },
            { label: 'Skill', value: stats.realTotalDps > 0 ? Math.min(100, stats.skillDps / stats.realTotalDps * 100) : 0, color: '#a78bfa' },
            { label: 'Defense', value: Math.min(100, (stats.blockChance + stats.healthRegen * 2) * 100), color: '#94a3b8' },
        ];

        const offWeaponStat = stats.isRangedWeapon ? /melee/i : /ranged/i;
        const wastedStats = Object.values(profile.items).flatMap(item => item?.secondaryStats ?? []).filter(stat => offWeaponStat.test(stat.statId));
        const belowQuantum = Object.values(profile.items).filter(item => item && item.age < 7).length;

        return { progress, damageIndex, sustainIndex, marginal, balance, wastedStats, belowQuantum };
    }, [profile.items, stats]);

    if (!analytics || !stats) {
        return <section className="rounded-2xl border border-border bg-bg-secondary p-6 text-sm text-text-muted">Build analytics will appear when your game data finishes loading.</section>;
    }

    const progressRows = sortByGap
        ? [...analytics.progress].sort((a, b) => (1 - a.value / a.target) - (1 - b.value / b.target)).reverse()
        : analytics.progress;
    const maxMarginal = Math.max(1, ...analytics.marginal.map(item => item.value));
    const highestGain = analytics.marginal[0];

    const gearByAge = AGE_NAMES.map((label, age) => ({ label, count: Object.values(profile.items).filter(item => item?.age === age).length, color: AGE_COLORS[age] })).filter(item => item.count > 0);
    const companions = [...profile.pets.active, ...(profile.mount.active ? [profile.mount.active] : [])];
    const companionRarities = Object.keys(RARITY_COLORS).map(label => ({ label, count: companions.filter(item => item.rarity === label).length, color: RARITY_COLORS[label] })).filter(item => item.count > 0);

    return (
        <section className="space-y-5">
            <div className="flex items-center gap-3">
                <h2 className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">Build analytics</h2>
                <div className="h-px flex-1 bg-border" />
            </div>

            <div className="rounded-2xl border border-amber-900/40 bg-[#171411] p-4 shadow-xl sm:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="font-black text-white">Accumulated totals</h3>
                        <p className="mt-1 text-xs text-[#8e8173]">Progress toward practical build targets</p>
                    </div>
                    <button type="button" onClick={() => setSortByGap(value => !value)} className="rounded-lg border border-[#4a4036] bg-[#241f1b] px-3 py-1.5 text-xs font-bold text-[#cfb99e] hover:border-amber-500/50">
                        {sortByGap ? 'Sorted by gap' : 'Default order'}
                    </button>
                </div>
                <div className="divide-y divide-[#2b2520]">
                    {progressRows.map(row => <AnalyticsProgress key={row.label} stat={row} />)}
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[0.72fr_0.72fr_1.25fr]">
                <IndexCard label="Effective damage index" value={`${analytics.damageIndex.toFixed(2)}×`} tone="orange" icon={<Swords className="h-5 w-5" />}>
                    Crit, attack speed, double chance, and your weapon-type bonus combined into one relative score.
                </IndexCard>
                <IndexCard label="Sustain index" value={String(analytics.sustainIndex)} tone="green" icon={<Droplets className="h-5 w-5" />}>
                    Lifesteal amplified by attack speed and double-hit chance. Higher means steadier healing.
                </IndexCard>
                <RadarChart items={analytics.balance} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-[#3b342d] bg-[#211d19] p-5">
                    <h3 className="font-black text-white">Marginal gain — where your next stat pays off</h3>
                    <div className="mt-5 space-y-3">
                        {analytics.marginal.map(item => (
                            <div key={item.label} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-3 text-xs sm:grid-cols-[9rem_1fr_4rem]">
                                <span className="truncate text-[#cfb99e]">{item.label}</span>
                                <div className="h-2 overflow-hidden rounded-full border border-[#463c33] bg-[#100e0c]"><div className="h-full rounded-full bg-gradient-to-r from-orange-700 to-orange-400" style={{ width: `${item.value / maxMarginal * 100}%` }} /></div>
                                <span className="text-right font-black text-orange-400">+{item.value.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                    <p className="mt-4 text-[11px] text-[#796c60]">Estimated damage-index gain from adding +10 percentage points at your current setup.</p>
                </div>

                <div className="rounded-2xl border border-[#3b342d] bg-[#211d19] p-5">
                    <h3 className="font-black text-white">Build distribution</h3>
                    <div className="mt-5 space-y-5">
                        <SegmentedBar label={`Gear (${gearByAge.reduce((sum, item) => sum + item.count, 0)})`} items={gearByAge} />
                        <SegmentedBar label={`Pets & mount (${companions.length})`} items={companionRarities} />
                    </div>
                    <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2">
                        {[...gearByAge, ...companionRarities].map(item => <span key={`${item.label}-${item.color}`} className="inline-flex items-center gap-1.5 text-[11px] text-[#9b8c7d]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>)}
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-[#3b342d] bg-[#211d19] p-5">
                <h3 className="font-black text-white">Path to goal — remaining gap by target</h3>
                <div className="mt-4 space-y-3">
                    {analytics.progress.slice(0, 5).map(row => {
                        const met = row.value >= row.target;
                        const gap = Math.max(0, row.target - row.value);
                        return <div key={row.label} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-xs sm:grid-cols-[9rem_1fr_6rem]"><span className="truncate text-[#cfb99e]">{row.label}</span><div className="h-2 overflow-hidden rounded-full border border-[#463c33] bg-[#100e0c]"><div className={`h-full rounded-full ${met ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${Math.min(100, row.value / row.target * 100)}%` }} /></div><span className={`text-right font-black ${met ? 'text-emerald-400' : 'text-red-400'}`}>{met ? '✓ met' : `−${(gap * 100).toFixed(1)}`}</span></div>;
                    })}
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                {stats.lifeSteal > 0 && <Insight tone="blue" icon={<Droplets className="h-5 w-5" />} title="Lifesteal is amplified">Your {pct(stats.lifeSteal)} lifesteal benefits from {stats.attackSpeedMultiplier.toFixed(2)}× attack speed and double-hit chance.</Insight>}
                {analytics.wastedStats.length > 0 && <Insight tone="red" icon={<AlertTriangle className="h-5 w-5" />} title="Weapon-type stat mismatch">You have {analytics.wastedStats.length} {stats.isRangedWeapon ? 'melee' : 'ranged'}-damage roll{analytics.wastedStats.length === 1 ? '' : 's'} on a {stats.isRangedWeapon ? 'ranged' : 'melee'} weapon. Consider rerolling.</Insight>}
                {analytics.belowQuantum > 0 && <Insight tone="amber" icon={<ArrowUpRight className="h-5 w-5" />} title={`${analytics.belowQuantum} gear piece${analytics.belowQuantum === 1 ? '' : 's'} below Quantum`}>Higher-age equipment can add another secondary-stat slot and improve your base values.</Insight>}
                <Insight tone="green" icon={<Crosshair className="h-5 w-5" />} title="Highest-value next stat">About +10% {highestGain.label} currently gives the largest estimated damage-index gain: +{highestGain.value.toFixed(1)}%.</Insight>
            </div>
        </section>
    );
}

function AnalyticsProgress({ stat }: { stat: ProgressStat }) {
    const met = stat.value >= stat.target;
    const width = Math.min(100, stat.value / stat.target * 100);
    return <div className="grid grid-cols-[7.5rem_1fr_6rem] items-center gap-3 py-4 text-xs sm:grid-cols-[9rem_1fr_8rem]"><div className="flex items-center gap-2 text-[#cfb99e]"><span className={`h-2 w-2 rounded-full ${met ? 'bg-emerald-400' : stat.tone === 'neutral' ? 'bg-stone-400' : 'bg-red-400'}`} />{stat.label}</div><div className="h-2 overflow-hidden rounded-full border border-[#3d352e] bg-[repeating-linear-gradient(135deg,#15120f,#15120f_4px,#211d19_4px,#211d19_7px)]"><div className={`h-full rounded-full ${met ? 'bg-emerald-400' : stat.tone === 'neutral' ? 'bg-stone-400' : 'bg-red-400'}`} style={{ width: `${width}%` }} /></div><div className="text-right"><span className="font-black text-white">{stat.display}</span><span className="text-[#75695e]"> / {stat.targetDisplay}</span></div></div>;
}

function IndexCard({ label, value, tone, icon, children }: { label: string; value: string; tone: 'orange' | 'green'; icon: ReactNode; children: ReactNode }) {
    return <div className="rounded-2xl border border-[#3b342d] bg-[#211d19] p-5"><div className={`flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] ${tone === 'orange' ? 'text-orange-400' : 'text-emerald-400'}`}>{icon}{label}</div><div className={`mt-2 text-4xl font-black ${tone === 'orange' ? 'text-orange-500' : 'text-emerald-400'}`}>{value}</div><p className="mt-2 text-xs leading-5 text-[#ad9b88]">{children}</p></div>;
}

function RadarChart({ items }: { items: { label: string; value: number; color: string }[] }) {
    const radius = 34;
    const goalValues = [78, 68, 76, 62, 66, 52];
    const polygon = (values: number[]) => values.map((value, index) => {
        const angle = (-90 + index * 60) * Math.PI / 180;
        const distance = radius * Math.max(0, Math.min(100, value)) / 100;
        return `${50 + Math.cos(angle) * distance}% ${50 + Math.sin(angle) * distance}%`;
    }).join(', ');
    const buildShape = polygon(items.map(item => item.value));
    const goalShape = polygon(goalValues);
    const labelPositions = [
        'left-1/2 top-0 -translate-x-1/2',
        'right-0 top-[22%]',
        'right-0 bottom-[19%]',
        'bottom-0 left-1/2 -translate-x-1/2',
        'bottom-[19%] left-0',
        'left-0 top-[22%]',
    ];

    return <div className="rounded-2xl border border-[#3b342d] bg-[#211d19] p-5">
        <div className="flex items-center justify-between"><h3 className="font-black text-white">Build balance</h3><Gauge className="h-5 w-5 text-amber-300" /></div>
        <div className="relative mx-auto mt-2 aspect-square w-full max-w-[21rem]" role="img" aria-label={`Build radar: ${items.map(item => `${item.label} ${Math.round(item.value)}`).join(', ')}`}>
            {[100, 75, 50, 25].map(size => <div key={size} className="absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 bg-[#4a4139]" style={{ width: `${size * .68}%`, clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' }}><div className="absolute inset-px bg-[#211d19]" style={{ clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' }} /></div>)}
            {items.map((_, index) => <div key={index} className="absolute left-1/2 top-1/2 h-px w-[34%] origin-left bg-[#4a4139]" style={{ transform: `rotate(${-90 + index * 60}deg)` }} />)}
            <div className="absolute inset-0 bg-amber-400/15" style={{ clipPath: `polygon(${goalShape})` }} />
            {goalValues.map((value, index) => {
                const angle = (-90 + index * 60) * Math.PI / 180;
                const distance = radius * value / 100;
                return <i key={index} className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300" style={{ left: `${50 + Math.cos(angle) * distance}%`, top: `${50 + Math.sin(angle) * distance}%` }} />;
            })}
            <div className="absolute inset-0 bg-orange-500/35 drop-shadow-[0_0_5px_rgba(249,115,22,.75)]" style={{ clipPath: `polygon(${buildShape})` }} />
            {items.map((item, index) => <span key={item.label} className={`absolute text-xs font-bold text-[#cfb99e] ${labelPositions[index]}`}><span className="text-white">{Math.round(item.value)}</span> {item.label}</span>)}
        </div>
        <div className="mt-1 flex justify-center gap-5 text-[11px] text-[#8f806f]"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-orange-500/60" />your build</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-amber-400/30" />goal profile</span></div>
    </div>;
}

function SegmentedBar({ label, items }: { label: string; items: { label: string; count: number; color: string }[] }) {
    const total = items.reduce((sum, item) => sum + item.count, 0);
    return <div><div className="mb-2 text-xs text-[#cfb99e]">{label}</div><div className="flex h-3 overflow-hidden rounded-full bg-[#100e0c]">{total > 0 ? items.map(item => <div key={item.label} title={`${item.label}: ${item.count}`} style={{ width: `${item.count / total * 100}%`, backgroundColor: item.color }} />) : <div className="w-full bg-[#312a24]" />}</div></div>;
}

function Insight({ tone, icon, title, children }: { tone: 'blue' | 'red' | 'amber' | 'green'; icon: ReactNode; title: string; children: ReactNode }) {
    const styles = { blue: 'border-l-sky-400 text-sky-300', red: 'border-l-red-400 text-red-300', amber: 'border-l-amber-400 text-amber-300', green: 'border-l-emerald-400 text-emerald-300' }[tone];
    return <div className={`flex gap-3 rounded-xl border border-[#2f2924] border-l-4 bg-[#1b1815] p-4 ${styles}`}><div className="mt-0.5 shrink-0">{icon}</div><div><h4 className="font-black text-white">{title}</h4><p className="mt-1 text-sm leading-6 text-[#c1ae99]">{children}</p></div></div>;
}
