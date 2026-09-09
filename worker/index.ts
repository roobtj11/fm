interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void }
interface D1Result { success: boolean }
interface D1AllResult<T> { results: T[] }
interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement
    first<T = Record<string, unknown>>(): Promise<T | null>
    all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>
    run(): Promise<D1Result>
}
interface D1Database { prepare(query: string): D1PreparedStatement; batch(statements: D1PreparedStatement[]): Promise<D1Result[]> }
interface Env { DB: D1Database; OWNER_USER_ID?: string }
interface ProfileRow { profiles_json: string; active_profile_id: string | null; updated_at: string }

const CREATE_PROFILE_TABLE = `CREATE TABLE IF NOT EXISTS forge_master_profiles (
    user_id TEXT PRIMARY KEY NOT NULL, email TEXT, display_name TEXT, profiles_json TEXT NOT NULL,
    active_profile_id TEXT, updated_at TEXT NOT NULL
)`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const decodeName = (value: string | null) => { if (!value) return undefined; try { return decodeURIComponent(value); } catch { return value; } };
const getUser = (request: Request) => {
    const url = new URL(request.url);
    const authenticatedId = request.headers.get('oai-authenticated-user-id');
    const isLocal = import.meta.env.DEV && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    const id = authenticatedId || (isLocal ? 'local-preview' : null);
    if (!id) return null;
    return { id, email: request.headers.get('oai-authenticated-user-email') || undefined, displayName: decodeName(request.headers.get('oai-authenticated-user-name')) };
};
const contributorKey = async (userId: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`forgemaster-community-v1|${userId}`));
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
};
const isOwner = (user: { id: string } | null, env: Env) => Boolean(user && env.OWNER_USER_ID && user.id === env.OWNER_USER_ID);

const profileSync = async (request: Request, env: Env) => {
    const user = getUser(request);
    if (!user) return json({ error: 'Please sign in to ForgeMaster.', code: 'SIGN_IN_REQUIRED' }, 401);
    const accountUser = { ...user, isOwner: isOwner(user, env) };
    await env.DB.prepare(CREATE_PROFILE_TABLE).run();
    if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT profiles_json, active_profile_id, updated_at FROM forge_master_profiles WHERE user_id = ?').bind(user.id).first<ProfileRow>();
        if (!row) return json({ user: accountUser, state: null });
        try { return json({ user: accountUser, state: { profiles: JSON.parse(row.profiles_json), activeProfileId: row.active_profile_id || undefined, updatedAt: row.updated_at } }); }
        catch { return json({ error: 'Your saved account data could not be read.' }, 500); }
    }
    if (request.method === 'PUT') {
        if (Number(request.headers.get('content-length') || 0) > 2_000_000) return json({ error: 'The profile collection is too large to save.' }, 413);
        const body = await request.json().catch(() => null) as { profiles?: unknown; activeProfileId?: unknown } | null;
        if (!body || !Array.isArray(body.profiles) || body.profiles.length === 0 || body.profiles.length > 100) return json({ error: 'A valid profile collection is required.' }, 400);
        const profilesJson = JSON.stringify(body.profiles);
        if (profilesJson.length > 2_000_000) return json({ error: 'The profile collection is too large to save.' }, 413);
        const activeProfileId = typeof body.activeProfileId === 'string' ? body.activeProfileId : null;
        const updatedAt = new Date().toISOString();
        await env.DB.prepare(`INSERT INTO forge_master_profiles (user_id, email, display_name, profiles_json, active_profile_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name,
            profiles_json = excluded.profiles_json, active_profile_id = excluded.active_profile_id, updated_at = excluded.updated_at`)
            .bind(user.id, user.email || null, user.displayName || null, profilesJson, activeProfileId, updatedAt).run();
        return json({ user: accountUser, state: { profiles: body.profiles, activeProfileId: activeProfileId || undefined, updatedAt } });
    }
    return json({ error: 'Method not allowed.' }, 405);
};

