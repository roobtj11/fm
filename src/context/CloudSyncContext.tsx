import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import type { UserProfile } from '../types/Profile';
import { useProfile } from './ProfileContext';

const CONFIG_KEY = 'forgeMaster_cloudConfig';
const SESSION_KEY = 'forgeMaster_cloudSession';
const AUTO_SYNC_KEY = 'forgeMaster_cloudAutoSync';
const LAST_SYNC_KEY = 'forgeMaster_cloudLastSync';

interface CloudConfig {
    url: string;
    anonKey: string;
}

interface CloudUser {
    id: string;
    email?: string;
}

interface CloudSession {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    user: CloudUser;
}

interface CloudBackupRow {
    user_id: string;
    profiles: UserProfile[];
    active_profile_id?: string;
    updated_at: string;
}

interface CloudSyncContextType {
    configured: boolean;
    config: CloudConfig | null;
    user: CloudUser | null;
    isBusy: boolean;
    error: string | null;
    autoSync: boolean;
    lastSyncedAt: string | null;
    remoteBackupExists: boolean;
    remoteUpdatedAt: string | null;
    configure: (url: string, anonKey: string) => void;
    clearConfiguration: () => void;
    signUp: (email: string, password: string) => Promise<'signed-in' | 'check-email'>;
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    pushNow: () => Promise<void>;
    pullNow: () => Promise<void>;
    refreshRemoteStatus: () => Promise<void>;
    dismissError: () => void;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(undefined);

const readJson = <T,>(key: string): T | null => {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) as T : null;
    } catch {
        return null;
    }
};

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '');

const normalizeSession = (payload: any): CloudSession | null => {
    if (!payload?.access_token || !payload?.refresh_token || !payload?.user?.id) return null;
    return {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: Number(payload.expires_at) || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
        user: {
            id: payload.user.id,
            email: payload.user.email,
        },
    };
};

const describeError = (payload: any, fallback: string) =>
    payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;

