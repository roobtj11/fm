export interface ItemSlot {
    age: number; // Tier/Level bracket (corresponds to "Age" in JSON)
    idx: number; // Index within the tier (corresponds to "Idx" in JSON)
    level: number;
    rarity: string; // "Common", "Rare", "Epic", "Legendary", "Ultimate", "Mythic" - display or derived, but useful for filtering
    secondaryStats: {
        statId: string;
        value: number;
    }[];
    skin?: {
        idx: number;
        type?: string; // Cache the skin type (e.g. "Helmet", "Armour") for easier lookup
        stats: { [statType: string]: number };
    };
}

export interface PetSlot {
    /** Stable inventory identity so duplicate copies of the same pet stay distinct. */
    instanceId?: string;
    rarity: string;
    id: number;
    level: number;
    evolution: number;
    ascensionLevel?: number;
    secondaryStats?: {
        statId: string;
        value: number;
    }[];
    customName?: string;
    hp?: number;
}

export interface MountSlot {
    /** Stable inventory identity so duplicate copies of the same mount stay distinct. */
    instanceId?: string;
    rarity: string;
    id: number;
    level: number;
    evolution: number;
    ascensionLevel?: number;
    skills: number[];
    secondaryStats?: {
        statId: string;
        value: number;
    }[];
    customName?: string;
    hp?: number;
}

export interface SkillSlot {
    id: string; // e.g., "Meat"
    rarity: string;
    level: number;
    evolution: number;
    ascensionLevel?: number;
}

export type SteppingStoneChoice = 'up' | 'down';
export type SteppingStoneOutcome = 'safe' | 'fall';
export type SteppingStonePredictionModel = 'balanced_50' | 'balanced_bayesian' | 'best_observed';
export type SteppingStonePredictionScope = 'whole_run' | 'per_stone';
export type SteppingStoneDataSource = 'my_data' | 'all_users' | 'combined';

export interface SteppingStoneEntry {
    id: string;
    stone: number;
    choice: SteppingStoneChoice;
    outcome: SteppingStoneOutcome;
    recordedAt: string;
}

export interface SteppingStoneAttempt {
    id: string;
    startedAt: string;
    finishedAt?: string;
    entries: SteppingStoneEntry[];
}

export interface SteppingStonesTracker {
    attempts: SteppingStoneAttempt[];
    currentAttemptId?: string;
    targetStones: number;
    predictionModel?: SteppingStonePredictionModel;
    predictionScope?: SteppingStonePredictionScope;
    dataSource?: SteppingStoneDataSource;
}

export type BuildGoalMetric =
    | 'real_dps' | 'real_hps' | 'total_health' | 'power'
    | 'weapon_dps' | 'skill_dps' | 'farm_rate' | 'boss_rate'
    | 'crit_chance' | 'crit_damage' | 'double_chance'
    | 'lifesteal' | 'health_regen' | 'block_chance'
    | 'attack_speed' | 'move_speed' | 'skill_cooldown'
    | 'melee_weapon_match' | 'ranged_weapon_match'
    | 'damage_substat' | 'health_substat'
    | 'melee_damage_substat' | 'ranged_damage_substat'
    | 'skill_damage_substat' | 'crit_chance_substat'
    | 'crit_damage_substat' | 'double_chance_substat'
    | 'lifesteal_substat' | 'health_regen_substat'
    | 'block_chance_substat' | 'attack_speed_substat'
    | 'move_speed_substat' | 'skill_cooldown_substat';

export interface BuildGoalRule {
    metric: BuildGoalMetric;
    weight: number;
    target?: number;
    minimum?: number;
    maximum?: number;
    required?: boolean;
    ignored?: boolean;
}

export interface CustomBuildGoal {
    id: string;
    name: string;
    description: string;
    rules: BuildGoalRule[];
}

export interface BuildGoalSettings {
    activeGoalId: string;
    customGoals: CustomBuildGoal[];
    weaponStyle: 'melee' | 'ranged';
}

export type FairyName = 'Mira' | 'Tira' | 'Lora';

export interface FairySettings {
    active: FairyName;
    level: number;
    useManualSources?: boolean;
    manualSources?: {
        skillDamage?: number;
        skillCooldown?: number;
        health?: number;
    };
    expiresAt?: string;
}

export type ScannerTrainingField = 'kind' | 'name' | 'rarity' | 'level' | 'slot' | 'age' | 'stat_name' | 'stat_value';

export interface ScannerTrainingExample {
    id: string;
    kind: 'item' | 'pet' | 'mount';
    field: ScannerTrainingField;
    region: { x: number; y: number; width: number; height: number };
    aspectRatio: number;
    observedText?: string;
    correctedValue: string;
    createdAt: string;
}

export interface UserProfile {
    id: string; // Unique identifier for the profile
    name: string;
    iconIndex: number; // Index in the versioned CardIcons.png spritesheet
    version: number;
    isShared?: boolean;

    items: {
        Weapon: ItemSlot | null;
        Helmet: ItemSlot | null;
        Body: ItemSlot | null;
        Gloves: ItemSlot | null;
        Belt: ItemSlot | null;
        Necklace: ItemSlot | null;
        Ring: ItemSlot | null;
        Shoe: ItemSlot | null; // Note: Review if "Shoes" or "Shoe" in JSON keys
    };

    savedItems: {
        [slot: string]: (ItemSlot & { customName?: string })[];
    };

    techTree: {
        Forge: { [nodeId: number]: number };
        Power: { [nodeId: number]: number };
        SkillsPetTech: { [nodeId: number]: number };
        Clan: { [nodeId: number]: number };
    };

