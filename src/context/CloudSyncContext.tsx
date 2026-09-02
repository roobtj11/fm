import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import type { UserProfile } from '../types/Profile';
import { useProfile } from './ProfileContext';

type SyncStatus = 'connecting' | 'saving' | 'saved' | 'signed_out' | 'offline' | 'error';

interface AccountUser {
    id: string;
    email?: string;
    displayName?: string;
}

interface AccountState {
    profiles: UserProfile[];
    activeProfileId?: string;
    updatedAt: string;
}

interface AccountResponse {
    user: AccountUser;
    state: AccountState | null;
}

interface CloudSyncContextType {
    user: AccountUser | null;
    status: SyncStatus;
    lastSavedAt: string | null;
    error: string | null;
    retry: () => void;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(undefined);

async function accountRequest(init?: RequestInit): Promise<AccountResponse> {
    const response = await fetch('/api/profile-sync', {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    });
    const payload = await response.json().catch(() => null) as (AccountResponse & { error?: string }) | null;
    if (!response.ok || !payload) {
        const error = new Error(payload?.error || 'Account sync is temporarily unavailable.') as Error & { status?: number };
        error.status = response.status;
        throw error;
    }
    return payload;
}

const fingerprint = (profiles: UserProfile[], activeProfileId: string) =>
    JSON.stringify({ profiles, activeProfileId });

export function CloudSyncProvider({ children }: { children: ReactNode }) {
    const { profiles, activeProfileId, replaceAllProfiles } = useProfile();
    const [user, setUser] = useState<AccountUser | null>(null);
    const [status, setStatus] = useState<SyncStatus>('connecting');
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const hydrated = useRef(false);
    const lastSavedFingerprint = useRef('');

    const retry = useCallback(() => {
        hydrated.current = false;
        setStatus('connecting');
        setError(null);
        setRetryToken(value => value + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        hydrated.current = false;

        const connect = async () => {
            setStatus('connecting');
            try {
                const remote = await accountRequest();
                if (cancelled) return;
                setUser(remote.user);

                if (remote.state?.profiles?.length) {
                    const remoteActiveId = remote.state.activeProfileId || remote.state.profiles[0].id;
                    lastSavedFingerprint.current = fingerprint(remote.state.profiles, remoteActiveId);
                    replaceAllProfiles(remote.state.profiles, remoteActiveId);
                    setLastSavedAt(remote.state.updatedAt);
                } else {
                    const created = await accountRequest({
                        method: 'PUT',
                        body: JSON.stringify({ profiles, activeProfileId }),
                    });
                    if (cancelled) return;
                    lastSavedFingerprint.current = fingerprint(profiles, activeProfileId);
                    setLastSavedAt(created.state?.updatedAt || new Date().toISOString());
                }

                hydrated.current = true;
                setError(null);
                setStatus('saved');
            } catch (caught) {
                if (cancelled) return;
                const message = caught instanceof Error ? caught.message : 'Account sync is temporarily unavailable.';
                setError(message);
                setStatus((caught as Error & { status?: number })?.status === 401 ? 'signed_out' : navigator.onLine ? 'error' : 'offline');
            }
        };

        void connect();
        return () => { cancelled = true; };
    // Initial account hydration intentionally runs only on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryToken]);

    useEffect(() => {
        if (!hydrated.current) return;
        const nextFingerprint = fingerprint(profiles, activeProfileId);
        if (nextFingerprint === lastSavedFingerprint.current) return;

        const timeout = window.setTimeout(async () => {
            setStatus('saving');
            try {
                const result = await accountRequest({
                    method: 'PUT',
                    body: JSON.stringify({ profiles, activeProfileId }),
                });
                lastSavedFingerprint.current = nextFingerprint;
                setUser(result.user);
                setLastSavedAt(result.state?.updatedAt || new Date().toISOString());
                setError(null);
                setStatus('saved');
            } catch (caught) {
                const message = caught instanceof Error ? caught.message : 'Your changes are safe on this device but could not sync.';
                setError(message);
                setStatus(navigator.onLine ? 'error' : 'offline');
            }
        }, 1500);

        return () => window.clearTimeout(timeout);
    }, [activeProfileId, profiles]);

    const value = useMemo<CloudSyncContextType>(() => ({
        user,
        status,
        lastSavedAt,
        error,
        retry,
    }), [error, lastSavedAt, retry, status, user]);

    return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync() {
    const context = useContext(CloudSyncContext);
    if (!context) throw new Error('useCloudSync must be used within CloudSyncProvider');
    return context;
}
