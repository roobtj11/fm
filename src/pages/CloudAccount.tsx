import { useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Cloud,
    CloudDownload,
    CloudUpload,
    Copy,
    ExternalLink,
    LogOut,
    RefreshCw,
    Settings,
    ShieldCheck,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useCloudSync } from '../context/CloudSyncContext';

const SETUP_SQL = `create table if not exists public.forge_master_cloud_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profiles jsonb not null default '[]'::jsonb,
  active_profile_id text,
  updated_at timestamptz not null default now()
);
alter table public.forge_master_cloud_profiles enable row level security;
create policy "Forge Master read own" on public.forge_master_cloud_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Forge Master insert own" on public.forge_master_cloud_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Forge Master update own" on public.forge_master_cloud_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Forge Master delete own" on public.forge_master_cloud_profiles for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.forge_master_cloud_profiles from anon;
grant select, insert, update, delete on table public.forge_master_cloud_profiles to authenticated;`;

const formatDate = (value: string | null) => {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
};

export default function CloudAccount() {
    const cloud = useCloudSync();
    const [projectUrl, setProjectUrl] = useState(cloud.config?.url ?? '');
    const [publicKey, setPublicKey] = useState(cloud.config?.anonKey ?? '');
    const [showSetup, setShowSetup] = useState(!cloud.configured);
    const [mode, setMode] = useState<'sign-in' | 'create'>('sign-in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const saveConnection = () => {
        try {
            cloud.configure(projectUrl, publicKey);
            setShowSetup(false);
            toast.success('Cloud project connected on this device.');
        } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : 'Could not save the cloud connection.');
        }
    };

    const submitAccount = async () => {
        if (!email.trim() || password.length < 8) {
            toast.error('Enter your email and a password with at least 8 characters.');
            return;
        }

        try {
            if (mode === 'sign-in') {
                await cloud.signIn(email, password);
                toast.success('Signed in. Choose whether to back up this device or restore the cloud copy.');
            } else {
                const result = await cloud.signUp(email, password);
                if (result === 'check-email') {
                    toast.info('Check your email to confirm the account, then return here and sign in.');
                    setMode('sign-in');
                } else {
                    toast.success('Account created and signed in.');
                }
            }
            setPassword('');
        } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : 'Account request failed.');
        }
    };

    const push = async () => {
        try {
            await cloud.pushNow();
            toast.success('This device is backed up. Automatic syncing is now on.');
        } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : 'Cloud backup failed.');
        }
    };

    const pull = async () => {
        if (!window.confirm('Replace the profiles on this device with the cloud backup? Download a JSON backup first if you may need the current local copy.')) {
            return;
        }
        try {
            await cloud.pullNow();
            toast.success('Cloud profiles restored. Automatic syncing is now on.');
        } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : 'Cloud restore failed.');
        }
    };

    const copySetup = async () => {
        await navigator.clipboard.writeText(SETUP_SQL);
        toast.success('Database setup copied.');
    };

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-3 sm:p-5 lg:p-7">
            <section className="rounded-2xl border border-cyan-900/70 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 p-5 shadow-xl sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-cyan-300">
                            <Cloud className="h-5 w-5" />
                            <span className="text-sm font-semibold uppercase tracking-wider">Account and backup</span>
                        </div>
                        <h1 className="text-2xl font-bold text-white sm:text-3xl">Cloud Profile Sync</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                            Keep your Forge Master profiles backed up and restore them on another device.
                            Local saving continues even if the cloud is unavailable.
                        </p>
                    </div>
                    <StatusPill
                        active={Boolean(cloud.user)}
                        text={cloud.user ? 'Signed in' : cloud.configured ? 'Ready to sign in' : 'Setup required'}
                    />
                </div>
            </section>

            {cloud.error && (
                <div className="flex gap-3 rounded-xl border border-rose-800/70 bg-rose-950/35 p-4 text-rose-100">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold">Cloud action needs attention</p>
                        <p className="mt-1 break-words text-sm text-rose-200/80">{cloud.error}</p>
                    </div>
                    <button type="button" onClick={cloud.dismissError} className="text-sm text-rose-300 hover:text-white">
                        Dismiss
                    </button>
                </div>
            )}

            {showSetup && (
                <section className="rounded-2xl border border-slate-700 bg-slate-900/85 p-4 shadow-lg sm:p-6">
                    <div className="flex items-center gap-2">
                        <Settings className="h-5 w-5 text-cyan-300" />
                        <h2 className="text-xl font-bold text-white">One-time cloud setup</h2>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                        Forge Master uses your own Supabase project, so you control the account data.
                        The project URL and public client key are designed to be used by browser apps;
                        database security is enforced by the account rules below.
                    </p>

                    <ol className="mt-5 grid gap-3 md:grid-cols-3">
                        <SetupStep number="1" title="Create a project">
                            Open Supabase and create a free project.
                        </SetupStep>
                        <SetupStep number="2" title="Create secure storage">
                            Copy the setup below and run it once in the project SQL editor.
                        </SetupStep>
                        <SetupStep number="3" title="Connect this app">
                            Paste the project URL and public client key here.
                        </SetupStep>
                    </ol>

                    <div className="mt-5 flex flex-wrap gap-3">
                        <a
                            href="https://supabase.com/dashboard"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-cyan-700 bg-cyan-950/40 px-4 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/40"
                        >
                            Open Supabase
                            <ExternalLink className="h-4 w-4" />
                        </a>
                        <button
                            type="button"
                            onClick={copySetup}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                        >
                            <Copy className="h-4 w-4" />
                            Copy database setup
                        </button>
                    </div>

                    <div className="mt-5 grid gap-4">
                        <label className="block">
                            <span className="mb-1.5 block text-sm font-medium text-slate-300">Project URL</span>
                            <input
                                type="url"
                                value={projectUrl}
                                onChange={event => setProjectUrl(event.target.value)}
                                placeholder="https://your-project.supabase.co"
                                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-sm font-medium text-slate-300">Public client key</span>
                            <input
                                type="password"
                                value={publicKey}
                                onChange={event => setPublicKey(event.target.value)}
                                placeholder="Publishable or anon key"
                                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
                            />
                        </label>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={saveConnection}
                            className="rounded-xl bg-cyan-500 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-400"
                        >
                            Save cloud connection
                        </button>
                        {cloud.configured && (
                            <button
                                type="button"
                                onClick={() => setShowSetup(false)}
                                className="rounded-xl border border-slate-600 px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </section>
            )}

            {!showSetup && !cloud.user && (
                <section className="rounded-2xl border border-slate-700 bg-slate-900/85 p-4 shadow-lg sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-white">
                                {mode === 'sign-in' ? 'Sign in' : 'Create your account'}
                            </h2>
                            <p className="mt-1 text-sm text-slate-400">
                                {mode === 'sign-in'
                                    ? 'Use the same email and password on each device.'
                                    : 'Email confirmation may be required by your cloud project.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowSetup(true)}
                            className="text-sm text-cyan-300 hover:text-cyan-200"
                        >
                            Change cloud connection
                        </button>
                    </div>

                    <div className="mt-5 flex rounded-xl border border-slate-700 bg-slate-950 p-1">
                        <button
                            type="button"
                            onClick={() => setMode('sign-in')}
                            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'sign-in' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}
                        >
                            Sign in
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('create')}
                            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'create' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}
                        >
                            Create account
                        </button>
                    </div>

                    <div className="mt-5 grid gap-4">
                        <label>
                            <span className="mb-1.5 block text-sm font-medium text-slate-300">Email</span>
                            <input
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={event => setEmail(event.target.value)}
                                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                            />
                        </label>
                        <label>
                            <span className="mb-1.5 block text-sm font-medium text-slate-300">Password</span>
                            <input
                                type="password"
                                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                                value={password}
                                onChange={event => setPassword(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') void submitAccount();
                                }}
                                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                            />
                        </label>
                    </div>

                    <button
                        type="button"
                        disabled={cloud.isBusy}
                        onClick={() => void submitAccount()}
                        className="mt-5 w-full rounded-xl bg-cyan-500 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                    >
                        {cloud.isBusy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
                    </button>
                </section>
            )}

            {!showSetup && cloud.user && (
                <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                    <section className="rounded-2xl border border-emerald-800/70 bg-emerald-950/20 p-4 shadow-lg sm:p-6">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-emerald-300" />
                            <h2 className="text-xl font-bold text-white">Account connected</h2>
                        </div>
                        <p className="mt-3 break-all text-sm text-emerald-100/80">{cloud.user.email || cloud.user.id}</p>
                        <div className="mt-5 space-y-3 text-sm">
                            <InfoRow label="Automatic sync" value={cloud.autoSync ? 'On' : 'Waiting for first choice'} />
                            <InfoRow label="Last synced" value={formatDate(cloud.lastSyncedAt)} />
                            <InfoRow label="Cloud backup" value={cloud.remoteBackupExists ? formatDate(cloud.remoteUpdatedAt) : 'None yet'} />
                        </div>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={cloud.isBusy}
                                onClick={() => void cloud.refreshRemoteStatus()}
                                className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Refresh status
                            </button>
                            <button
                                type="button"
                                onClick={() => void cloud.signOut()}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                            >
                                <LogOut className="h-4 w-4" />
                                Sign out
                            </button>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-slate-700 bg-slate-900/85 p-4 shadow-lg sm:p-6">
                        <h2 className="text-xl font-bold text-white">Choose the first sync direction</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-400">
                            Signing in never overwrites anything automatically. Choose which copy should become
                            the starting cloud version. After a successful backup or restore, changes sync automatically.
                        </p>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                disabled={cloud.isBusy}
                                onClick={() => void push()}
                                className="flex min-h-36 flex-col items-start justify-between rounded-xl border-2 border-cyan-700 bg-cyan-950/30 p-4 text-left transition hover:border-cyan-400 disabled:opacity-50"
                            >
                                <CloudUpload className="h-7 w-7 text-cyan-300" />
                                <div>
                                    <div className="font-bold text-white">Back up this device</div>
                                    <div className="mt-1 text-sm text-slate-400">Upload all current local profiles to your account.</div>
                                </div>
                            </button>
                            <button
                                type="button"
                                disabled={cloud.isBusy || !cloud.remoteBackupExists}
                                onClick={() => void pull()}
                                className="flex min-h-36 flex-col items-start justify-between rounded-xl border-2 border-violet-800 bg-violet-950/25 p-4 text-left transition hover:border-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <CloudDownload className="h-7 w-7 text-violet-300" />
                                <div>
                                    <div className="font-bold text-white">Restore cloud backup</div>
                                    <div className="mt-1 text-sm text-slate-400">
                                        {cloud.remoteBackupExists ? 'Replace this device with the saved cloud profiles.' : 'No cloud backup exists yet.'}
                                    </div>
                                </div>
                            </button>
                        </div>
                    </section>
                </div>
            )}

            <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-4 text-sm leading-6 text-slate-500">
                <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                    <p>
                        Your device copy remains the primary fallback. Cloud failures do not delete local data,
                        and you can still download a JSON backup from the Profile or Stepping Stones pages.
                    </p>
                </div>
            </section>
        </div>
    );
}

function StatusPill({ active, text }: { active: boolean; text: string }) {
    return (
        <span className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            active
                ? 'border-emerald-600 bg-emerald-950/50 text-emerald-300'
                : 'border-slate-600 bg-slate-950/50 text-slate-400'
        }`}>
            {text}
        </span>
    );
}

function SetupStep({ number, title, children }: { number: string; title: string; children: string }) {
    return (
        <li className="rounded-xl border border-slate-700 bg-slate-950/55 p-4">
            <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500 text-sm font-bold text-slate-950">
                    {number}
                </span>
                <span className="font-semibold text-white">{title}</span>
            </div>
            <p className="mt-3 text-sm leading-5 text-slate-400">{children}</p>
        </li>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-emerald-900/50 pb-2 last:border-0">
            <span className="text-slate-500">{label}</span>
            <span className="text-right font-medium text-slate-200">{value}</span>
        </div>
    );
}
