import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, Check, CopyCheck, Crop, Loader2, Plus, ScanLine, Trash2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import type { ItemSlot, MountSlot, PetSlot, ScannerTrainingExample, ScannerTrainingField } from '../types/Profile';
import { recognizeLocally, recognizeRegionsLocally, type OcrRegion } from '../utils/localOcr';
import { getStatName } from '../utils/statNames';
import { AGES } from '../utils/constants';

type Kind = 'item' | 'pet' | 'mount';
type EquipmentSlot = 'Weapon' | 'Helmet' | 'Body' | 'Gloves' | 'Belt' | 'Necklace' | 'Ring' | 'Shoe';
type ImportStat = { statId: string; value: number };
type Recognition = {
    kind: Kind;
    name: string;
    rarity: string;
    level: number;
    slot?: EquipmentSlot;
    age?: number;
    idx?: number;
    damage?: number;
    health?: number;
    secondaryStats: ImportStat[];
    confidence?: number;
    notes?: string;
};

type DraftCorrection = { field: ScannerTrainingField; region: OcrRegion; correctedValue: string };
type QueuedImage = { id: string; name: string; dataUrl: string };

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

const slotFromType = (type?: string): EquipmentSlot | undefined => ({
    Weapon: 'Weapon', Helmet: 'Helmet', Armour: 'Body', Gloves: 'Gloves', Belt: 'Belt',
    Necklace: 'Necklace', Ring: 'Ring', Shoes: 'Shoe',
} as Record<string, EquipmentSlot>)[type || ''];

const statIdFromText = (value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
    return statAliases.find(([label]) => clean.includes(label))?.[1];
};

function parseOcr(text: string, confidence: number, spriteMapping: any, autoItemMapping: any): Recognition {
    const candidates = [
        ...Object.values(spriteMapping?.pets?.mapping || {}).map((item: any) => ({ ...item, kind: 'pet' as Kind })),
        ...Object.values(spriteMapping?.mounts?.mapping || {}).map((item: any) => ({ ...item, kind: 'mount' as Kind })),
        ...Object.values(autoItemMapping || {}).map((item: any) => ({
            ...item,
            name: item.ItemName,
            rarity: AGES[item.Age] || 'Common',
            kind: 'item' as Kind,
            slot: slotFromType(item.TypeName),
            age: item.Age,
            idx: item.Idx,
        })),
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
        kind: matched?.kind || (/\bmounts?\b/i.test(text) ? 'mount' : /\b(?:weapon|helmet|armou?r|gloves?|belt|necklace|ring|shoes?|item)\b/i.test(text) ? 'item' : 'pet'),
        name: matched?.name || bracketName || '',
        rarity: matched?.rarity || (rarityText ? rarityText[0].toUpperCase() + rarityText.slice(1).toLowerCase() : 'Common'),
        level: Math.max(1, Number(levelText) || 1),
        slot: matched?.slot,
        age: matched?.age,
        idx: matched?.idx,
        damage: parseMagnitude(damageText), health: parseMagnitude(healthText), secondaryStats,
        confidence,
        notes: missing ? `Local OCR could not confidently find the ${missing}. Enter it manually below.` : 'Read locally in your browser. Verify the values before importing.',
    };
}

const recognitionFailed = (result: Recognition) => !result.name || result.confidence === undefined || result.confidence < 0.35 || (result.kind === 'item' && (result.slot === undefined || result.age === undefined || result.idx === undefined));

