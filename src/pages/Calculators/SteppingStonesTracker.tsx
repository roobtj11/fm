import { useMemo, useState } from 'react';
import {
    ArrowDown,
    ArrowUp,
    BarChart3,
    CloudOff,
    Download,
    Play,
    RotateCcw,
    ShieldCheck,
    Sparkles,
    Square,
    Undo2,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useProfile } from '../../context/ProfileContext';
import type {
    SteppingStoneAttempt,
    SteppingStoneChoice,
    SteppingStoneEntry,
    SteppingStoneOutcome,
    SteppingStonesTracker,
} from '../../types/Profile';

const EMPTY_TRACKER: SteppingStonesTracker = {
    attempts: [],
    targetStones: 10,
};

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
    const tracker = profile.misc.steppingStones ?? EMPTY_TRACKER;
    const [choice, setChoice] = useState<SteppingStoneChoice | null>(null);

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

    const startAttempt = () => {
        if (currentAttempt) return;
        const now = new Date().toISOString();
        const attempt: SteppingStoneAttempt = {
            id: newId('attempt'),
            startedAt: now,
            entries: [],
        };
        saveTracker({
            ...tracker,
            attempts: [...tracker.attempts, attempt],
            currentAttemptId: attempt.id,
        });
        setChoice(null);
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
        saveTracker({ ...EMPTY_TRACKER, targetStones: tracker.targetStones });
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
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                            Target stones
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={tracker.targetStones}
                                disabled={Boolean(currentAttempt)}
                                onChange={event => saveTracker({
                                    ...tracker,
                                    targetStones: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                                })}
                                className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-400 disabled:opacity-50"
                            />
                        </label>
                    </div>

                    {!currentAttempt ? (
                        <button
                            type="button"
                            onClick={startAttempt}
                            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-4 text-lg font-bold text-slate-950 transition hover:bg-cyan-400"
                        >
                            <Play className="h-5 w-5" />
                            Start new attempt
                        </button>
                    ) : (
                        <>
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
                                        <span className="font-semibold text-white">Attempt {attemptNumber}</span>
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

                    <div className="mt-5 flex gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                        <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                        <div>
                            <p className="font-semibold text-slate-200">Cloud sign-in is not configured yet</p>
                            <p className="mt-1 text-sm leading-6 text-slate-400">
                                Clearing site data, changing browser profiles, or moving to another device can
                                remove local saves. Real sign-in and cross-device sync require a hosted account
                                and database service; this app does not pretend a local password is cloud backup.
                            </p>
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
