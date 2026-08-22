import { useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, Check, CopyCheck, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import type { MountSlot, PetSlot } from '../types/Profile';
import { recognizeLocally } from '../utils/localOcr';
import { getStatName } from '../utils/statNames';

type Kind = 'pet' | 'mount';
type ImportStat = { statId: string; value: number };
type Recognition = {
    kind: Kind;
    name: string;
    rarity: string;
    level: number;
    damage?: number;
    health?: number;
    secondaryStats: ImportStat[];
    confidence?: number;
    notes?: string;
};

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const inputClass = 'w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-primary';
const normalizedStats = (stats: ImportStat[] = []) => [...stats]
    .map(stat => ({ statId: stat.statId, value: Number(stat.value) || 0 }))
    .sort((a, b) => a.statId.localeCompare(b.statId));

const parseMagnitude = (value?: string) => {
    if (!value) return undefined;
    const clean = value.toLowerCase().replace(/,/g, '').replace(/\s/g, '');
    const number = Number.parseFloat(clean);
    if (!Number.isFinite(number)) return undefined;
    if (clean.endsWith('k')) return number * 1_000;
    if (clean.endsWith('m')) return number * 1_000_000;
    if (clean.endsWith('b')) return number * 1_000_000_000;
    return number;
};

const statAliases: [string, string][] = [
    ['skill cooldown', 'SkillCooldownMulti'], ['skill damage', 'SkillDamageMulti'], ['critical damage', 'CriticalMulti'],
    ['critical chance', 'CriticalChance'], ['double chance', 'DoubleDamageChance'], ['double damage chance', 'DoubleDamageChance'],
    ['ranged damage', 'RangedDamageMulti'], ['melee damage', 'MeleeDamageMulti'], ['attack speed', 'AttackSpeed'],
    ['health regen', 'HealthRegen'], ['lifesteal', 'LifeSteal'], ['life steal', 'LifeSteal'], ['block chance', 'BlockChance'],
    ['health', 'HealthMulti'], ['damage', 'DamageMulti'],
];

function parseOcr(text: string, confidence: number, spriteMapping: any): Recognition {
    const candidates = [
        ...Object.values(spriteMapping?.pets?.mapping || {}).map((item: any) => ({ ...item, kind: 'pet' as Kind })),
        ...Object.values(spriteMapping?.mounts?.mapping || {}).map((item: any) => ({ ...item, kind: 'mount' as Kind })),
    ].sort((a: any, b: any) => normalize(b.name).length - normalize(a.name).length);
    const compactText = normalize(text);
    const matched = candidates.find((item: any) => compactText.includes(normalize(item.name)));
    const rarityText = text.match(/\b(Common|Rare|Epic|Legendary|Ultimate|Mythic|Quantum)\b/i)?.[1];
    const levelText = text.match(/\b(?:lv|level)\.?\s*:?\s*(\d{1,3})\b/i)?.[1];
    const damageText = text.match(/([\d,.]+\s*[kmb]?)\s*damage\b/i)?.[1];
    const healthText = text.match(/([\d,.]+\s*[kmb]?)\s*health\b/i)?.[1];
    const secondaryStats: ImportStat[] = [];
    for (const line of text.split(/\r?\n/)) {
        const percent = line.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/)?.[1];
        if (!percent) continue;
        const normalizedLine = line.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
        const alias = statAliases.find(([label]) => normalizedLine.includes(label));
        if (alias) secondaryStats.push({ statId: alias[1], value: Number(percent.replace(',', '.')) });
    }
    const bracketName = text.match(/\[(?:Common|Rare|Epic|Legendary|Ultimate|Mythic|Quantum)\]\s*([^\r\n]+)/i)?.[1]?.trim();
    const missing = [!matched && 'name', !levelText && 'level'].filter(Boolean).join(' and ');
    return {
        kind: matched?.kind || (/\bmounts?\b/i.test(text) ? 'mount' : 'pet'),
        name: matched?.name || bracketName || '',
        rarity: matched?.rarity || (rarityText ? rarityText[0].toUpperCase() + rarityText.slice(1).toLowerCase() : 'Common'),
        level: Math.max(1, Number(levelText) || 1),
        damage: parseMagnitude(damageText), health: parseMagnitude(healthText), secondaryStats,
        confidence,
        notes: missing ? `Local OCR could not confidently find the ${missing}. Enter it manually below.` : 'Read locally in your browser. Verify the values before importing.',
    };
}

