import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, Check, CopyCheck, Crop, Loader2, Plus, ScanLine, Trash2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import type { ItemSlot, MountSlot, PetSlot, ScannerTrainingExample, ScannerTrainingField } from '../types/Profile';
import { recognizeImportCardLocally, recognizeRegionsLocally, type ImportCardOcrFields, type OcrRegion } from '../utils/localOcr';
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
    .filter(stat => Boolean(stat.statId))
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

const editDistance = (left: string, right: string) => {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
            );
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
};

const similarity = (left: string, right: string) => {
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 1 - editDistance(a, b) / Math.max(a.length, b.length);
};

const bestKnownCandidate = (text: string, candidates: any[], rarity?: string, minimumScore = 0.68) => {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const nameLines = lines.flatMap(line => {
        const withoutRarity = line.replace(/\[(?:Common|Rare|Epic|Legendary|Ultimate|Mythic|Quantum)\]/i, '').trim();
        return [withoutRarity, ...withoutRarity.split(/\s+/)];
    });
    const pool = rarity ? candidates.filter(candidate => !candidate.rarity || normalize(candidate.rarity) === normalize(rarity)) : candidates;
    let best: { candidate: any; score: number } | null = null;
    for (const candidate of pool.length ? pool : candidates) {
        const lettersOnly = text.replace(/[^a-z]/gi, '');
        const candidateLength = normalize(candidate.name).length;
        const suffixes = [candidateLength - 1, candidateLength, candidateLength + 1]
            .filter(length => length > 1 && lettersOnly.length >= length)
            .map(length => lettersOnly.slice(-length));
        for (const line of [...nameLines, ...suffixes]) {
            const score = similarity(line, candidate.name);
            if (!best || score > best.score) best = { candidate, score };
        }
    }
    return best && best.score >= minimumScore ? best.candidate : undefined;
};

const statIdFromOcrLine = (line: string) => {
    const clean = line.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const exact = statAliases.find(([label]) => clean.includes(label));
    if (exact) return exact[1];
    let best: { statId: string; score: number } | null = null;
    for (const [label, statId] of statAliases) {
        const score = similarity(clean, label);
        if (!best || score > best.score) best = { statId, score };
    }
    return best && best.score >= 0.68 ? best.statId : undefined;
};

