import { memo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../UI/Button';
import { X, Zap, Heart, Swords, Shield, Star, TrendingUp, Crosshair, Activity } from 'lucide-react';
import { formatNumber } from '../../utils/format';
import { formatPercent, formatMultiplier } from '../../utils/statsCalculator';
import { ComparisonStatRow } from './StatsSummaryPanel';
import { ExpandedLoadout } from '../../hooks/useLoadoutSweep';

interface LoadoutComparisonModalProps {
    isOpen: boolean;
    onClose: () => void;
    current: ExpandedLoadout;
    proposed: ExpandedLoadout;
}

const ModalContent = memo(({ current, proposed, onClose }: Omit<LoadoutComparisonModalProps, 'isOpen'>) => {
    const cur = current.calcStats;
    const pro = proposed.calcStats;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4" onClick={onClose}>
            <div
                className="bg-bg-primary w-full max-w-[calc(100vw-1rem)] md:max-w-xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-5 border-b border-border bg-bg-secondary/40">
                    <h3 className="text-xl md:text-2xl font-bold text-white tracking-tight">Current &rarr; Proposed</h3>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-2 custom-scrollbar">
                    {/* Headline metrics */}
                    <ComparisonStatRow variant="minimal" icon={<Zap className="w-4 h-4" />} label="DPS"
                        originalValue={current.dps} testValue={proposed.dps}
                        formatFn={formatNumber} color="text-orange-400" />
                    <ComparisonStatRow variant="minimal" icon={<Heart className="w-4 h-4" />} label="Lifesteal/sec"
                        originalValue={current.lifestealPerSec} testValue={proposed.lifestealPerSec}
                        formatFn={formatNumber} color="text-purple-400" />
                    <ComparisonStatRow variant="minimal" icon={<Activity className="w-4 h-4" />} label="HPS"
                        originalValue={current.healPerSec} testValue={proposed.healPerSec}
                        formatFn={formatNumber} color="text-emerald-400" />
                    <ComparisonStatRow variant="minimal" icon={<Swords className="w-4 h-4" />} label="Shown Dmg"
                        originalValue={current.shownDmg} testValue={proposed.shownDmg}
                        formatFn={formatNumber} color="text-red-400" />
                    <ComparisonStatRow variant="minimal" icon={<Swords className="w-4 h-4" />} label="Calculated Dmg"
                        originalValue={current.calcDmg} testValue={proposed.calcDmg}
                        formatFn={formatNumber} color="text-red-400" />
                    <ComparisonStatRow variant="minimal" icon={<Heart className="w-4 h-4" />} label="Shown HP"
                        originalValue={current.shownHp} testValue={proposed.shownHp}
                        formatFn={formatNumber} color="text-green-400" />
                    <ComparisonStatRow variant="minimal" icon={<Heart className="w-4 h-4" />} label="Calculated HP"
                        originalValue={current.calcHp} testValue={proposed.calcHp}
                        formatFn={formatNumber} color="text-green-400" />

                    <div className="h-px bg-border my-3" />

                    {/* Underlying stats */}
                    <ComparisonStatRow variant="minimal" icon={<Star className="w-4 h-4" />} label="Crit chance"
                        originalValue={cur.criticalChance || 0} testValue={pro.criticalChance || 0}
                        formatFn={formatPercent} color="text-yellow-400" />
                    <ComparisonStatRow variant="minimal" icon={<TrendingUp className="w-4 h-4" />} label="Crit damage"
                        originalValue={cur.criticalDamage || 0} testValue={pro.criticalDamage || 0}
                        formatFn={formatMultiplier} color="text-yellow-500" />
                    <ComparisonStatRow variant="minimal" icon={<Heart className="w-4 h-4" />} label="Lifesteal"
                        originalValue={cur.lifeSteal || 0} testValue={pro.lifeSteal || 0}
                        formatFn={formatPercent} color="text-purple-400" />
                    <ComparisonStatRow variant="minimal" icon={<Zap className="w-4 h-4" />} label="Double chance"
                        originalValue={cur.doubleDamageChance || 0} testValue={pro.doubleDamageChance || 0}
                        formatFn={formatPercent} color="text-purple-400" />
                    <ComparisonStatRow variant="minimal" icon={<Shield className="w-4 h-4" />} label="Block chance"
                        originalValue={cur.blockChance || 0} testValue={pro.blockChance || 0}
                        formatFn={formatPercent} color="text-blue-400" />
                    <ComparisonStatRow variant="minimal" icon={<Shield className="w-4 h-4" />} label="Reflect chance"
                        originalValue={cur.reflectChance || 0} testValue={pro.reflectChance || 0}
                        formatFn={formatPercent} color="text-cyan-400" />
                    <ComparisonStatRow variant="minimal" icon={<Swords className="w-4 h-4" />} label="Damage"
                        originalValue={cur.secondaryDamageMulti || 0} testValue={pro.secondaryDamageMulti || 0}
                        formatFn={formatPercent} color="text-red-400" />
                    <ComparisonStatRow variant="minimal" icon={<Crosshair className="w-4 h-4" />} label="Ranged Dmg"
                        originalValue={cur.rangedDamageMultiplier || 0} testValue={pro.rangedDamageMultiplier || 0}
                        formatFn={formatPercent} color="text-sky-400" />
                    <ComparisonStatRow variant="minimal" icon={<TrendingUp className="w-4 h-4" />} label="Attack speed"
                        originalValue={cur.attackSpeedMultiplier || 0} testValue={pro.attackSpeedMultiplier || 0}
                        formatFn={formatMultiplier} color="text-orange-400" />
                    <ComparisonStatRow variant="minimal" icon={<TrendingUp className="w-4 h-4" />} label="Skill cooldown"
                        originalValue={cur.skillCooldownReduction || 0} testValue={pro.skillCooldownReduction || 0}
                        formatFn={formatPercent} color="text-emerald-400" />
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-bg-secondary flex justify-end">
                    <Button onClick={onClose} variant="ghost" className="px-8 text-accent-primary hover:text-accent-primary">Close</Button>
                </div>
            </div>
        </div>
    );
});

ModalContent.displayName = 'LoadoutComparisonModalContent';

export const LoadoutComparisonModal = memo(({ isOpen, onClose, current, proposed }: LoadoutComparisonModalProps) => {
    if (!isOpen) return null;

    return createPortal(
        <ModalContent current={current} proposed={proposed} onClose={onClose} />,
        document.body
    );
});

LoadoutComparisonModal.displayName = 'LoadoutComparisonModal';
