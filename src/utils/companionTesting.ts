import type { MountSlot, PetSlot } from '../types/Profile';

export type CompanionWeaponStyle = 'melee' | 'ranged';
export type TestableCompanion = PetSlot | MountSlot;

export function companionTestEnabled(entry: TestableCompanion, style: CompanionWeaponStyle) {
    const testing = entry.optimizerTesting;
    if (style === 'melee') {
        return testing?.manualMelee ? testing.testMelee !== false : testing?.autoMelee !== false;
    }
    return testing?.manualRanged ? testing.testRanged !== false : testing?.autoRanged !== false;
}

export function companionTestMode(entry: TestableCompanion, style: CompanionWeaponStyle) {
    return style === 'melee'
        ? (entry.optimizerTesting?.manualMelee ? 'manual' : 'auto')
        : (entry.optimizerTesting?.manualRanged ? 'manual' : 'auto');
}

export function withManualCompanionTest<T extends TestableCompanion>(entry: T, style: CompanionWeaponStyle, enabled: boolean): T {
    const current = entry.optimizerTesting || {};
    return {
        ...entry,
        optimizerTesting: style === 'melee'
            ? { ...current, manualMelee: true, testMelee: enabled }
            : { ...current, manualRanged: true, testRanged: enabled },
    };
}

export function withAutomaticCompanionTest<T extends TestableCompanion>(entry: T, style: CompanionWeaponStyle): T {
    const current = entry.optimizerTesting || {};
    return {
        ...entry,
        optimizerTesting: style === 'melee'
            ? { ...current, manualMelee: false }
            : { ...current, manualRanged: false },
    };
}

export function isAutomaticMergeMaterial(entry: TestableCompanion) {
    const testing = entry.optimizerTesting;
    return testing?.autoMelee === false
        && testing?.autoRanged === false
        && !companionTestEnabled(entry, 'melee')
        && !companionTestEnabled(entry, 'ranged');
}

export function automaticCompanionFit(entry: TestableCompanion) {
    const testing = entry.optimizerTesting;
    if (testing?.autoMelee === undefined || testing?.autoRanged === undefined) return 'New · awaiting evaluation';
    if (testing.autoMelee && testing.autoRanged) return 'Useful for melee + ranged';
    if (testing.autoMelee) return 'Melee specialist';
    if (testing.autoRanged) return 'Ranged specialist';
    return 'Poor across all goals';
}
