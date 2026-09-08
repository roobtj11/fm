import { useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { StatEngine, LibraryData } from '../utils/statEngine';
import { PetSlot, SkillSlot, MountSlot, UserProfile } from '../types/Profile';
import { MAX_ACTIVE_PETS, MAX_ACTIVE_SKILLS } from '../utils/constants';
import { companionTestEnabled, type CompanionWeaponStyle } from '../utils/companionTesting';

const yieldToBrowser = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));

function* petLoadouts(savedPets: PetSlot[], currentPets: PetSlot[]): Generator<PetSlot[]> {
    const count = savedPets.length;
    const slots = Math.min(count, MAX_ACTIVE_PETS);
    if (!count) {
        yield currentPets;
        return;
    }
    for (let i = 0; i < count; i++) {
        if (slots === 1) { yield [savedPets[i]]; continue; }
        for (let j = i + 1; j < count; j++) {
            if (slots === 2) { yield [savedPets[i], savedPets[j]]; continue; }
            for (let k = j + 1; k < count; k++) yield [savedPets[i], savedPets[j], savedPets[k]];
        }
    }
}

function combinationCount(n: number, k: number) {
    if (!n) return 1;
    if (k < 0 || k > n) return 0;
    let value = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) value = value * (n - i + 1) / i;
    return Math.max(1, Math.round(value));
}