export default function CompanionImport() {
    const { profile, updateNestedProfile } = useProfile();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const fileRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState('');
    const [imageDataUrl, setImageDataUrl] = useState('');
    const [result, setResult] = useState<Recognition | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(0);
    const [progressLabel, setProgressLabel] = useState('');
    const [scanFailed, setScanFailed] = useState(false);
    const [corrections, setCorrections] = useState<DraftCorrection[]>([]);
    const [aspectRatio, setAspectRatio] = useState(1);
    const [queue, setQueue] = useState<QueuedImage[]>([]);
    const [queueIndex, setQueueIndex] = useState(0);
    const [autoAnalyzeNext, setAutoAnalyzeNext] = useState(false);
    const [importedCount, setImportedCount] = useState(0);

    const statIds = useMemo(() => Object.keys(secondaryStatLibrary || {}), [secondaryStatLibrary]);
    const availableNames = useMemo(() => {
        if (!result) return [];
        if (result.kind === 'item') return Object.values(autoItemMapping || {}).map((item: any) => item.ItemName).filter(Boolean).sort();
        return Object.values((result.kind === 'pet' ? spriteMapping?.pets : spriteMapping?.mounts)?.mapping || {}).map((item: any) => item.name).sort();
    }, [result, spriteMapping, autoItemMapping]);
    const matches = useMemo(() => {
        if (!result) return [];
        if (result.kind === 'item') return Object.values(autoItemMapping || {}).filter((item: any) => normalize(item.ItemName) === normalize(result.name));
        const mapping = result.kind === 'pet' ? spriteMapping?.pets?.mapping : spriteMapping?.mounts?.mapping;
        return Object.values(mapping || {}).filter((item: any) => normalize(item.name) === normalize(result.name));
    }, [result, spriteMapping, autoItemMapping]);
    const selectedMatch = useMemo(() => {
        if (!result) return null;
        if (result.kind === 'item') return (matches.find((item: any) => slotFromType(item.TypeName) === result.slot && item.Age === result.age) || matches[0] || null) as any;
        return (matches.find((item: any) => item.rarity === result.rarity) || null) as any;
    }, [matches, result]);

    const duplicate = useMemo(() => {
        if (!result || !selectedMatch) return false;
        const candidate = JSON.stringify(normalizedStats(result.secondaryStats));
        if (result.kind === 'item') {
            const slot = result.slot;
            if (!slot) return false;
            return (profile.savedItems?.[slot] || []).some(item => item.age === result.age
                && item.idx === result.idx
                && item.level === result.level
                && JSON.stringify(normalizedStats(item.secondaryStats || [])) === candidate);
        }
        const collection = result.kind === 'pet' ? profile.pets.savedBuilds : profile.mount.savedBuilds;
        return collection.some(item => item.id === selectedMatch.id
            && item.rarity === result.rarity
            && item.level === result.level
            && JSON.stringify(normalizedStats(item.secondaryStats || [])) === candidate);
    }, [profile, result, selectedMatch]);

    const showQueuedImage = (images: QueuedImage[], index: number) => {
        const queued = images[index];
        if (!queued) return;
        setPreview(queued.dataUrl);
        setImageDataUrl(queued.dataUrl);
        setResult(null);
        setCorrections([]);
        setScanFailed(false);
        const image = new Image();
        image.onload = () => setAspectRatio(image.naturalWidth / Math.max(1, image.naturalHeight));
        image.src = queued.dataUrl;
    };

    const chooseFiles = async (files?: FileList | File[]) => {
        const selected = Array.from(files || []).slice(0, 30);
        if (!selected.length) return;
        setError('');
        setResult(null);
        const valid = selected.filter(file => file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024);
        if (!valid.length) return setError('Choose PNG, JPG, or WEBP screenshots smaller than 10 MB each.');
        if (valid.length !== selected.length) setError(`${selected.length - valid.length} unsupported or oversized image(s) were skipped.`);
        const images = await Promise.all(valid.map(file => new Promise<QueuedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ id: makeId(), name: file.name, dataUrl: String(reader.result || '') });
            reader.onerror = () => reject(new Error(`${file.name} could not be opened.`));
            reader.readAsDataURL(file);
        }))).catch(cause => { setError(cause instanceof Error ? cause.message : 'The images could not be opened.'); return []; });
        if (!images.length) return;
        setQueue(images);
        setQueueIndex(0);
        setImportedCount(0);
        showQueuedImage(images, 0);
    };

    const analyze = async () => {
        if (!imageDataUrl) return;
        setBusy(true);
        setError('');
        setProgress(0);
        setScanFailed(false);
        setCorrections([]);
        try {
            const ocr = await recognizeLocally(imageDataUrl, message => {
                setProgress(Math.round((message.progress || 0) * 100));
                setProgressLabel(message.status.replace(/_/g, ' '));
            });
            let parsed = parseOcr(ocr.text, ocr.confidence, spriteMapping, autoItemMapping);
            if (recognitionFailed(parsed)) {
                const sharedResponse = await fetch('/api/scanner-training').catch(() => null);
                const sharedPayload = sharedResponse?.ok
                    ? await sharedResponse.json().catch(() => null) as { examples?: Array<Omit<ScannerTrainingExample, 'id' | 'createdAt' | 'region'> & { regionJson?: string }> } | null
                    : null;
                const sharedTemplates: ScannerTrainingExample[] = (sharedPayload?.examples || []).flatMap((example, index) => {
                    try {
                        const region = JSON.parse(example.regionJson || '') as OcrRegion;
                        return [{ ...example, id: `shared-${index}`, createdAt: '', region } as ScannerTrainingExample];
                    } catch { return []; }
                });
                const templates = [...(profile.misc.scannerTrainingExamples || []), ...sharedTemplates]
                    .filter(example => Math.abs(example.aspectRatio - aspectRatio) < 0.18)
                    .slice(0, 80);
                if (templates.length) {
                    setProgressLabel('checking learned scan regions');
                    const readings = await recognizeRegionsLocally(imageDataUrl, templates.map(template => template.region), message => setProgress(Math.round((message.progress || 0) * 100)));
                    const trainedText = templates.map((template, index) => `${template.field}: ${readings[index]?.text || ''}`).join('\n');
                    parsed = parseOcr(`${ocr.text}\n${trainedText}`, Math.max(ocr.confidence, ...readings.map(reading => reading.confidence)), spriteMapping, autoItemMapping);
                }
            }
            setResult(parsed);
            const failed = recognitionFailed(parsed);
            setScanFailed(failed);
            if (failed) setError('Automatic reading needs help. Mark only the failed fields below, enter the correct values, and ForgeMaster will remember those regions for future screenshots.');
        } catch (cause) {
            setError(`${cause instanceof Error ? cause.message : 'The screenshot could not be read.'} Mark the failed fields or enter them manually.`);
            setResult({ kind: 'pet', name: '', rarity: 'Common', level: 1, secondaryStats: [], confidence: 0, notes: 'Manual entry — local OCR did not complete.' });
            setScanFailed(true);
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (!autoAnalyzeNext || !imageDataUrl || busy) return;
        setAutoAnalyzeNext(false);
        void analyze();
    // The queued image change is the deliberate trigger; analyze uses the current scanner state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoAnalyzeNext, imageDataUrl]);

    const finishCurrent = (imported: boolean) => {
        const nextIndex = queueIndex + 1;
        if (imported) setImportedCount(count => count + 1);
        if (nextIndex < queue.length) {
            setQueueIndex(nextIndex);
            showQueuedImage(queue, nextIndex);
            setAutoAnalyzeNext(true);
            return;
        }
        setResult(null); setPreview(''); setImageDataUrl(''); setCorrections([]); setScanFailed(false);
        setQueue([]); setQueueIndex(0); setAutoAnalyzeNext(false);
        if (fileRef.current) fileRef.current.value = '';
        toast.success(imported ? `Batch complete — ${importedCount + 1} image(s) imported.` : `Batch complete — ${importedCount} image(s) imported.`);
    };

    const startManual = () => {
        setError('');
        setResult({ kind: 'pet', name: '', rarity: 'Common', level: 1, secondaryStats: [], confidence: 0, notes: 'Manual entry.' });
        setScanFailed(true);
    };

    const update = (patch: Partial<Recognition>) => setResult(current => current ? { ...current, ...patch } : current);
    const updateStat = (index: number, patch: Partial<ImportStat>) => update({ secondaryStats: result!.secondaryStats.map((stat, i) => i === index ? { ...stat, ...patch } : stat) });

    const addCorrection = (correction: DraftCorrection) => {
        setCorrections(current => [...current, correction]);
        const value = correction.correctedValue.trim();
        if (!value) return;
        if (correction.field === 'kind' && ['item', 'pet', 'mount'].includes(value.toLowerCase())) update({ kind: value.toLowerCase() as Kind });
        if (correction.field === 'name') update({ name: value });
        if (correction.field === 'rarity') update({ rarity: value });
        if (correction.field === 'level') update({ level: Math.max(1, Number(value) || 1) });
        if (correction.field === 'slot') update({ slot: slotFromType(value) || value as EquipmentSlot });
        if (correction.field === 'age') {
            const age = AGES.findIndex(item => normalize(item) === normalize(value));
            update({ age: age >= 0 ? age : Math.max(0, Number(value) - 1) });
        }
        if (correction.field === 'stat_name') {
            const statId = statIdFromText(value);
            if (statId) update({ secondaryStats: [...(result?.secondaryStats || []), { statId, value: 0 }] });
        }
        if (correction.field === 'stat_value') {
            const stats = [...(result?.secondaryStats || [])];
            if (stats.length) stats[stats.length - 1] = { ...stats[stats.length - 1], value: Number(value.replace('%', '')) || 0 };
            update({ secondaryStats: stats });
        }
    };

    const save = async () => {
        if (!result || !selectedMatch || duplicate) return;
        setBusy(true);
        let trainingExamples: ScannerTrainingExample[] = [];
        if (corrections.length && imageDataUrl) {
            let readings: { text: string }[] = [];
            try {
                readings = await recognizeRegionsLocally(imageDataUrl, corrections.map(correction => correction.region), message => {
                    setProgress(Math.round((message.progress || 0) * 100));
                    setProgressLabel('saving corrected scan examples');
                });
            } catch {
                // Corrections still work as layout training even when the crop OCR cannot be repeated.
            }
            trainingExamples = corrections.map((correction, index) => ({
                id: makeId(),
                kind: result.kind,
                field: correction.field,
                region: correction.region,
                aspectRatio,
                observedText: readings[index]?.text || undefined,
                correctedValue: correction.correctedValue,
                createdAt: new Date().toISOString(),
            }));
            updateNestedProfile('misc', {
                scannerTrainingExamples: [...(profile.misc.scannerTrainingExamples || []), ...trainingExamples].slice(-100),
            });
            if (profile.misc.scannerContributionEnabled !== false) {
                void fetch('/api/scanner-training', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examples: trainingExamples }),
                }).catch(() => undefined);
            }
        }
        if (result.kind === 'item') {
            const slot = slotFromType(selectedMatch.TypeName) || result.slot;
            if (!slot) {
                setError('Choose the equipment slot before importing this item.');
                setBusy(false);
                return;
            }
            const item: ItemSlot & { customName?: string } = {
                age: Number(selectedMatch.Age ?? result.age ?? 0),
                idx: Number(selectedMatch.Idx ?? result.idx ?? 0),
                level: Math.max(1, result.level),
                rarity: 'Common',
                secondaryStats: normalizedStats(result.secondaryStats),
                customName: result.name,
            };
            updateNestedProfile('savedItems', { [slot]: [...(profile.savedItems?.[slot] || []), item] });
            toast.success(`${result.name} added to saved ${slot} items`);
            setBusy(false);
            finishCurrent(true);
            return;
        }
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
        setBusy(false);
        finishCurrent(true);
    };

    return <div className="mx-auto max-w-6xl space-y-6 pb-20">
        <header className="border-b border-border pb-6"><h1 className="flex items-center gap-3 text-3xl font-black text-text-primary"><Camera className="h-8 w-8 text-accent-primary" />Screenshot Import</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Select up to 30 equipment, pet, or mount screenshots at once. Free local OCR works through the batch inside your browser—no AI, tokens, or per-image charge. Review each result; after import, the next image scans automatically.</p></header>
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <section className="space-y-4 rounded-2xl border border-border bg-bg-card/70 p-5">
                <label className="flex items-start gap-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3 text-xs text-text-secondary">
                    <input type="checkbox" checked={profile.misc.scannerContributionEnabled !== false} onChange={event => {
                        const enabled = event.target.checked;
                        updateNestedProfile('misc', { scannerContributionEnabled: enabled });
                        if (!enabled) void fetch('/api/scanner-training', { method: 'DELETE' }).catch(() => undefined);
                    }} className="mt-0.5 accent-cyan-400" />
                    <span><strong className="block text-text-primary">Improve scanning for everyone</strong><span className="mt-1 block leading-5">On by default. If automatic scanning fails and you correct it, only the field, crop coordinates, OCR text, and corrected game value are shared anonymously. The screenshot never leaves your device.</span></span>
                </label>
                <div onClick={() => fileRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void chooseFiles(event.dataTransfer.files); }} className="flex min-h-72 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-black/15 text-center hover:border-accent-primary/60">
                    {preview ? <div className="relative w-full"><img src={preview} alt="Screenshot preview" className="max-h-[32rem] w-full object-contain" />{queue.length > 1 && <span className="absolute left-2 top-2 rounded-full bg-black/80 px-3 py-1 text-xs font-black text-white">{queueIndex + 1} of {queue.length} · {queue[queueIndex]?.name}</span>}</div> : <><Upload className="h-10 w-10 text-accent-primary" /><h2 className="mt-3 font-black text-text-primary">Drop screenshots here</h2><p className="mt-1 text-xs text-text-muted">or click to choose up to 30 PNG, JPG, or WEBP files · 10 MB each</p></>}
                </div>
                <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void chooseFiles(event.target.files || undefined)} />
                <button onClick={analyze} disabled={!imageDataUrl || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-3 font-black text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{busy ? `Reading image ${queue.length ? queueIndex + 1 : 1}${progress ? ` · ${progress}%` : '…'}` : queue.length > 1 ? `Start batch of ${queue.length}` : 'Read screenshot locally'}</button>
                {busy && <div className="space-y-1"><div className="h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full bg-accent-primary transition-all" style={{ width: `${progress}%` }} /></div><p className="text-center text-[10px] capitalize text-text-muted">{progressLabel || 'Preparing OCR'}</p></div>}
                <button onClick={startManual} disabled={busy} className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-text-secondary hover:border-accent-primary/50 hover:text-text-primary disabled:opacity-40">Enter manually instead</button>
                {queue.length > 1 && <button onClick={() => finishCurrent(false)} disabled={busy} className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-text-muted hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-40">Skip this image · {queue.length - queueIndex - 1} remaining</button>}
                {error && <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
            </section>

            <section className="rounded-2xl border border-border bg-bg-card/70 p-5">
                {!result ? <div className="flex min-h-72 flex-col items-center justify-center text-center"><CopyCheck className="h-10 w-10 text-text-muted" /><h2 className="mt-3 font-black text-text-primary">Review before importing</h2><p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">Recognized or manually entered values appear here. Nothing is added automatically.</p><button onClick={startManual} className="mt-4 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary">Start manual entry</button></div> : <div className="space-y-5">
                    <div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-text-primary">{result.kind === 'item' ? 'Equipment details' : 'Companion details'}</h2><p className="text-xs text-text-muted">{result.confidence ? `Local OCR confidence ${Math.round(result.confidence * 100)}%` : 'Manual entry'} · verify every value</p></div>{duplicate && <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-300">Already saved</span>}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Type"><select value={result.kind} onChange={e => update({ kind: e.target.value as Kind, name: '' })} className={inputClass}><option value="item">Equipment</option><option value="pet">Pet</option><option value="mount">Mount</option></select></Field>
                        <Field label="Name"><input list="scan-import-names" value={result.name} onChange={e => update({ name: e.target.value })} className={inputClass} /><datalist id="scan-import-names">{availableNames.map(name => <option key={name} value={name} />)}</datalist></Field>
                        <Field label="Rarity"><select value={result.rarity} onChange={e => update({ rarity: e.target.value })} className={inputClass}>{['Common','Rare','Epic','Legendary','Ultimate','Mythic','Quantum'].map(value => <option key={value}>{value}</option>)}</select></Field>
                        <Field label="Level"><input type="number" min="1" value={result.level} onChange={e => update({ level: Math.max(1, Number(e.target.value)) })} className={inputClass} /></Field>
                        {result.kind === 'item' && <>
                            <Field label="Equipment slot"><select value={result.slot || ''} onChange={e => update({ slot: e.target.value as EquipmentSlot })} className={inputClass}><option value="">Choose slot</option>{['Weapon','Helmet','Body','Gloves','Belt','Necklace','Ring','Shoe'].map(slot => <option key={slot}>{slot}</option>)}</select></Field>
                            <Field label="Age"><select value={result.age ?? ''} onChange={e => update({ age: Number(e.target.value) })} className={inputClass}><option value="">Choose age</option>{AGES.map((age, index) => <option key={age} value={index}>{age}</option>)}</select></Field>
                        </>}
                    </div>
                    {!selectedMatch && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">That name is not in the current game config. Correct the name before importing.</div>}
                    {(result.damage !== undefined || result.health !== undefined) && <div className="grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-black/20 p-3"><span className="text-text-muted">Shown damage</span><strong className="block text-base text-text-primary">{result.damage ?? '—'}</strong></div><div className="rounded-lg bg-black/20 p-3"><span className="text-text-muted">Shown health</span><strong className="block text-base text-text-primary">{result.health ?? '—'}</strong></div></div>}
                    <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase text-text-secondary">Secondary stats</h3><button onClick={() => update({ secondaryStats: [...result.secondaryStats, { statId: statIds[0] || 'DamageMulti', value: 0 }] })} className="flex items-center gap-1 text-xs font-bold text-accent-primary"><Plus className="h-3 w-3" />Add stat</button></div>{result.secondaryStats.map((stat, index) => <div key={`${index}-${stat.statId}`} className="grid grid-cols-[1fr_7rem_2rem] gap-2"><select value={stat.statId} onChange={e => updateStat(index, { statId: e.target.value })} className={inputClass}>{statIds.map(id => <option key={id} value={id}>{getStatName(id)}</option>)}</select><input type="number" step="0.01" value={stat.value} onChange={e => updateStat(index, { value: Number(e.target.value) })} className={inputClass} /><button onClick={() => update({ secondaryStats: result.secondaryStats.filter((_, i) => i !== index) })} className="rounded-lg text-red-300 hover:bg-red-500/10"><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>
                    {result.notes && <p className="rounded-lg bg-black/20 p-3 text-xs leading-5 text-text-muted">{result.notes}</p>}
                    <button onClick={save} disabled={!selectedMatch || duplicate || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-35">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : duplicate ? <CopyCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}{duplicate ? 'Duplicate — not imported' : result.kind === 'item' ? 'Add to saved equipment' : `Add to My ${result.kind === 'pet' ? 'Pets' : 'Mounts'}`}</button>
                </div>}
            </section>
        </div>
        {scanFailed && preview && result && (
            <RegionCorrectionPanel
                image={preview}
                corrections={corrections}
                onAdd={addCorrection}
                onRemove={index => setCorrections(current => current.filter((_, correctionIndex) => correctionIndex !== index))}
            />
        )}
    </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="text-[10px] font-black uppercase text-text-muted">{label}<div className="mt-1">{children}</div></label>;
}

function RegionCorrectionPanel({ image, corrections, onAdd, onRemove }: {
    image: string;
    corrections: DraftCorrection[];
    onAdd: (correction: DraftCorrection) => void;
    onRemove: (index: number) => void;
}) {
    const imageRef = useRef<HTMLDivElement>(null);
    const [field, setField] = useState<ScannerTrainingField>('name');
    const [correctedValue, setCorrectedValue] = useState('');
    const [start, setStart] = useState<{ x: number; y: number } | null>(null);
    const [region, setRegion] = useState<OcrRegion | null>(null);

    const point = (event: React.PointerEvent) => {
        const rect = imageRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
    };
    const updateRegion = (origin: { x: number; y: number }, current: { x: number; y: number }) => setRegion({
        x: Math.min(origin.x, current.x),
        y: Math.min(origin.y, current.y),
        width: Math.abs(current.x - origin.x),
        height: Math.abs(current.y - origin.y),
    });

    return (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-950/10 p-5 space-y-5">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-amber-400/10 p-2 text-amber-300"><ScanLine className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-black text-text-primary">Help only where automatic scan failed</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">Choose the missing field, drag a box around that value in the screenshot, and type the correct value. The current import updates immediately, and the normalized region is saved with your account for screenshots with the same layout.</p></div>
            </div>
            <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
                <div className="overflow-auto rounded-xl border border-border bg-black/30 p-2">
                    <div
                        ref={imageRef}
                        className="relative mx-auto w-fit max-w-full touch-none cursor-crosshair select-none"
                        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); const next = point(event); setStart(next); setRegion({ x: next.x, y: next.y, width: 0, height: 0 }); }}
                        onPointerMove={event => { if (start) updateRegion(start, point(event)); }}
                        onPointerUp={event => { if (start) updateRegion(start, point(event)); setStart(null); }}
                    >
                        <img src={image} alt="Select a failed scan region" className="block max-h-[42rem] max-w-full" draggable={false} />
                        {corrections.map((correction, index) => <div key={index} className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/10" style={{ left: `${correction.region.x * 100}%`, top: `${correction.region.y * 100}%`, width: `${correction.region.width * 100}%`, height: `${correction.region.height * 100}%` }}><span className="absolute -top-5 left-0 rounded bg-emerald-500 px-1 text-[9px] font-black text-black">{correction.field}</span></div>)}
                        {region && <div className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/10" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}
                    </div>
                </div>
                <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-bg-card/60 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-black text-text-primary"><Crop className="h-4 w-4 text-amber-300" /> New correction</div>
                        <Field label="What is inside the box?"><select value={field} onChange={event => setField(event.target.value as ScannerTrainingField)} className={inputClass}>{[
                            ['kind','Type: item, pet, or mount'], ['name','Name'], ['rarity','Rarity'], ['level','Level'], ['slot','Equipment slot'], ['age','Age'], ['stat_name','Secondary stat name'], ['stat_value','Secondary stat value'],
                        ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                        <Field label="Correct value"><input value={correctedValue} onChange={event => setCorrectedValue(event.target.value)} placeholder="Type exactly what should be saved" className={inputClass} /></Field>
                        <button type="button" disabled={!region || region.width < 0.01 || region.height < 0.01 || !correctedValue.trim()} onClick={() => {
                            if (!region) return;
                            onAdd({ field, region, correctedValue: correctedValue.trim() });
                            setRegion(null);
                            setCorrectedValue('');
                        }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2.5 text-xs font-black text-amber-950 disabled:opacity-35"><Plus className="h-3.5 w-3.5" /> Save correction</button>
                    </div>
                    <div className="space-y-2">
                        {corrections.map((correction, index) => <div key={index} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-primary/30 p-2 text-xs"><div className="min-w-0"><div className="font-bold text-text-primary">{correction.field.replace('_', ' ')}</div><div className="truncate text-text-muted">{correction.correctedValue}</div></div><button type="button" onClick={() => onRemove(index)} className="rounded-md p-2 text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
                        {!corrections.length && <p className="rounded-lg border border-dashed border-border p-3 text-[11px] leading-5 text-text-muted">Drag on the image first. This section stays hidden whenever automatic recognition succeeds.</p>}
                    </div>
                </div>
            </div>
        </section>
    );
}
