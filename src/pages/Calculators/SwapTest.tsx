import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
    ArrowRightLeft, Calculator, Check, Loader2, PackagePlus, PawPrint, RotateCcw,
    ScanLine, Shield, Sparkles, Sword, Target, Trash2, Trophy
} from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useProfileOptimizer } from '../../hooks/useProfileOptimizer';
import { useGameData } from '../../hooks/useGameData';
import { useBattleSimulation } from '../../hooks/useBattleSimulation';
import { ItemSelectorModal } from '../../components/Profile/ItemSelectorModal';
import { PetSelectorModal } from '../../components/Profile/PetSelectorModal';
import { MountSelectorModal } from '../../components/Profile/MountSelectorModal';
import { Button } from '../../components/UI/Button';
import { ItemSlot, MountSlot, PetSlot, UserProfile, type BuildGoalSettings } from '../../types/Profile';
import { AggregatedStats } from '../../utils/statEngine';
import { AGES, MAX_ACTIVE_PETS } from '../../utils/constants';
import { formatNumber } from '../../utils/format';
import { formatSecondaryStat } from '../../utils/statNames';
import { getPerfection } from '../../utils/itemCalculations';
import { PerfectionMeter } from '../../components/UI/PerfectionMeter';
import { getMainBattleStageSummary, simulateBattleMultiAsync, type BattleResult } from '../../utils/BattleSimulator';
import { cn } from '../../lib/utils';
import { BuildGoalSelector } from '../../components/Profile/BuildGoalSelector';
import { BUILD_GOAL_PRESETS, compareBuildGoal, resolveBuildGoal, scoreBuildGoal, type BuildGoalContext, type BuildGoalDefinition } from '../../utils/buildGoals';
import { recognizeLocally } from '../../utils/localOcr';
import { scanKnownEquipmentItems } from '../../utils/screenshotItemScanner';
import {
    automaticCompanionFit,
    companionTestEnabled,
    companionTestMode,
    isAutomaticMergeMaterial,
    withAutomaticCompanionTest,
    withManualCompanionTest,
    type CompanionWeaponStyle,
    type TestableCompanion,
} from '../../utils/companionTesting';

type EquipmentSlot = keyof UserProfile['items'];
type CompanionLoadout = { pets: PetSlot[]; mount: MountSlot | null };
type CalculationProgress = { percent: number; label: string; detail: string };

type SwapResult = {
    slot: EquipmentSlot;
    item: ItemSlot;
    current: AggregatedStats;
    candidateCurrent: AggregatedStats;
    candidateOptimized: AggregatedStats;
    currentLoadout: CompanionLoadout;
    candidateLoadout: CompanionLoadout;
    combinations: number;
    screened: number;
    strategy: 'fast' | 'exact';
    goal: BuildGoalDefinition;
    contexts: { current: BuildGoalContext; candidateCurrent: BuildGoalContext; candidateOptimized: BuildGoalContext };
    stage: { difficulty: number; age: number; battle: number; predictionEnabled: boolean };
    stagePrediction: BattleResult | null;
};

const EQUIPMENT_SLOTS: EquipmentSlot[] = [
    'Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'
];

const newInstanceId = (prefix: 'pet' | 'mount') =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const readImage = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The screenshot could not be opened.'));
    reader.readAsDataURL(file);
});

const yieldForPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => window.setTimeout(resolve, 0)));

function formatTimeRemaining(milliseconds: number) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    if (seconds < 60) return `${seconds}s left`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s left`;
}

function describeSubstats(stats?: { statId: string; value: number }[]) {
    if (!stats?.length) return 'No special stats';
    return stats.map(stat => {
        const formatted = formatSecondaryStat(stat.statId, stat.value);
        return `${formatted.name} ${formatted.formattedValue.replace(/^\+/, '')}`;
    }).join(', ');
}

function describeItem(item: ItemSlot | null) {
    if (!item) return 'Empty';
    return `${AGES[item.age] || `Age ${item.age}`} item #${item.idx + 1} · Lv. ${item.level}`;
}

function withCompanions(base: UserProfile, loadout: CompanionLoadout): UserProfile {
    return {
        ...base,
        pets: { ...base.pets, active: loadout.pets },
        mount: { ...base.mount, active: loadout.mount }
    };
}

function choose(n: number, k: number) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let result = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) {
        result = result * (n - i + 1) / i;
    }
    return Math.round(result);
}

function searchSize(profile: UserProfile) {
    const petCount = profile.pets.savedBuilds?.length || 0;
    const petSets = petCount === 0 ? 1 : choose(petCount, Math.min(petCount, MAX_ACTIVE_PETS));
    const mountKeys = new Set(
        [...(profile.mount.savedBuilds || []), profile.mount.active]
            .filter((mount): mount is MountSlot => !!mount)
            .map(mount => `${mount.id}|${mount.rarity}|${mount.level}|${JSON.stringify(mount.secondaryStats)}`)
    );
    return petSets * Math.max(1, mountKeys.size);
}

// These defaults mirror BattleEngine's current movement, spawn-distance, and wave-delay model.
const BATTLE_TIMING = {
    playerSpeed: 4,
    enemySpeed: 4,
    firstWaveSpawnDistance: 21,
    nextWaveSpawnDistance: 28,
    waveDelay: 1
} as const;

function estimatedTimeBetweenKills(stats: AggregatedStats, enemyCount: number, waveCount: number) {
    const relativeSpeed = BATTLE_TIMING.playerSpeed + BATTLE_TIMING.enemySpeed;
    const attackRange = Math.max(0, stats.weaponAttackRange || 0);
    const firstApproach = Math.max(0, BATTLE_TIMING.firstWaveSpawnDistance - attackRange) / relativeSpeed;
    const laterApproach = Math.max(0, BATTLE_TIMING.nextWaveSpawnDistance - attackRange) / relativeSpeed;
    const totalNonCombatTime = firstApproach
        + Math.max(0, waveCount - 1) * (BATTLE_TIMING.waveDelay + laterApproach);
    return totalNonCombatTime / Math.max(1, enemyCount);
}

const companionKey = (entry: TestableCompanion) => entry.instanceId
    || `${entry.id}|${entry.rarity}|${entry.level}|${entry.evolution}|${entry.ascensionLevel || 0}|${JSON.stringify(entry.secondaryStats || [])}`;

function goalsForStyle(settings: BuildGoalSettings | undefined, style: CompanionWeaponStyle) {
    const customGoalIds = settings?.customGoals?.map(goal => goal.id) || [];
    return [...BUILD_GOAL_PRESETS.map(goal => goal.id), ...customGoalIds].map(activeGoalId => resolveBuildGoal({
        activeGoalId,
        customGoals: settings?.customGoals || [],
        weaponStyle: style,
    }));
}