const knownCandidates = (spriteMapping: any, autoItemMapping: any) => [
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

const canonicalizeRecognition = (current: Recognition, spriteMapping: any, autoItemMapping: any): Recognition => {
    const candidates = knownCandidates(spriteMapping, autoItemMapping);
    const sameKind = candidates.filter(item => item.kind === current.kind);
    const candidate = sameKind.find((item: any) => normalize(item.name) === normalize(current.name))
        || bestKnownCandidate(current.name, sameKind);
    if (!candidate) return current;
    return {
        ...current,
        kind: candidate.kind,
        name: candidate.name,
        rarity: candidate.kind === 'item' ? current.rarity : candidate.rarity,
        slot: candidate.slot ?? current.slot,
        age: candidate.age ?? current.age,
        idx: candidate.idx ?? current.idx,
    };
};

const slotFromType = (type?: string): EquipmentSlot | undefined => ({
    Weapon: 'Weapon', Helmet: 'Helmet', Armour: 'Body', Gloves: 'Gloves', Belt: 'Belt',
    Necklace: 'Necklace', Ring: 'Ring', Shoes: 'Shoe',
} as Record<string, EquipmentSlot>)[type || ''];

const statIdFromText = (value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
    return statAliases.find(([label]) => clean.includes(label))?.[1];
};

const indexedStatField = (field: ScannerTrainingField) => field.match(/^stat_(\d+)_(name|value)$/);

function applyCorrectionValue(current: Recognition, field: ScannerTrainingField, rawValue: string): Recognition {
    const value = rawValue.trim();
    if (!value) return current;
    if (field === 'kind' && ['item', 'pet', 'mount'].includes(value.toLowerCase())) return { ...current, kind: value.toLowerCase() as Kind };
    if (field === 'name') return { ...current, name: value };
    if (field === 'rarity') return { ...current, rarity: value };
    if (field === 'level') return { ...current, level: Math.max(1, Number(value.replace(/[^0-9]/g, '')) || 1) };
    if (field === 'slot') return { ...current, slot: slotFromType(value) || value as EquipmentSlot };
    if (field === 'age') {
        const age = AGES.findIndex(item => normalize(item) === normalize(value));
        return { ...current, age: age >= 0 ? age : Math.max(0, Number(value) - 1) };
    }
    const indexed = indexedStatField(field);
    if (indexed) {
        const index = Math.max(0, Number(indexed[1]) - 1);
        const stats = [...current.secondaryStats];
        while (stats.length <= index) stats.push({ statId: '', value: 0 });
        if (indexed[2] === 'name') {
            const statId = statIdFromText(value);
            if (statId) stats[index] = { ...stats[index], statId };
        } else {
            stats[index] = { ...stats[index], value: Number(value.replace(/[^0-9.,+-]/g, '').replace(',', '.')) || 0 };
        }
        return { ...current, secondaryStats: stats };
    }
    if (field === 'stat_name') {
        const statId = statIdFromText(value);
        return statId ? { ...current, secondaryStats: [...current.secondaryStats, { statId, value: 0 }] } : current;
    }
    if (field === 'stat_value' && current.secondaryStats.length) {
        const stats = [...current.secondaryStats];
        stats[stats.length - 1] = { ...stats[stats.length - 1], value: Number(value.replace('%', '')) || 0 };
        return { ...current, secondaryStats: stats };
    }
    return current;
}

const canonicalRarity = (value: string) => {
    const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic', 'Quantum'];
    return rarities.map(rarity => ({ rarity, score: similarity(value, rarity) }))
        .sort((left, right) => right.score - left.score)[0];
};

export function parseOcr(text: string, confidence: number, spriteMapping: any, autoItemMapping: any, fields?: ImportCardOcrFields): Recognition {
    const candidates = knownCandidates(spriteMapping, autoItemMapping);
    const typeText = fields?.type || text;
    const titleText = fields?.title || text;
    const levelRegionText = fields?.level || text;
    const detailsText = fields?.details || text;
    const headingWords = typeText.split(/[^a-z]+/i).filter(Boolean);
    const mountHeadingScore = Math.max(0, ...headingWords.map(word => similarity(word, 'Mounts')));
    const petHeadingScore = Math.max(0, ...headingWords.map(word => similarity(word, 'Pets')));
    const headingKind: Kind | undefined = /\bmounts?\b/i.test(typeText) || mountHeadingScore >= 0.6 && mountHeadingScore > petHeadingScore
        ? 'mount'
        : /\bpets?\b/i.test(typeText) || petHeadingScore >= 0.6 ? 'pet' : undefined;
    const bracket = titleText.match(/\[\s*([^\]]{2,16})\s*\]\s*([^\r\n]*)/i);
    const closingBracketName = titleText.match(/\]\s*([^\r\n]+)/)?.[1]?.trim();
    const rarityGuess = bracket ? canonicalRarity(bracket[1]) : undefined;
    const rarityText = rarityGuess && rarityGuess.score >= 0.52 ? rarityGuess.rarity : undefined;
    const nameText = (bracket?.[2] || closingBracketName || titleText).replace(/^[^a-z]+/i, '').trim();
    const kindPool = headingKind ? candidates.filter(candidate => candidate.kind === headingKind) : candidates;
    const exact = kindPool.find((item: any) => normalize(nameText) === normalize(item.name));
    const matched = exact || bestKnownCandidate(nameText, kindPool, rarityText, normalize(nameText).length <= 5 ? 0.58 : 0.64);
    const levelText = levelRegionText.match(/\b(?:lv|lvl|level)[.\s:]*(\d{1,3})\b/i)?.[1]
        || levelRegionText.match(/\b(\d{1,3})\b/)?.[1];
    const damageText = detailsText.match(/([\d,.]+\s*[kmb]?)\s*damage\b/i)?.[1];
    const healthText = detailsText.match(/([\d,.]+\s*[kmb]?)\s*health\b/i)?.[1];
    const secondaryStats: ImportStat[] = [];
    for (const line of detailsText.split(/\r?\n/)) {
        const percent = line.match(/\+\s*(\d+(?:[.,]\d+)?)\s*%/)?.[1];
        if (!percent) continue;
        const statId = statIdFromOcrLine(line);
        const value = Number(percent.replace(',', '.'));
        if (!statId || !Number.isFinite(value) || value <= 0) continue;
        const sameValueIndex = secondaryStats.findIndex(stat => stat.value === value);
        const isGeneric = (id: string) => id === 'DamageMulti' || id === 'HealthMulti';
        if (sameValueIndex >= 0 && isGeneric(secondaryStats[sameValueIndex].statId) && !isGeneric(statId || '')) {
            secondaryStats[sameValueIndex] = { statId: statId!, value };
        } else if (statId && !(sameValueIndex >= 0 && !isGeneric(secondaryStats[sameValueIndex].statId) && isGeneric(statId))
            && !secondaryStats.some(stat => stat.statId === statId && stat.value === value)) {
            secondaryStats.push({ statId, value });
        }
    }
    const missing = [!matched && 'name', !levelText && 'level'].filter(Boolean).join(' and ');
    return canonicalizeRecognition({
        kind: headingKind || matched?.kind || (/\b(?:weapon|helmet|armou?r|gloves?|belt|necklace|ring|shoes?|item)\b/i.test(typeText) ? 'item' : 'pet'),
        name: matched?.name || '',
        rarity: rarityText || matched?.rarity || 'Common',
        level: Math.max(1, Number(levelText) || 1),
        slot: matched?.slot,
        age: matched?.age,
        idx: matched?.idx,
        damage: parseMagnitude(damageText), health: parseMagnitude(healthText), secondaryStats,
        confidence,
        notes: missing ? `Local OCR could not confidently find the ${missing}. Enter it manually below.` : 'Read locally in your browser. Verify the values before importing.',
    }, spriteMapping, autoItemMapping);
}

