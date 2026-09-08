import type { BuildGoalMetric, BuildGoalRule, BuildGoalSettings, CustomBuildGoal } from '../types/Profile';
import type { AggregatedStats } from './statEngine';

export interface BuildGoalContext {
    enemyHealth: number;
    bossHealth: number;
    overheadSeconds: number;
}

export interface BuildGoalDefinition {
    id: string;
    name: string;
    shortDescription: string;
    explanation: string;
    rules: BuildGoalRule[];
    custom?: boolean;
}

export const BUILD_GOAL_METRICS: { id: BuildGoalMetric; label: string; unit: 'number' | 'percent' | 'multiplier' | 'rate' }[] = [
    { id: 'real_dps', label: 'Real total DPS', unit: 'number' },
    { id: 'real_hps', label: 'Real total HPS', unit: 'number' },
    { id: 'total_health', label: 'Total health', unit: 'number' },
    { id: 'power', label: 'Power', unit: 'number' },
    { id: 'weapon_dps', label: 'Real weapon DPS', unit: 'number' },
    { id: 'skill_dps', label: 'Skill DPS', unit: 'number' },
    { id: 'farm_rate', label: 'Farming kills/min', unit: 'rate' },
    { id: 'boss_rate', label: 'Boss damage rate', unit: 'rate' },
    { id: 'crit_chance', label: 'Critical chance', unit: 'percent' },
    { id: 'crit_damage', label: 'Critical damage', unit: 'multiplier' },
    { id: 'double_chance', label: 'Double chance', unit: 'percent' },
    { id: 'lifesteal', label: 'Lifesteal', unit: 'percent' },
    { id: 'health_regen', label: 'Health regeneration', unit: 'percent' },
    { id: 'block_chance', label: 'Block chance', unit: 'percent' },
    { id: 'attack_speed', label: 'Attack speed', unit: 'multiplier' },
    { id: 'move_speed', label: 'Move speed', unit: 'percent' },
    { id: 'skill_cooldown', label: 'Skill cooldown reduction', unit: 'percent' },
    { id: 'melee_weapon_match', label: 'Melee weapon', unit: 'number' },
    { id: 'ranged_weapon_match', label: 'Ranged weapon', unit: 'number' },
    { id: 'damage_substat', label: 'Damage', unit: 'percent' },
    { id: 'health_substat', label: 'Health', unit: 'percent' },
    { id: 'melee_damage_substat', label: 'Melee damage', unit: 'percent' },
    { id: 'ranged_damage_substat', label: 'Ranged damage', unit: 'percent' },
    { id: 'skill_damage_substat', label: 'Skill damage', unit: 'percent' },
    { id: 'crit_chance_substat', label: 'Critical chance', unit: 'percent' },
    { id: 'crit_damage_substat', label: 'Critical damage', unit: 'percent' },
    { id: 'double_chance_substat', label: 'Double chance', unit: 'percent' },
    { id: 'lifesteal_substat', label: 'Lifesteal', unit: 'percent' },
    { id: 'health_regen_substat', label: 'Health regeneration', unit: 'percent' },
    { id: 'block_chance_substat', label: 'Block chance', unit: 'percent' },
    { id: 'attack_speed_substat', label: 'Attack speed', unit: 'percent' },
    { id: 'move_speed_substat', label: 'Move speed', unit: 'percent' },
    { id: 'skill_cooldown_substat', label: 'Skill cooldown', unit: 'percent' },
];

export const SUBSTAT_GOAL_METRICS = BUILD_GOAL_METRICS.filter(metric => metric.id.endsWith('_substat'));
const SUBSTAT_GOAL_IDS = new Set<BuildGoalMetric>(SUBSTAT_GOAL_METRICS.map(metric => metric.id));

const preset = (id: string, name: string, shortDescription: string, explanation: string, rules: BuildGoalRule[]): BuildGoalDefinition => ({
    id, name, shortDescription, explanation, rules,
});