export default function SwapTest() {
    const { profile, updateNestedProfile } = useProfile();
    const { optimizeLoadoutAsync, calculateProfileStats, isReady } = useProfileOptimizer();
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const {
        libs: battleLibs,
        getBattleCountForAge,
        maxAgeIdx,
        isLoading: battleDataLoading
    } = useBattleSimulation();

    const [slot, setSlot] = useState<EquipmentSlot>('Weapon');
    const [candidate, setCandidate] = useState<ItemSlot | null>(null);
    const [enemyHealth, setEnemyHealth] = useState(1_000_000);
    const [bossHealth, setBossHealth] = useState(10_000_000);
    const [overheadSeconds, setOverheadSeconds] = useState(0.35);
    const savedStage = profile.misc.swapCalculatorStage;
    const [stageDifficulty, setStageDifficulty] = useState(savedStage?.difficulty === 1 ? 1 : 0);
    const [stageAge, setStageAge] = useState(Math.max(0, savedStage?.age ?? 0));
    const [stageBattle, setStageBattle] = useState(savedStage?.battle ?? 0);
    const [stagePredictionEnabled, setStagePredictionEnabled] = useState(true);
    const [stagePredictionRuns, setStagePredictionRuns] = useState(10);
    const [autoStageStats, setAutoStageStats] = useState(true);
    const [respectSavedLevels, setRespectSavedLevels] = useState(true);
    const [optimizerStrategy, setOptimizerStrategy] = useState<'fast' | 'exact'>('fast');
    const [result, setResult] = useState<SwapResult | null>(null);
    const [calculationBusy, setCalculationBusy] = useState(false);
    const [calculationProgress, setCalculationProgress] = useState<CalculationProgress>({ percent: 0, label: '', detail: '' });
    const [calculationStartedAt, setCalculationStartedAt] = useState(0);
    const [itemModalOpen, setItemModalOpen] = useState(false);
    const [petModalOpen, setPetModalOpen] = useState(false);
    const [mountModalOpen, setMountModalOpen] = useState(false);
    const swapScanRef = useRef<HTMLInputElement>(null);
    const [swapScanBusy, setSwapScanBusy] = useState(false);
    const [swapScanProgress, setSwapScanProgress] = useState(0);
    const [swapScanError, setSwapScanError] = useState('');
    const [swapScanSummary, setSwapScanSummary] = useState('');

    const currentItem = profile.items[slot];
    const savedPets = profile.pets.savedBuilds || [];
    const savedMounts = profile.mount.savedBuilds || [];
    const battleCount = getBattleCountForAge(stageAge);
    const stageSummary = useMemo(
        () => getMainBattleStageSummary(stageAge, stageBattle, stageDifficulty, battleLibs),
        [stageAge, stageBattle, stageDifficulty, battleLibs]
    );
    const activeBuildGoal = useMemo(() => resolveBuildGoal(profile.misc.buildGoals), [profile.misc.buildGoals]);

    const scanSwapScreenshot = async (file?: File) => {
        if (!file) return;
        setSwapScanError('');
        setSwapScanSummary('');
        if (!file.type.startsWith('image/')) return setSwapScanError('Choose a PNG, JPG, or WEBP screenshot.');
        if (file.size > 10 * 1024 * 1024) return setSwapScanError('The screenshot must be smaller than 10 MB.');
        setSwapScanBusy(true);
        setSwapScanProgress(0);
        try {
            const image = await readImage(file);
            const ocr = await recognizeLocally(image, message => setSwapScanProgress(Math.round((message.progress || 0) * 100)));
            const detected = scanKnownEquipmentItems(ocr.text, autoItemMapping);
            const grouped = EQUIPMENT_SLOTS.map(equipmentSlot => ({
                slot: equipmentSlot,
                items: detected.filter(match => match.slot === equipmentSlot),
            })).filter(group => group.items.length >= 2).sort((a, b) => b.items.length - a.items.length);
            const group = grouped[0];
            if (!group) throw new Error('I could not find two known items for the same equipment slot. Use a screenshot where both item names and details are visible.');
            const equipped = profile.items[group.slot];
            const equippedIndex = equipped
                ? group.items.findIndex(match => match.item.age === equipped.age && match.item.idx === equipped.idx)
                : -1;
            if (equippedIndex < 0) {
                throw new Error(`I found ${group.items.map(match => match.name).join(' and ')} for ${group.slot}, but neither matches the ${group.slot} saved in your profile. Update your equipped item first, or add the test item manually.`);
            }
            const proposed = group.items.find((_, index) => index !== equippedIndex);
            if (!proposed) throw new Error('The new comparison item could not be separated from the equipped item.');
            setSlot(group.slot);
            setCandidate(proposed.item);
            setSwapScanSummary(`Detected ${group.items[equippedIndex].name} as equipped and loaded ${proposed.name} as the new ${group.slot}. Verify its level and special stats before running the test.`);
        } catch (cause) {
            setSwapScanError(cause instanceof Error ? cause.message : 'The swap screenshot could not be read.');
        } finally {
            setSwapScanBusy(false);
            if (swapScanRef.current) swapScanRef.current.value = '';
        }
    };

    useEffect(() => {
        if (!battleDataLoading && stageBattle >= battleCount) setStageBattle(Math.max(0, battleCount - 1));
    }, [stageBattle, battleCount, battleDataLoading]);

    useEffect(() => {
        if (!battleDataLoading && stageAge > maxAgeIdx) setStageAge(maxAgeIdx);
    }, [battleDataLoading, maxAgeIdx, stageAge]);

    useEffect(() => {
        updateNestedProfile('misc', {
            swapCalculatorStage: { age: stageAge, battle: stageBattle, difficulty: stageDifficulty }
        });
    }, [stageAge, stageBattle, stageDifficulty, updateNestedProfile]);

    useEffect(() => {
        if (!autoStageStats || !stageSummary) return;
        setEnemyHealth(Math.round(stageSummary.averageEnemyHealth));
        setBossHealth(Math.round(stageSummary.finalWaveHealth));
        if (isReady) {
            const currentStats = calculateProfileStats(profile);
            setOverheadSeconds(Number(estimatedTimeBetweenKills(currentStats, stageSummary.enemyCount, stageSummary.waveCount).toFixed(3)));
        }
    }, [autoStageStats, stageSummary, isReady, calculateProfileStats, profile]);

    const killDowntimeFor = (stats: AggregatedStats) => autoStageStats && stageSummary
        ? estimatedTimeBetweenKills(stats, stageSummary.enemyCount, stageSummary.waveCount)
        : overheadSeconds;

    const petName = (pet: PetSlot) => {
        const key = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
        const type = petLibrary?.[key]?.Type || `Pet #${pet.id}`;
        const baseName = pet.customName?.split(' - ')[0]?.trim() || type;
        return `${baseName} - ${describeSubstats(pet.secondaryStats)} - ${pet.rarity}`;
    };

    const mountName = (mount: MountSlot) => {
        const baseName = mount.customName?.split(' - ')[0]?.trim() || `Mount #${mount.id}`;
        return `${baseName} - ${describeSubstats(mount.secondaryStats)} - ${mount.rarity}`;
    };

    const equippedPetIds = useMemo(
        () => new Set(profile.pets.active.map(p => p.instanceId).filter(Boolean)),
        [profile.pets.active]
    );
    const equippedMountId = profile.mount.active?.instanceId;

    const applyAutomaticCompanionAssessment = (
        screenedPets: { entry: PetSlot; stats: AggregatedStats }[],
        screenedMounts: { entry: MountSlot; stats: AggregatedStats }[],
        baseline: AggregatedStats,
    ) => {
        const evaluatedAt = new Date().toISOString();
        const evaluate = <T extends TestableCompanion>(
            screened: { entry: T; stats: AggregatedStats }[],
            requiredAlternatives: number,
            activeKeys: Set<string>,
        ) => {
            const styles: CompanionWeaponStyle[] = ['melee', 'ranged'];
            const vectors = new Map<CompanionWeaponStyle, number[][]>();
            styles.forEach(style => {
                const goals = goalsForStyle(profile.misc.buildGoals, style);
                vectors.set(style, screened.map(item => [
                    ...goals.map(goal => scoreBuildGoal(goal, item.stats, baseline, {
                        enemyHealth,
                        bossHealth,
                        overheadSeconds: killDowntimeFor(item.stats),
                    })),
                    // Independent specialist dimensions prevent a high-value niche roll from
                    // being hidden inside a weighted aggregate and incorrectly pruned.
                    item.stats.realTotalDps,
                    item.stats.realTotalHps,
                    item.stats.totalHealth,
                    style === 'melee' ? item.stats.meleeDamageMultiplier : item.stats.rangedDamageMultiplier,
                    item.stats.skillDamageMultiplier,
                    item.stats.criticalChance,
                    item.stats.criticalDamage,
                    item.stats.doubleDamageChance,
                    item.stats.lifeSteal,
                    item.stats.healthRegen,
                    item.stats.blockChance,
                    item.stats.attackSpeedMultiplier,
                    item.stats.moveSpeed,
                    item.stats.skillCooldownReduction,
                ]));
            });
            return screened.map((item, index) => {
                const decisions = Object.fromEntries(styles.map(style => {
                    if (activeKeys.has(companionKey(item.entry))) return [style, true];
                    const own = vectors.get(style)?.[index] || [];
                    const betterAlternatives = screened.reduce((count, _other, otherIndex) => {
                        if (otherIndex === index) return count;
                        const other = vectors.get(style)?.[otherIndex] || [];
                        const neverWorse = own.every((score, goalIndex) => (other[goalIndex] ?? Number.NEGATIVE_INFINITY) >= score - 1e-9);
                        const strictlyBetter = own.some((score, goalIndex) => (other[goalIndex] ?? Number.NEGATIVE_INFINITY) > score + 1e-9);
                        const winsEqualTie = !strictlyBetter && otherIndex < index;
                        return neverWorse && (strictlyBetter || winsEqualTie) ? count + 1 : count;
                    }, 0);
                    return [style, betterAlternatives < requiredAlternatives];
                })) as Record<CompanionWeaponStyle, boolean>;
                return { key: companionKey(item.entry), ...decisions };
            });
        };

        const petDecisions = new Map(evaluate(screenedPets, MAX_ACTIVE_PETS, new Set(profile.pets.active.map(companionKey))).map(item => [item.key, item]));
        const mountDecisions = new Map(evaluate(screenedMounts, 1, new Set(profile.mount.active ? [companionKey(profile.mount.active)] : [])).map(item => [item.key, item]));
        const updateEntry = <T extends TestableCompanion>(entry: T, decision?: { melee: boolean; ranged: boolean }): T => decision ? {
            ...entry,
            optimizerTesting: {
                ...(entry.optimizerTesting || {}),
                autoMelee: decision.melee,
                autoRanged: decision.ranged,
                evaluatedAt,
            },
        } : entry;
        updateNestedProfile('pets', {
            savedBuilds: savedPets.map(entry => updateEntry(entry, petDecisions.get(companionKey(entry))))
        });
        updateNestedProfile('mount', {
            savedBuilds: savedMounts.map(entry => updateEntry(entry, mountDecisions.get(companionKey(entry))))
        });
    };

    const runCalculation = async () => {
        if (!candidate) {
            toast.info('Choose the gear item you want to test first.');
            return;
        }
        if (!isReady) {
            toast.info('Game data is still loading. Try Calculate again in a moment.');
            return;
        }
        if (calculationBusy) return;
        setCalculationBusy(true);
        setCalculationStartedAt(Date.now());
        setResult(null);
        try {
            setCalculationProgress({ percent: 3, label: 'Preparing calculations', detail: 'Reading your current profile and selected item.' });
            await yieldForPaint();
            const baselineStats = calculateProfileStats(profile);
            const scoreForGoal = (stats: AggregatedStats) => scoreBuildGoal(activeBuildGoal, stats, baselineStats, {
                enemyHealth,
                bossHealth,
                overheadSeconds: killDowntimeFor(stats),
            });

            setCalculationProgress({ percent: 8, label: 'Optimizing current companions', detail: 'Preparing pet and mount combinations.' });
            await yieldForPaint();
            const currentBest = await optimizeLoadoutAsync('balanced', profile, respectSavedLevels, scoreForGoal, (completed, total, phase) => {
                const fraction = completed / Math.max(1, total);
                setCalculationProgress({
                    percent: 8 + (phase === 'screening' ? fraction * 9 : 9 + fraction * 23),
                    label: phase === 'screening' ? 'Screening enabled current companions' : 'Optimizing current companions',
                    detail: phase === 'screening'
                        ? `Checked ${completed.toLocaleString()} of ${total.toLocaleString()} pets and mounts for goal fit.`
                        : `Tested ${completed.toLocaleString()} of ${total.toLocaleString()} shortlisted combinations.`,
                });
            }, optimizerStrategy, profile.misc.buildGoals?.weaponStyle || 'melee');
            const currentLoadout: CompanionLoadout = currentBest || { pets: profile.pets.active, mount: profile.mount.active };
            const currentOptimizedProfile = withCompanions(profile, currentLoadout);
            if (currentBest) applyAutomaticCompanionAssessment(currentBest.screenedPets, currentBest.screenedMounts, baselineStats);

            const candidateProfile: UserProfile = { ...profile, items: { ...profile.items, [slot]: candidate } };
            setCalculationProgress({ percent: 42, label: 'Calculating the new item', detail: `Applying the new ${slot} to your profile.` });
            await yieldForPaint();
            const candidateCurrentStats = calculateProfileStats(candidateProfile);

            setCalculationProgress({ percent: 45, label: 'Optimizing new-item companions', detail: 'Preparing pet and mount combinations.' });
            await yieldForPaint();
            const candidateBest = await optimizeLoadoutAsync('balanced', candidateProfile, respectSavedLevels, scoreForGoal, (completed, total, phase) => {
                const fraction = completed / Math.max(1, total);
                setCalculationProgress({
                    percent: 45 + (phase === 'screening' ? fraction * 8 : 8 + fraction * 22),
                    label: phase === 'screening' ? 'Screening enabled new-item companions' : 'Optimizing new-item companions',
                    detail: phase === 'screening'
                        ? `Checked ${completed.toLocaleString()} of ${total.toLocaleString()} pets and mounts with the new item.`
                        : `Tested ${completed.toLocaleString()} of ${total.toLocaleString()} shortlisted combinations.`,
                });
            }, optimizerStrategy, profile.misc.buildGoals?.weaponStyle || 'melee');
            const candidateLoadout: CompanionLoadout = candidateBest || { pets: candidateProfile.pets.active, mount: candidateProfile.mount.active };

            setCalculationProgress({ percent: 78, label: 'Building the stat comparison', detail: 'Calculating before, after, and goal-fit changes.' });
            await yieldForPaint();
            const currentStats = calculateProfileStats(currentOptimizedProfile);
            const candidateOptimizedProfile = withCompanions(candidateProfile, candidateLoadout);
            const candidateOptimizedStats = calculateProfileStats(candidateOptimizedProfile);

            let stagePrediction: BattleResult | null = null;
            if (stagePredictionEnabled && battleLibs.mainBattleLibrary) {
                setCalculationProgress({ percent: 82, label: 'Running stage prediction', detail: `Starting ${stagePredictionRuns.toLocaleString()} prediction runs.` });
                await yieldForPaint();
                stagePrediction = await simulateBattleMultiAsync(candidateOptimizedStats, candidateOptimizedProfile, stageAge, stageBattle, stageDifficulty, battleLibs, stagePredictionRuns, (completed, total) => {
                    setCalculationProgress({
                        percent: 82 + (completed / Math.max(1, total)) * 17,
                        label: 'Running stage prediction',
                        detail: `Completed ${completed.toLocaleString()} of ${total.toLocaleString()} prediction runs.`,
                    });
                });
            } else {
                setCalculationProgress({ percent: 96, label: 'Prediction skipped', detail: 'Quick test is finishing the stat recommendation.' });
                await yieldForPaint();
            }

            const contexts = {
                current: { enemyHealth, bossHealth, overheadSeconds: killDowntimeFor(currentStats) },
                candidateCurrent: { enemyHealth, bossHealth, overheadSeconds: killDowntimeFor(candidateCurrentStats) },
                candidateOptimized: { enemyHealth, bossHealth, overheadSeconds: killDowntimeFor(candidateOptimizedStats) },
            };
            setResult({ slot, item: candidate, current: currentStats, candidateCurrent: candidateCurrentStats, candidateOptimized: candidateOptimizedStats,
                currentLoadout, candidateLoadout,
                combinations: (currentBest?.combinations || searchSize(profile)) + (candidateBest?.combinations || searchSize(candidateProfile)),
                screened: (currentBest?.screened || 0) + (candidateBest?.screened || 0),
                strategy: optimizerStrategy, goal: activeBuildGoal, contexts,
                stage: { difficulty: stageDifficulty, age: stageAge, battle: stageBattle, predictionEnabled: stagePredictionEnabled },
                stagePrediction });
            setCalculationProgress({ percent: 100, label: 'Complete', detail: 'Your swap recommendation is ready.' });
            await yieldForPaint();
        } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : 'The swap calculation could not be completed.');
        } finally {
            setCalculationBusy(false);
        }
    };

    const resetTest = () => {
        setCandidate(null);
        setResult(null);
        setAutoStageStats(true);
    };

    const equipSwap = (includeCompanions: boolean) => {
        if (!result) return;
        const previous = profile.items[result.slot];
        if (previous) {
            const existing = profile.savedItems?.[result.slot] || [];
            updateNestedProfile('savedItems', {
                [result.slot]: [
                    { ...previous, customName: `Previous ${result.slot} · Lv. ${previous.level}` },
                    ...existing
                ]
            });
        }
        updateNestedProfile('items', { [result.slot]: result.item });
        if (includeCompanions) {
            updateNestedProfile('pets', { active: result.candidateLoadout.pets });
            updateNestedProfile('mount', { active: result.candidateLoadout.mount });
        }
        toast.success(includeCompanions
            ? `${result.slot} equipped with the best companions for ${result.goal.name}. Previous gear was saved.`
            : `${result.slot} equipped. Your current pets and mount were left unchanged.`);
    };

    const savePet = (pet: PetSlot | null) => {
        if (!pet) return;
        const inventoryPet = { ...pet, instanceId: newInstanceId('pet') };
        updateNestedProfile('pets', { savedBuilds: [inventoryPet, ...savedPets] });
        toast.success('Unequipped pet saved to inventory.');
    };

    const saveMount = (
        rarity: string | null,
        id?: number,
        level?: number,
        secondaryStats?: { statId: string; value: number }[]
    ) => {
        if (!rarity || id === undefined) return;
        const inventoryMount: MountSlot = {
            instanceId: newInstanceId('mount'),
            rarity,
            id,
            level: level || 1,
            evolution: 0,
            skills: [],
            secondaryStats: secondaryStats || []
        };
        updateNestedProfile('mount', { savedBuilds: [inventoryMount, ...savedMounts] });
        toast.success('Unequipped mount saved to inventory.');
    };

    const saveEquippedPets = () => {
        if (!profile.pets.active.length) {
            toast.info('There are no equipped pets to copy.');
            return;
        }
        const copies = profile.pets.active.map(pet => ({ ...pet, instanceId: newInstanceId('pet') }));
        updateNestedProfile('pets', { savedBuilds: [...copies, ...savedPets] });
        toast.success(`${copies.length} equipped pet${copies.length === 1 ? '' : 's'} copied to inventory.`);
    };

    const saveEquippedMount = () => {
        if (!profile.mount.active) {
            toast.info('There is no equipped mount to copy.');
            return;
        }
        const copy = { ...profile.mount.active, instanceId: newInstanceId('mount') };
        updateNestedProfile('mount', { savedBuilds: [copy, ...savedMounts] });
        toast.success('Equipped mount copied to inventory.');
    };

    const equipPet = (pet: PetSlot) => {
        const alreadyEquipped = pet.instanceId && equippedPetIds.has(pet.instanceId);
        if (alreadyEquipped) return;
        const next = profile.pets.active.length < MAX_ACTIVE_PETS
            ? [...profile.pets.active, pet]
            : [...profile.pets.active.slice(0, MAX_ACTIVE_PETS - 1), pet];
        updateNestedProfile('pets', { active: next });
        toast.success(profile.pets.active.length < MAX_ACTIVE_PETS
            ? 'Pet equipped.'
            : 'Pet equipped in the last slot.');
    };

    const equipMount = (mount: MountSlot) => {
        updateNestedProfile('mount', { active: mount });
        toast.success('Mount equipped.');
    };

    const removePet = (index: number) => {
        updateNestedProfile('pets', { savedBuilds: savedPets.filter((_, i) => i !== index) });
    };

    const removeMount = (index: number) => {
        updateNestedProfile('mount', { savedBuilds: savedMounts.filter((_, i) => i !== index) });
    };

    const setPetTestPreference = (index: number, style: CompanionWeaponStyle, enabled: boolean | null) => {
        updateNestedProfile('pets', {
            savedBuilds: savedPets.map((entry, entryIndex) => entryIndex !== index ? entry
                : enabled === null ? withAutomaticCompanionTest(entry, style) : withManualCompanionTest(entry, style, enabled))
        });
    };

    const setMountTestPreference = (index: number, style: CompanionWeaponStyle, enabled: boolean | null) => {
        updateNestedProfile('mount', {
            savedBuilds: savedMounts.map((entry, entryIndex) => entryIndex !== index ? entry
                : enabled === null ? withAutomaticCompanionTest(entry, style) : withManualCompanionTest(entry, style, enabled))
        });
    };

    const recommendation = useMemo(() => {
        if (!result) return null;
        const comparison = compareBuildGoal(result.goal, result.current, result.candidateOptimized, result.contexts.candidateOptimized);
        const change = comparison.changePercent;
        if (change > 1) return { label: 'Equip the new item', change, color: 'emerald' };
        if (change < -1) return { label: 'Keep the current item', change, color: 'red' };
        return { label: 'Sidegrade / situational', change, color: 'amber' };
    }, [result]);

    const remainingTime = calculationBusy && calculationStartedAt > 0 && calculationProgress.percent >= 3 && calculationProgress.percent < 100
        ? formatTimeRemaining((Date.now() - calculationStartedAt) * (100 - calculationProgress.percent) / calculationProgress.percent)
        : 'estimating';

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-7xl mx-auto">
            <div className="space-y-1">
                <div className="flex items-center gap-3">
                    <ArrowRightLeft className="w-8 h-8 text-accent-primary" />
                    <h1 className="text-3xl md:text-4xl font-bold text-text-primary">Swap Test</h1>
                </div>
                <p className="text-text-secondary text-sm max-w-3xl">
                    Test one gear change against your real profile and selected build objective. Equipping companions afterward is optional.
                </p>
            </div>

            <section className="bg-bg-card/60 rounded-2xl border border-border p-4 md:p-6 space-y-5">
                <div>
                    <h2 className="text-xl font-bold text-text-primary">1. Enter the item to test</h2>
                    <p className="text-xs text-text-muted mt-1">Scan a game comparison showing both item names, or pick the slot and enter the new item manually.</p>
                </div>

                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className="flex items-center gap-2 font-bold text-text-primary"><ScanLine className="h-4 w-4 text-cyan-300" /> Scan equipped + new item</div>
                            <p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">Local OCR matches both names against current game items, uses the names to determine the slot, confirms which one is equipped in your profile, and fills the other as the test item.</p>
                        </div>
                        <button type="button" disabled={swapScanBusy || !autoItemMapping} onClick={() => swapScanRef.current?.click()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
                            {swapScanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                            {swapScanBusy ? `Reading${swapScanProgress ? ` ${swapScanProgress}%` : '…'}` : 'Choose swap screenshot'}
                        </button>
                        <input ref={swapScanRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void scanSwapScreenshot(event.target.files?.[0])} />
                    </div>
                    {swapScanSummary && <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-200">{swapScanSummary}</p>}
                    {swapScanError && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">{swapScanError}</p>}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                    {EQUIPMENT_SLOTS.map(value => (
                        <button
                            key={value}
                            onClick={() => { setSlot(value); setCandidate(null); }}
                            className={cn(
                                'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                                slot === value
                                    ? 'bg-accent-primary/20 border-accent-primary/50 text-text-primary'
                                    : 'border-border text-text-secondary hover:bg-white/5'
                            )}
                        >
                            {value}
                        </button>
                    ))}
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                    <ItemSummary title="Currently equipped" item={currentItem} icon={<Shield className="w-4 h-4" />} secondaryStatLibrary={secondaryStatLibrary} />
                    <button
                        onClick={() => setItemModalOpen(true)}
                        className="text-left rounded-xl border border-dashed border-accent-primary/50 bg-accent-primary/5 p-4 hover:bg-accent-primary/10 transition-colors"
                    >
                        <div className="flex items-center gap-2 text-sm font-bold text-accent-primary mb-2">
                            <PackagePlus className="w-4 h-4" />
                            {candidate ? 'Edit test item' : 'Add test item'}
                        </div>
                        <div className="text-text-primary">{describeItem(candidate)}</div>
                        <div className="text-xs text-text-muted mt-1">{candidate ? describeSubstats(candidate.secondaryStats) : 'Select age, item, level, skin and special stats.'}</div>
                        {candidate && <PerfectionDisplay item={candidate} secondaryStatLibrary={secondaryStatLibrary} />}
                    </button>
                </div>
            </section>

            <section className="bg-bg-card/60 rounded-2xl border border-border p-4 md:p-6 space-y-5">
                <div>
                    <h2 className="text-xl font-bold text-text-primary">2. Calculator assumptions</h2>
                    <p className="text-xs text-text-muted mt-1">These only affect the recommendation display; the character stat engine uses your actual profile and tech tree.</p>
                </div>

                <BuildGoalSelector
                    compact
                    value={profile.misc.buildGoals}
                    onChange={buildGoals => {
                        updateNestedProfile('misc', { buildGoals });
                    }}
                />

                <div className="rounded-xl border border-border bg-bg-primary/30 p-4 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <div className="text-sm font-bold text-text-primary">Main Battle stage</div>
                            <p className="text-xs text-text-muted mt-1">
                                Uses the exact Main Battle configuration and enemy scaling from Progress Prediction.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => {
                                    setStagePredictionEnabled(value => !value);
                                }}
                                className={cn(
                                    'rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                                    stagePredictionEnabled
                                        ? 'bg-blue-500/15 border-blue-400/40 text-blue-300'
                                        : 'border-border text-text-secondary'
                                )}
                            >
                                Stage prediction: {stagePredictionEnabled ? 'On' : 'Off · Quick test'}
                            </button>
                            <button
                                onClick={() => setAutoStageStats(value => !value)}
                                className={cn(
                                    'rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                                    autoStageStats
                                        ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                        : 'border-border text-text-secondary'
                                )}
                            >
                                Auto-fill: {autoStageStats ? 'On' : 'Manual override'}
                            </button>
                        </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3">
                        <label className="space-y-1">
                            <span className="text-xs text-text-muted">Difficulty</span>
                            <select
                                value={stageDifficulty}
                                onChange={event => {
                                    setStageDifficulty(Number(event.target.value));
                                }}
                                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                            >
                                <option value={0}>Normal</option>
                                <option value={1}>Hard</option>
                            </select>
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs text-text-muted">Age</span>
                            <select
                                value={stageAge}
                                onChange={event => {
                                    setStageAge(Number(event.target.value));
                                    setStageBattle(0);
                                }}
                                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                            >
                                {Array.from({ length: maxAgeIdx + 1 }, (_, age) => (
                                    <option key={age} value={age}>Age {age + 1}{AGES[age] ? ` · ${AGES[age]}` : ''}</option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs text-text-muted">Stage</span>
                            <select
                                value={stageBattle}
                                onChange={event => {
                                    setStageBattle(Number(event.target.value));
                                }}
                                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                            >
                                {Array.from({ length: battleCount }, (_, battle) => (
                                    <option key={battle} value={battle}>Stage {battle + 1}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className={cn(
                        'grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end transition-opacity',
                        !stagePredictionEnabled && 'opacity-50'
                    )}>
                        <label className="space-y-1">
                            <span className="text-xs text-text-muted">Stage prediction runs</span>
                            <input
                                type="number"
                                min={1}
                                max={1000}
                                step={1}
                                value={stagePredictionRuns}
                                disabled={!stagePredictionEnabled}
                                onChange={event => {
                                    const nextRuns = Math.max(1, Math.min(1000, Math.round(Number(event.target.value) || 10)));
                                    setStagePredictionRuns(nextRuns);
                                }}
                                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                            />
                        </label>
                        <p className="text-[11px] leading-5 text-text-muted">
                            {stagePredictionEnabled
                                ? 'Only the selected difficulty, age, and stage are simulated. The default is 10 runs for speed; increasing it improves confidence but takes longer.'
                                : 'Quick test skips battle simulation completely. Your full before-and-after stat comparison still runs.'}
                        </p>
                    </div>

                    {stageSummary ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                            <StageFact label="Average enemy HP" value={formatNumber(stageSummary.averageEnemyHealth)} />
                            <StageFact label="Final wave HP" value={formatNumber(stageSummary.finalWaveHealth)} />
                            <StageFact label="Total stage HP" value={formatNumber(stageSummary.totalStageHealth)} />
                            <StageFact label="Average enemy hit" value={formatNumber(stageSummary.averageEnemyDamage)} />
                            <StageFact label="Strongest enemy hit" value={formatNumber(stageSummary.maxEnemyDamage)} />
                            <StageFact label="Stage size" value={`${stageSummary.enemyCount} enemies · ${stageSummary.waveCount} waves`} />
                        </div>
                    ) : (
                        <div className="text-xs text-text-muted">
                            {battleDataLoading ? 'Loading Main Battle stage data…' : 'No Main Battle data was found for this stage.'}
                        </div>
                    )}
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                    <NumberField label="Average enemy health" value={enemyHealth} onChange={value => { setEnemyHealth(value); setAutoStageStats(false); }} />
                    <NumberField label="Boss / final wave health" value={bossHealth} onChange={value => { setBossHealth(value); setAutoStageStats(false); }} />
                    <NumberField label={`Time between kills (sec)${autoStageStats ? ' · Auto' : ''}`} value={overheadSeconds} onChange={value => { setOverheadSeconds(value); setAutoStageStats(false); }} step="0.01" disabled={autoStageStats} />
                </div>
                <p className="text-[11px] leading-5 text-text-muted">
                    Auto timing uses the same battle model as Progress Prediction: stage wave count, enemy spawn distance, movement speed, your weapon range, and the one-second delay between waves. Switch Auto-fill off only to test a custom farming delay.
                </p>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setRespectSavedLevels(v => !v)}
                        className={cn(
                            'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                            respectSavedLevels
                                ? 'bg-accent-primary/15 border-accent-primary/40 text-text-primary'
                                : 'border-border text-text-secondary'
                        )}
                    >
                        Companion levels: {respectSavedLevels ? 'Use saved levels' : 'Compare special stats at level 1'}
                    </button>
                    <button
                        onClick={() => setOptimizerStrategy(value => value === 'fast' ? 'exact' : 'fast')}
                        className={cn(
                            'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                            optimizerStrategy === 'fast'
                                ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200'
                                : 'bg-violet-500/15 border-violet-400/40 text-violet-200'
                        )}
                    >
                        Companion search: {optimizerStrategy === 'fast' ? 'Fast shortlist' : 'Exact enabled combinations'}
                    </button>
                </div>
                <p className="text-[11px] leading-5 text-text-muted">
                    Fast mode checks every newly added, enabled, and equipped companion, then tests combinations of the strongest goal-fit choices and stat specialists. Exact mode tests every enabled combination and may take much longer.
                </p>

                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void runCalculation()} disabled={!candidate || !isReady || calculationBusy} className="gap-2">
                        {calculationBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                        {calculationBusy ? calculationProgress.label : 'Calculate swap'}
                    </Button>
                    <Button variant="ghost" onClick={resetTest} disabled={calculationBusy} className="gap-2">
                        <RotateCcw className="w-4 h-4" />
                        Reset
                    </Button>
                    {!isReady && <span className="self-center text-xs text-text-muted">Loading game calculation data…</span>}
                </div>
                {calculationBusy && <div className="rounded-xl border border-blue-400/30 bg-blue-500/5 p-4" role="status" aria-live="polite">
                    <div className="flex items-center justify-between gap-3 text-sm"><strong className="text-text-primary">{calculationProgress.label}</strong><span className="font-mono font-bold text-blue-300">{Math.round(calculationProgress.percent)}% · {remainingTime}</span></div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400 transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, calculationProgress.percent))}%` }} /></div>
                    <p className="mt-2 text-xs leading-5 text-text-muted">{calculationProgress.detail}</p>
                </div>}
            </section>

            {result && recommendation && (
                <section className={cn(
                    'rounded-2xl border p-4 md:p-6 space-y-5',
                    recommendation.color === 'emerald' && 'bg-emerald-950/30 border-emerald-500/30',
                    recommendation.color === 'red' && 'bg-red-950/30 border-red-500/30',
                    recommendation.color === 'amber' && 'bg-amber-950/30 border-amber-500/30'
                )}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-text-muted">{result.goal.name} recommendation</div>
                            <h2 className="text-2xl font-bold text-text-primary mt-1">{recommendation.label}</h2>
                            <p className="text-sm text-text-secondary mt-1">
                                {recommendation.change >= 0 ? '+' : ''}{recommendation.change.toFixed(2)}% after companion re-optimization.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">
                                {result.strategy === 'fast'
                                    ? `Fast · ${result.screened.toLocaleString()} screened · ${result.combinations.toLocaleString()} combinations`
                                    : `Exact · ${result.combinations.toLocaleString()} combinations`}
                            </span>
                            <Button variant="outline" onClick={() => equipSwap(false)} className="gap-2">
                                <Check className="w-4 h-4" />
                                Equip item only
                            </Button>
                            <Button onClick={() => equipSwap(true)} className="gap-2">
                                <Check className="w-4 h-4" />
                                Equip item + goal companions
                            </Button>
                        </div>
                    </div>

                    <p className="rounded-lg border border-border bg-bg-primary/20 px-3 py-2 text-xs text-text-muted">
                        This completed result stays visible while you change goals, stages, or equipment. Press Calculate swap to replace it, or Reset to clear it.
                    </p>

                    <div className={cn(
                        'rounded-xl border p-4',
                        !result.stage.predictionEnabled
                            ? 'border-border bg-bg-primary/20'
                            : result.stagePrediction && result.stagePrediction.winProbability >= 50
                                ? 'border-emerald-400/40 bg-emerald-500/10'
                                : 'border-red-400/40 bg-red-500/10'
                    )}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                    <Target className="h-4 w-4" /> New-item stage prediction
                                </div>
                                <p className="mt-1 text-xs text-text-secondary">
                                    {result.stage.difficulty === 1 ? 'Hard' : 'Normal'} {result.stage.age + 1}-{result.stage.battle + 1}, with the new item and its best companion loadout.
                                </p>
                            </div>
                            {!result.stage.predictionEnabled ? (
                                <div className="text-xs font-bold text-text-muted">Skipped · Quick test</div>
                            ) : result.stagePrediction ? (
                                <div className="text-left sm:text-right">
                                    <div className={cn('text-lg font-black', result.stagePrediction.winProbability >= 50 ? 'text-emerald-300' : 'text-red-300')}>
                                        {result.stagePrediction.winProbability >= 50 ? 'Predicted pass' : 'Predicted fail'}
                                    </div>
                                    <div className="text-xs font-mono text-text-secondary">
                                        {result.stagePrediction.winProbability.toFixed(1)}% win chance · {result.stagePrediction.totalRuns} runs
                                    </div>
                                </div>
                            ) : <div className="text-xs text-text-muted">Stage prediction unavailable</div>}
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-3 gap-3">
                        <MetricCard title="Current, optimized" stats={result.current} baseline={result.current} goal={result.goal} context={result.contexts.current} />
                        <MetricCard title="New item, current companions" stats={result.candidateCurrent} baseline={result.current} goal={result.goal} context={result.contexts.candidateCurrent} />
                        <MetricCard title="New item, re-optimized" stats={result.candidateOptimized} baseline={result.current} goal={result.goal} context={result.contexts.candidateOptimized} highlight />
                    </div>

                    <StatComparison current={result.current} candidateCurrent={result.candidateCurrent} candidateOptimized={result.candidateOptimized} />

                    <div className="grid md:grid-cols-2 gap-3">
                        <LoadoutSummary title="Best companions on current gear" loadout={result.currentLoadout} petName={petName} mountName={mountName} secondaryStatLibrary={secondaryStatLibrary} />
                        <LoadoutSummary title="Best companions after swap" loadout={result.candidateLoadout} petName={petName} mountName={mountName} secondaryStatLibrary={secondaryStatLibrary} highlight />
                    </div>
                </section>
            )}

            <section className="bg-bg-card/60 rounded-2xl border border-border p-4 md:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <PawPrint className="w-5 h-5 text-accent-primary" />
                            <h2 className="text-xl font-bold text-text-primary">Unequipped companion inventory</h2>
                        </div>
                        <p className="text-xs text-text-muted mt-1 max-w-2xl">
                            Melee and Ranged testing are controlled separately. New companions start enabled for both; Auto may skip a style only after the companion is dominated across every goal and specialist stat. You can override either choice.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => setPetModalOpen(true)} className="gap-1.5">
                            <PackagePlus className="w-4 h-4" /> Add pet
                        </Button>
                        <Button size="sm" onClick={() => setMountModalOpen(true)} className="gap-1.5">
                            <PackagePlus className="w-4 h-4" /> Add mount
                        </Button>
                        <Button size="sm" variant="secondary" onClick={saveEquippedPets}>Copy equipped pets</Button>
                        <Button size="sm" variant="secondary" onClick={saveEquippedMount}>Copy equipped mount</Button>
                    </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-5">
                    <InventoryColumn
                        title={`Pets (${savedPets.length})`}
                        empty="No unequipped pets saved yet."
                    >
                        {savedPets.map((pet, index) => {
                            const equipped = !!pet.instanceId && equippedPetIds.has(pet.instanceId);
                            return (
                                <InventoryRow
                                    key={pet.instanceId || `pet-${index}`}
                                    title={petName(pet)}
                                    subtitle={`Lv. ${pet.level} · ID ${pet.instanceId || 'legacy'}`}
                                    perfection={getPerfection(pet as any, secondaryStatLibrary)}
                                    equipped={equipped}
                                    entry={pet}
                                    mergeMaterial={!equipped && isAutomaticMergeMaterial(pet)}
                                    onEquip={() => equipPet(pet)}
                                    onRemove={() => removePet(index)}
                                    onTestChange={(style, enabled) => setPetTestPreference(index, style, enabled)}
                                />
                            );
                        })}
                    </InventoryColumn>

                    <InventoryColumn
                        title={`Mounts (${savedMounts.length})`}
                        empty="No unequipped mounts saved yet."
                    >
                        {savedMounts.map((mount, index) => {
                            const equipped = !!mount.instanceId && equippedMountId === mount.instanceId;
                            return (
                                <InventoryRow
                                    key={mount.instanceId || `mount-${index}`}
                                    title={mountName(mount)}
                                    subtitle={`Lv. ${mount.level} · ID ${mount.instanceId || 'legacy'}`}
                                    perfection={getPerfection(mount as any, secondaryStatLibrary)}
                                    equipped={equipped}
                                    entry={mount}
                                    mergeMaterial={!equipped && isAutomaticMergeMaterial(mount)}
                                    onEquip={() => equipMount(mount)}
                                    onRemove={() => removeMount(index)}
                                    onTestChange={(style, enabled) => setMountTestPreference(index, style, enabled)}
                                />
                            );
                        })}
                    </InventoryColumn>
                </div>
            </section>

            <ItemSelectorModal
                isOpen={itemModalOpen}
                onClose={() => setItemModalOpen(false)}
                onSelect={item => setCandidate(item)}
                slot={slot}
                current={candidate || currentItem}
                forgeAscensionLevel={profile.misc.forgeAscensionLevel}
            />
            <PetSelectorModal
                isOpen={petModalOpen}
                onClose={() => setPetModalOpen(false)}
                onSelect={savePet}
                petAscensionLevel={profile.misc.petAscensionLevel}
            />
            <MountSelectorModal
                isOpen={mountModalOpen}
                onClose={() => setMountModalOpen(false)}
                onSelect={saveMount}
                mountAscensionLevel={profile.misc.mountAscensionLevel}
            />
        </div>
    );
}

function NumberField({
    label, value, onChange, step = '1', disabled = false
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    step?: string;
    disabled?: boolean;
}) {
    return (
        <label className="space-y-1">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            <input
                type="number"
                min="0"
                step={step}
                value={value}
                disabled={disabled}
                onChange={event => onChange(Math.max(0, Number(event.target.value) || 0))}
                className="w-full h-10 rounded-lg border border-border bg-bg-input px-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary disabled:cursor-default disabled:opacity-70"
            />
        </label>
    );
}

function PerfectionDisplay({ item, secondaryStatLibrary }: { item: { secondaryStats?: { statId: string; value: number }[] }; secondaryStatLibrary: any }) {
    return (
        <div className="mt-3 rounded-lg border border-border/60 bg-bg-primary/20 px-3 py-2">
            <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-text-muted">Perfection</div>
            <PerfectionMeter value={getPerfection(item as any, secondaryStatLibrary)} />
        </div>
    );
}

function ItemSummary({ title, item, icon, secondaryStatLibrary }: { title: string; item: ItemSlot | null; icon: React.ReactNode; secondaryStatLibrary: any }) {
    return (
        <div className="rounded-xl border border-border bg-bg-input/20 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-text-secondary mb-2">{icon}{title}</div>
            <div className="text-text-primary">{describeItem(item)}</div>
            <div className="text-xs text-text-muted mt-1">{item ? describeSubstats(item.secondaryStats) : 'No item equipped.'}</div>
            {item && <PerfectionDisplay item={item} secondaryStatLibrary={secondaryStatLibrary} />}
        </div>
    );
}

function MetricCard({
    title, stats, baseline, goal, context, highlight
}: {
    title: string;
    stats: AggregatedStats;
    baseline: AggregatedStats;
    goal: BuildGoalDefinition;
    context: BuildGoalContext;
    highlight?: boolean;
}) {
    const primary = scoreBuildGoal(goal, stats, baseline, context).toFixed(2);
    return (
        <div className={cn('rounded-xl border p-4', highlight ? 'border-blue-400/40 bg-blue-500/10' : 'border-border bg-bg-input/20')}>
            <div className="text-xs text-text-muted">{title}</div>
            <div className="text-xl font-bold text-text-primary mt-1">{primary} <span className="text-xs font-medium text-text-muted">goal fit</span></div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div><span className="text-text-muted">DPS</span><div className="font-mono text-orange-300">{formatNumber(stats.realTotalDps)}</div></div>
                <div><span className="text-text-muted">HPS</span><div className="font-mono text-emerald-300">{formatNumber(stats.realTotalHps)}</div></div>
            </div>
        </div>
    );
}

function StageFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border/70 bg-bg-input/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
            <div className="mt-1 text-sm font-bold text-text-primary">{value}</div>
        </div>
    );
}

function StatComparison({
    current, candidateCurrent, candidateOptimized
}: {
    current: AggregatedStats;
    candidateCurrent: AggregatedStats;
    candidateOptimized: AggregatedStats;
}) {
    type Row = { group: string; label: string; read: (s: AggregatedStats) => number; kind?: 'number' | 'percent' | 'multiplier' | 'seconds' };
    const rows: Row[] = [
        { group: 'Headline', label: 'Real total DPS', read: s => s.realTotalDps },
        { group: 'Headline', label: 'Average total DPS', read: s => s.averageTotalDps },
        { group: 'Headline', label: 'Real total HPS', read: s => s.realTotalHps },
        { group: 'Headline', label: 'Theoretical total HPS', read: s => s.theoreticalTotalHps },
        { group: 'Headline', label: 'Power', read: s => s.power },
        { group: 'Damage sources', label: 'Total damage', read: s => s.totalDamage },
        { group: 'Damage sources', label: 'Item damage', read: s => s.itemDamage },
        { group: 'Damage sources', label: 'Weapon damage', read: s => s.weaponDamage },
        { group: 'Damage sources', label: 'Pet damage', read: s => s.petDamage },
        { group: 'Damage sources', label: 'Mount damage', read: s => s.mountDamage },
        { group: 'Damage sources', label: 'Passive skill damage', read: s => s.skillPassiveDamage },
        { group: 'Damage sources', label: 'Real weapon DPS', read: s => s.realWeaponDps },
        { group: 'Damage sources', label: 'Skill DPS', read: s => s.skillDps },
        { group: 'Damage sources', label: 'Skill buff DPS', read: s => s.skillBuffDps },
        { group: 'Health sources', label: 'Total health', read: s => s.totalHealth },
        { group: 'Health sources', label: 'Item health', read: s => s.itemHealth },
        { group: 'Health sources', label: 'Pet health', read: s => s.petHealth },
        { group: 'Health sources', label: 'Mount health', read: s => s.mountHealth },
        { group: 'Health sources', label: 'Passive skill health', read: s => s.skillPassiveHealth },
        { group: 'Health sources', label: 'Skill HPS', read: s => s.skillHps },
        { group: 'Combat multipliers', label: 'Damage multiplier', read: s => s.damageMultiplier, kind: 'multiplier' },
        { group: 'Combat multipliers', label: 'Health multiplier', read: s => s.healthMultiplier, kind: 'multiplier' },
        { group: 'Combat multipliers', label: 'Melee damage multiplier', read: s => s.meleeDamageMultiplier, kind: 'multiplier' },
        { group: 'Combat multipliers', label: 'Ranged damage multiplier', read: s => s.rangedDamageMultiplier, kind: 'multiplier' },
        { group: 'Combat multipliers', label: 'Skill damage multiplier', read: s => s.skillDamageMultiplier, kind: 'multiplier' },
        { group: 'Combat multipliers', label: 'Skill healing multiplier', read: s => s.skillHealthMultiplier, kind: 'multiplier' },
        { group: 'Combat rates', label: 'Attack speed', read: s => s.attackSpeedMultiplier, kind: 'multiplier' },
        { group: 'Combat rates', label: 'Critical chance', read: s => s.criticalChance, kind: 'percent' },
        { group: 'Combat rates', label: 'Critical damage', read: s => s.criticalDamage, kind: 'multiplier' },
        { group: 'Combat rates', label: 'Double chance', read: s => s.doubleDamageChance, kind: 'percent' },
        { group: 'Combat rates', label: 'Lifesteal', read: s => s.lifeSteal, kind: 'percent' },
        { group: 'Combat rates', label: 'Health regen', read: s => s.healthRegen, kind: 'percent' },
        { group: 'Combat rates', label: 'Block chance', read: s => s.blockChance, kind: 'percent' },
        { group: 'Combat rates', label: 'Reflect chance', read: s => s.reflectChance, kind: 'percent' },
        { group: 'Combat rates', label: 'Skill cooldown reduction', read: s => s.skillCooldownReduction, kind: 'percent' },
        { group: 'Timing', label: 'Real attacks per second', read: s => s.realAps },
        { group: 'Timing', label: 'Attack cycle', read: s => s.realCycleTime, kind: 'seconds' },
        { group: 'Timing', label: 'Double-hit cycle', read: s => s.realDoubleHitCycle, kind: 'seconds' },
        { group: 'Utility', label: 'Move speed', read: s => s.moveSpeed, kind: 'percent' },
        { group: 'Utility', label: 'Experience multiplier', read: s => s.experienceMultiplier, kind: 'multiplier' },
        { group: 'Utility', label: 'Sell price multiplier', read: s => s.sellPriceMultiplier, kind: 'multiplier' },
        { group: 'Utility', label: 'Forge freebie chance', read: s => s.forgeFreebieChance, kind: 'percent' },
        { group: 'Utility', label: 'Egg freebie chance', read: s => s.eggFreebieChance, kind: 'percent' },
        { group: 'Utility', label: 'Mount freebie chance', read: s => s.mountFreebieChance, kind: 'percent' },
    ];
    const renderValue = (row: Row, value: number) => row.kind === 'percent' ? `${(value * 100).toFixed(2)}%` : row.kind === 'multiplier' ? `${value.toFixed(3)}×` : row.kind === 'seconds' ? `${value.toFixed(2)}s` : formatNumber(value);
    const renderChange = (row: Row) => {
        const before = row.read(current);
        const after = row.read(candidateOptimized);
        const delta = after - before;
        if (row.kind === 'percent') return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)} pp`;
        if (row.kind === 'multiplier') return `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}×`;
        if (row.kind === 'seconds') return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}s`;
        return `${delta >= 0 ? '+' : ''}${formatNumber(delta)}`;
    };
    const groups = [...new Set(rows.map(row => row.group))];

    return (
        <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-bg-input/50 text-text-muted text-xs">
                    <tr>
                        <th className="text-left p-3">Stat</th>
                        <th className="text-right p-3">Before</th>
                        <th className="text-right p-3">After, current companions</th>
                        <th className="text-right p-3">After, best companions</th>
                        <th className="text-right p-3">Change</th>
                        <th className="text-right p-3">Change %</th>
                    </tr>
                </thead>
                <tbody>
                    {groups.flatMap(group => [
                        <tr key={`${group}-heading`} className="border-t border-border bg-bg-input/30"><td colSpan={6} className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-accent-primary">{group}</td></tr>,
                        ...rows.filter(row => row.group === group).map(row => {
                            const before = row.read(current);
                            const after = row.read(candidateOptimized);
                            const delta = after - before;
                            const percent = before === 0 ? (after === 0 ? 0 : 100) : delta / Math.abs(before) * 100;
                            const tone = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-red-300' : 'text-text-muted';
                            return <tr key={row.label} className="border-t border-border/60">
                                <td className="p-3 text-text-secondary">{row.label}</td>
                                <td className="p-3 text-right font-mono text-text-primary">{renderValue(row, before)}</td>
                                <td className="p-3 text-right font-mono text-text-primary">{renderValue(row, row.read(candidateCurrent))}</td>
                                <td className="p-3 text-right font-mono text-blue-300">{renderValue(row, after)}</td>
                                <td className={cn('p-3 text-right font-mono font-bold', tone)}>{renderChange(row)}</td>
                                <td className={cn('p-3 text-right font-mono font-bold', tone)}>{percent >= 0 ? '+' : ''}{percent.toFixed(2)}%</td>
                            </tr>;
                        })
                    ])}
                </tbody>
            </table>
        </div>
    );
}

function LoadoutSummary({
    title, loadout, petName, mountName, secondaryStatLibrary, highlight
}: {
    title: string;
    loadout: CompanionLoadout;
    petName: (pet: PetSlot) => string;
    mountName: (mount: MountSlot) => string;
    secondaryStatLibrary: any;
    highlight?: boolean;
}) {
    return (
        <div className={cn('rounded-xl border p-4 space-y-2', highlight ? 'border-blue-400/40 bg-blue-500/10' : 'border-border bg-bg-input/20')}>
            <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                <Trophy className="w-4 h-4 text-blue-400" />{title}
            </div>
            {loadout.pets.length ? loadout.pets.map((pet, index) => (
                <div key={pet.instanceId || index} className="rounded-lg border border-border/40 bg-bg-primary/20 p-2 text-xs text-text-secondary"><div>Pet {index + 1}: {petName(pet)}</div><PerfectionMeter value={getPerfection(pet as any, secondaryStatLibrary)} className="mt-1.5" barClassName="h-1.5" /></div>
            )) : <div className="text-xs text-text-muted">No pets equipped</div>}
            <div className="rounded-lg border border-border/40 bg-bg-primary/20 p-2 text-xs text-text-secondary"><div>Mount: {loadout.mount ? mountName(loadout.mount) : 'None'}</div>{loadout.mount && <PerfectionMeter value={getPerfection(loadout.mount as any, secondaryStatLibrary)} className="mt-1.5" barClassName="h-1.5" />}</div>
        </div>
    );
}

function InventoryColumn({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
    const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
    return (
        <div className="space-y-2">
            <h3 className="text-sm font-bold text-text-primary">{title}</h3>
            {hasChildren ? children : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">{empty}</div>
            )}
        </div>
    );
}

function InventoryRow({
    title, subtitle, perfection, equipped, entry, mergeMaterial, onEquip, onRemove, onTestChange
}: {
    title: string;
    subtitle: string;
    perfection: number | null;
    equipped: boolean;
    entry: TestableCompanion;
    mergeMaterial: boolean;
    onEquip: () => void;
    onRemove: () => void;
    onTestChange: (style: CompanionWeaponStyle, enabled: boolean | null) => void;
}) {
    return (
        <div className={cn('rounded-xl border bg-bg-input/20 p-3', mergeMaterial ? 'border-red-500/70 bg-red-950/15' : 'border-border')}>
            <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-accent-primary/10">
                <Sparkles className="w-4 h-4 text-accent-primary" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="text-sm text-text-primary break-words">{title}</div>
                <div className="text-[11px] text-text-muted mt-1 font-mono">{subtitle}</div>
                <div className={cn('mt-1 text-[10px] font-bold', mergeMaterial ? 'text-red-300' : 'text-cyan-300')}>{automaticCompanionFit(entry)}</div>
                {mergeMaterial && <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-red-300">Merge material · poor for every melee and ranged goal</div>}
                <div className="mt-2 max-w-xs"><div className="mb-1 text-[9px] font-black uppercase tracking-wider text-text-muted">Perfection</div><PerfectionMeter value={perfection} barClassName="h-1.5" /></div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant={equipped ? 'secondary' : 'outline'} onClick={onEquip} disabled={equipped}>
                    {equipped ? 'Equipped' : 'Equip'}
                </Button>
                <button
                    onClick={onRemove}
                    className="p-2 rounded-lg text-red-400 hover:bg-red-500/10"
                    title="Remove from inventory"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(['melee', 'ranged'] as CompanionWeaponStyle[]).map(style => {
                    const enabled = companionTestEnabled(entry, style);
                    const mode = companionTestMode(entry, style);
                    return <div key={style} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-bg-primary/20 px-2.5 py-2">
                        <button type="button" aria-pressed={enabled} onClick={() => onTestChange(style, !enabled)} className={cn('text-xs font-bold', enabled ? 'text-emerald-300' : 'text-text-muted')}>
                            {style === 'melee' ? 'Melee' : 'Ranged'}: {enabled ? 'Test' : 'Skip'}
                        </button>
                        {mode === 'manual'
                            ? <button type="button" onClick={() => onTestChange(style, null)} className="text-[10px] font-bold text-amber-300 hover:text-amber-200">Manual · use Auto</button>
                            : <span className="text-[10px] font-bold text-text-muted">Auto</span>}
                    </div>;
                })}
            </div>
        </div>
    );
}