export default function CompanionImport() {
    const { profile, updateNestedProfile } = useProfile();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const fileRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState('');
    const [imageDataUrl, setImageDataUrl] = useState('');
    const [result, setResult] = useState<Recognition | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(0);
    const [progressLabel, setProgressLabel] = useState('');

    const statIds = useMemo(() => Object.keys(secondaryStatLibrary || {}), [secondaryStatLibrary]);
    const availableNames = useMemo(() => result ? Object.values((result.kind === 'pet' ? spriteMapping?.pets : spriteMapping?.mounts)?.mapping || {}).map((item: any) => item.name).sort() : [], [result, spriteMapping]);
    const matches = useMemo(() => {
        if (!result) return [];
        const mapping = result.kind === 'pet' ? spriteMapping?.pets?.mapping : spriteMapping?.mounts?.mapping;
        return Object.values(mapping || {}).filter((item: any) => normalize(item.name) === normalize(result.name));
    }, [result, spriteMapping]);
    const selectedMatch = useMemo(() => {
        if (!result) return null;
        return (matches.find((item: any) => item.rarity === result.rarity) || null) as any;
    }, [matches, result]);

    const duplicate = useMemo(() => {
        if (!result || !selectedMatch) return false;
        const candidate = JSON.stringify(normalizedStats(result.secondaryStats));
        const collection = result.kind === 'pet' ? profile.pets.savedBuilds : profile.mount.savedBuilds;
        return collection.some(item => item.id === selectedMatch.id
            && item.rarity === result.rarity
            && item.level === result.level
            && JSON.stringify(normalizedStats(item.secondaryStats || [])) === candidate);
    }, [profile, result, selectedMatch]);

    const chooseFile = (file?: File) => {
        if (!file) return;
        setError('');
        setResult(null);
        if (!file.type.startsWith('image/')) return setError('Choose a PNG, JPG, or WEBP screenshot.');
        if (file.size > 10 * 1024 * 1024) return setError('The screenshot must be smaller than 10 MB.');
        const reader = new FileReader();
        reader.onload = () => {
            const value = String(reader.result || '');
            setPreview(value);
            setImageDataUrl(value);
        };
        reader.readAsDataURL(file);
    };

    const analyze = async () => {
        if (!imageDataUrl) return;
        setBusy(true);
        setError('');
        setProgress(0);
        try {
            const ocr = await recognizeLocally(imageDataUrl, message => {
                setProgress(Math.round((message.progress || 0) * 100));
                setProgressLabel(message.status.replace(/_/g, ' '));
            });
            const parsed = parseOcr(ocr.text, ocr.confidence, spriteMapping);
            setResult(parsed);
            if (!parsed.name) setError('Local OCR could not identify the companion. Enter the fields manually in the review panel.');
        } catch (cause) {
            setError(`${cause instanceof Error ? cause.message : 'The screenshot could not be read.'} Enter the fields manually in the review panel.`);
            setResult({ kind: 'pet', name: '', rarity: 'Common', level: 1, secondaryStats: [], confidence: 0, notes: 'Manual entry — local OCR did not complete.' });
        } finally {
            setBusy(false);
        }
    };

    const startManual = () => {
        setError('');
        setResult({ kind: 'pet', name: '', rarity: 'Common', level: 1, secondaryStats: [], confidence: 0, notes: 'Manual entry.' });
    };

    const update = (patch: Partial<Recognition>) => setResult(current => current ? { ...current, ...patch } : current);
    const updateStat = (index: number, patch: Partial<ImportStat>) => update({ secondaryStats: result!.secondaryStats.map((stat, i) => i === index ? { ...stat, ...patch } : stat) });

    const save = () => {
        if (!result || !selectedMatch || duplicate) return;
        const common = {
            id: Number(selectedMatch.id), rarity: result.rarity, level: Math.max(1, result.level), evolution: 0,
            instanceId: makeId(), secondaryStats: normalizedStats(result.secondaryStats),
        };
        if (result.kind === 'pet') {
            const pet: PetSlot = common;
            updateNestedProfile('pets', { savedBuilds: [...profile.pets.savedBuilds, pet] });
        } else {
            const mount: MountSlot = { ...common, skills: [] };
            updateNestedProfile('mount', { savedBuilds: [...profile.mount.savedBuilds, mount] });
        }
        toast.success(`${result.name} added to My ${result.kind === 'pet' ? 'Pets' : 'Mounts'}`);
        setResult(null); setPreview(''); setImageDataUrl('');
        if (fileRef.current) fileRef.current.value = '';
    };

    return <div className="mx-auto max-w-6xl space-y-6 pb-20">
        <header className="border-b border-border pb-6"><h1 className="flex items-center gap-3 text-3xl font-black text-text-primary"><Camera className="h-8 w-8 text-accent-primary" />Screenshot Import</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Upload one detailed pet or mount card. Free local OCR reads it inside your browser—no AI, tokens, or per-image charge. You review every field before it saves.</p></header>
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <section className="space-y-4 rounded-2xl border border-border bg-bg-card/70 p-5">
                <div onClick={() => fileRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }} className="flex min-h-72 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-black/15 text-center hover:border-accent-primary/60">
                    {preview ? <img src={preview} alt="Screenshot preview" className="max-h-[32rem] w-full object-contain" /> : <><Upload className="h-10 w-10 text-accent-primary" /><h2 className="mt-3 font-black text-text-primary">Drop a screenshot here</h2><p className="mt-1 text-xs text-text-muted">or click to choose PNG, JPG, or WEBP · 10 MB max</p></>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />
                <button onClick={analyze} disabled={!imageDataUrl || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-3 font-black text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{busy ? `Reading locally${progress ? ` · ${progress}%` : '…'}` : 'Read screenshot locally'}</button>
                {busy && <div className="space-y-1"><div className="h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full bg-accent-primary transition-all" style={{ width: `${progress}%` }} /></div><p className="text-center text-[10px] capitalize text-text-muted">{progressLabel || 'Preparing OCR'}</p></div>}
                <button onClick={startManual} disabled={busy} className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-text-secondary hover:border-accent-primary/50 hover:text-text-primary disabled:opacity-40">Enter manually instead</button>
                {error && <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
            </section>

            <section className="rounded-2xl border border-border bg-bg-card/70 p-5">
                {!result ? <div className="flex min-h-72 flex-col items-center justify-center text-center"><CopyCheck className="h-10 w-10 text-text-muted" /><h2 className="mt-3 font-black text-text-primary">Review before importing</h2><p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">Recognized or manually entered values appear here. Nothing is added automatically.</p><button onClick={startManual} className="mt-4 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary">Start manual entry</button></div> : <div className="space-y-5">
                    <div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-text-primary">Companion details</h2><p className="text-xs text-text-muted">{result.confidence ? `Local OCR confidence ${Math.round(result.confidence * 100)}%` : 'Manual entry'} · verify every value</p></div>{duplicate && <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-300">Already saved</span>}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Type"><select value={result.kind} onChange={e => update({ kind: e.target.value as Kind })} className={inputClass}><option value="pet">Pet</option><option value="mount">Mount</option></select></Field>
                        <Field label="Name"><input list="companion-import-names" value={result.name} onChange={e => update({ name: e.target.value })} className={inputClass} /><datalist id="companion-import-names">{availableNames.map(name => <option key={name} value={name} />)}</datalist></Field>
                        <Field label="Rarity"><select value={result.rarity} onChange={e => update({ rarity: e.target.value })} className={inputClass}>{['Common','Rare','Epic','Legendary','Ultimate','Mythic','Quantum'].map(value => <option key={value}>{value}</option>)}</select></Field>
                        <Field label="Level"><input type="number" min="1" value={result.level} onChange={e => update({ level: Math.max(1, Number(e.target.value)) })} className={inputClass} /></Field>
                    </div>
                    {!selectedMatch && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">That name is not in the current game config. Correct the name before importing.</div>}
                    {(result.damage !== undefined || result.health !== undefined) && <div className="grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-black/20 p-3"><span className="text-text-muted">Shown damage</span><strong className="block text-base text-text-primary">{result.damage ?? '—'}</strong></div><div className="rounded-lg bg-black/20 p-3"><span className="text-text-muted">Shown health</span><strong className="block text-base text-text-primary">{result.health ?? '—'}</strong></div></div>}
                    <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase text-text-secondary">Secondary stats</h3><button onClick={() => update({ secondaryStats: [...result.secondaryStats, { statId: statIds[0] || 'DamageMulti', value: 0 }] })} className="flex items-center gap-1 text-xs font-bold text-accent-primary"><Plus className="h-3 w-3" />Add stat</button></div>{result.secondaryStats.map((stat, index) => <div key={`${index}-${stat.statId}`} className="grid grid-cols-[1fr_7rem_2rem] gap-2"><select value={stat.statId} onChange={e => updateStat(index, { statId: e.target.value })} className={inputClass}>{statIds.map(id => <option key={id} value={id}>{getStatName(id)}</option>)}</select><input type="number" step="0.01" value={stat.value} onChange={e => updateStat(index, { value: Number(e.target.value) })} className={inputClass} /><button onClick={() => update({ secondaryStats: result.secondaryStats.filter((_, i) => i !== index) })} className="rounded-lg text-red-300 hover:bg-red-500/10"><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>
                    {result.notes && <p className="rounded-lg bg-black/20 p-3 text-xs leading-5 text-text-muted">{result.notes}</p>}
                    <button onClick={save} disabled={!selectedMatch || duplicate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-35">{duplicate ? <CopyCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}{duplicate ? 'Duplicate — not imported' : `Add to My ${result.kind === 'pet' ? 'Pets' : 'Mounts'}`}</button>
                </div>}
            </section>
        </div>
    </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="text-[10px] font-black uppercase text-text-muted">{label}<div className="mt-1">{children}</div></label>;
}