export function useProfileOptimizer() {
    const { profile } = useProfile();
    
    // Load all necessary libraries for StatEngine
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    // Filename is SkillPassiveLibrary, not PassiveSkillLibrary — the wrong name
    // 404s silently, dropping skill passive flat damage/health from every score.
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

    const libs: LibraryData = {
        petLibrary,
        petUpgradeLibrary,
        petBalancingLibrary,
        skillLibrary,
        skillPassiveLibrary,
        mountUpgradeLibrary,
        techTreeLibrary,
        techTreePositionLibrary,
        guildTechTreePositionLibrary: guildPositionLibrary || undefined,
        guildTechTreeUpgradeLibrary: guildUpgradeLibrary || undefined,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary,
        secondaryStatLibrary,
        skinsLibrary,
        setsLibrary,
        ascensionConfigsLibrary
    };

    /** Calculate the complete character result for any profile snapshot. */
    const calculateProfileStats = useCallback((base: UserProfile = profile) => {
        return new StatEngine(base, libs).calculate();
    }, [profile, libs]);

    // respectSavedLevels: when true (default), each saved build is scored at its own
    // stored level — the original behavior. When false, every candidate is scored at
    // level 1 so only secondary stats decide. Either way the returned build keeps its
    // saved level for equipping.
    const optimizeLoadout = useCallback((
        metric: 'dps' | 'power' | 'lifesteal' | 'balanced',
        base: UserProfile = profile,
        respectSavedLevels: boolean = true,
        scoreOverride?: (stats: ReturnType<StatEngine['calculate']>) => number
    ): { pets: PetSlot[]; mount: MountSlot | null } | null => {
        // --- Pet candidate sets: every combination of up to MAX_ACTIVE_PETS from saved builds ---
        const savedPets = base.pets.savedBuilds || [];
        const petSets: PetSlot[][] = [];
        const n = savedPets.length;
        const slotsToFill = Math.min(n, MAX_ACTIVE_PETS);

        for (let i = 0; i < n; i++) {
            const set1 = [savedPets[i]];
            if (slotsToFill === 1) {
                petSets.push(set1);
                continue;
            }
            for (let j = i + 1; j < n; j++) {
                const set2 = [...set1, savedPets[j]];
                if (slotsToFill === 2) {
                    petSets.push(set2);
                    continue;
                }
                for (let k = j + 1; k < n; k++) {
                    petSets.push([...set2, savedPets[k]]);
                }
            }
        }
        // If there are no saved pets, keep the current active pets (don't force a change).
        if (petSets.length === 0) petSets.push(base.pets.active);

        // --- Mount candidates: current active + saved builds, deduped ---
        const mountCandidates: (MountSlot | null)[] = [];
        const seen = new Set<string>();
        const mountKey = (m: MountSlot) => `${m.id}|${m.rarity}|${m.level}|${JSON.stringify(m.secondaryStats)}`;
        const addMount = (m: MountSlot | null) => {
            if (!m) return;
            const key = mountKey(m);
            if (seen.has(key)) return;
            seen.add(key);
            mountCandidates.push(m);
        };
        // Prefer saved inventory records so custom names and unique instance IDs
        // survive into optimizer recommendations; add the active mount as a fallback.
        (base.mount.savedBuilds || []).forEach(addMount);
        addMount(base.mount.active);
        // If there are no mounts at all, keep the current mount (no change).
        if (mountCandidates.length === 0) mountCandidates.push(base.mount.active);

        // Evaluate every combination once. "Balanced" needs two passes (it
        // normalises DPS and HPS by their maxima across the sweep), so keep the
        // full stats around rather than collapsing to a single scalar up front.
        type Combo = { pets: PetSlot[]; mount: MountSlot | null; stats: ReturnType<StatEngine['calculate']> };
        const combos: Combo[] = [];
        for (const petSet of petSets) {
            for (const mount of mountCandidates) {
                // Score at level 1 when respectSavedLevels is off; the original
                // petSet/mount (with saved levels) are still what we push and return.
                const scoredPets = respectSavedLevels
                    ? petSet
                    : petSet.map(p => ({ ...p, level: 1 }));
                const scoredMount = (respectSavedLevels || !mount)
                    ? mount
                    : { ...mount, level: 1 };
                const tempProfile: UserProfile = {
                    ...base,
                    pets: { ...base.pets, active: scoredPets },
                    mount: { ...base.mount, active: scoredMount }
                };
                const engine = new StatEngine(tempProfile, libs);
                combos.push({ pets: petSet, mount, stats: engine.calculate() });
            }
        }
        if (combos.length === 0) return null;

        const scoreOf = (stats: ReturnType<StatEngine['calculate']>): number => {
            if (scoreOverride) return scoreOverride(stats);
            // Real-time DPS, matching the Loadout Optimizer sweep (not the theoretical average).
            if (metric === 'dps') return stats.realTotalDps;
            if (metric === 'power') return stats.power;
            if (metric === 'balanced') {
                // Geometric mean (product) of real-time DPS and HPS. Unlike a weighted
                // sum of the two, the product rewards being strong on BOTH axes and
                // collapses toward zero if either is weak — that's what a balanced build
                // actually is. Raw scale is fine: the product is scale-invariant for
                // ranking, so no normalisation is needed. Matches the Substats Calculator.
                return stats.realTotalDps * stats.realTotalHps;
            }
            return stats.realWeaponDps * stats.lifeSteal; // lifesteal/sec (real-time)
        };

        let bestPets: PetSlot[] = [];
        let bestMount: MountSlot | null = base.mount.active;
        let bestValue = -1;

        for (const c of combos) {
            const value = scoreOf(c.stats);
            if (value > bestValue) {
                bestValue = value;
                bestPets = c.pets;
                bestMount = c.mount;
            }
        }

        return bestPets.length > 0 ? { pets: bestPets, mount: bestMount } : null;
    }, [profile, libs]);

    /**
     * Cooperative loadout search. Fast mode scores every enabled candidate individually, keeps the
     * strongest goal-fit choices plus stat specialists, then exhaustively combines that shortlist.
     */
    const optimizeLoadoutAsync = useCallback(async (
        metric: 'dps' | 'power' | 'lifesteal' | 'balanced',
        base: UserProfile = profile,
        respectSavedLevels: boolean = true,
        scoreOverride?: (stats: ReturnType<StatEngine['calculate']>) => number,
        onProgress?: (completed: number, total: number, phase: 'screening' | 'combinations') => void,
        strategy: 'fast' | 'exact' = 'exact',
        weaponStyle: CompanionWeaponStyle = 'melee'
    ): Promise<{
        pets: PetSlot[];
        mount: MountSlot | null;
        combinations: number;
        screened: number;
        strategy: 'fast' | 'exact';
        screenedPets: { entry: PetSlot; stats: ReturnType<StatEngine['calculate']> }[];
        screenedMounts: { entry: MountSlot; stats: ReturnType<StatEngine['calculate']> }[];
    } | null> => {
        const petKey = (pet: PetSlot) => pet.instanceId || `${pet.id}|${pet.rarity}|${pet.level}|${JSON.stringify(pet.secondaryStats)}`;
        const savedPets = base.pets.savedBuilds || [];
        const petPool: PetSlot[] = [];
        const seenPets = new Set<string>();
        for (const pet of [...savedPets, ...base.pets.active]) {
            const key = petKey(pet);
            if (!seenPets.has(key)) { seenPets.add(key); petPool.push(pet); }
        }
        const mountCandidates: (MountSlot | null)[] = [];
        const seen = new Set<string>();
        const addMount = (mount: MountSlot | null) => {
            if (!mount) return;
            const key = `${mount.id}|${mount.rarity}|${mount.level}|${JSON.stringify(mount.secondaryStats)}`;
            if (seen.has(key)) return;
            seen.add(key);
            mountCandidates.push(mount);
        };
        (base.mount.savedBuilds || []).forEach(addMount);
        addMount(base.mount.active);
        if (!mountCandidates.length) mountCandidates.push(base.mount.active);

        const scoreStats = (stats: ReturnType<StatEngine['calculate']>) => scoreOverride ? scoreOverride(stats)
            : metric === 'dps' ? stats.realTotalDps
                : metric === 'power' ? stats.power
                    : metric === 'balanced' ? stats.realTotalDps * stats.realTotalHps
                        : stats.realWeaponDps * stats.lifeSteal;
        const statsFor = (pets: PetSlot[], mount: MountSlot | null) => {
            const scoredPets = respectSavedLevels ? pets : pets.map(pet => ({ ...pet, level: 1 }));
            const scoredMount = respectSavedLevels || !mount ? mount : { ...mount, level: 1 };
            return new StatEngine({
                ...base,
                pets: { ...base.pets, active: scoredPets },
                mount: { ...base.mount, active: scoredMount },
            }, libs).calculate();
        };

        const activePetKeys = new Set(base.pets.active.map(petKey));
        const activeMountKey = base.mount.active ? `${base.mount.active.id}|${base.mount.active.rarity}|${base.mount.active.level}|${JSON.stringify(base.mount.active.secondaryStats)}` : '';
        let searchPets = petPool.filter(pet => activePetKeys.has(petKey(pet)) || companionTestEnabled(pet, weaponStyle));
        let searchMounts = mountCandidates.filter(mount => !mount || `${mount.id}|${mount.rarity}|${mount.level}|${JSON.stringify(mount.secondaryStats)}` === activeMountKey || companionTestEnabled(mount, weaponStyle));
        if (!searchMounts.length) searchMounts = [base.mount.active];
        type Scored<T> = { entry: T; score: number; stats: ReturnType<StatEngine['calculate']> };
        const scoredPets: Scored<PetSlot>[] = [];
        const scoredMounts: Scored<MountSlot | null>[] = [];
        const screeningTotal = searchPets.length + searchMounts.length;
        const screenedCandidates = screeningTotal;
        {
            let screened = 0;
            onProgress?.(0, Math.max(1, screeningTotal), 'screening');
            await yieldToBrowser();

            for (const pet of searchPets) {
                const key = petKey(pet);
                const companions = [pet, ...base.pets.active.filter(active => petKey(active) !== key)].slice(0, MAX_ACTIVE_PETS);
                const stats = statsFor(companions, base.mount.active);
                scoredPets.push({ entry: pet, score: scoreStats(stats), stats });
                screened++;
                if (screened % 5 === 0 || screened === screeningTotal) {
                    onProgress?.(screened, Math.max(1, screeningTotal), 'screening');
                    await yieldToBrowser();
                }
            }
            for (const mount of searchMounts) {
                const stats = statsFor(base.pets.active, mount);
                scoredMounts.push({ entry: mount, score: scoreStats(stats), stats });
                screened++;
                if (screened % 5 === 0 || screened === screeningTotal) {
                    onProgress?.(screened, Math.max(1, screeningTotal), 'screening');
                    await yieldToBrowser();
                }
            }

        }

        if (strategy === 'fast') {
            const signals = [
                (stats: ReturnType<StatEngine['calculate']>) => stats.realTotalDps,
                (stats: ReturnType<StatEngine['calculate']>) => stats.realTotalHps,
                (stats: ReturnType<StatEngine['calculate']>) => stats.power,
                (stats: ReturnType<StatEngine['calculate']>) => stats.criticalChance,
                (stats: ReturnType<StatEngine['calculate']>) => stats.criticalDamage,
                (stats: ReturnType<StatEngine['calculate']>) => stats.attackSpeedMultiplier,
                (stats: ReturnType<StatEngine['calculate']>) => stats.lifeSteal,
                (stats: ReturnType<StatEngine['calculate']>) => stats.skillDamageMultiplier,
            ];
            const choosePets = new Map<string, PetSlot>();
            const addPet = (pet?: PetSlot) => { if (pet && choosePets.size < 12) choosePets.set(petKey(pet), pet); };
            base.pets.active.forEach(addPet);
            [...scoredPets].sort((a, b) => b.score - a.score).slice(0, 6).forEach(item => addPet(item.entry));
            for (const signal of signals) addPet([...scoredPets].sort((a, b) => signal(b.stats) - signal(a.stats))[0]?.entry);
            for (const item of [...scoredPets].sort((a, b) => b.score - a.score)) addPet(item.entry);
            searchPets = [...choosePets.values()];

            const chooseMounts = new Map<string, MountSlot | null>();
            const mountKey = (mount: MountSlot | null) => mount ? `${mount.id}|${mount.rarity}|${mount.level}|${JSON.stringify(mount.secondaryStats)}` : 'none';
            const addChosenMount = (mount: MountSlot | null | undefined) => { if (mount !== undefined && chooseMounts.size < 6) chooseMounts.set(mountKey(mount), mount); };
            addChosenMount(base.mount.active);
            [...scoredMounts].sort((a, b) => b.score - a.score).slice(0, 3).forEach(item => addChosenMount(item.entry));
            for (const signal of signals) addChosenMount([...scoredMounts].sort((a, b) => signal(b.stats) - signal(a.stats))[0]?.entry);
            for (const item of [...scoredMounts].sort((a, b) => b.score - a.score)) addChosenMount(item.entry);
            searchMounts = [...chooseMounts.values()];
        }

        const total = combinationCount(searchPets.length, Math.min(searchPets.length, MAX_ACTIVE_PETS)) * searchMounts.length;
        let completed = 0;
        let bestValue = Number.NEGATIVE_INFINITY;
        let bestPets: PetSlot[] = [];
        let bestMount: MountSlot | null = base.mount.active;
        onProgress?.(0, total, 'combinations');
        await yieldToBrowser();

        for (const petSet of petLoadouts(searchPets, base.pets.active)) {
            for (const mount of searchMounts) {
                const stats = statsFor(petSet, mount);
                const value = scoreStats(stats);
                if (value > bestValue) {
                    bestValue = value;
                    bestPets = petSet;
                    bestMount = mount;
                }
                completed++;
                if (completed % 5 === 0 || completed === total) {
                    onProgress?.(completed, total, 'combinations');
                    await yieldToBrowser();
                }
            }
        }
        return completed ? {
            pets: bestPets,
            mount: bestMount,
            combinations: total,
            screened: screenedCandidates,
            strategy,
            screenedPets: scoredPets,
            screenedMounts: scoredMounts.filter((item): item is Scored<MountSlot> => !!item.entry),
        } : null;
    }, [profile, libs]);

    const optimizeSkills = useCallback((): SkillSlot[] | null => {
        if (!skillLibrary) return null;

        // Build the candidate list from the library, using levels from passives
        const collection: SkillSlot[] = Object.keys(skillLibrary).map(id => ({
            id: id,
            rarity: skillLibrary[id].Rarity || 'Common',
            level: profile.skills.passives[id] || 1,
            evolution: 0,
            ascensionLevel: profile.misc.skillAscensionLevel || 0
        }));

        if (collection.length === 0) return null;

        let bestSet: SkillSlot[] = [];
        let bestValue = -1;

        const n = collection.length;
        const slotsToFill = Math.min(n, MAX_ACTIVE_SKILLS);

        const checkSet = (candidate: SkillSlot[]) => {
            const tempProfile: UserProfile = {
                ...profile,
                skills: {
                    ...profile.skills,
                    equipped: candidate
                }
            };

            const engine = new StatEngine(tempProfile, libs);
            const stats = engine.calculate();
            
            const value = stats.averageTotalDps;
            
            if (value > bestValue) {
                bestValue = value;
                bestSet = candidate;
            }
        };

        for (let i = 0; i < n; i++) {
            const set1 = [collection[i]];
            if (slotsToFill === 1) {
                checkSet(set1);
                continue;
            }
            for (let j = i + 1; j < n; j++) {
                const set2 = [...set1, collection[j]];
                if (slotsToFill === 2) {
                    checkSet(set2);
                    continue;
                }
                for (let k = j + 1; k < n; k++) {
                    checkSet([...set2, collection[k]]);
                }
            }
        }

        return bestSet.length > 0 ? bestSet : null;
    }, [profile, libs, skillLibrary]);

    return {
        optimizeLoadout,
        optimizeLoadoutAsync,
        optimizeSkills,
        calculateProfileStats,
        isReady: !!petLibrary && !!skillLibrary && !!mountUpgradeLibrary && !!itemBalancingConfig
    };
}
