import type { FairyName, FairySettings } from '../types/Profile';

export type FairySourceKey = 'skillDamage' | 'skillCooldown' | 'health';
export type FairyTargetKey = 'criticalChance' | 'blockChance' | 'reflectChance';

export interface FairyDefinition {
    name: FairyName;
    texture: string;
    source: FairySourceKey;
    sourceLabel: string;
    target: FairyTargetKey;
    targetLabel: string;
    sourceStep: number;
    bonusPerStepAtLevelOne: number;
    cap: number;
    formula: string;
}

export const FAIRY_DEFINITIONS: Record<FairyName, FairyDefinition> = {
    Mira: {
        name: 'Mira', texture: 'FairyIconMira.png', source: 'skillDamage', sourceLabel: 'Skill Damage',
        target: 'criticalChance', targetLabel: 'Critical Chance', sourceStep: 15,
        bonusPerStepAtLevelOne: 1, cap: 80,
        formula: '+1% Critical Chance per +15% Skill Damage per fairy level',
    },
    Tira: {
        name: 'Tira', texture: 'FairyIconTira.png', source: 'skillCooldown', sourceLabel: 'Skill Cooldown',
        target: 'blockChance', targetLabel: 'Block Chance', sourceStep: 1,
        bonusPerStepAtLevelOne: 0.25, cap: 30,
        formula: '+0.25% Block Chance per -1% Skill Cooldown per fairy level',
    },
    Lora: {
        name: 'Lora', texture: 'FairyIconLora.png', source: 'health', sourceLabel: 'Health',
        target: 'reflectChance', targetLabel: 'Reflect Chance', sourceStep: 10,
        bonusPerStepAtLevelOne: 0.75, cap: 30,
        formula: '+0.75% Reflect Chance per +10% Health per fairy level',
    },
};

export const FAIRY_NAMES: FairyName[] = ['Mira', 'Tira', 'Lora'];

export interface FairySources {
    skillDamage: number;
    skillCooldown: number;
    health: number;
}

export function normalizeFairySettings(settings?: FairySettings): FairySettings {
    return {
        active: settings?.active && FAIRY_DEFINITIONS[settings.active] ? settings.active : 'Mira',
        level: Math.min(20, Math.max(1, Math.round(settings?.level || 1))),
        useManualSources: settings?.useManualSources === true,
        manualSources: settings?.manualSources || {},
        expiresAt: settings?.expiresAt,
    };
}

export function effectiveFairySources(settings: FairySettings | undefined, automatic: FairySources): FairySources {
    const normalized = normalizeFairySettings(settings);
    if (!normalized.useManualSources) return automatic;
    return {
        skillDamage: normalized.manualSources?.skillDamage ?? automatic.skillDamage,
        skillCooldown: normalized.manualSources?.skillCooldown ?? automatic.skillCooldown,
        health: normalized.manualSources?.health ?? automatic.health,
    };
}

export function calculateFairyBonus(name: FairyName, level: number, sources: FairySources): number {
    const fairy = FAIRY_DEFINITIONS[name];
    const source = Math.max(0, sources[fairy.source] || 0);
    // The game class applies the source/divider ratio directly. The UI rounds the result for
    // display, which is why 17.9% Skill Damage appears as +1% for Mira in the screenshot.
    const steps = source / fairy.sourceStep;
    return Math.min(fairy.cap, steps * fairy.bonusPerStepAtLevelOne * Math.min(20, Math.max(1, level)));
}
