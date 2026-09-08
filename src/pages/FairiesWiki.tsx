import { useMemo } from 'react';
import { Sparkles, Target, Wand2 } from 'lucide-react';
import { Card, CardContent } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { useProfile } from '../context/ProfileContext';
import { calculateFairyBonus, effectiveFairySources, FAIRY_DEFINITIONS, FAIRY_NAMES, normalizeFairySettings, type FairySources } from '../utils/fairies';
import { compareBuildGoal, readBuildGoalMetric, resolveBuildGoal } from '../utils/buildGoals';
import { useProfileOptimizer } from '../hooks/useProfileOptimizer';

interface Price { Amount: number; Currency: string }
interface FairyUpgrade { Level: number; Costs: Price[] }

const CURRENCY: Record<string, { label: string; icon: string }> = {
    Coins: { label: 'Coins', icon: 'Coin' },
    SkillSummonTickets: { label: 'Skill Tickets', icon: 'SkillTicket' },
    Eggshells: { label: 'Eggshells', icon: 'Eggshell' },
    TechPotions: { label: 'Tech Potions', icon: 'Potion' },
    ClockWinders: { label: 'Clock Winders', icon: 'MountKey' },
};

const nf = new Intl.NumberFormat('en-US');
const pct = (value: number) => `${value.toFixed(value % 1 ? 2 : 0)}%`;

