import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowDown,
    ArrowUp,
    BarChart3,
    Cloud,
    Dices,
    Download,
    Play,
    RotateCcw,
    ShieldCheck,
    Sparkles,
    Square,
    Undo2,
    Users,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useProfile } from '../../context/ProfileContext';
import type {
    SteppingStoneAttempt,
    SteppingStoneChoice,
    SteppingStoneEntry,
    SteppingStoneOutcome,
    SteppingStonePredictionModel,
    SteppingStonePredictionScope,
    SteppingStonesTracker,
} from '../../types/Profile';

const EMPTY_TRACKER: SteppingStonesTracker = {
    attempts: [],
    targetStones: 8,
    predictionModel: 'balanced_bayesian',
    predictionScope: 'per_stone',
};

const MODEL_OPTIONS: { id: SteppingStonePredictionModel; label: string; description: string }[] = [
    { id: 'balanced_50', label: 'Balanced successful outcomes', description: 'Uses safe-result counts—not alternating turns—to balance successful Up and Down outcomes.' },
    { id: 'balanced_bayesian', label: 'Balanced Bayesian', description: 'Explores evenly while evidence is weak, then follows a meaningful edge.' },
    { id: 'best_observed', label: 'Best observed', description: 'Always favors the strongest smoothed historical result.' },
    { id: 'random', label: 'Random suggestion', description: 'Makes a fresh 50/50 Up or Down suggestion for each hop.' },
];

const SCOPE_OPTIONS: { id: SteppingStonePredictionScope; label: string; description: string }[] = [
    { id: 'whole_run', label: 'Whole run', description: 'Uses one combined Up/Down history from every hop.' },
    { id: 'per_stone', label: 'Per hop', description: 'Hop 1, Hop 2, and every later hop learn independently.' },
];

type SharedAggregate = { stone: number; choice: SteppingStoneChoice; attempts: number | string; safe: number | string };

const newId = (prefix: string) =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const percent = (value: number) =>
    Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

const formatDate = (value?: string) => {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
};

const rate = (successes: number, total: number) => total ? successes / total : Number.NaN;

const wilsonInterval = (successes: number, total: number): [number, number] | null => {
    if (!total) return null;
    const z = 1.96;
    const p = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = (p + (z * z) / (2 * total)) / denominator;
    const spread = (z / denominator) * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total));
    return [Math.max(0, center - spread), Math.min(1, center + spread)];
};

const erf = (x: number) => {
    const sign = x < 0 ? -1 : 1;
    const absolute = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * absolute);
    const value = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absolute * absolute);
    return sign * value;
};

const twoProportionPValue = (
    upSafe: number,
    upTotal: number,
    downSafe: number,
    downTotal: number,
) => {
    if (!upTotal || !downTotal) return null;
    const pooled = (upSafe + downSafe) / (upTotal + downTotal);
    const standardError = Math.sqrt(pooled * (1 - pooled) * ((1 / upTotal) + (1 / downTotal)));
    if (!standardError) return 1;
    const z = Math.abs((upSafe / upTotal) - (downSafe / downTotal)) / standardError;
    return 2 * (1 - (0.5 * (1 + erf(z / Math.sqrt(2)))));
};

type DirectionStats = {
    total: number;
    safe: number;
    successRate: number;
    interval: [number, number] | null;
};

type StoneRecommendation = {
    choice: SteppingStoneChoice;
    confidence: 'Balanced pick' | 'Early signal' | 'Medium confidence' | 'High confidence';
    reason: string;
};

const getDirectionStats = (
    entries: SteppingStoneEntry[],
    choice: SteppingStoneChoice,
): DirectionStats => {
    const matching = entries.filter(entry => entry.choice === choice);
    const safe = matching.filter(entry => entry.outcome === 'safe').length;
    return {
        total: matching.length,
        safe,
        successRate: rate(safe, matching.length),
        interval: wilsonInterval(safe, matching.length),
    };
};

