import { useState } from 'react';
import { Check, Info, Plus, Target, Trash2 } from 'lucide-react';
import type { BuildGoalMetric, BuildGoalRule, BuildGoalSettings, CustomBuildGoal } from '../../types/Profile';
import {
    BUILD_GOAL_METRICS,
    BUILD_GOAL_PRESETS,
    SUBSTAT_GOAL_METRICS,
    createCustomBuildGoal,
    normalizeBuildGoalSettings,
    resolveBuildGoal,
} from '../../utils/buildGoals';
import { cn } from '../../lib/utils';

export function BuildGoalSelector({ value, onChange, compact = false }: {
    value?: BuildGoalSettings;
    onChange: (settings: BuildGoalSettings) => void;
    compact?: boolean;
}) {
    const settings = normalizeBuildGoalSettings(value);
    const active = resolveBuildGoal(settings);
    const [openInfo, setOpenInfo] = useState<string | null>(null);

    const select = (id: string) => onChange({ ...settings, activeGoalId: id });
    const addCustom = () => {
        const goal = createCustomBuildGoal(settings.customGoals.length + 1);
        onChange({ ...settings, activeGoalId: goal.id, customGoals: [...settings.customGoals, goal] });
    };
    const updateCustom = (goal: CustomBuildGoal) => onChange({
        ...settings,
        customGoals: settings.customGoals.map(item => item.id === goal.id ? goal : item),
    });
    const deleteCustom = (id: string) => onChange({
        ...settings,
        activeGoalId: settings.activeGoalId === id ? 'balanced_late_game' : settings.activeGoalId,
        customGoals: settings.customGoals.filter(goal => goal.id !== id),
    });

    const options = [...BUILD_GOAL_PRESETS, ...settings.customGoals.map(goal => ({
        ...goal,
        shortDescription: goal.description,
        explanation: goal.description || 'Uses the target values, limits, required thresholds, and stat weights below.',
        custom: true,
    }))];

    return (
        <div className="space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                    <div className="flex items-center gap-2 text-sm font-black text-text-primary"><Target className="h-4 w-4 text-accent-primary" /> Build objective</div>
                    <p className="mt-1 text-xs leading-5 text-text-muted">The selected objective controls Swap Test recommendations and companion re-optimization.</p>
                </div>
                <button type="button" onClick={addCustom} className="inline-flex items-center justify-center gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 px-3 py-2 text-xs font-bold text-accent-primary hover:bg-accent-primary/15">
                    <Plus className="h-3.5 w-3.5" /> New custom goal
                </button>
            </div>

            <div className="rounded-xl border border-border bg-bg-primary/25 p-3 sm:flex sm:items-center sm:justify-between">
                <div>
                    <div className="text-sm font-black text-text-primary">Weapon style</div>
                    <p className="mt-1 text-xs leading-5 text-text-muted">This combines with every objective below and guides all swap recommendations.</p>
                </div>
                <div className="mt-3 grid grid-cols-2 rounded-lg border border-border bg-bg-input p-1 sm:mt-0 sm:min-w-64" role="group" aria-label="Weapon style">
                    {(['melee', 'ranged'] as const).map(style => (
                        <button key={style} type="button" aria-pressed={settings.weaponStyle === style} onClick={() => onChange({ ...settings, weaponStyle: style })} className={cn('rounded-md px-4 py-2 text-sm font-bold capitalize transition-colors', settings.weaponStyle === style ? 'bg-accent-primary text-bg-primary shadow' : 'text-text-secondary hover:text-text-primary')}>
                            {style}
                        </button>
                    ))}
                </div>
            </div>

            <div className={cn('grid gap-2', compact ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4')}>
                {options.map(option => {
                    const selected = settings.activeGoalId === option.id;
                    const showingInfo = openInfo === option.id;
                    return (
                        <div key={option.id} className={cn('rounded-xl border p-3 transition-colors', selected ? 'border-accent-primary/60 bg-accent-primary/10' : 'border-border bg-bg-primary/25')}>
                            <div className="flex items-start gap-2">
                                <button type="button" onClick={() => select(option.id)} className="min-w-0 flex-1 text-left">
                                    <div className="flex items-center gap-1.5 text-sm font-black text-text-primary">{selected && <Check className="h-3.5 w-3.5 text-emerald-300" />}{option.name}</div>
                                    <div className="mt-1 text-[11px] leading-4 text-text-muted">{option.shortDescription}</div>
                                </button>
                                <button type="button" aria-label={`Explain ${option.name}`} aria-expanded={showingInfo} onClick={() => setOpenInfo(showingInfo ? null : option.id)} className="rounded-md p-1.5 text-text-muted hover:bg-white/5 hover:text-text-primary"><Info className="h-4 w-4" /></button>
                            </div>
                            {showingInfo && (
                                <div className="mt-3 border-t border-border/70 pt-3 text-[11px] leading-5 text-text-secondary">
                                    <p>{option.explanation}</p>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        <span className="rounded-full border border-accent-primary/40 px-2 py-0.5 text-[10px] text-accent-primary capitalize">{settings.weaponStyle} style</span>
                                        {option.rules.filter(rule => !rule.ignored).map(rule => <span key={rule.metric} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted">{BUILD_GOAL_METRICS.find(metric => metric.id === rule.metric)?.label} ×{rule.weight}</span>)}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {active.custom && (() => {
                const custom = settings.customGoals.find(goal => goal.id === active.id);
                return custom ? <CustomGoalEditor goal={custom} onChange={updateCustom} onDelete={() => deleteCustom(custom.id)} /> : null;
            })()}
        </div>
    );
}

function CustomGoalEditor({ goal, onChange, onDelete }: { goal: CustomBuildGoal; onChange: (goal: CustomBuildGoal) => void; onDelete: () => void }) {
    const updateRule = (index: number, updates: Partial<BuildGoalRule>) => onChange({
        ...goal,
        rules: goal.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...updates } : rule),
    });
    const addRule = () => {
        const used = new Set(goal.rules.map(rule => rule.metric));
        const metric = SUBSTAT_GOAL_METRICS.find(item => !used.has(item.id))?.id || 'damage_substat';
        onChange({ ...goal, rules: [...goal.rules, { metric, weight: 1 }] });
    };

    return (
        <div className="rounded-xl border border-violet-400/35 bg-violet-500/5 p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-text-muted">Goal name</span><input value={goal.name} onChange={event => onChange({ ...goal, name: event.target.value })} className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary" /></label>
                    <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-text-muted">What this build is for</span><input value={goal.description} onChange={event => onChange({ ...goal, description: event.target.value })} className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary" /></label>
                </div>
                <button type="button" onClick={onDelete} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete goal</button>
            </div>

            <div className="space-y-2">
                {goal.rules.map((rule, index) => (
                    <div key={`${rule.metric}-${index}`} className={cn('grid gap-2 rounded-lg border border-border/70 bg-bg-primary/25 p-3 md:grid-cols-[1.4fr_0.65fr_0.8fr_0.8fr_0.8fr_auto]', rule.ignored && 'opacity-55')}>
                        <label className="space-y-1"><span className="text-[9px] uppercase tracking-wider text-text-muted">Substat</span><select value={rule.metric} onChange={event => updateRule(index, { metric: event.target.value as BuildGoalMetric })} className="w-full rounded-md border border-border bg-bg-input px-2 py-2 text-xs text-text-primary">{SUBSTAT_GOAL_METRICS.map(metric => <option key={metric.id} value={metric.id}>{metric.label}</option>)}</select></label>
                        <SmallNumber label="Priority" value={rule.weight} min={0} max={5} step={0.25} onChange={weight => updateRule(index, { weight })} />
                        <SmallNumber label="Target" value={rule.target} onChange={target => updateRule(index, { target })} optional />
                        <SmallNumber label="Minimum" value={rule.minimum} onChange={minimum => updateRule(index, { minimum })} optional />
                        <SmallNumber label="Maximum" value={rule.maximum} onChange={maximum => updateRule(index, { maximum })} optional />
                        <div className="flex items-end gap-1">
                            <button type="button" aria-pressed={Boolean(rule.required)} onClick={() => updateRule(index, { required: !rule.required })} className={cn('rounded-md border px-2 py-2 text-[10px] font-bold', rule.required ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-border text-text-muted')}>Required</button>
                            <button type="button" aria-pressed={Boolean(rule.ignored)} onClick={() => updateRule(index, { ignored: !rule.ignored })} className={cn('rounded-md border px-2 py-2 text-[10px] font-bold', rule.ignored ? 'border-red-400/50 bg-red-400/10 text-red-300' : 'border-border text-text-muted')}>Ignore</button>
                            <button type="button" aria-label="Remove rule" onClick={() => onChange({ ...goal, rules: goal.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="rounded-md border border-border p-2 text-text-muted hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-col justify-between gap-2 text-[11px] text-text-muted sm:flex-row sm:items-center">
                <span>Enter displayed percentage targets such as 40 for 40%. A target stops adding value once reached, so swaps can work on the next unfinished goal; required minimums strongly reject swaps that fall short.</span>
                <button type="button" onClick={addRule} disabled={goal.rules.length >= SUBSTAT_GOAL_METRICS.length} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 font-bold text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add substat</button>
            </div>
        </div>
    );
}

function SmallNumber({ label, value, onChange, min = 0, max, step = 0.1, optional = false }: { label: string; value?: number; onChange: (value: number | undefined) => void; min?: number; max?: number; step?: number; optional?: boolean }) {
    return <label className="space-y-1"><span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span><input type="number" min={min} max={max} step={step} value={value ?? ''} placeholder={optional ? '—' : undefined} onChange={event => onChange(event.target.value === '' && optional ? undefined : Math.max(min, Number(event.target.value) || 0))} className="w-full rounded-md border border-border bg-bg-input px-2 py-2 text-xs text-text-primary" /></label>;
}