export default function FairiesWiki() {
    const { profile, updateNestedProfile } = useProfile();
    const { calculateProfileStats, isReady } = useProfileOptimizer();
    const stats = useMemo(() => calculateProfileStats(profile), [calculateProfileStats, profile]);
    const { selectedVersion } = useGameDataContext();
    const { data: upgrades, loading, error } = useGameData<Record<string, FairyUpgrade>>('FairyUpgradesLibrary.json');
    const fairy = normalizeFairySettings(profile.misc.fairy);

    const automaticSources: FairySources = {
        skillDamage: (stats.secondarySkillDamageMulti || 0) * 100,
        skillCooldown: (stats.secondarySkillCooldownMulti || 0) * 100,
        health: (stats.secondaryHealthMulti || 0) * 100,
    };
    const sources = effectiveFairySources(fairy, automaticSources);
    const goal = resolveBuildGoal(profile.misc.buildGoals);
    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${selectedVersion ?? ''}/`;

    const levels = useMemo(() => Object.values(upgrades || {}).sort((a, b) => a.Level - b.Level), [upgrades]);
    const maxLevel = levels.at(-1)?.Level || 20;
    const currencies = levels[0]?.Costs.map(cost => cost.Currency) || [];
    const costRows = currencies.map(currency => {
        const next = levels.find(entry => entry.Level === fairy.level + 1)?.Costs.find(cost => cost.Currency === currency)?.Amount || 0;
        const level20 = levels.reduce((sum, entry) => sum + (entry.Costs.find(cost => cost.Currency === currency)?.Amount || 0), 0);
        const remaining = levels.filter(entry => entry.Level > fairy.level)
            .reduce((sum, entry) => sum + (entry.Costs.find(cost => cost.Currency === currency)?.Amount || 0), 0);
        return { currency, next, remaining, level20 };
    });

    const goalContext = { enemyHealth: 1, bossHealth: 1, overheadSeconds: 0 };
    const comparison = FAIRY_NAMES.map(name => {
        const definition = FAIRY_DEFINITIONS[name];
        const bonus = calculateFairyBonus(name, fairy.level, sources);
        const nextBonus = calculateFairyBonus(name, Math.min(maxLevel, fairy.level + 1), sources);
        const maxBonus = calculateFairyBonus(name, maxLevel, sources);
        const profileAt = (level: number) => ({
            ...profile,
            misc: { ...profile.misc, fairy: { ...fairy, active: name, level } },
        });
        const currentStats = calculateProfileStats(profileAt(fairy.level));
        const nextStats = calculateProfileStats(profileAt(Math.min(maxLevel, fairy.level + 1)));
        const impact = compareBuildGoal(goal, currentStats, nextStats, goalContext);
        const crossedTargets = goal.rules.filter(rule => {
            const target = rule.target ?? rule.minimum;
            if (!target || rule.ignored) return false;
            return readBuildGoalMetric(currentStats, rule.metric, goalContext) < target
                && readBuildGoalMetric(nextStats, rule.metric, goalContext) >= target;
        });
        return {
            name, definition, bonus, nextGain: Math.max(0, nextBonus - bonus), maxBonus,
            score: impact.afterScore,
            goalChange: impact.changePercent,
            crossedTargets,
            dpsChange: nextStats.realTotalDps - currentStats.realTotalDps,
            hpsChange: nextStats.realTotalHps - currentStats.realTotalHps,
        };
    });
    const bestScore = Math.max(...comparison.map(item => item.score));
    const recommended = bestScore > 0 ? comparison.find(item => item.score === bestScore)?.name : fairy.active;
    const activeImpact = comparison.find(item => item.name === fairy.active)!;
    const importance = fairy.level >= maxLevel ? 'Maximum level'
        : activeImpact.nextGain <= 0.0001 ? 'No gain at current cap'
            : activeImpact.goalChange >= 1 ? 'High priority'
                : activeImpact.goalChange >= 0.1 ? 'Useful upgrade'
                    : activeImpact.goalChange > 0.001 ? 'Small goal impact'
                        : 'Not valued by this goal';
    const goalAdvice = activeImpact.crossedTargets.length
        ? `Review the goal after upgrading: ${activeImpact.crossedTargets.map(rule => rule.metric.replace(/_/g, ' ')).join(', ')} reaches its target.`
        : activeImpact.goalChange > 0.001
            ? `Keep the current goal. This upgrade moves ${goal.name} forward without completing a target.`
            : `Keep your substat goals unchanged. ${fairy.active}'s bonus is separate from rolled substats; switch fairy or goal only if ${FAIRY_DEFINITIONS[fairy.active].targetLabel} matters to the build.`;

    const saveFairy = (patch: Partial<typeof fairy>) => updateNestedProfile('misc', { fairy: { ...fairy, ...patch } });
    const setManualSource = (key: keyof FairySources, value: number) => saveFairy({
        manualSources: { ...fairy.manualSources, [key]: Math.max(0, value || 0) },
    });

    return (
        <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-accent-primary flex items-center gap-2"><Sparkles className="w-7 h-7" /> Fairy Planner</h1>
                <p className="mt-2 text-base text-text-secondary">Compare all three fairies against <strong className="text-text-primary">{goal.name}</strong>. Your selected fairy is saved to the profile and feeds Swap Test, optimizers, simulations, and character totals.</p>
            </div>

            <Card className="border-accent-primary/25">
                <CardContent className="pt-5 space-y-5">
                    <div className="flex flex-col md:flex-row gap-5 md:items-center">
                        <div className="min-w-48">
                            <div className="text-sm uppercase tracking-wide text-text-muted">Shared fairy level</div>
                            <div className="text-2xl font-bold text-text-primary">Level {fairy.level}</div>
                            <div className="text-sm text-text-secondary">Upgrades transfer when you switch.</div>
                        </div>
                        <input aria-label="Fairy level" type="range" min="1" max={maxLevel} value={fairy.level} onChange={event => saveFairy({ level: Number(event.target.value) })} className="flex-1 h-3 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary" />
                        <input aria-label="Fairy level number" type="number" min="1" max={maxLevel} value={fairy.level} onChange={event => saveFairy({ level: Math.min(maxLevel, Math.max(1, Number(event.target.value))) })} className="w-24 rounded-lg border border-border bg-bg-input px-3 py-2 text-base text-text-primary" />
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
                        <div><div className="text-base font-semibold text-text-primary">Source values</div><div className="text-sm text-text-secondary">Read automatically from the active profile.</div></div>
                        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer"><input type="checkbox" checked={fairy.useManualSources || false} onChange={event => saveFairy({ useManualSources: event.target.checked })} /> Manual override</label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {([['skillDamage', 'Skill Damage'], ['skillCooldown', 'Skill Cooldown'], ['health', 'Health']] as [keyof FairySources, string][]).map(([key, label]) => (
                            <label key={key} className="rounded-lg border border-border bg-bg-secondary/50 p-3">
                                <span className="block text-sm text-text-muted">{label}</span>
                                {fairy.useManualSources ? <span className="mt-1 flex items-center gap-2"><input type="number" min="0" step="0.1" value={fairy.manualSources?.[key] ?? automaticSources[key]} onChange={event => setManualSource(key, Number(event.target.value))} className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1.5 text-base text-text-primary" /><span className="text-text-muted">%</span></span> : <strong className="block mt-1 text-lg text-text-primary">{pct(automaticSources[key])}</strong>}
                            </label>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {comparison.map(item => {
                    const selected = fairy.active === item.name;
                    const isRecommended = recommended === item.name;
                    return <Card key={item.name} className={selected ? 'border-accent-primary ring-1 ring-accent-primary/50' : ''}>
                        <CardContent className="pt-5 flex h-full flex-col">
                            <div className="flex items-start justify-between gap-2">
                                <img src={`${textureBase}${item.definition.texture}`} alt={item.name} className="w-24 h-24 object-contain" />
                                <div className="flex flex-col items-end gap-2">{selected && <span className="rounded-full bg-accent-primary/20 px-2.5 py-1 text-xs font-semibold text-accent-primary">Active</span>}{isRecommended && <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-semibold text-green-400">Best for goal</span>}</div>
                            </div>
                            <h2 className="text-xl font-bold text-text-primary">{item.name}</h2>
                            <p className="mt-2 min-h-12 text-sm text-text-secondary">{item.definition.formula}.</p>
                            <div className="mt-4 rounded-lg bg-bg-secondary/70 p-3 space-y-2">
                                <div className="flex justify-between text-sm"><span className="text-text-muted">Current bonus</span><strong className="text-accent-primary">+{pct(item.bonus)} {item.definition.targetLabel}</strong></div>
                                <div className="flex justify-between text-sm"><span className="text-text-muted">Next-level gain</span><strong className="text-green-400">+{pct(item.nextGain)}</strong></div>
                                <div className="flex justify-between text-sm"><span className="text-text-muted">Level {maxLevel}</span><strong className="text-text-primary">+{pct(item.maxBonus)}</strong></div>
                                <div className="flex justify-between text-sm"><span className="text-text-muted">Fairy cap</span><strong className="text-text-primary">{pct(item.definition.cap)}</strong></div>
                            </div>
                            {item.name === 'Lora' && <p className="mt-3 text-xs text-amber-300">Reflect Chance is tracked, but reflected damage is not added to DPS until its damage formula is confirmed.</p>}
                            <button type="button" onClick={() => saveFairy({ active: item.name })} className={`mt-4 w-full rounded-lg px-4 py-2.5 text-base font-semibold ${selected ? 'text-accent-primary border border-accent-primary/40 bg-accent-primary/10' : 'bg-accent-primary text-bg-primary hover:opacity-90'}`}>{selected ? `${item.name} is active` : `Use ${item.name}`}</button>
                        </CardContent>
                    </Card>;
                })}
            </div>

            <Card className="border-violet-400/30 bg-violet-500/5">
                <CardContent className="pt-5 space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div><h2 className="text-lg font-bold text-text-primary">Is the next fairy upgrade important?</h2><p className="mt-1 text-sm text-text-secondary">Calculated through the same complete stat engine and active goal used by Swap Test.</p></div>
                        <span className="rounded-full border border-violet-400/40 bg-violet-400/10 px-3 py-1.5 text-sm font-bold text-violet-300">{isReady ? importance : 'Loading profile data'}</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[680px] text-sm">
                            <thead><tr className="border-b border-border text-text-muted"><th className="pb-2 text-left font-medium">Fairy at next level</th><th className="pb-2 text-right font-medium">Bonus change</th><th className="pb-2 text-right font-medium">Goal score</th><th className="pb-2 text-right font-medium">Real DPS</th><th className="pb-2 text-right font-medium">Real HPS</th></tr></thead>
                            <tbody>{comparison.map(item => <tr key={item.name} className={`border-b border-border/40 last:border-0 ${item.name === fairy.active ? 'bg-accent-primary/5' : ''}`}>
                                <td className="py-2.5"><span className="flex items-center gap-2"><img src={`${textureBase}${item.definition.texture}`} alt="" className="h-9 w-9 object-contain" /><span><strong className="text-text-primary">{item.name}</strong>{item.name === recommended && <span className="ml-2 text-xs font-bold text-green-400">best fit</span>}</span></span></td>
                                <td className="py-2.5 text-right font-semibold text-text-primary">+{pct(item.nextGain)} {item.definition.targetLabel}</td>
                                <td className={`py-2.5 text-right font-semibold ${item.goalChange > 0.001 ? 'text-green-400' : 'text-text-muted'}`}>{item.goalChange > 0.001 ? '+' : ''}{item.goalChange.toFixed(3)}%</td>
                                <td className={`py-2.5 text-right ${item.dpsChange > 0 ? 'text-green-400' : 'text-text-muted'}`}>{item.dpsChange > 0 ? '+' : ''}{nf.format(Math.round(item.dpsChange))}</td>
                                <td className={`py-2.5 text-right ${item.hpsChange > 0 ? 'text-green-400' : 'text-text-muted'}`}>{item.hpsChange > 0 ? '+' : ''}{nf.format(Math.round(item.hpsChange))}</td>
                            </tr>)}</tbody>
                        </table>
                    </div>
                    <div className="rounded-lg border border-border bg-bg-primary/35 p-3"><div className="text-sm font-bold text-text-primary">Goal recommendation</div><p className="mt-1 text-sm text-text-secondary">{goalAdvice}</p></div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="pt-5">
                    <h2 className="text-lg font-bold text-text-primary flex items-center gap-2"><Target className="w-5 h-5 text-accent-primary" /> Upgrade costs</h2>
                    <p className="mt-1 text-sm text-text-secondary">Choose one currency for each upgrade. These are alternatives, not a combined bill.</p>
                    {loading && <p className="mt-4 text-sm text-text-secondary">Loading costs…</p>}
                    {error && <p className="mt-4 text-sm text-red-400">Cost data is unavailable.</p>}
                    {!!costRows.length && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
                        <thead><tr className="border-b border-border text-text-muted"><th className="pb-2 text-left font-medium">Currency</th><th className="pb-2 text-right font-medium">Next level</th><th className="pb-2 text-right font-medium">Remaining to 20</th><th className="pb-2 text-right font-medium">Level 1 → 20</th></tr></thead>
                        <tbody>{costRows.map(row => { const meta = CURRENCY[row.currency]; return <tr key={row.currency} className="border-b border-border/40 last:border-0"><td className="py-2.5"><span className="flex items-center gap-2">{meta && <GameIcon name={meta.icon} size={20} />}<span className="text-text-primary">{meta?.label || row.currency}</span></span></td><td className="py-2.5 text-right tabular-nums text-text-secondary">{row.next ? nf.format(row.next) : 'Max'}</td><td className="py-2.5 text-right tabular-nums text-text-primary">{nf.format(row.remaining)}</td><td className="py-2.5 text-right tabular-nums font-semibold text-text-primary">{nf.format(row.level20)}</td></tr>; })}</tbody>
                    </table></div>}
                </CardContent>
            </Card>

            <Card className="border-amber-500/25 bg-amber-500/5"><CardContent className="pt-4 flex gap-3"><Wand2 className="w-5 h-5 shrink-0 text-amber-300" /><p className="text-sm text-text-secondary">The level-one effects and caps come from your game screenshots. The per-level increase is inferred from Mira’s green +1% value and applied proportionally to all three fairies, as confirmed; it can be corrected when a higher-level screenshot or game config exposes the exact values.</p></CardContent></Card>
        </div>
    );
}