export default function SteppingStonesTracker() {
    const { profile, updateNestedProfile, exportProfile } = useProfile();
    const storedTracker = profile.misc.steppingStones ?? EMPTY_TRACKER;
    const tracker = storedTracker.targetStones === 8 ? storedTracker : { ...storedTracker, targetStones: 8 };
    const predictionModel = tracker.predictionModel ?? 'balanced_bayesian';
    const predictionScope = tracker.predictionScope ?? 'per_stone';
    const dataSource = tracker.dataSource ?? 'all_users';
    const [choice, setChoice] = useState<SteppingStoneChoice | null>(null);
    const [sharedAggregates, setSharedAggregates] = useState<SharedAggregate[]>([]);
    const [simulationRuns, setSimulationRuns] = useState(500);

    const currentAttempt = tracker.attempts.find(
        attempt => attempt.id === tracker.currentAttemptId,
    );
    const currentStone = currentAttempt
        ? currentAttempt.entries.filter(entry => entry.outcome === 'safe').length + 1
        : 1;

    const allEntries = useMemo(
        () => tracker.attempts.flatMap(attempt => attempt.entries),
        [tracker.attempts],
    );

    const refreshShared = async () => {
        const response = await fetch('/api/shared-stepping-stones').catch(() => null);
        if (!response?.ok) return;
        const payload = await response.json().catch(() => null) as { aggregates?: SharedAggregate[] } | null;
        setSharedAggregates(payload?.aggregates || []);
    };

    useEffect(() => { void refreshShared(); }, []);

    useEffect(() => {
        if (!allEntries.length) return;
        const timeout = window.setTimeout(async () => {
            const response = await fetch('/api/shared-stepping-stones', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: allEntries }),
            }).catch(() => null);
            if (response?.ok) void refreshShared();
        }, 900);
        return () => window.clearTimeout(timeout);
    }, [allEntries]);

    const stats = useMemo(() => {
        const up = getDirectionStats(allEntries, 'up');
        const down = getDirectionStats(allEntries, 'down');
        const completed = tracker.attempts.filter(attempt => attempt.finishedAt);
        const furthest = tracker.attempts.reduce((best, attempt) => {
            const safeCount = attempt.entries.filter(entry => entry.outcome === 'safe').length;
            return Math.max(best, safeCount);
        }, 0);
        const wins = tracker.attempts.filter(attempt =>
            attempt.entries.filter(entry => entry.outcome === 'safe').length >= tracker.targetStones,
        ).length;

        let longestSafeStreak = 0;
        let runningSafeStreak = 0;
        for (const entry of allEntries) {
            if (entry.outcome === 'safe') {
                runningSafeStreak += 1;
                longestSafeStreak = Math.max(longestSafeStreak, runningSafeStreak);
            } else {
                runningSafeStreak = 0;
            }
        }

        const perStone = Array.from(
            { length: Math.max(tracker.targetStones, ...allEntries.map(entry => entry.stone), 1) },
            (_, index) => {
                const stone = index + 1;
                const entries = allEntries.filter(entry => entry.stone === stone);
                return {
                    stone,
                    up: getDirectionStats(entries, 'up'),
                    down: getDirectionStats(entries, 'down'),
                };
            },
        );

        return {
            up,
            down,
            completed: completed.length,
            furthest,
            wins,
            longestSafeStreak,
            perStone,
            pValue: twoProportionPValue(up.safe, up.total, down.safe, down.total),
        };
    }, [allEntries, tracker.attempts, tracker.targetStones]);

    const saveTracker = (next: SteppingStonesTracker) => {
        updateNestedProfile('misc', { steppingStones: next });
    };

    const sharedDirection = (direction: SteppingStoneChoice, stone?: number): DirectionStats => {
        const matching = sharedAggregates.filter(row => row.choice === direction && (stone === undefined || Number(row.stone) === stone));
        const total = matching.reduce((sum, row) => sum + Number(row.attempts || 0), 0);
        const safe = matching.reduce((sum, row) => sum + Number(row.safe || 0), 0);
        return { total, safe, successRate: rate(safe, total), interval: wilsonInterval(safe, total) };
    };

    const combineDirection = (a: DirectionStats, b: DirectionStats): DirectionStats => {
        const total = a.total + b.total;
        const safe = a.safe + b.safe;
        return { total, safe, successRate: rate(safe, total), interval: wilsonInterval(safe, total) };
    };

    const simulatedDirection = (direction: SteppingStoneChoice, stone?: number): DirectionStats => {
        const source = stone === undefined
            ? tracker.simulation?.[direction]
            : tracker.simulation?.perStone?.find(row => row.stone === stone)?.[direction];
        const total = source?.attempts || 0;
        const safe = source?.safe || 0;
        return { total, safe, successRate: rate(safe, total), interval: wilsonInterval(safe, total) };
    };

    const recommendation = useMemo<StoneRecommendation>(() => {
        const stoneStats = stats.perStone[currentStone - 1];
        const upStone = stoneStats?.up ?? getDirectionStats([], 'up');
        const downStone = stoneStats?.down ?? getDirectionStats([], 'down');
        const myUp = predictionScope === 'per_stone' ? upStone : stats.up;
        const myDown = predictionScope === 'per_stone' ? downStone : stats.down;
        const communityUp = sharedDirection('up', predictionScope === 'per_stone' ? currentStone : undefined);
        const communityDown = sharedDirection('down', predictionScope === 'per_stone' ? currentStone : undefined);
        const communityHasData = communityUp.total + communityDown.total > 0;
        const realScopeUp = dataSource === 'my_data' || (dataSource === 'all_users' && !communityHasData)
            ? myUp : dataSource === 'combined' ? combineDirection(myUp, communityUp) : communityUp;
        const realScopeDown = dataSource === 'my_data' || (dataSource === 'all_users' && !communityHasData)
            ? myDown : dataSource === 'combined' ? combineDirection(myDown, communityDown) : communityDown;
        const scopeUp = combineDirection(realScopeUp, simulatedDirection('up', predictionScope === 'per_stone' ? currentStone : undefined));
        const scopeDown = combineDirection(realScopeDown, simulatedDirection('down', predictionScope === 'per_stone' ? currentStone : undefined));
        const scopeSamples = scopeUp.total + scopeDown.total;
        const simulationLabel = tracker.simulation ? ' plus your local simulated user' : '';
        const populationName = (dataSource === 'my_data' ? 'your data' : dataSource === 'combined' ? 'your and community data' : communityHasData ? 'community data' : 'your data (community sample is empty)') + simulationLabel;
        const scopeName = `${predictionScope === 'per_stone' ? `hop ${currentStone}` : 'the whole run'} using ${populationName}`;

        // Laplace smoothing prevents one lucky result from becoming a 0%/100% prediction.
        const smoothed = (direction: DirectionStats) =>
            (direction.safe + 1) / (direction.total + 2);
        const upScore = smoothed(scopeUp);
        const downScore = smoothed(scopeDown);
        const margin = Math.abs(upScore - downScore);

        const randomPick: SteppingStoneChoice = Math.random() < 0.5 ? 'up' : 'down';
        const lessUsedInScope = scopeUp.total === scopeDown.total ? randomPick : scopeUp.total < scopeDown.total ? 'up' : 'down';
        const lessSuccessfulInScope = scopeUp.safe === scopeDown.safe ? (upScore === downScore ? randomPick : upScore > downScore ? 'up' : 'down') : scopeUp.safe < scopeDown.safe ? 'up' : 'down';
        const observedLeader = margin < 0.001 ? randomPick : upScore > downScore ? 'up' : 'down';
        const strongEvidence = scopeSamples >= 20 && margin >= 0.1;
        const suggested: SteppingStoneChoice = predictionModel === 'random'
            ? randomPick
            : predictionModel === 'balanced_50'
            ? lessSuccessfulInScope
            : predictionModel === 'best_observed'
                ? observedLeader
                : strongEvidence ? observedLeader : lessUsedInScope;

        if (predictionModel === 'random') {
            return {
                choice: suggested,
                confidence: 'Balanced pick',
                reason: `This is a true 50/50 random suggestion for ${predictionScope === 'per_stone' ? `hop ${currentStone}` : 'this run'}. It does not use or alter historical evidence.`,
            };
        }

        if (predictionModel === 'balanced_50') {
            return {
                choice: suggested,
                confidence: 'Balanced pick',
                reason: `This balances successful outcomes within ${scopeName}. So far, Up has ${scopeUp.safe} safe results and Down has ${scopeDown.safe}; it does not simply alternate directions.`,
            };
        }

        if (scopeSamples === 0) {
            return {
                choice: suggested,
                confidence: 'Balanced pick',
                reason: `There is no history for ${scopeName} yet, so this is a balanced starting pick rather than a prediction.`,
            };
        }
        if (predictionModel === 'balanced_bayesian' && !strongEvidence) {
            return {
                choice: suggested,
                confidence: 'Early signal',
                reason: `Evidence for ${scopeName} is still weak, so this tests the less-used direction in this scope while keeping exploration balanced.`,
            };
        }
        if (scopeSamples >= 20 && margin >= 0.15) {
            return {
                choice: suggested,
                confidence: 'High confidence',
                reason: `This direction has the stronger smoothed result for ${scopeName}, supported by ${scopeSamples} recorded choices in this scope.`,
            };
        }
        if (scopeSamples >= 8 && margin >= 0.08) {
            return {
                choice: suggested,
                confidence: 'Medium confidence',
                reason: `This direction currently has the stronger smoothed result for ${scopeName}.`,
            };
        }
        return {
            choice: suggested,
            confidence: 'Early signal',
            reason: `The sample for ${scopeName} is still small, so treat this as an early signal.`,
        };
    }, [currentStone, dataSource, predictionModel, predictionScope, sharedAggregates, stats.down, stats.perStone, stats.up, tracker.simulation]);

    const startAttempt = (source: SteppingStoneAttempt['source'] = 'mine') => {
        if (currentAttempt) return;
        const now = new Date().toISOString();
        const attempt: SteppingStoneAttempt = {
            id: newId('attempt'),
            startedAt: now,
            entries: [],
            source,
        };
        saveTracker({
            ...tracker,
            attempts: [...tracker.attempts, attempt],
            currentAttemptId: attempt.id,
        });
        setChoice(null);
    };

    const simulateRandomRuns = () => {
        const runs = Math.max(1, Math.min(10_000, Math.round(simulationRuns) || 500));
        let upAttempts = 0; let upSafe = 0; let downAttempts = 0; let downSafe = 0; let clears = 0;
        const perStone = Array.from({ length: 8 }, (_, index) => ({ stone: index + 1, up: { attempts: 0, safe: 0 }, down: { attempts: 0, safe: 0 } }));
        // Real people rarely produce a perfectly even sequence. Give each generated batch a
        // mild temporary lean, let individual runs vary more strongly, and allow short streaks.
        // The lean is randomly centered around either direction, so repeated simulations do not
        // permanently favor Up or Down; only the choice pattern becomes less mechanically 50/50.
        const batchUpChance = 0.42 + (Math.random() * 0.16);
        for (let run = 0; run < runs; run += 1) {
            let cleared = true;
            const runUpChance = Math.max(0.2, Math.min(0.8, batchUpChance + ((Math.random() - 0.5) * 0.5)));
            let previousDirection: SteppingStoneChoice | null = null;
            for (let stone = 1; stone <= tracker.targetStones; stone += 1) {
                const direction: SteppingStoneChoice = previousDirection && Math.random() < 0.58
                    ? previousDirection
                    : Math.random() < runUpChance ? 'up' : 'down';
                previousDirection = direction;
                const safe = Math.random() < 0.5;
                if (direction === 'up') { upAttempts += 1; if (safe) upSafe += 1; }
                else { downAttempts += 1; if (safe) downSafe += 1; }
                const row = perStone[stone - 1];
                row[direction].attempts += 1;
                if (safe) row[direction].safe += 1;
                if (!safe) { cleared = false; break; }
            }
            if (cleared) clears += 1;
        }
        saveTracker({ ...tracker, simulation: { generatedAt: new Date().toISOString(), runs, up: { attempts: upAttempts, safe: upSafe }, down: { attempts: downAttempts, safe: downSafe }, perStone, clears } });
        toast.success(`Simulated ${runs.toLocaleString()} random runs for this profile's calculations.`);
    };

    const endAttempt = () => {
        if (!currentAttempt) return;
        const now = new Date().toISOString();
        saveTracker({
            ...tracker,
            attempts: tracker.attempts.map(attempt =>
                attempt.id === currentAttempt.id
                    ? { ...attempt, finishedAt: now }
                    : attempt,
            ),
            currentAttemptId: undefined,
        });
        setChoice(null);
    };

    const recordOutcome = (outcome: SteppingStoneOutcome) => {
        if (!currentAttempt || !choice) return;

        const entry: SteppingStoneEntry = {
            id: newId('step'),
            stone: currentStone,
            choice,
            outcome,
            recordedAt: new Date().toISOString(),
        };
        const completed = outcome === 'fall' || currentStone >= tracker.targetStones;
        const now = new Date().toISOString();

        saveTracker({
            ...tracker,
            attempts: tracker.attempts.map(attempt =>
                attempt.id === currentAttempt.id
                    ? {
                        ...attempt,
                        entries: [...attempt.entries, entry],
                        finishedAt: completed ? now : attempt.finishedAt,
                    }
                    : attempt,
            ),
            currentAttemptId: completed ? undefined : currentAttempt.id,
        });

        if (outcome === 'safe' && currentStone >= tracker.targetStones) {
            toast.success('Run completed — all target stones cleared.');
        } else if (outcome === 'fall') {
            toast.info(`Attempt ended at stone ${currentStone}.`);
        }
        setChoice(null);
    };

    const undoLast = () => {
        const active = currentAttempt
            ?? [...tracker.attempts].reverse().find(attempt => attempt.entries.length > 0);
        if (!active || active.entries.length === 0) return;

        saveTracker({
            ...tracker,
            attempts: tracker.attempts.map(attempt =>
                attempt.id === active.id
                    ? { ...attempt, entries: attempt.entries.slice(0, -1), finishedAt: undefined }
                    : attempt,
            ),
            currentAttemptId: active.id,
        });
        setChoice(null);
    };

    const resetHistory = () => {
        if (!window.confirm('Delete all Stepping Stones attempt history for this profile?')) return;
        saveTracker({ ...EMPTY_TRACKER, targetStones: tracker.targetStones, predictionModel, predictionScope, dataSource });
        setChoice(null);
        toast.success('Stepping Stones history cleared.');
    };

    const downloadBackup = () => {
        const backedUpAt = new Date().toISOString();
        updateNestedProfile('misc', { lastManualBackupAt: backedUpAt });
        window.setTimeout(() => exportProfile(), 0);
        toast.success('Profile backup downloaded.');
    };

    const directionCard = (
        label: string,
        direction: DirectionStats,
        accent: string,
    ) => (
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
                <span className={`font-semibold ${accent}`}>{label}</span>
                <span className="text-2xl font-bold text-white">{percent(direction.successRate)}</span>
            </div>
            <div className="mt-2 text-sm text-slate-400">
                {direction.safe} safe out of {direction.total} choices
            </div>
            <div className="mt-1 text-xs text-slate-500">
                {direction.interval
                    ? `Likely range: ${percent(direction.interval[0])}–${percent(direction.interval[1])}`
                    : 'Make choices to build a sample.'}
            </div>
        </div>
    );

    const enoughSamples = stats.up.total >= 20 && stats.down.total >= 20;
    const apparentLeader = stats.up.successRate > stats.down.successRate ? 'Up' : 'Down';
    const difference = Math.abs(stats.up.successRate - stats.down.successRate);
    const evidenceIsWeak = stats.pValue === null || stats.pValue >= 0.05 || !enoughSamples;
    const currentScopeRow = stats.perStone[currentStone - 1];
    const myBalanceUp = predictionScope === 'per_stone' ? currentScopeRow?.up ?? getDirectionStats([], 'up') : stats.up;
    const myBalanceDown = predictionScope === 'per_stone' ? currentScopeRow?.down ?? getDirectionStats([], 'down') : stats.down;
    const communityBalanceUp = sharedDirection('up', predictionScope === 'per_stone' ? currentStone : undefined);
    const communityBalanceDown = sharedDirection('down', predictionScope === 'per_stone' ? currentStone : undefined);
    const hasCommunityBalance = communityBalanceUp.total + communityBalanceDown.total > 0;
    const balanceUp = dataSource === 'my_data' || (dataSource === 'all_users' && !hasCommunityBalance) ? myBalanceUp : dataSource === 'combined' ? combineDirection(myBalanceUp, communityBalanceUp) : communityBalanceUp;
    const balanceDown = dataSource === 'my_data' || (dataSource === 'all_users' && !hasCommunityBalance) ? myBalanceDown : dataSource === 'combined' ? combineDirection(myBalanceDown, communityBalanceDown) : communityBalanceDown;
    const choiceTotal = balanceUp.total + balanceDown.total;
    const upChoiceShare = choiceTotal ? balanceUp.total / choiceTotal : 0.5;
    const globalUp = sharedDirection('up');
    const globalDown = sharedDirection('down');

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-3 sm:p-5 lg:p-7">
            <section className="overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 shadow-xl">
                <div className="grid gap-6 p-5 lg:grid-cols-[1.25fr_0.75fr] lg:p-7">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-cyan-300">
                            <BarChart3 className="h-5 w-5" />
                            <span className="text-sm font-semibold uppercase tracking-wider">Attempt tracker</span>
                        </div>
                        <h1 className="text-2xl font-bold text-white sm:text-3xl">Stepping Stones</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                            Record every Up or Down choice and whether it was safe. The analysis can show
                            what happened in your sample, but it cannot predict a truly random next stone.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                        <Stat label="Attempts" value={String(tracker.attempts.length)} />
                        <Stat label="Decisions" value={String(allEntries.length)} />
                        <Stat label="Furthest" value={`${stats.furthest} stones`} />
                        <Stat label="Clears" value={String(stats.wins)} />
                    </div>
                </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
                <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-lg sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-white">Record this run</h2>
                            <p className="mt-1 text-sm text-slate-400">
                                {currentAttempt
                                    ? `Attempt ${tracker.attempts.findIndex(item => item.id === currentAttempt.id) + 1} · Stone ${currentStone} of ${tracker.targetStones}`
                                    : 'Start an attempt when you reach the first choice.'}
                            </p>
                        </div>
                        <span className="rounded-full border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-300">Fixed run · 8 hops</span>
                    </div>

                    <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/45 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div><h3 className="font-semibold text-white">Prediction model</h3><p className="mt-1 text-xs text-slate-500">You can change this at any time without deleting history.</p></div>
                            <span className="rounded-full border border-cyan-800 bg-cyan-950/50 px-3 py-1 text-xs font-semibold text-cyan-200">Default: Balanced Bayesian</span>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            {MODEL_OPTIONS.map(model => <button key={model.id} type="button" onClick={() => saveTracker({ ...tracker, predictionModel: model.id })} className={`rounded-xl border p-3 text-left transition ${predictionModel === model.id ? 'border-cyan-400 bg-cyan-500/15' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'}`}><span className={`block text-sm font-bold ${predictionModel === model.id ? 'text-cyan-200' : 'text-white'}`}>{model.label}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{model.description}</span></button>)}
                        </div>
                        <div className="mt-4 border-t border-slate-700 pt-4">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Calculation scope</h4>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {SCOPE_OPTIONS.map(scope => <button key={scope.id} type="button" onClick={() => saveTracker({ ...tracker, predictionScope: scope.id })} className={`rounded-xl border p-3 text-left transition ${predictionScope === scope.id ? 'border-amber-400 bg-amber-500/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'}`}><span className={`block text-sm font-bold ${predictionScope === scope.id ? 'text-amber-200' : 'text-white'}`}>{scope.label}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{scope.description}</span></button>)}
                            </div>
                        </div>
                        <div className="mt-4 border-t border-slate-700 pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Prediction data</h4><p className="mt-1 text-xs text-slate-500">Choose which real results the model uses. Recorded runs are added to the anonymous aggregate automatically.</p></div>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                {[
                                    ['my_data', 'My data', 'Only this profile history.'],
                                    ['all_users', 'All users', 'Anonymous community aggregate.'],
                                    ['combined', 'Combined', 'Your history plus the community.'],
                                ].map(([id, label, description]) => <button key={id} type="button" onClick={() => saveTracker({ ...tracker, dataSource: id as SteppingStonesTracker['dataSource'] })} className={`rounded-xl border p-3 text-left transition ${dataSource === id ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'}`}><span className={`block text-sm font-bold ${dataSource === id ? 'text-fuchsia-200' : 'text-white'}`}>{label}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span></button>)}
                            </div>
                            <p className="mt-2 text-[11px] leading-5 text-slate-500">Only hop number, direction, and safe/fall outcome are shared. Local simulated-user results affect your calculations but are never uploaded or counted in global statistics.</p>
                        </div>
                        <div className="mt-4">
                            <div className="mb-2 text-xs font-semibold text-slate-400">{predictionScope === 'per_stone' ? `Hop ${currentStone} choice balance` : 'Whole-run choice balance'} · {dataSource === 'my_data' ? 'my data' : dataSource === 'combined' ? 'combined' : hasCommunityBalance ? 'all users' : 'my data fallback'}</div>
                            <div className="flex justify-between text-xs font-semibold"><span className="text-emerald-300">Up {balanceUp.total} · {percent(upChoiceShare)}</span><span className="text-violet-300">Down {balanceDown.total} · {percent(1 - upChoiceShare)}</span></div>
                            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800"><div className="bg-emerald-500 transition-all" style={{ width: `${upChoiceShare * 100}%` }} /><div className="flex-1 bg-violet-500" /></div>
                            <p className="mt-2 text-xs text-slate-500">Balanced successful outcomes uses safe-result evidence rather than alternating Up and Down. Other models use their descriptions above.</p>
                        </div>
                    </div>

                    <div className="mt-5 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
                        <div className="flex items-center gap-2"><Dices className="h-5 w-5 text-violet-300" /><h3 className="font-bold text-white">Local simulated user</h3></div>
                        <p className="mt-1 text-xs leading-5 text-slate-400">Generate volatile eight-hop runs with mild directional leans and natural-looking streaks. The safe/fall result stays 50/50, and simulated data remains separate from your history and global statistics.</p>
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="space-y-1 text-xs text-slate-400"><span className="block">Number of runs</span><input type="number" min={1} max={10000} value={simulationRuns} onChange={event => setSimulationRuns(Math.max(1, Math.min(10000, Number(event.target.value) || 500)))} className="w-32 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" /></label>
                            <button type="button" onClick={simulateRandomRuns} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-bold text-white hover:bg-violet-400"><Dices className="h-4 w-4" />Simulate runs</button>
                            {tracker.simulation && <button type="button" onClick={() => saveTracker({ ...tracker, simulation: undefined })} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Remove simulation</button>}
                        </div>
                        {tracker.simulation && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4"><Stat label="Simulated runs" value={tracker.simulation.runs.toLocaleString()} /><Stat label="Up choices" value={percent(tracker.simulation.up.attempts / Math.max(1, tracker.simulation.up.attempts + tracker.simulation.down.attempts))} /><Stat label="Up safe" value={`${tracker.simulation.up.safe}/${tracker.simulation.up.attempts}`} /><Stat label="Down safe" value={`${tracker.simulation.down.safe}/${tracker.simulation.down.attempts}`} /></div>}
                    </div>

                    {!currentAttempt ? (
                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                            <button type="button" onClick={() => startAttempt('mine')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-4 text-lg font-bold text-slate-950 transition hover:bg-cyan-400"><Play className="h-5 w-5" />Start my attempt</button>
                            <button type="button" onClick={() => startAttempt('community_observed')} className="flex w-full items-center justify-center gap-2 rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/10 px-5 py-4 text-base font-bold text-fuchsia-100 transition hover:bg-fuchsia-500/20"><Users className="h-5 w-5" />Add observed community run</button>
                        </div>
                    ) : (
                        <>
                            <div className="mt-6 rounded-xl border border-cyan-700/70 bg-cyan-950/35 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyan-300">
                                            <Sparkles className="h-4 w-4" />
                                            Suggested next move
                                        </div>
                                        <div className="mt-2 flex items-center gap-3">
                                            <span className={`flex h-11 w-11 items-center justify-center rounded-full ${
                                                recommendation.choice === 'up'
                                                    ? 'bg-emerald-500/20 text-emerald-300'
                                                    : 'bg-violet-500/20 text-violet-300'
                                            }`}>
                                                {recommendation.choice === 'up'
                                                    ? <ArrowUp className="h-7 w-7" />
                                                    : <ArrowDown className="h-7 w-7" />}
                                            </span>
                                            <div>
                                                <div className="text-xl font-bold text-white">
                                                    Try {recommendation.choice === 'up' ? 'Up' : 'Down'}
                                                </div>
                                                <div className="text-xs font-semibold text-cyan-300">
                                                    {recommendation.confidence}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setChoice(recommendation.choice)}
                                        className="rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-400"
                                    >
                                        Use this suggestion
                                    </button>
                                </div>
                                <p className="mt-3 text-sm leading-5 text-cyan-100/70">
                                    {recommendation.reason}
                                </p>
                                <p className="mt-2 text-xs text-slate-500">
                                    Suggestions learn from this profile's history, but cannot guarantee a safe stone.
                                </p>
                            </div>

                            <div className="mt-6 grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setChoice('up')}
                                    className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border-2 px-4 py-5 transition ${
                                        choice === 'up'
                                            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                                            : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-emerald-500/60'
                                    }`}
                                >
                                    <ArrowUp className="h-8 w-8" />
                                    <span className="text-lg font-bold">Up</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setChoice('down')}
                                    className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border-2 px-4 py-5 transition ${
                                        choice === 'down'
                                            ? 'border-violet-400 bg-violet-500/20 text-violet-200'
                                            : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-violet-500/60'
                                    }`}
                                >
                                    <ArrowDown className="h-8 w-8" />
                                    <span className="text-lg font-bold">Down</span>
                                </button>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    disabled={!choice}
                                    onClick={() => recordOutcome('safe')}
                                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                    <ShieldCheck className="h-5 w-5" />
                                    Safe — next stone
                                </button>
                                <button
                                    type="button"
                                    disabled={!choice}
                                    onClick={() => recordOutcome('fall')}
                                    className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 px-5 py-3 font-bold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                    Fell — end attempt
                                </button>
                            </div>
                        </>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={undoLast}
                            disabled={!tracker.attempts.some(attempt => attempt.entries.length)}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-35"
                        >
                            <Undo2 className="h-4 w-4" />
                            Undo last result
                        </button>
                        {currentAttempt && (
                            <button
                                type="button"
                                onClick={endAttempt}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                            >
                                <Square className="h-4 w-4" />
                                End attempt
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={resetHistory}
                            disabled={!tracker.attempts.length}
                            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-rose-900/80 px-3 py-2 text-sm text-rose-300 hover:bg-rose-950/40 disabled:opacity-35"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Reset history
                        </button>
                    </div>
                </section>

                <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-lg sm:p-6">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-amber-300" />
                        <h2 className="text-xl font-bold text-white">Pattern check</h2>
                    </div>

                    <div className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/25 p-4">
                        <p className="font-semibold text-amber-200">
                            {allEntries.length === 0
                                ? 'No results recorded yet'
                                : evidenceIsWeak
                                    ? 'No reliable Up/Down edge detected'
                                    : `Your sample currently leans ${apparentLeader}`}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-amber-100/75">
                            {allEntries.length === 0
                                ? 'Record real attempts and this panel will compare the results.'
                                : !enoughSamples
                                    ? 'The sample is still small. Try to record at least 20 Up and 20 Down choices before comparing them.'
                                    : evidenceIsWeak
                                        ? `The observed difference is ${percent(difference)} and can reasonably be random variation.`
                                        : `The observed difference is ${percent(difference)}. That is interesting in this history, but it is not proof the next choice is predictable.`}
                        </p>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        {directionCard('Up choices', stats.up, 'text-emerald-300')}
                        {directionCard('Down choices', stats.down, 'text-violet-300')}
                    </div>
                    <p className="mt-4 text-xs leading-5 text-slate-500">
                        Rates and likely ranges describe only your recorded sample. If the game is fully random,
                        no past streak changes the odds of the next choice.
                    </p>
                </section>
            </div>

            <section className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-950/15 p-4 shadow-lg sm:p-6">
                <div className="flex items-center gap-2"><Cloud className="h-5 w-5 text-fuchsia-300" /><h2 className="text-xl font-bold text-white">Global stepping-stone statistics</h2></div>
                <p className="mt-1 text-xs leading-5 text-slate-400">Anonymous observed runs from all users. Your local simulated user is excluded from these totals.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {directionCard('Global Up', globalUp, 'text-emerald-300')}
                    {directionCard('Global Down', globalDown, 'text-violet-300')}
                </div>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-lg sm:p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-bold text-white">Results by stone</h2>
                        <p className="mt-1 text-sm text-slate-400">
                            Compare Up and Down separately at each position.
                        </p>
                    </div>
                    <div className="text-sm text-slate-400">
                        Longest safe streak: <span className="font-semibold text-white">{stats.longestSafeStreak}</span>
                    </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[660px] text-left text-sm">
                        <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-3 py-3">Stone</th>
                                <th className="px-3 py-3">Up safe</th>
                                <th className="px-3 py-3">Up rate</th>
                                <th className="px-3 py-3">Down safe</th>
                                <th className="px-3 py-3">Down rate</th>
                                <th className="px-3 py-3">Recorded</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {stats.perStone.map(row => (
                                <tr key={row.stone} className="text-slate-300">
                                    <td className="px-3 py-3 font-semibold text-white">{row.stone}</td>
                                    <td className="px-3 py-3">{row.up.safe} / {row.up.total}</td>
                                    <td className="px-3 py-3 text-emerald-300">{percent(row.up.successRate)}</td>
                                    <td className="px-3 py-3">{row.down.safe} / {row.down.total}</td>
                                    <td className="px-3 py-3 text-violet-300">{percent(row.down.successRate)}</td>
                                    <td className="px-3 py-3">{row.up.total + row.down.total}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-lg sm:p-6">
                    <h2 className="text-xl font-bold text-white">Recent attempts</h2>
                    <div className="mt-4 space-y-3">
                        {tracker.attempts.length === 0 && (
                            <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">
                                Your attempts will appear here.
                            </p>
                        )}
                        {[...tracker.attempts].reverse().slice(0, 10).map((attempt, reverseIndex) => {
                            const attemptNumber = tracker.attempts.length - reverseIndex;
                            const safeCount = attempt.entries.filter(entry => entry.outcome === 'safe').length;
                            return (
                                <div key={attempt.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-semibold text-white">Attempt {attemptNumber} <span className="ml-2 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-400">{attempt.source === 'community_observed' ? 'Observed community' : 'Mine'}</span></span>
                                        <span className="text-xs text-slate-500">{formatDate(attempt.startedAt)}</span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {attempt.entries.length === 0 && (
                                            <span className="text-sm text-slate-500">No decisions recorded</span>
                                        )}
                                        {attempt.entries.map(entry => (
                                            <span
                                                key={entry.id}
                                                title={`Stone ${entry.stone}: ${entry.choice} · ${entry.outcome}`}
                                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                                    entry.outcome === 'safe'
                                                        ? 'border-emerald-700/70 bg-emerald-950/50 text-emerald-300'
                                                        : 'border-rose-800/70 bg-rose-950/50 text-rose-300'
                                                }`}
                                            >
                                                {entry.choice === 'up' ? '↑' : '↓'} {entry.stone}
                                                {entry.outcome === 'safe' ? ' ✓' : ' ×'}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="mt-3 text-xs text-slate-500">
                                        {safeCount >= tracker.targetStones
                                            ? 'Target cleared'
                                            : attempt.finishedAt
                                                ? `Finished after ${safeCount} safe stone${safeCount === 1 ? '' : 's'}`
                                                : 'In progress'}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="rounded-2xl border border-cyan-900/70 bg-cyan-950/20 p-4 shadow-lg sm:p-6">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-cyan-300" />
                        <h2 className="text-xl font-bold text-white">Protect this profile</h2>
                    </div>
                    <div className="mt-4 rounded-xl border border-emerald-800/60 bg-emerald-950/25 p-4">
                        <p className="font-semibold text-emerald-200">Autosaved on this device</p>
                        <p className="mt-1 text-sm leading-6 text-emerald-100/70">
                            Changes are saved in this browser shortly after you make them and normally survive
                            refreshes and restarts.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={downloadBackup}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-400"
                    >
                        <Download className="h-5 w-5" />
                        Download profile backup
                    </button>
                    <p className="mt-2 text-xs text-slate-500">
                        Last manual backup: {formatDate(profile.misc.lastManualBackupAt)}
                    </p>

                    <div className="mt-5 flex gap-3 rounded-xl border border-cyan-800/70 bg-cyan-950/25 p-4">
                        <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                        <div>
                            <p className="font-semibold text-cyan-100">Automatically saved to your account</p>
                            <p className="mt-1 text-sm leading-6 text-cyan-100/70">
                                ForgeMaster keeps every profile in sync with your Sites account—no backup or restore buttons needed.
                            </p>
                            <Link
                                to="/account"
                                className="mt-3 inline-flex rounded-lg border border-cyan-700 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/40"
                            >
                                View Account &amp; Sync
                            </Link>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-slate-700 bg-slate-950/55 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-bold text-white">{value}</div>
        </div>
    );
}