const recognitionFailed = (result: Recognition, expectedStats = 0) => !result.name || result.confidence === undefined || result.confidence < 0.35
    || result.secondaryStats.filter(stat => stat.statId && Number.isFinite(stat.value)).length < expectedStats
    || (result.kind === 'item' && (result.slot === undefined || result.age === undefined || result.idx === undefined));

export default function CompanionImport() {
    const { profile, updateNestedProfile } = useProfile();
    const { data: spriteMapping, loading: spriteMappingLoading } = useGameData<any>('ManualSpriteMapping.json');
    const { data: autoItemMapping, loading: autoItemMappingLoading } = useGameData<any>('AutoItemMapping.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: itemSecondaryUnlock } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: companionSecondaryUnlock } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
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

    const expectedStatCount = (candidate: Recognition) => {
        if (candidate.kind === 'item') {
            if ((profile.misc.forgeAscensionLevel || 0) > 0) return 2;
            return Math.max(0, Number(itemSecondaryUnlock?.[String(candidate.age ?? '')]?.NumberOfSecondStats) || 0);
        }
        const ascension = candidate.kind === 'pet' ? profile.misc.petAscensionLevel : profile.misc.mountAscensionLevel;
        if ((ascension || 0) > 0) return 2;
        return Math.max(0, Number(companionSecondaryUnlock?.[candidate.rarity]?.NumberOfSecondStats) || 0);
    };
    const applicableStatCount = result ? expectedStatCount(result) : 0;

    const statIds = useMemo(() => Object.keys(secondaryStatLibrary || {}), [secondaryStatLibrary]);
    const availableNames = useMemo(() => {
        if (!result) return [];
        if (result.kind === 'item') return Object.values(autoItemMapping || {}).map((item: any) => item.ItemName).filter(Boolean).sort();
        return [...new Set<string>(Object.values((result.kind === 'pet' ? spriteMapping?.pets : spriteMapping?.mounts)?.mapping || {}).map((item: any) => item.name).filter(Boolean))].sort();
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
        const selected = Array.from(files || []).slice(0, 100);
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
        if (spriteMappingLoading || autoItemMappingLoading || !spriteMapping || !autoItemMapping) {
            setError('Game names are still loading. Wait a moment, then scan again.');
            return;
        }
        setBusy(true);
        setError('');
        setProgress(0);
        setScanFailed(false);
        setCorrections([]);
        try {
            const ocr = await recognizeImportCardLocally(imageDataUrl, message => {
                setProgress(Math.round((message.progress || 0) * 100));
                setProgressLabel(message.status.replace(/_/g, ' '));
            });
            let parsed = parseOcr(ocr.text, ocr.confidence, spriteMapping, autoItemMapping, ocr.fields);
            if (recognitionFailed(parsed, expectedStatCount(parsed))) {
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
                    parsed = parseOcr(`${ocr.text}\n${trainedText}`, Math.max(ocr.confidence, ...readings.map(reading => reading.confidence)), spriteMapping, autoItemMapping, ocr.fields);
                    templates.forEach((template, index) => {
                        const reading = readings[index]?.text;
                        if (!reading) return;
                        const indexed = indexedStatField(template.field);
                        if (indexed?.[2] === 'name') {
                            const statIndex = Math.max(0, Number(indexed[1]) - 1);
                            const currentId = parsed.secondaryStats[statIndex]?.statId;
                            const incomingId = statIdFromText(reading);
                            const incomingIsGeneric = incomingId === 'DamageMulti' || incomingId === 'HealthMulti';
                            const currentIsSpecific = currentId && currentId !== 'DamageMulti' && currentId !== 'HealthMulti';
                            if (incomingIsGeneric && currentIsSpecific) return;
                        }
                        if (template.field === 'kind' || template.field === 'rarity') return;
                        if (template.field === 'name' && parsed.name) return;
                        if (template.field === 'level' && !parsed.notes?.includes('level')) return;
                        const statField = indexedStatField(template.field);
                        if (statField && Number(statField[1]) > expectedStatCount(parsed)) return;
                        parsed = applyCorrectionValue(parsed, template.field, reading);
                    });
                    parsed = canonicalizeRecognition(parsed, spriteMapping, autoItemMapping);
                }
            }
            parsed = {
                ...parsed,
                secondaryStats: parsed.secondaryStats
                    .filter(stat => stat.statId && Number.isFinite(stat.value) && stat.value > 0)
                    .slice(0, expectedStatCount(parsed)),
            };
            setResult(parsed);
            const failed = recognitionFailed(parsed, expectedStatCount(parsed));
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
    const updateStat = (index: number, patch: Partial<ImportStat>) => setResult(current => {
        if (!current) return current;
        const stats = [...current.secondaryStats];
        while (stats.length <= index) stats.push({ statId: statIds[0] || 'DamageMulti', value: 0 });
        stats[index] = { ...stats[index], ...patch };
        return { ...current, secondaryStats: stats };
    });

    const addCorrection = (correction: DraftCorrection) => {
        setCorrections(current => [...current, correction]);
        setResult(current => current ? applyCorrectionValue(current, correction.field, correction.correctedValue) : current);
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
        <header className="border-b border-border pb-6"><h1 className="flex items-center gap-3 text-3xl font-black text-text-primary"><Camera className="h-8 w-8 text-accent-primary" />Screenshot Import</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Select up to 100 equipment, pet, or mount screenshots at once. Free local OCR reads the type, bracketed rarity and name, level, and stat areas separately inside your browser—no AI, tokens, or per-image charge. Review each result; after import, the next image scans automatically.</p></header>
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
                    {preview ? <div className="relative w-full"><img src={preview} alt="Screenshot preview" className="max-h-[32rem] w-full object-contain" />{queue.length > 1 && <span className="absolute left-2 top-2 rounded-full bg-black/80 px-3 py-1 text-xs font-black text-white">{queueIndex + 1} of {queue.length} · {queue[queueIndex]?.name}</span>}</div> : <><Upload className="h-10 w-10 text-accent-primary" /><h2 className="mt-3 font-black text-text-primary">Drop screenshots here</h2><p className="mt-1 text-xs text-text-muted">or click to choose up to 100 PNG, JPG, or WEBP files · 10 MB each</p></>}
                </div>
                <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void chooseFiles(event.target.files || undefined)} />
                <button onClick={analyze} disabled={!imageDataUrl || busy || spriteMappingLoading || autoItemMappingLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-3 font-black text-white disabled:opacity-40">{busy || spriteMappingLoading || autoItemMappingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{busy ? `Reading image ${queue.length ? queueIndex + 1 : 1}${progress ? ` · ${progress}%` : '…'}` : spriteMappingLoading || autoItemMappingLoading ? 'Loading current game names…' : queue.length > 1 ? `Start batch of ${queue.length}` : 'Read screenshot locally'}</button>
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
                        <Field label="Name"><select value={result.name} onChange={e => {
                            const name = e.target.value;
                            if (!name) return update({ name: '' });
                            if (result.kind === 'item') {
                                const candidate = Object.values(autoItemMapping || {}).find((item: any) => item.ItemName === name) as any;
                                return update({ name, slot: slotFromType(candidate?.TypeName) || result.slot, age: candidate?.Age ?? result.age, idx: candidate?.Idx ?? result.idx });
                            }
                            const mapping = result.kind === 'pet' ? spriteMapping?.pets?.mapping : spriteMapping?.mounts?.mapping;
                            const candidates = Object.values(mapping || {}).filter((item: any) => item.name === name) as any[];
                            const candidate = candidates.find(item => item.rarity === result.rarity) || candidates[0];
                            update({ name, rarity: candidate?.rarity || result.rarity });
                        }} className={inputClass}><option value="">Choose a known {result.kind === 'item' ? 'item' : result.kind}</option>{availableNames.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
                        <Field label="Rarity"><select value={result.rarity} onChange={e => update({ rarity: e.target.value })} className={inputClass}>{['Common','Rare','Epic','Legendary','Ultimate','Mythic','Quantum'].map(value => <option key={value}>{value}</option>)}</select></Field>
                        <Field label="Level"><input type="number" min="1" value={result.level} onChange={e => update({ level: Math.max(1, Number(e.target.value)) })} className={inputClass} /></Field>
                        {result.kind === 'item' && <>
                            <Field label="Equipment slot"><select value={result.slot || ''} onChange={e => update({ slot: e.target.value as EquipmentSlot })} className={inputClass}><option value="">Choose slot</option>{['Weapon','Helmet','Body','Gloves','Belt','Necklace','Ring','Shoe'].map(slot => <option key={slot}>{slot}</option>)}</select></Field>
                            <Field label="Age"><select value={result.age ?? ''} onChange={e => update({ age: Number(e.target.value) })} className={inputClass}><option value="">Choose age</option>{AGES.map((age, index) => <option key={age} value={index}>{age}</option>)}</select></Field>
                        </>}
                    </div>
                    {!selectedMatch && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">That name is not in the current game config. Correct the name before importing.</div>}
                    {(result.damage !== undefined || result.health !== undefined) && <div className="grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-black/20 p-3"><span className="text-text-muted">Shown damage</span><strong className="block text-base text-text-primary">{result.damage ?? '—'}</strong></div><div className="rounded-lg bg-black/20 p-3"><span className="text-text-muted">Shown health</span><strong className="block text-base text-text-primary">{result.health ?? '—'}</strong></div></div>}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-black uppercase text-text-secondary">Secondary stats · {result.secondaryStats.length}/{applicableStatCount}</h3>{result.secondaryStats.length < applicableStatCount && <button onClick={() => update({ secondaryStats: [...result.secondaryStats, { statId: statIds[0] || 'DamageMulti', value: 0 }] })} className="flex items-center gap-1 text-xs font-bold text-accent-primary"><Plus className="h-3 w-3" />Add substat {result.secondaryStats.length + 1}</button>}</div>
                        {result.secondaryStats.map((stat, index) => <div key={`${index}-${stat.statId}`} className="rounded-lg border border-border/60 bg-black/10 p-2"><div className="mb-1 text-[10px] font-black uppercase text-text-muted">Substat {index + 1}</div><div className="grid grid-cols-[minmax(0,1fr)_6rem_2rem] gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_2rem]"><select aria-label={`Substat ${index + 1} name`} value={stat.statId} onChange={e => updateStat(index, { statId: e.target.value })} className={inputClass}>{statIds.map(id => <option key={id} value={id}>{getStatName(id)}</option>)}</select><input aria-label={`Substat ${index + 1} value`} type="number" step="0.01" value={stat.value} onChange={e => updateStat(index, { value: Number(e.target.value) })} className={inputClass} /><button aria-label={`Remove substat ${index + 1}`} onClick={() => update({ secondaryStats: result.secondaryStats.filter((_, i) => i !== index) })} className="rounded-lg text-red-300 hover:bg-red-500/10"><Trash2 className="mx-auto h-4 w-4" /></button></div></div>)}
                        {applicableStatCount > 0 && result.secondaryStats.length < applicableStatCount && <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-2 text-xs text-amber-200">This {result.kind} can have {applicableStatCount} substat{applicableStatCount === 1 ? '' : 's'}. Add or teach the missing field before importing if it appears in the screenshot.</p>}
                    </div>
                    {result.notes && <p className="rounded-lg bg-black/20 p-3 text-xs leading-5 text-text-muted">{result.notes}</p>}
                    {preview && <button type="button" onClick={() => { setScanFailed(true); window.setTimeout(() => document.getElementById('scan-corrections')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-2.5 text-sm font-bold text-amber-200 hover:bg-amber-400/10"><Crop className="h-4 w-4" />{scanFailed ? 'Correction fields are open below' : 'Partial scan? Fix or teach a field'}</button>}
                    <button onClick={save} disabled={!selectedMatch || duplicate || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-35">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : duplicate ? <CopyCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}{duplicate ? 'Duplicate — not imported' : result.kind === 'item' ? 'Add to saved equipment' : `Add to My ${result.kind === 'pet' ? 'Pets' : 'Mounts'}`}</button>
                </div>}
            </section>
        </div>
        {scanFailed && preview && result && (
            <RegionCorrectionPanel
                image={preview}
                corrections={corrections}
                maxStats={Math.max(1, applicableStatCount)}
                statIds={statIds}
                onAdd={addCorrection}
                onRemove={index => setCorrections(current => current.filter((_, correctionIndex) => correctionIndex !== index))}
            />
        )}
    </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="text-[10px] font-black uppercase text-text-muted">{label}<div className="mt-1">{children}</div></label>;
}

function RegionCorrectionPanel({ image, corrections, maxStats, statIds, onAdd, onRemove }: {
    image: string;
    corrections: DraftCorrection[];
    maxStats: number;
    statIds: string[];
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
        <section id="scan-corrections" className="scroll-mt-4 rounded-2xl border border-amber-400/30 bg-amber-950/10 p-4 space-y-5 sm:p-5">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-amber-400/10 p-2 text-amber-300"><ScanLine className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-black text-text-primary">Fix missing or incorrect fields</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">Choose a field—including each numbered substat name and value—drag a box around it, and enter the correct value. The current import updates immediately, and the normalized region is saved with your account for screenshots with the same layout.</p></div>
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
                        <Field label="What is inside the box?"><select value={field} onChange={event => { setField(event.target.value as ScannerTrainingField); setCorrectedValue(''); }} className={inputClass}>{[
                            ['kind','Type: item, pet, or mount'], ['name','Name'], ['rarity','Rarity'], ['level','Level'], ['slot','Equipment slot'], ['age','Age'],
                            ...Array.from({ length: maxStats }, (_, index) => [[`stat_${index + 1}_name`, `Substat ${index + 1} name`], [`stat_${index + 1}_value`, `Substat ${index + 1} value`]]).flat(),
                        ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                        <Field label="Correct value"><input list={field.endsWith('_name') ? 'scan-correction-stat-names' : undefined} inputMode={field.endsWith('_value') || field === 'level' || field === 'age' ? 'decimal' : 'text'} value={correctedValue} onChange={event => setCorrectedValue(event.target.value)} placeholder={field.endsWith('_name') ? 'Choose a stat name' : 'Type exactly what should be saved'} className={inputClass} /><datalist id="scan-correction-stat-names">{statIds.map(id => <option key={id} value={getStatName(id)} />)}</datalist></Field>
                        <button type="button" disabled={!region || region.width < 0.01 || region.height < 0.01 || !correctedValue.trim()} onClick={() => {
                            if (!region) return;
                            onAdd({ field, region, correctedValue: correctedValue.trim() });
                            setRegion(null);
                            setCorrectedValue('');
                        }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2.5 text-xs font-black text-amber-950 disabled:opacity-35"><Plus className="h-3.5 w-3.5" /> Save correction</button>
                    </div>
                    <div className="space-y-2">
                        {corrections.map((correction, index) => <div key={index} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-primary/30 p-2 text-xs"><div className="min-w-0"><div className="font-bold text-text-primary">{correction.field.replace('_', ' ')}</div><div className="truncate text-text-muted">{correction.correctedValue}</div></div><button type="button" onClick={() => onRemove(index)} className="rounded-md p-2 text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
                        {!corrections.length && <p className="rounded-lg border border-dashed border-border p-3 text-[11px] leading-5 text-text-muted">Drag on the image first. You can open this section after any scan, including a partially successful scan.</p>}
                    </div>
                </div>
            </div>
        </section>
    );
}