export const BUILD_GOAL_PRESETS: BuildGoalDefinition[] = [
    preset('balanced_late_game', 'Balanced late-game', 'Advance without creating a damage or survival weakness.', 'Uses a weighted blend of real DPS, real healing, total health, lifesteal, attack speed, and block. A swap must improve the combined late-game profile instead of winning on one headline number alone.', [
        { metric: 'real_dps', weight: 3 }, { metric: 'real_hps', weight: 2.5 }, { metric: 'total_health', weight: 2 },
        { metric: 'lifesteal', weight: 1.5 }, { metric: 'attack_speed', weight: 1 }, { metric: 'block_chance', weight: 0.75 },
    ]),
    preset('pvp_burst', 'PvP burst', 'Front-load damage while keeping instant sustain.', 'Prioritizes real DPS, critical chance and damage, double chance, and lifesteal. Regeneration receives little value because PvP fights are usually decided before slow passive healing pays back.', [
        { metric: 'real_dps', weight: 4 }, { metric: 'crit_chance', weight: 2.5 }, { metric: 'crit_damage', weight: 2.5 },
        { metric: 'double_chance', weight: 2 }, { metric: 'lifesteal', weight: 1.5 }, { metric: 'total_health', weight: 1 },
    ]),
    preset('boss_damage', 'Boss damage', 'Maximize sustained single-target output.', 'Scores sustained real DPS and boss damage rate most heavily, then attack speed, critical damage, and enough healing to remain in the fight.', [
        { metric: 'boss_rate', weight: 4 }, { metric: 'real_dps', weight: 3 }, { metric: 'attack_speed', weight: 1.5 },
        { metric: 'crit_damage', weight: 1.25 }, { metric: 'real_hps', weight: 1 },
    ]),
    preset('farming', 'Farming & speed', 'Clear repeatable stages quickly and efficiently.', 'Estimates kills per minute from the selected stage health and travel delay. Real DPS, attack speed, movement speed, and experience gain support the farming score.', [
        { metric: 'farm_rate', weight: 4 }, { metric: 'real_dps', weight: 2 }, { metric: 'attack_speed', weight: 1.5 }, { metric: 'move_speed', weight: 1 },
    ]),
    preset('dungeon_sustain', 'Dungeon sustain', 'Survive long waves without sacrificing all damage.', 'Weights real healing, total health, lifesteal, block, and regeneration, then adds enough DPS to avoid builds that survive but cannot finish.', [
        { metric: 'real_hps', weight: 3.5 }, { metric: 'total_health', weight: 3 }, { metric: 'lifesteal', weight: 2 },
        { metric: 'block_chance', weight: 1.5 }, { metric: 'health_regen', weight: 1.5 }, { metric: 'real_dps', weight: 1.25 },
    ]),
    preset('skill_ability', 'Skill / ability', 'Lean on active skills as the main damage source.', 'Prioritizes skill DPS and cooldown reduction, then real DPS and sustain so the skill rotation remains usable in extended fights.', [
        { metric: 'skill_dps', weight: 4 }, { metric: 'skill_cooldown', weight: 2.5 }, { metric: 'real_dps', weight: 2 },
        { metric: 'real_hps', weight: 1 }, { metric: 'total_health', weight: 0.75 },
    ]),
    preset('critical_hit', 'Critical-hit build', 'Scale paired critical chance and critical damage.', 'Gives critical chance and damage equal importance, then rewards double chance, real DPS, and lifesteal for burst that also heals.', [
        { metric: 'crit_chance', weight: 3.5 }, { metric: 'crit_damage', weight: 3.5 }, { metric: 'double_chance', weight: 1.5 },
        { metric: 'real_dps', weight: 2 }, { metric: 'lifesteal', weight: 1 },
    ]),
    preset('regeneration', 'Full regeneration', 'Favor steady, hands-off survivability.', 'Weights regeneration, total health, block, and real healing above damage. It is intended for long PvE attrition and is deliberately not a PvP recommendation.', [
        { metric: 'health_regen', weight: 4 }, { metric: 'total_health', weight: 3 }, { metric: 'block_chance', weight: 2 },
        { metric: 'real_hps', weight: 2.5 }, { metric: 'real_dps', weight: 0.75 },
    ]),
];

export const DEFAULT_BUILD_GOAL_SETTINGS: BuildGoalSettings = {
    activeGoalId: 'balanced_late_game',
    customGoals: [],
    weaponStyle: 'melee',
};

