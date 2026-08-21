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
    OPENAI_API_KEY?: string
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

const getOutputText = (body: any): string => {
    if (typeof body?.output_text === 'string') return body.output_text;
    for (const item of body?.output || []) {
        for (const content of item?.content || []) {
            if (typeof content?.text === 'string') return content.text;
        }
    }
    return '';
};

const companionSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        kind: { type: 'string', enum: ['pet', 'mount'] },
        name: { type: 'string' }, rarity: { type: 'string' }, level: { type: 'integer', minimum: 1 },
        damage: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        health: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        secondaryStats: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { statId: { type: 'string' }, value: { type: 'number' } }, required: ['statId', 'value'] } },
        confidence: { type: 'number', minimum: 0, maximum: 1 }, notes: { type: 'string' },
    },
    required: ['kind', 'name', 'rarity', 'level', 'damage', 'health', 'secondaryStats', 'confidence', 'notes'],
};

const importCompanion = async (request: Request, env: Env) => {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!getUser(request)) return json({ error: 'Please sign in to ForgeMaster.' }, 401);
    if (!env.OPENAI_API_KEY) return json({ error: 'Screenshot recognition is not activated for this site yet. You can still add pets and mounts manually.' }, 503);
    if (Number(request.headers.get('content-length') || 0) > 14_000_000) return json({ error: 'The screenshot is too large.' }, 413);
    const input = await request.json().catch(() => null) as { imageDataUrl?: unknown } | null;
    if (!input || typeof input.imageDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(input.imageDataUrl) || input.imageDataUrl.length > 14_000_000) {
        return json({ error: 'A valid PNG, JPG, or WEBP screenshot is required.' }, 400);
    }
    const prompt = `Read this Forge Master game companion detail card. It is exactly one pet or mount. Transcribe the displayed name, rarity, level, base damage, base health, and every percentage secondary stat. Ignore dim cards behind the open detail card. Use these exact statId values when applicable: CriticalChance, CriticalMulti, BlockChance, HealthRegen, LifeSteal, DoubleDamageChance, DamageMulti, MeleeDamageMulti, RangedDamageMulti, AttackSpeed, SkillDamageMulti, SkillCooldownMulti, HealthMulti. Percent values must be returned as displayed percentage numbers (7.91, not 0.0791). If a value is unreadable, explain it in notes and lower confidence. Never invent a stat.`;
    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: input.imageDataUrl, detail: 'high' }] }],
            text: { format: { type: 'json_schema', name: 'companion_import', strict: true, schema: companionSchema } },
        }),
    });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) return json({ error: body?.error?.message || 'The screenshot recognition service is unavailable.' }, 502);
    try {
        const result = JSON.parse(getOutputText(body));
        return json({ result: { ...result, damage: result.damage ?? undefined, health: result.health ?? undefined } });
    } catch {
        return json({ error: 'The screenshot was read, but its fields could not be understood. Try a tighter crop.' }, 502);
    }
};

const worker = {
    async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/api/companion-import') return importCompanion(request, env);
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