    pets: {
        active: PetSlot[];
        collection: {
            [key: string]: PetSlot; // Key: `${rarity}_${id}`
        };
        savedBuilds: PetSlot[];
    };

    mount: {
        active: MountSlot | null;
        collection: { [key: string]: MountSlot };
        savedBuilds: MountSlot[];
    };

    skills: {
        equipped: SkillSlot[];
        collection: { [key: string]: SkillSlot };
        passives: { [skillId: string]: number }; // skillId -> level (0 = not owned)
    };

    misc: {
        forgeLevel: number;
        forgeAscensionLevel?: number;
        petAscensionLevel?: number;
        skillAscensionLevel?: number;
        mountAscensionLevel?: number;
        dungeonLevels: {
            [dungeonId: string]: number; // e.g. "Dungeon_Hammer" -> 50
        };
        eggSlots: number;
        eggStage?: number; // Persisted selection for Drop Rates tab
        dungeonKeys?: number; // Persisted for Drop Predictor
        researchLevel: number;
        forgeCalculator?: {
            hammers: string;
            targetGold: string;
            mode: 'hammers' | 'gold';
            usePlayerItems?: boolean;
            autoForgeSummons?: number;
            autoForgeInterval?: number;
        };
        skillCalculatorLevel?: number;
        skillCalculatorTickets?: number;
        mountCalculatorLevel?: number;
        mountCalculatorProgress?: number;
        mountCalculatorWinders?: number;
        eggSummonLevel?: number;
        eggSummonProgress?: number;
        eggshellCount?: number;
        techPotions?: number;
        dungeonKeyCounts?: {
            Hammer: number;
            Skill: number;
            Egg: number;
            Potion: number;
        };
        gemCount: number;
        useGemsInCalculators: boolean;
        simulateAscensionInCalculators: boolean;
        techPlanQueue?: { type: 'node' | 'delay'; tree?: string; nodeId?: number; nodeType?: string; delayMinutes?: number }[];
        techPlanStartDate?: string;
        plannerSleepStart?: string;
        plannerSleepEnd?: string;
        plannerMaxSteps?: number;
        plannerMaxWait?: number;
        plannerMinWaitBetweenNodes?: number;
        plannerPriorityWeights?: Record<'war_points' | 'dps' | 'speed' | 'time', number>;
        plannerAllowedTrees?: string[];
        plannerTreeWeights?: Record<string, number>;
        plannerPotionReserve?: number;
        plannerMaxTotalHours?: number;
        plannerMaxNodeMinutes?: number;
        plannerLevelCaps?: Record<string, number>;
        plannerPhases?: { id: string; throughStep: number; focus: 'war_points' | 'dps' | 'speed' | 'time' }[];
        techPlanMetadata?: { isAuto: boolean; config?: any };
        useSkinWindup?: boolean;
        steppingStones?: SteppingStonesTracker;
        swapCalculatorStage?: {
            age: number;
            battle: number;
            difficulty: number;
        };
        buildGoals?: BuildGoalSettings;
        fairy?: FairySettings;
        scannerTrainingExamples?: ScannerTrainingExample[];
        scannerContributionEnabled?: boolean;
        steppingStoneContributionEnabled?: boolean;
        lastManualBackupAt?: string;
    };
}

// Generate unique ID
export function generateProfileId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const INITIAL_PROFILE: UserProfile = {
    id: '',
    name: "Profile 1",
    iconIndex: 0,
    version: 1,
    items: {
        Weapon: null,
        Helmet: null,
        Body: null,
        Gloves: null,
        Belt: null,
        Necklace: null,
        Ring: null,
        Shoe: null,
    },
    savedItems: {},
    techTree: {
        Forge: {},
        Power: {},
        SkillsPetTech: {},
        Clan: {},
    },
    pets: {
        active: [],
        collection: {},
        savedBuilds: [],
    },
    mount: {
        active: null,
        collection: {},
        savedBuilds: [],
    },
    skills: {
        equipped: [],
        collection: {},
        passives: {},
    },
    misc: {
        forgeLevel: 1,
        dungeonLevels: {},
        eggSlots: 2,
        eggStage: 1,
        dungeonKeys: 1,
        researchLevel: 1,
        forgeCalculator: {
            hammers: '0',
            targetGold: '0',
            mode: 'hammers',
            autoForgeSummons: 1,
            autoForgeInterval: 2.43
        },
        skillCalculatorLevel: 1,
        skillCalculatorTickets: 0,
        mountCalculatorLevel: 1,
        mountCalculatorProgress: 0,
        mountCalculatorWinders: 0,
        techPotions: 0,
        dungeonKeyCounts: {
            Hammer: 0,
            Skill: 0,
            Egg: 0,
            Potion: 0
        },
        gemCount: 0,
        useGemsInCalculators: false,
        simulateAscensionInCalculators: true,
        techPlanQueue: [],
        techPlanStartDate: '',
        plannerSleepStart: '23:00',
        plannerSleepEnd: '07:00',
        plannerMaxWait: 120,
        plannerMinWaitBetweenNodes: 1,
        techPlanMetadata: { isAuto: false },
        useSkinWindup: true,
        swapCalculatorStage: { age: 0, battle: 0, difficulty: 0 },
        buildGoals: { activeGoalId: 'balanced_late_game', customGoals: [], weaponStyle: 'melee' },
        fairy: { active: 'Mira', level: 1, useManualSources: false, manualSources: {} },
        scannerTrainingExamples: [],
        scannerContributionEnabled: true,
        steppingStoneContributionEnabled: true,
        steppingStones: { attempts: [], targetStones: 10, dataSource: 'all_users' }
    }
};
