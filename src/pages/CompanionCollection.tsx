import { useMemo, useState, type ReactNode } from 'react';
import { Cat, Check, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { PetSelectorModal } from '../components/Profile/PetSelectorModal';
import { MountSelectorModal } from '../components/Profile/MountSelectorModal';
import { SpriteSheetIcon } from '../components/UI/SpriteSheetIcon';
import { getAscensionTexturePath } from '../utils/ascensionUtils';
import { getStatName } from '../utils/statNames';
import { getPerfection, getStatPerfection } from '../utils/itemCalculations';
import { PerfectionMeter } from '../components/UI/PerfectionMeter';
import type { MountSlot, PetSlot } from '../types/Profile';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
type CollectionSort = 'level' | 'perfection' | 'stat';

export function PetCollection() {
    const { profile, updateNestedProfile } = useProfile();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    const save = (pet: PetSlot | null) => {
        if (!pet) return;
        const builds = [...profile.pets.savedBuilds];
        const saved = { ...pet, instanceId: pet.instanceId || makeId() };
        if (editingIndex === null) builds.push(saved);
        else builds[editingIndex] = saved;
        updateNestedProfile('pets', { savedBuilds: builds });
        setEditingIndex(null);
        setModalOpen(false);
    };

    return <CollectionPage
        kind="pet"
        title="My Pets"
        description="Keep every pet roll in one account-saved collection. Your optimizer uses these saved pets when it searches for the best loadout."
        entries={profile.pets.savedBuilds}
        activeKeys={new Set(profile.pets.active.map(p => p.instanceId || `${p.rarity}-${p.id}-${p.level}`))}
        onAdd={() => { setEditingIndex(null); setModalOpen(true); }}
        onEdit={index => { setEditingIndex(index); setModalOpen(true); }}
        onDelete={index => updateNestedProfile('pets', { savedBuilds: profile.pets.savedBuilds.filter((_, i) => i !== index) })}
        onEquip={index => {
            const selected = profile.pets.savedBuilds[index];
            const selectedKey = selected.instanceId || `${selected.rarity}-${selected.id}-${selected.level}`;
            const without = profile.pets.active.filter(p => (p.instanceId || `${p.rarity}-${p.id}-${p.level}`) !== selectedKey);
            updateNestedProfile('pets', { active: [...without, selected].slice(-3) });
        }}
    >
        <PetSelectorModal
            isOpen={modalOpen}
            onClose={() => { setModalOpen(false); setEditingIndex(null); }}
            onSelect={save}
            currentPet={editingIndex === null ? undefined : profile.pets.savedBuilds[editingIndex]}
            petAscensionLevel={profile.misc.petAscensionLevel}
        />
    </CollectionPage>;
}

export function MountCollection() {
    const { profile, updateNestedProfile } = useProfile();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    const save = (rarity: string | null, id = 0, level = 1, secondaryStats: { statId: string; value: number }[] = []) => {
        if (!rarity) return;
        const current = editingIndex === null ? null : profile.mount.savedBuilds[editingIndex];
        const mount: MountSlot = {
            id, rarity, level, secondaryStats,
            instanceId: current?.instanceId || makeId(),
            evolution: current?.evolution || 0,
            skills: current?.skills || [],
            customName: current?.customName,
        };
        const builds = [...profile.mount.savedBuilds];
        if (editingIndex === null) builds.push(mount);
        else builds[editingIndex] = mount;
        updateNestedProfile('mount', { savedBuilds: builds });
        setEditingIndex(null);
        setModalOpen(false);
    };

    const active = profile.mount.active;
    return <CollectionPage
        kind="mount"
        title="My Mounts"
        description="Store all of your mount rolls here. They save with your account and are available to the loadout optimizer."
        entries={profile.mount.savedBuilds}
        activeKeys={new Set(active ? [active.instanceId || `${active.rarity}-${active.id}-${active.level}`] : [])}
        onAdd={() => { setEditingIndex(null); setModalOpen(true); }}
        onEdit={index => { setEditingIndex(index); setModalOpen(true); }}
        onDelete={index => updateNestedProfile('mount', { savedBuilds: profile.mount.savedBuilds.filter((_, i) => i !== index) })}
        onEquip={index => updateNestedProfile('mount', { active: profile.mount.savedBuilds[index] })}
    >
        <MountSelectorModal
            isOpen={modalOpen}
            onClose={() => { setModalOpen(false); setEditingIndex(null); }}
            onSelect={save}
            currentMount={editingIndex === null ? null : profile.mount.savedBuilds[editingIndex]}
            mountAscensionLevel={profile.misc.mountAscensionLevel}
        />
    </CollectionPage>;
}

function CollectionPage({ kind, title, description, entries, activeKeys, onAdd, onEdit, onDelete, onEquip, children }: {
    kind: 'pet' | 'mount'; title: string; description: string; entries: (PetSlot | MountSlot)[]; activeKeys: Set<string>;
    onAdd: () => void; onEdit: (index: number) => void; onDelete: (index: number) => void; onEquip: (index: number) => void; children: ReactNode;
}) {
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<CollectionSort>('perfection');
    const [sortDescending, setSortDescending] = useState(true);
    const [sortStat, setSortStat] = useState('');
    const [filterStat, setFilterStat] = useState('');
    const [minimumLevel, setMinimumLevel] = useState(0);
    const [maximumLevel, setMaximumLevel] = useState(0);
    const { selectedVersion } = useGameDataContext();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const mapping = kind === 'pet' ? spriteMapping?.pets : spriteMapping?.mounts;
    const statOptions = useMemo(() => {
        const ids = new Set<string>(Object.keys(secondaryStatLibrary || {}));
        entries.forEach(entry => entry.secondaryStats?.forEach(stat => ids.add(stat.statId)));
        return Array.from(ids).sort((a, b) => getStatName(a).localeCompare(getStatName(b)));
    }, [entries, secondaryStatLibrary]);
    const selectedSortStat = sortStat || statOptions[0] || '';
    const statValue = (entry: PetSlot | MountSlot, statId: string) => entry.secondaryStats?.find(stat => stat.statId === statId)?.value ?? -1;
    const visible = useMemo(() => entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
        const info = Object.values(mapping?.mapping || {}).find((value: any) => value.id === entry.id && value.rarity === entry.rarity) as any;
        const matchesSearch = `${entry.customName || ''} ${info?.name || ''} ${entry.rarity}`.toLowerCase().includes(search.toLowerCase());
        return matchesSearch && entry.level >= minimumLevel && (!maximumLevel || entry.level <= maximumLevel) && (!filterStat || statValue(entry, filterStat) >= 0);
    }).sort((a, b) => {
        const aValue = sortBy === 'level' ? a.entry.level : sortBy === 'stat' ? statValue(a.entry, selectedSortStat) : (getPerfection(a.entry as any, secondaryStatLibrary) ?? -1);
        const bValue = sortBy === 'level' ? b.entry.level : sortBy === 'stat' ? statValue(b.entry, selectedSortStat) : (getPerfection(b.entry as any, secondaryStatLibrary) ?? -1);
        return (aValue - bValue) * (sortDescending ? -1 : 1);
    }), [entries, mapping, search, minimumLevel, maximumLevel, filterStat, sortBy, selectedSortStat, sortDescending, secondaryStatLibrary]);

    const mergeMaterialIndexes = useMemo(() => {
        const groups = new Map<string, number[]>();
        entries.forEach((entry, index) => {
            const duplicateKey = `${entry.rarity}|${entry.id}`;
            groups.set(duplicateKey, [...(groups.get(duplicateKey) || []), index]);
        });
        const marked = new Set<number>();
        groups.forEach(indices => {
            if (indices.length < 2) return;
            const inactive = indices.filter(index => {
                const entry = entries[index];
                const key = entry.instanceId || `${entry.rarity}-${entry.id}-${entry.level}`;
                return !activeKeys.has(key);
            });
            const activeCount = indices.length - inactive.length;
            const keepInactive = activeCount === 0 ? 1 : 0;
            inactive.sort((a, b) => {
                const perfectionGap = (getPerfection(entries[b] as any, secondaryStatLibrary) ?? -1) - (getPerfection(entries[a] as any, secondaryStatLibrary) ?? -1);
                return perfectionGap || entries[b].level - entries[a].level || (entries[b].evolution || 0) - (entries[a].evolution || 0);
            });
            inactive.slice(keepInactive).forEach(index => marked.add(index));
        });
        return marked;
    }, [entries, activeKeys, secondaryStatLibrary]);

    const Icon = kind === 'pet' ? Cat : Star;
    return <div className="mx-auto max-w-6xl space-y-6 pb-20">
        <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div><h1 className="flex items-center gap-3 text-3xl font-black text-text-primary"><Icon className="h-8 w-8 text-amber-400" />{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{description}</p></div>
            <button type="button" onClick={onAdd} className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 font-bold text-white shadow-lg hover:brightness-110"><Plus className="h-4 w-4" /> Add {kind}</button>
        </header>
        <div className="grid gap-3 rounded-xl border border-border bg-bg-card/60 p-3 sm:grid-cols-2 lg:grid-cols-6">
            <span className="text-sm font-bold text-text-secondary">{entries.length} saved {entries.length === 1 ? kind : `${kind}s`}</span>
            <label className="relative lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${kind}s`} className="w-full rounded-lg border border-border bg-bg-input py-2 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-accent-primary" /></label>
            <select aria-label="Sort companions" value={sortBy} onChange={e => setSortBy(e.target.value as CollectionSort)} className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary"><option value="perfection">Sort: Perfection</option><option value="level">Sort: Level</option><option value="stat">Sort: Stat value</option></select>
            <button type="button" onClick={() => setSortDescending(value => !value)} className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm font-bold text-text-secondary hover:text-text-primary">{sortDescending ? 'Highest first' : 'Lowest first'}</button>
            <input aria-label="Minimum companion level" type="number" min="0" value={minimumLevel || ''} onChange={e => setMinimumLevel(Math.max(0, Number(e.target.value) || 0))} placeholder="Minimum level" className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary" />
            <input aria-label="Maximum companion level" type="number" min="0" value={maximumLevel || ''} onChange={e => setMaximumLevel(Math.max(0, Number(e.target.value) || 0))} placeholder="Maximum level" className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary" />
            {sortBy === 'stat' && <select aria-label="Stat to sort by" value={selectedSortStat} onChange={e => setSortStat(e.target.value)} className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary"><option value="" disabled>Sort stat</option>{statOptions.map(stat => <option key={stat} value={stat}>{getStatName(stat)}</option>)}</select>}
            <select aria-label="Filter companions by stat" value={filterStat} onChange={e => setFilterStat(e.target.value)} className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary"><option value="">All stats</option>{statOptions.map(stat => <option key={stat} value={stat}>Has {getStatName(stat)}</option>)}</select>
        </div>
        {visible.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-bg-card/40 px-6 py-16 text-center"><Icon className="mx-auto h-10 w-10 text-text-muted" /><h2 className="mt-4 font-black text-text-primary">{entries.length ? 'No matches' : `No ${kind}s saved yet`}</h2><p className="mt-2 text-sm text-text-muted">Use “Add {kind}” to record its level and secondary-stat rolls.</p></div> :
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(({ entry, index }) => {
                const infoEntry = Object.entries(mapping?.mapping || {}).find(([, value]: [string, any]) => value.id === entry.id && value.rarity === entry.rarity);
                const spriteIndex = infoEntry ? Number(infoEntry[0]) : -1;
                const info = infoEntry?.[1] as any;
                const key = entry.instanceId || `${entry.rarity}-${entry.id}-${entry.level}`;
                const active = activeKeys.has(key);
                const perfection = getPerfection(entry as any, secondaryStatLibrary);
                const mergeMaterial = mergeMaterialIndexes.has(index);
                return <article key={`${key}-${index}`} className={`rounded-2xl border p-4 ${active ? 'border-emerald-500/60 bg-emerald-950/15' : mergeMaterial ? 'border-red-500/70 bg-red-950/15' : 'border-border bg-bg-card/70'}`}>
                    <div className="flex gap-4">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/20">{mapping && spriteIndex >= 0 ? <SpriteSheetIcon textureSrc={getAscensionTexturePath(kind === 'pet' ? 'Pets' : 'MountIcons', entry.ascensionLevel || 0, selectedVersion)} spriteWidth={mapping.sprite_size.width} spriteHeight={mapping.sprite_size.height} sheetWidth={mapping.texture_size.width} sheetHeight={mapping.texture_size.height} iconIndex={spriteIndex} className="h-16 w-16" /> : <Icon className="h-8 w-8 text-text-muted" />}</div>
                        <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h2 className="truncate font-black text-text-primary">{entry.customName || info?.name || `${entry.rarity} ${kind}`}</h2><p className="text-xs font-bold text-amber-300">{entry.rarity} · Level {entry.level}</p></div><div className="flex flex-col items-end gap-1">{active && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-black uppercase text-emerald-300"><Check className="h-3 w-3" /> Active</span>}{mergeMaterial && <span className="rounded-full bg-red-500/15 px-2 py-1 text-[10px] font-black uppercase text-red-300">Merge Material</span>}</div></div>
                            <div className="mt-3 space-y-1">{entry.secondaryStats?.length ? entry.secondaryStats.map(stat => {
                                const statPerfection = getStatPerfection(stat.statId, stat.value, secondaryStatLibrary);
                                return <div key={stat.statId} className="flex justify-between gap-2 text-xs"><span className="truncate text-text-muted">{getStatName(stat.statId)}</span><span className="flex shrink-0 items-center gap-2 font-mono font-bold text-text-primary"><span>{stat.value.toFixed(2)}%</span>{statPerfection !== null && <span className="text-[10px] text-text-muted">({statPerfection.toFixed(1)}%)</span>}</span></div>;
                            }) : <p className="text-xs text-text-muted">No secondary stats recorded</p>}</div>
                        </div>
                    </div>
                    <div className="mt-4 rounded-lg border border-border/60 bg-bg-input/20 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-text-muted"><span>Perfection</span><span>{entry.secondaryStats?.length || 0} rolled stats</span></div>
                        <PerfectionMeter value={perfection} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2"><Action onClick={() => onEquip(index)} disabled={active} icon={<Check className="h-3.5 w-3.5" />}>{active ? 'Active' : 'Equip'}</Action><Action onClick={() => onEdit(index)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Action><Action onClick={() => onDelete(index)} icon={<Trash2 className="h-3.5 w-3.5" />} danger>Delete</Action></div>
                </article>;
            })}</div>}
        {children}
    </div>;
}

function Action({ onClick, disabled, icon, danger, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; danger?: boolean; children: ReactNode }) {
    return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold disabled:cursor-default disabled:opacity-50 ${danger ? 'border-red-500/20 text-red-300 hover:bg-red-500/10' : 'border-border text-text-secondary hover:border-accent-primary/50 hover:text-text-primary'}`}>{icon}{children}</button>;
}