async function cloudRequest(
    config: CloudConfig,
    path: string,
    init: RequestInit = {},
    accessToken?: string,
) {
    const response = await fetch(`${config.url}${path}`, {
        ...init,
        headers: {
            apikey: config.anonKey,
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(init.headers || {}),
        },
    });

    const text = await response.text();
    let payload: any = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = text;
        }
    }

    if (!response.ok) {
        throw new Error(describeError(payload, `Cloud request failed (${response.status}).`));
    }

    return payload;
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
    const { profiles, activeProfileId, replaceAllProfiles } = useProfile();
    const [config, setConfig] = useState<CloudConfig | null>(() => {
        const saved = readJson<CloudConfig>(CONFIG_KEY);
        if (saved?.url && saved?.anonKey) return saved;

        const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
            || 'https://efyeyutyurbdukafdgai.supabase.co';
        const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
            || 'sb_publishable_gTzbFQ_xcf6uLIo3M8ofUQ_8QR7Y7O3';
        return envUrl && envKey ? { url: normalizeUrl(envUrl), anonKey: envKey } : null;
    });
    const [session, setSession] = useState<CloudSession | null>(() => readJson<CloudSession>(SESSION_KEY));
    const [autoSync, setAutoSync] = useState(() => localStorage.getItem(AUTO_SYNC_KEY) === 'true');
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => localStorage.getItem(LAST_SYNC_KEY));
    const [remoteBackupExists, setRemoteBackupExists] = useState(false);
    const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const persistSession = useCallback((next: CloudSession | null) => {
        setSession(next);
        if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        else localStorage.removeItem(SESSION_KEY);
    }, []);

    const configure = useCallback((url: string, anonKey: string) => {
        const normalized: CloudConfig = {
            url: normalizeUrl(url),
            anonKey: anonKey.trim(),
        };
        if (!/^https:\/\//i.test(normalized.url) || !normalized.anonKey) {
            throw new Error('Enter a valid HTTPS project URL and public client key.');
        }
        setConfig(normalized);
        localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
        setError(null);
    }, []);

    const clearConfiguration = useCallback(() => {
        setConfig(null);
        persistSession(null);
        setAutoSync(false);
        setRemoteBackupExists(false);
        setRemoteUpdatedAt(null);
        localStorage.removeItem(CONFIG_KEY);
        localStorage.removeItem(AUTO_SYNC_KEY);
    }, [persistSession]);

    const ensureSession = useCallback(async () => {
        if (!config || !session) throw new Error('Sign in to use cloud sync.');
        if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;

        const payload = await cloudRequest(
            config,
            '/auth/v1/token?grant_type=refresh_token',
            {
                method: 'POST',
                body: JSON.stringify({ refresh_token: session.refresh_token }),
            },
        );
        const refreshed = normalizeSession(payload);
        if (!refreshed) throw new Error('Your cloud session expired. Please sign in again.');
        persistSession(refreshed);
        return refreshed;
    }, [config, persistSession, session]);

    const fetchRemoteRow = useCallback(async (activeSession: CloudSession) => {
        if (!config) throw new Error('Cloud sync is not configured.');
        const rows = await cloudRequest(
            config,
            `/rest/v1/forge_master_cloud_profiles?user_id=eq.${encodeURIComponent(activeSession.user.id)}&select=user_id,profiles,active_profile_id,updated_at`,
            { method: 'GET' },
            activeSession.access_token,
        ) as CloudBackupRow[];
        return rows?.[0] ?? null;
    }, [config]);

    const refreshRemoteStatus = useCallback(async () => {
        if (!config || !session) return;
        setIsBusy(true);
        try {
            const activeSession = await ensureSession();
            const row = await fetchRemoteRow(activeSession);
            setRemoteBackupExists(Boolean(row));
            setRemoteUpdatedAt(row?.updated_at ?? null);
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not check the cloud backup.');
        } finally {
            setIsBusy(false);
        }
    }, [config, ensureSession, fetchRemoteRow, session]);

    const signIn = useCallback(async (email: string, password: string) => {
        if (!config) throw new Error('Connect a cloud project first.');
        setIsBusy(true);
        try {
            const payload = await cloudRequest(
                config,
                '/auth/v1/token?grant_type=password',
                {
                    method: 'POST',
                    body: JSON.stringify({ email: email.trim(), password }),
                },
            );
            const next = normalizeSession(payload);
            if (!next) throw new Error('The account response did not include a valid session.');
            persistSession(next);
            setAutoSync(false);
            localStorage.setItem(AUTO_SYNC_KEY, 'false');
            const row = await fetchRemoteRow(next);
            setRemoteBackupExists(Boolean(row));
            setRemoteUpdatedAt(row?.updated_at ?? null);
            setError(null);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Sign-in failed.';
            setError(message);
            throw new Error(message);
        } finally {
            setIsBusy(false);
        }
    }, [config, fetchRemoteRow, persistSession]);

    const signUp = useCallback(async (email: string, password: string) => {
        if (!config) throw new Error('Connect a cloud project first.');
        setIsBusy(true);
        try {
            const payload = await cloudRequest(
                config,
                '/auth/v1/signup',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: email.trim(),
                        password,
                        data: { app: 'forge-master' },
                    }),
                },
            );
            const next = normalizeSession(payload);
            if (next) {
                persistSession(next);
                setRemoteBackupExists(false);
                setRemoteUpdatedAt(null);
                setError(null);
                return 'signed-in' as const;
            }
            setError(null);
            return 'check-email' as const;
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Account creation failed.';
            setError(message);
            throw new Error(message);
        } finally {
            setIsBusy(false);
        }
    }, [config, persistSession]);

    const signOut = useCallback(async () => {
        if (config && session) {
            try {
                await cloudRequest(config, '/auth/v1/logout', { method: 'POST' }, session.access_token);
            } catch {
                // Local sign-out must still succeed when the network is unavailable.
            }
        }
        persistSession(null);
        setAutoSync(false);
        setRemoteBackupExists(false);
        setRemoteUpdatedAt(null);
        localStorage.setItem(AUTO_SYNC_KEY, 'false');
    }, [config, persistSession, session]);

    const pushBackup = useCallback(async (silent: boolean) => {
        if (!config || !session) throw new Error('Sign in to use cloud sync.');
        if (!silent) setIsBusy(true);
        try {
            const activeSession = await ensureSession();
            const now = new Date().toISOString();
            const rows = await cloudRequest(
                config,
                '/rest/v1/forge_master_cloud_profiles?on_conflict=user_id',
                {
                    method: 'POST',
                    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
                    body: JSON.stringify({
                        user_id: activeSession.user.id,
                        profiles,
                        active_profile_id: activeProfileId,
                        updated_at: now,
                    }),
                },
                activeSession.access_token,
            ) as CloudBackupRow[];

            const syncedAt = rows?.[0]?.updated_at ?? now;
            setLastSyncedAt(syncedAt);
            setRemoteUpdatedAt(syncedAt);
            setRemoteBackupExists(true);
            setAutoSync(true);
            localStorage.setItem(LAST_SYNC_KEY, syncedAt);
            localStorage.setItem(AUTO_SYNC_KEY, 'true');
            setError(null);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Cloud backup failed.';
            setError(message);
            if (!silent) throw new Error(message);
        } finally {
            if (!silent) setIsBusy(false);
        }
    }, [activeProfileId, config, ensureSession, profiles, session]);

    const pushNow = useCallback(() => pushBackup(false), [pushBackup]);

    const pullNow = useCallback(async () => {
        if (!config || !session) throw new Error('Sign in to use cloud sync.');
        setIsBusy(true);
        try {
            const activeSession = await ensureSession();
            const row = await fetchRemoteRow(activeSession);
            if (!row || !Array.isArray(row.profiles) || row.profiles.length === 0) {
                throw new Error('No cloud backup was found for this account.');
            }
            replaceAllProfiles(row.profiles, row.active_profile_id);
            setLastSyncedAt(row.updated_at);
            setRemoteUpdatedAt(row.updated_at);
            setRemoteBackupExists(true);
            setAutoSync(true);
            localStorage.setItem(LAST_SYNC_KEY, row.updated_at);
            localStorage.setItem(AUTO_SYNC_KEY, 'true');
            setError(null);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Cloud restore failed.';
            setError(message);
            throw new Error(message);
        } finally {
            setIsBusy(false);
        }
    }, [config, ensureSession, fetchRemoteRow, replaceAllProfiles, session]);

    useEffect(() => {
        if (!config || !session) return;
        void refreshRemoteStatus();
    }, [config?.url, session?.user.id]);

    useEffect(() => {
        if (!autoSync || !config || !session) return;
        const timeout = window.setTimeout(() => {
            void pushBackup(true);
        }, 2500);
        return () => window.clearTimeout(timeout);
    }, [activeProfileId, autoSync, config, profiles, pushBackup, session]);

    const value = useMemo<CloudSyncContextType>(() => ({
        configured: Boolean(config?.url && config?.anonKey),
        config,
        user: session?.user ?? null,
        isBusy,
        error,
        autoSync,
        lastSyncedAt,
        remoteBackupExists,
        remoteUpdatedAt,
        configure,
        clearConfiguration,
        signUp,
        signIn,
        signOut,
        pushNow,
        pullNow,
        refreshRemoteStatus,
        dismissError: () => setError(null),
    }), [
        autoSync, clearConfiguration, config, configure, error, isBusy, lastSyncedAt,
        pullNow, pushNow, refreshRemoteStatus, remoteBackupExists, remoteUpdatedAt,
        session?.user, signIn, signOut, signUp,
    ]);

    return (
        <CloudSyncContext.Provider value={value}>
            {children}
        </CloudSyncContext.Provider>
    );
}

export function useCloudSync() {
    const context = useContext(CloudSyncContext);
    if (!context) throw new Error('useCloudSync must be used within CloudSyncProvider');
    return context;
}