const sharedStepping = async (request: Request, env: Env) => {
    if (request.method === 'GET') {
        const rows = await env.DB.prepare(`SELECT stone, choice, COUNT(*) AS attempts,
            SUM(CASE WHEN outcome = 'safe' THEN 1 ELSE 0 END) AS safe
            FROM stepping_stone_events GROUP BY stone, choice ORDER BY stone, choice`).all();
        return json({ aggregates: rows.results });
    }
    const user = getUser(request);
    if (!user) return json({ error: 'Sign in to contribute community results.', code: 'SIGN_IN_REQUIRED' }, 401);
    const contributor = await contributorKey(user.id);
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM stepping_stone_events WHERE contributor_key = ?').bind(contributor).run();
        return json({ removed: true });
    }
    if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { entries?: unknown } | null;
        if (!body || !Array.isArray(body.entries) || body.entries.length > 5000) return json({ error: 'A valid contribution is required.' }, 400);
        const statements = body.entries.flatMap((raw: unknown) => {
            const entry = raw as Record<string, unknown>;
            if (typeof entry.id !== 'string' || !Number.isInteger(entry.stone) || !['up', 'down'].includes(String(entry.choice)) || !['safe', 'fall'].includes(String(entry.outcome))) return [];
            return [env.DB.prepare(`INSERT OR IGNORE INTO stepping_stone_events
                (contributor_key, entry_id, stone, choice, outcome, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
                .bind(contributor, entry.id, entry.stone, entry.choice, entry.outcome, typeof entry.recordedAt === 'string' ? entry.recordedAt : new Date().toISOString())];
        });
        if (statements.length) await env.DB.batch(statements);
        return json({ contributed: statements.length });
    }
    return json({ error: 'Method not allowed.' }, 405);
};

const scannerTraining = async (request: Request, env: Env) => {
    if (request.method === 'GET') {
        const user = getUser(request);
        const contributor = user ? await contributorKey(user.id) : '';
        const rows = await env.DB.prepare(`SELECT contributor_key AS contributorKey, kind, field, region_json AS regionJson,
            aspect_ratio AS aspectRatio, observed_text AS observedText, corrected_value AS correctedValue,
            trust_weight AS trustWeight, review_status AS reviewStatus, created_at AS createdAt
            FROM scanner_training_examples WHERE review_status = 'approved' OR contributor_key = ?
            ORDER BY trust_weight DESC, created_at DESC LIMIT 250`).bind(contributor).all<Record<string, unknown>>();
        return json({ examples: rows.results.map(row => ({ ...row, isMine: row.contributorKey === contributor, contributorKey: undefined })) });
    }
    const user = getUser(request);
    if (!user) return json({ error: 'Sign in to contribute scanner corrections.', code: 'SIGN_IN_REQUIRED' }, 401);
    const contributor = await contributorKey(user.id);
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM scanner_training_examples WHERE contributor_key = ?').bind(contributor).run();
        return json({ removed: true });
    }
    if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { examples?: unknown } | null;
        if (!body || !Array.isArray(body.examples) || body.examples.length > 100) return json({ error: 'A valid correction collection is required.' }, 400);
        const allowedKinds = ['item', 'pet', 'mount'];
        const allowedFields = ['kind', 'name', 'rarity', 'level', 'slot', 'age', 'stat_name', 'stat_value',
            'stat_1_name', 'stat_1_value', 'stat_2_name', 'stat_2_value'];
        const statements = body.examples.flatMap((raw: unknown) => {
            const example = raw as Record<string, unknown>;
            if (typeof example.id !== 'string' || !allowedKinds.includes(String(example.kind)) || !allowedFields.includes(String(example.field)) || typeof example.correctedValue !== 'string') return [];
            const region = example.region as Record<string, unknown> | undefined;
            if (!region || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(Number(region[key])))) return [];
            const ownerSubmission = isOwner(user, env);
            return [env.DB.prepare(`INSERT OR IGNORE INTO scanner_training_examples
                (contributor_key, example_id, kind, field, region_json, aspect_ratio, observed_text, corrected_value, created_at, review_status, trust_weight, reviewed_by, reviewed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(contributor, example.id, example.kind, example.field, JSON.stringify(region), Number(example.aspectRatio) || 1,
                    typeof example.observedText === 'string' ? example.observedText.slice(0, 300) : null,
                    example.correctedValue.slice(0, 300), typeof example.createdAt === 'string' ? example.createdAt : new Date().toISOString(),
                    ownerSubmission ? 'approved' : 'pending', ownerSubmission ? 10 : 1,
                    ownerSubmission ? contributor : null, ownerSubmission ? new Date().toISOString() : null)];
        });
        if (statements.length) await env.DB.batch(statements);
        return json({ contributed: statements.length });
    }
    return json({ error: 'Method not allowed.' }, 405);
};