export function normalizeBuildGoalSettings(settings?: BuildGoalSettings): BuildGoalSettings {
    const legacyStyle = settings?.activeGoalId === 'ranged_weapon' ? 'ranged'
        : settings?.activeGoalId === 'melee_weapon' ? 'melee'
            : undefined;
    const legacyGoal = settings?.activeGoalId === 'ranged_weapon' || settings?.activeGoalId === 'melee_weapon';
    return {
        activeGoalId: legacyGoal ? DEFAULT_BUILD_GOAL_SETTINGS.activeGoalId : (settings?.activeGoalId || DEFAULT_BUILD_GOAL_SETTINGS.activeGoalId),
        weaponStyle: settings?.weaponStyle || legacyStyle || DEFAULT_BUILD_GOAL_SETTINGS.weaponStyle,
        customGoals: (settings?.customGoals || []).map(goal => {
            const rules = goal.rules.filter(rule => SUBSTAT_GOAL_IDS.has(rule.metric));
            return { ...goal, rules: rules.length ? rules : defaultCustomSubstatRules() };
        }),
    };
}

export function resolveBuildGoal(settings?: BuildGoalSettings): BuildGoalDefinition {
    const normalized = normalizeBuildGoalSettings(settings);
    const custom = normalized.customGoals.find(goal => goal.id === normalized.activeGoalId);
    const base = custom
        ? { ...custom, shortDescription: custom.description, explanation: custom.description || 'Uses your custom targets, limits, required thresholds, and relative stat weights.', custom: true }
        : (BUILD_GOAL_PRESETS.find(goal => goal.id === normalized.activeGoalId) || BUILD_GOAL_PRESETS[0]);
    return applyWeaponStyle(base, normalized.weaponStyle);
}

function applyWeaponStyle(goal: BuildGoalDefinition, weaponStyle: BuildGoalSettings['weaponStyle']): BuildGoalDefinition {
    const matchMetric: BuildGoalMetric = weaponStyle === 'ranged' ? 'ranged_weapon_match' : 'melee_weapon_match';
    const damageMetric: BuildGoalMetric = weaponStyle === 'ranged' ? 'ranged_damage_substat' : 'melee_damage_substat';
    const rules = goal.rules.filter(rule => rule.metric !== 'melee_weapon_match' && rule.metric !== 'ranged_weapon_match');
    const existingDamage = rules.find(rule => rule.metric === damageMetric);
    const styledRules = existingDamage
        ? rules.map(rule => rule === existingDamage ? { ...rule, weight: rule.weight + 2 } : rule)
        : [...rules, { metric: damageMetric, weight: 2 }];
    return {
        ...goal,
        explanation: `${goal.explanation} The ${weaponStyle} style filter also requires a ${weaponStyle} weapon and favors ${weaponStyle} damage on every swap.`,
        rules: [{ metric: matchMetric, weight: 5, target: 1, required: true }, ...styledRules],
    };
}

