import { CheckCircle2, Cloud, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { useCloudSync } from '../context/CloudSyncContext';

const formatDate = (value: string | null) => {
    if (!value) return 'Finishing setup…';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Finishing setup…' : date.toLocaleString();
};

export default function CloudAccount() {
    const account = useCloudSync();
    const isHealthy = account.status === 'saved' || account.status === 'saving';

    const statusText = {
        connecting: 'Connecting to your account…',
        saving: 'Saving your latest changes…',
        saved: 'All changes saved',
        signed_out: 'Sign in to save to your account',
        offline: 'Offline — saved on this device',
        error: 'Saved on this device — sync needs attention',
    }[account.status];

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-4 pb-24 sm:p-6">
            <header>
                <div className="flex items-center gap-3">
                    <Cloud className="h-8 w-8 text-cyan-300" />
                    <div>
                        <h1 className="text-3xl font-bold text-white">Account &amp; Sync</h1>
                        <p className="mt-1 text-slate-400">ForgeMaster saves to your signed-in account automatically.</p>
                    </div>
                </div>
            </header>

            <section className={`rounded-2xl border p-5 shadow-lg sm:p-7 ${
                isHealthy ? 'border-emerald-800/70 bg-emerald-950/20' : 'border-amber-800/70 bg-amber-950/20'
            }`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex gap-3">
                        {isHealthy
                            ? <ShieldCheck className="mt-0.5 h-7 w-7 text-emerald-300" />
                            : <WifiOff className="mt-0.5 h-7 w-7 text-amber-300" />}
                        <div>
                            <h2 className="text-xl font-bold text-white">{statusText}</h2>
                            <p className="mt-1 text-sm text-slate-300">
                                {account.user?.displayName || account.user?.email || 'Your Sites account'}
                            </p>
                        </div>
                    </div>
                    {account.status === 'signed_out' ? (
                        <a href="/signin-with-chatgpt?return_to=/" target="_top" className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-black text-slate-950 hover:bg-cyan-300">
                            Sign in with ChatGPT
                        </a>
                    ) : (account.status === 'error' || account.status === 'offline') && (
                        <button
                            type="button"
                            onClick={account.retry}
                            className="inline-flex items-center gap-2 rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-950/50"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Try again
                        </button>
                    )}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <InfoCard label="Automatic account saving" value={isHealthy ? 'On' : account.status === 'signed_out' ? 'Sign in required' : 'Waiting to reconnect'} />
                    <InfoCard label="Last saved to account" value={formatDate(account.lastSavedAt)} />
                </div>

                {account.error && (
                    <p className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100">
                        {account.error}
                    </p>
                )}
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 sm:p-7">
                <h2 className="text-xl font-bold text-white">Nothing to remember or press</h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <Benefit title="One account">Your Sites sign-in identifies you automatically.</Benefit>
                    <Benefit title="Automatic saving">Profile and calculator changes sync shortly after you make them.</Benefit>
                    <Benefit title="Device safety copy">A local copy stays available if your connection drops.</Benefit>
                </div>
            </section>

            <div className="flex gap-3 rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4 text-sm leading-6 text-cyan-100/80">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                <p>On another computer, open ForgeMaster with the same account and your profiles will load automatically.</p>
            </div>
        </div>
    );
}

function InfoCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-slate-700/70 bg-slate-950/45 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-2 font-semibold text-white">{value}</div>
        </div>
    );
}

function Benefit({ title, children }: { title: string; children: string }) {
    return (
        <div className="rounded-xl border border-slate-700 bg-slate-950/45 p-4">
            <h3 className="font-bold text-cyan-200">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{children}</p>
        </div>
    );
}