const scannerTrainingReview = async (request: Request, env: Env) => {
    const user = getUser(request);
    if (!user) return json({ error: 'Please sign in to review OCR corrections.', code: 'SIGN_IN_REQUIRED' }, 401);
    if (!isOwner(user, env)) return json({ error: 'OCR review is restricted to the ForgeMaster owner.' }, 403);
    const reviewerKey = await contributorKey(user.id);
    if (request.method === 'GET') {
        const rows = await env.DB.prepare(`SELECT contributor_key AS contributorKey, example_id AS exampleId, kind, field,
            region_json AS regionJson, aspect_ratio AS aspectRatio, observed_text AS observedText,
            corrected_value AS correctedValue, review_status AS reviewStatus, trust_weight AS trustWeight,
            created_at AS createdAt, reviewed_at AS reviewedAt
            FROM scanner_training_examples ORDER BY CASE review_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
            created_at DESC LIMIT 500`).all();
        return json({ examples: rows.results.map(row => ({ ...row, isMine: row.contributorKey === reviewerKey })) });
    }
    if (request.method === 'PATCH') {
        const body = await request.json().catch(() => null) as { contributorKey?: unknown; exampleId?: unknown; status?: unknown; correctedValue?: unknown } | null;
        if (!body || typeof body.contributorKey !== 'string' || typeof body.exampleId !== 'string' || !['approved', 'rejected'].includes(String(body.status))) {
            return json({ error: 'A valid review decision is required.' }, 400);
        }
        const correctedValue = typeof body.correctedValue === 'string' ? body.correctedValue.trim().slice(0, 300) : '';
        const reviewedAt = new Date().toISOString();
        await env.DB.prepare(`UPDATE scanner_training_examples SET review_status = ?, trust_weight = ?, reviewed_by = ?, reviewed_at = ?,
            corrected_value = CASE WHEN ? <> '' THEN ? ELSE corrected_value END WHERE contributor_key = ? AND example_id = ?`)
            .bind(body.status, body.status === 'approved' ? (body.contributorKey === reviewerKey ? 10 : 3) : 0, reviewerKey, reviewedAt,
                correctedValue, correctedValue, body.contributorKey, body.exampleId).run();
        return json({ updated: true, status: body.status, reviewedAt });
    }
    return json({ error: 'Method not allowed.' }, 405);
};

const worker = {
    async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const pathname = new URL(request.url).pathname;
        if (!env.DB) return json({ error: 'Account storage is not available yet.' }, 503);
        if (pathname === '/api/profile-sync') return profileSync(request, env);
        if (pathname === '/api/shared-stepping-stones') return sharedStepping(request, env);
        if (pathname === '/api/scanner-training') return scannerTraining(request, env);
        if (pathname === '/api/scanner-training-review') return scannerTrainingReview(request, env);
        return new Response('Not found', { status: 404 });
    },
};
export default worker