export function createCustomBuildGoal(index: number): CustomBuildGoal {
    return {
        id: `custom_goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `Custom goal ${index}`,
        description: 'My own substat targets and priorities.',
        rules: defaultCustomSubstatRules(),
    };
}

function defaultCustomSubstatRules(): BuildGoalRule[] {
    return [
        { metric: 'damage_substat', weight: 2 },
        { metric: 'attack_speed_substat', weight: 1.5 },
        { metric: 'lifesteal_substat', weight: 1.5 },
        { metric: 'crit_chance_substat', weight: 1 },
        { metric: 'crit_damage_substat', weight: 1 },
        { metric: 'double_chance_substat', weight: 1 },
    ];
}

export function readBuildGoalMetric(stats: AggregatedStats, metric: BuildGoalMetric, context: BuildGoalContext): number {
    switch (metric) {
        case 'real_dps': return stats.realTotalDps;
        case 'real_hps': return stats.realTotalHps;
        case 'total_health': return stats.totalHealth;
        case 'power': return stats.power;
        case 'weapon_dps': return stats.realWeaponDps;
        case 'skill_dps': return stats.skillDps + stats.skillBuffDps;
        case 'farm_rate': {
            const fightSeconds = Math.max(0, context.enemyHealth) / Math.max(1, stats.realTotalDps);
            return 60 / Math.max(0.01, fightSeconds + Math.max(0, context.overheadSeconds));
        }
        case 'boss_rate': return stats.realTotalDps / Math.max(1, context.bossHealth);
        case 'crit_chance': return stats.criticalChance * 100;
        case 'crit_damage': return stats.criticalDamage;
        case 'double_chance': return stats.doubleDamageChance * 100;
        case 'lifesteal': return stats.lifeSteal * 100;
        case 'health_regen': return stats.healthRegen * 100;
        case 'block_chance': return stats.blockChance * 100;
        case 'attack_speed': return stats.attackSpeedMultiplier;
        case 'move_speed': return stats.moveSpeed * 100;
        case 'skill_cooldown': return stats.skillCooldownReduction * 100;
        case 'melee_weapon_match': return stats.isRangedWeapon ? 0 : 1;
        case 'ranged_weapon_match': return stats.isRangedWeapon ? 1 : 0;
        case 'damage_substat': return stats.secondaryDamageMulti * 100;
        case 'health_substat': return stats.secondaryHealthMulti * 100;
        case 'melee_damage_substat': return stats.meleeDamageMultiplier * 100;
        case 'ranged_damage_substat': return stats.rangedDamageMultiplier * 100;
        case 'skill_damage_substat': return stats.secondarySkillDamageMulti * 100;
        case 'crit_chance_substat': return stats.secondaryCriticalChance * 100;
        case 'crit_damage_substat': return stats.secondaryCriticalDamage * 100;
        case 'double_chance_substat': return stats.secondaryDoubleDamageChance * 100;
        case 'lifesteal_substat': return stats.secondaryLifeSteal * 100;
        case 'health_regen_substat': return stats.secondaryHealthRegen * 100;
        case 'block_chance_substat': return stats.secondaryBlockChance * 100;
        case 'attack_speed_substat': return stats.secondaryAttackSpeed * 100;
        case 'move_speed_substat': return stats.secondaryMoveSpeed * 100;
        case 'skill_cooldown_substat': return stats.secondarySkillCooldownMulti * 100;
    }
}

export function scoreBuildGoal(goal: BuildGoalDefinition, stats: AggregatedStats, baseline: AggregatedStats, context: BuildGoalContext): number {
    return goal.rules.reduce((total, rule) => {
        if (rule.ignored || rule.weight <= 0) return total;
        const value = Math.max(0, readBuildGoalMetric(stats, rule.metric, context));
        const base = Math.max(0.000001, Math.abs(readBuildGoalMetric(baseline, rule.metric, context)));
        const threshold = rule.target ?? rule.minimum;
        // Targets are distance-first: reaching the requested value is worth 100%, and going
        // farther does not drown out another unfinished target. This intentionally allows a
        // swap with a lower headline stat total when it moves the chosen build closer to its
        // actual substat goals.
        let utility = threshold && threshold > 0
            ? Math.min(value / threshold, 1)
            : Math.log1p(value / base);
        if (rule.maximum !== undefined && value > rule.maximum) utility -= (value - rule.maximum) / Math.max(0.000001, rule.maximum) * 2;
        if (rule.required && threshold !== undefined && value < threshold) utility -= 5 + (threshold - value) / Math.max(0.000001, threshold) * 5;
        return total + utility * rule.weight;
    }, 0);
}

export function compareBuildGoal(goal: BuildGoalDefinition, before: AggregatedStats, after: AggregatedStats, context: BuildGoalContext) {
    const beforeScore = scoreBuildGoal(goal, before, before, context);
    const afterScore = scoreBuildGoal(goal, after, before, context);
    const changePercent = beforeScore === 0 ? (afterScore === 0 ? 0 : 100) : (afterScore - beforeScore) / Math.abs(beforeScore) * 100;
    return { beforeScore, afterScore, changePercent };
}

export function metricLabel(metric: BuildGoalMetric) {
    return BUILD_GOAL_METRICS.find(item => item.id === metric)?.label || metric;
}
