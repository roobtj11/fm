interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void
    passThroughOnException(): void
}

interface D1Result {
    success: boolean
}

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement
    first<T = Record<string, unknown>>(): Promise<T | null>
    run(): Promise<D1Result>
}

interface D1Database {
    prepare(query: string): D1PreparedStatement
}

interface Env {
    DB: D1Database
}

interface ProfileRow {
    profiles_json: string
    active_profile_id: string | null
    updated_at: string
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS forge_master_profiles (
    user_id TEXT PRIMARY KEY NOT NULL,
    email TEXT,
    display_name TEXT,
    profiles_json TEXT NOT NULL,
    active_profile_id TEXT,
    updated_at TEXT NOT NULL
)`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const decodeName = (value: string | null) => {
    if (!value) return undefined;
    try { return decodeURIComponent(value); } catch { return value; }
};

const getUser = (request: Request) => {
    const url = new URL(request.url);
    const authenticatedId = request.headers.get('oai-authenticated-user-id');
    const isLocal = import.meta.env.DEV && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    const id = authenticatedId || (isLocal ? 'local-preview' : null);
    if (!id) return null;
    return {
        id,
        email: request.headers.get('oai-authenticated-user-email') || undefined,
        displayName: decodeName(request.headers.get('oai-authenticated-user-name')),
    };
};

const worker = {
    async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname !== '/api/profile-sync') return new Response('Not found', { status: 404 });

        const user = getUser(request);
        if (!user) return json({ error: 'Please sign in to ForgeMaster.' }, 401);
        if (!env.DB) return json({ error: 'Account storage is not available yet.' }, 503);

        await env.DB.prepare(CREATE_TABLE).run();

        if (request.method === 'GET') {
            const row = await env.DB.prepare(
                'SELECT profiles_json, active_profile_id, updated_at FROM forge_master_profiles WHERE user_id = ?',
            ).bind(user.id).first<ProfileRow>();

            if (!row) return json({ user, state: null });
            try {
                return json({
                    user,
                    state: {
                        profiles: JSON.parse(row.profiles_json),
                        activeProfileId: row.active_profile_id || undefined,
                        updatedAt: row.updated_at,
                    },
                });
            } catch {
                return json({ error: 'Your saved account data could not be read.' }, 500);
            }
        }

        if (request.method === 'PUT') {
            if (Number(request.headers.get('content-length') || 0) > 2_000_000) {
                return json({ error: 'The profile collection is too large to save.' }, 413);
            }
            const body = await request.json().catch(() => null) as { profiles?: unknown; activeProfileId?: unknown } | null;
            if (!body || !Array.isArray(body.profiles) || body.profiles.length === 0 || body.profiles.length > 100) {
                return json({ error: 'A valid profile collection is required.' }, 400);
            }
            const profilesJson = JSON.stringify(body.profiles);
            if (profilesJson.length > 2_000_000) return json({ error: 'The profile collection is too large to save.' }, 413);
            const activeProfileId = typeof body.activeProfileId === 'string' ? body.activeProfileId : null;
            const updatedAt = new Date().toISOString();

            await env.DB.prepare(`INSERT INTO forge_master_profiles
                (user_id, email, display_name, profiles_json, active_profile_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = excluded.email,
                    display_name = excluded.display_name,
                    profiles_json = excluded.profiles_json,
                    active_profile_id = excluded.active_profile_id,
                    updated_at = excluded.updated_at`).bind(
                user.id,
                user.email || null,
                user.displayName || null,
                profilesJson,
                activeProfileId,
                updatedAt,
            ).run();

            return json({
                user,
                state: { profiles: body.profiles, activeProfileId: activeProfileId || undefined, updatedAt },
            });
        }

        return json({ error: 'Method not allowed.' }, 405);
    },
};

export default worker
