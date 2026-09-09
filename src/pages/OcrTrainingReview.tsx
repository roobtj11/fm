import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ScanSearch, XCircle } from 'lucide-react';
import { toast } from 'react-toastify';

type ReviewStatus = 'pending' | 'approved' | 'rejected';
type ReviewExample = {
    contributorKey: string;
    exampleId: string;
    kind: string;
    field: string;
    regionJson: string;
    aspectRatio: number;
    observedText?: string;
    correctedValue: string;
    reviewStatus: ReviewStatus;
    trustWeight: number;
    createdAt: string;
    reviewedAt?: string;
    isMine?: boolean;
};

export default function OcrTrainingReview() {
    const [examples, setExamples] = useState<ReviewExample[]>([]);
    const [filter, setFilter] = useState<ReviewStatus | 'all'>('pending');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [workingKey, setWorkingKey] = useState('');
    const [drafts, setDrafts] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoading(true); setError('');
        const response = await fetch('/api/scanner-training-review').catch(() => null);
        const payload = response ? await response.json().catch(() => null) as { examples?: ReviewExample[]; error?: string } | null : null;
        if (!response?.ok) setError(payload?.error || 'The OCR review queue could not be loaded.');
        else {
            setExamples(payload?.examples || []);
            setDrafts(Object.fromEntries((payload?.examples || []).map(example => [`${example.contributorKey}|${example.exampleId}`, example.correctedValue])));
        }
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);

    const decide = async (example: ReviewExample, status: Exclude<ReviewStatus, 'pending'>) => {
        const key = `${example.contributorKey}|${example.exampleId}`;
        setWorkingKey(key);
        const response = await fetch('/api/scanner-training-review', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contributorKey: example.contributorKey, exampleId: example.exampleId, status, correctedValue: drafts[key] || example.correctedValue }),
        }).catch(() => null);
        const payload = response ? await response.json().catch(() => null) as { error?: string } | null : null;
        if (!response?.ok) toast.error(payload?.error || 'That review decision could not be saved.');
        else {
            setExamples(current => current.map(item => item.contributorKey === example.contributorKey && item.exampleId === example.exampleId
                ? { ...item, correctedValue: drafts[key] || item.correctedValue, reviewStatus: status, trustWeight: status === 'approved' ? (item.isMine ? 10 : 3) : 0 }
                : item));
            toast.success(status === 'approved' ? 'Correction approved for OCR training.' : 'Correction rejected.');
        }
        setWorkingKey('');
    };

    const visible = useMemo(() => filter === 'all' ? examples : examples.filter(example => example.reviewStatus === filter), [examples, filter]);
    const counts = useMemo(() => ({
        pending: examples.filter(example => example.reviewStatus === 'pending').length,
        approved: examples.filter(example => example.reviewStatus === 'approved').length,
        rejected: examples.filter(example => example.reviewStatus === 'rejected').length,
    }), [examples]);

    return <div className="mx-auto max-w-6xl space-y-6 pb-20">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="flex items-center gap-3"><ScanSearch className="h-8 w-8 text-accent-primary" /><h1 className="text-3xl font-black text-text-primary">OCR Training Review</h1></div><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Review community corrections before they can influence anyone else's scanner. Your own corrections are approved automatically with the highest trust weight.</p></div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-text-primary disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </header>

        {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : <>
            <div className="grid gap-3 sm:grid-cols-3"><CountCard label="Pending review" value={counts.pending} tone="amber" /><CountCard label="Approved" value={counts.approved} tone="emerald" /><CountCard label="Rejected" value={counts.rejected} tone="red" /></div>
            <div className="flex flex-wrap gap-2">{(['pending','approved','rejected','all'] as const).map(status => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${filter === status ? 'border-accent-primary bg-accent-primary/15 text-accent-primary' : 'border-border text-text-secondary'}`}>{status}</button>)}</div>
            {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-text-muted"><Loader2 className="h-5 w-5 animate-spin" />Loading corrections…</div> : visible.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-muted">No {filter === 'all' ? '' : `${filter} `}corrections.</div> : <div className="space-y-3">{visible.map(example => {
                const key = `${example.contributorKey}|${example.exampleId}`;
                return <article key={key} className="rounded-2xl border border-border bg-bg-card/70 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent-primary/10 px-2.5 py-1 text-xs font-black uppercase text-accent-primary">{example.kind}</span><span className="text-sm font-bold text-text-primary">{example.field.replace(/_/g, ' ')}</span><span className="text-xs text-text-muted">{example.isMine ? 'You' : `Contributor ${example.contributorKey.slice(0, 8)}`}</span></div><span className="text-xs capitalize text-text-muted">{example.reviewStatus} · weight {example.trustWeight}</span></div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs font-bold uppercase text-text-muted">OCR read<textarea readOnly value={example.observedText || '(No OCR text captured)'} className="mt-1 min-h-20 w-full rounded-lg border border-border bg-black/20 p-3 text-sm normal-case text-text-secondary" /></label><label className="text-xs font-bold uppercase text-text-muted">Correct answer<input value={drafts[key] ?? example.correctedValue} onChange={event => setDrafts(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-border bg-bg-input px-3 py-3 text-sm normal-case text-text-primary outline-none focus:border-accent-primary" /></label></div>
                    <div className="mt-3 text-xs text-text-muted">Layout ratio {Number(example.aspectRatio).toFixed(3)} · submitted {new Date(example.createdAt).toLocaleString()}</div>
                    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={workingKey === key || !(drafts[key] || '').trim()} onClick={() => void decide(example, 'approved')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-black text-emerald-950 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Approve{drafts[key] !== example.correctedValue ? ' edited answer' : ''}</button><button type="button" disabled={workingKey === key} onClick={() => void decide(example, 'rejected')} className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-40"><XCircle className="h-4 w-4" />Reject</button></div>
                </article>;
            })}</div>}
        </>}
    </div>;
}

function CountCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'emerald' | 'red' }) {
    const styles = { amber: 'border-amber-500/30 text-amber-300', emerald: 'border-emerald-500/30 text-emerald-300', red: 'border-red-500/30 text-red-300' };
    return <div className={`rounded-xl border bg-bg-card/60 p-4 ${styles[tone]}`}><div className="text-2xl font-black">{value}</div><div className="mt-1 text-xs font-bold uppercase text-text-muted">{label}</div></div>;
}
