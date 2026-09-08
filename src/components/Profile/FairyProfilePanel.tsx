import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useProfileStats } from '../../hooks/useProfileStats';
import { calculateFairyBonus, effectiveFairySources, FAIRY_DEFINITIONS, FAIRY_NAMES, normalizeFairySettings, type FairySources } from '../../utils/fairies';

const pct = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)}%`;

export function FairyProfilePanel() {
    const { profile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const stats = useProfileStats();
    const fairy = normalizeFairySettings(profile.misc.fairy);
    const automatic: FairySources = {
        skillDamage: (stats.secondarySkillDamageMulti || 0) * 100,
        skillCooldown: (stats.secondarySkillCooldownMulti || 0) * 100,
        health: (stats.secondaryHealthMulti || 0) * 100,
    };
    const sources = effectiveFairySources(fairy, automatic);
    const activeDefinition = FAIRY_DEFINITIONS[fairy.active];
    const bonus = calculateFairyBonus(fairy.active, fairy.level, sources);
    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${selectedVersion ?? ''}/`;
    const save = (patch: Partial<typeof fairy>) => updateNestedProfile('misc', { fairy: { ...fairy, ...patch } });

    return (
        <section className="rounded-2xl border border-border bg-bg-card/60 p-4 md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <Sparkles className="h-6 w-6 text-accent-primary" />
                    <div>
                        <h2 className="text-xl font-bold text-text-primary">Fairy</h2>
                        <p className="text-sm text-text-secondary">Saved with this profile and included in its calculations.</p>
                    </div>
                </div>
                <Link to="/fairies" className="rounded-lg border border-accent-primary/40 bg-accent-primary/10 px-4 py-2 text-center text-sm font-bold text-accent-primary hover:bg-accent-primary/15">Open upgrade calculator</Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {FAIRY_NAMES.map(name => {
                    const definition = FAIRY_DEFINITIONS[name];
                    const selected = fairy.active === name;
                    return <button key={name} type="button" aria-pressed={selected} onClick={() => save({ active: name })} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-accent-primary bg-accent-primary/10' : 'border-border bg-bg-primary/25 hover:border-accent-primary/40'}`}>
                        <img src={`${textureBase}${definition.texture}`} alt="" className="h-16 w-16 object-contain" />
                        <span><strong className="block text-base text-text-primary">{name}</strong><span className="text-sm text-text-muted">{definition.targetLabel}</span></span>
                    </button>;
                })}
            </div>

            <div className="mt-4 grid gap-4 rounded-xl border border-border bg-bg-primary/25 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label><span className="block text-sm font-semibold text-text-primary">Shared fairy level</span><input type="range" min="1" max="20" value={fairy.level} onChange={event => save({ level: Number(event.target.value) })} className="mt-3 h-3 w-full cursor-pointer appearance-none rounded-lg bg-bg-input accent-accent-primary" /></label>
                <label><span className="block text-sm font-semibold text-text-primary">Level</span><input type="number" min="1" max="20" value={fairy.level} onChange={event => save({ level: Math.min(20, Math.max(1, Number(event.target.value))) })} className="mt-2 w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-base text-text-primary" /></label>
                <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-4 py-2.5 text-sm text-text-secondary"><strong className="block text-lg text-accent-primary">+{pct(bonus)}</strong>{activeDefinition.targetLabel}</div>
            </div>
        </section>
    );
}
