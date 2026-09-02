import type { ItemSlot, UserProfile } from '../types/Profile';

export type EquipmentSlot = keyof UserProfile['items'];
export type AutoItemRecord = {
    Age: number;
    Idx: number;
    ItemName: string;
    TypeName: string;
};

export type ScannedEquipmentItem = {
    name: string;
    slot: EquipmentSlot;
    item: ItemSlot & { customName?: string };
    textPosition: number;
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const equipmentSlotFromType = (type?: string): EquipmentSlot | undefined => ({
    Weapon: 'Weapon', Helmet: 'Helmet', Armour: 'Body', Body: 'Body', Gloves: 'Gloves', Belt: 'Belt',
    Necklace: 'Necklace', Ring: 'Ring', Shoes: 'Shoe', Shoe: 'Shoe',
} as Record<string, EquipmentSlot>)[type || ''];

const statAliases: Array<[string, string]> = [
    ['skill cooldown', 'SkillCooldownMulti'], ['skill damage', 'SkillDamageMulti'],
    ['critical damage', 'CriticalMulti'], ['critical chance', 'CriticalChance'],
    ['double damage chance', 'DoubleDamageChance'], ['double chance', 'DoubleDamageChance'],
    ['ranged damage', 'RangedDamageMulti'], ['melee damage', 'MeleeDamageMulti'],
    ['attack speed', 'AttackSpeed'], ['health regen', 'HealthRegen'],
    ['lifesteal', 'LifeSteal'], ['life steal', 'LifeSteal'], ['block chance', 'BlockChance'],
    ['health', 'HealthMulti'], ['damage', 'DamageMulti'],
];

const nearestIndex = (items: Array<{ textPosition: number }>, position: number) => {
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
        const nextDistance = Math.abs(item.textPosition - position);
        if (nextDistance < distance) { distance = nextDistance; best = index; }
    });
    return best;
};

/**
 * Matches OCR text against the current config's exact item names. Item name decides
 * slot/age/index; nearby level, rarity, and secondary-stat text fills the editable copy.
 */
export function scanKnownEquipmentItems(text: string, autoItemMapping: Record<string, AutoItemRecord> | undefined) {
    const records = Object.values(autoItemMapping || {})
        .filter(record => record?.ItemName && equipmentSlotFromType(record.TypeName))
        .sort((a, b) => normalize(b.ItemName).length - normalize(a.ItemName).length);
    const lines = text.split(/\r?\n/);
    const occurrences: Array<{ record: AutoItemRecord; textPosition: number }> = [];
    let offset = 0;

    for (const line of lines) {
        const normalizedLine = normalize(line);
        const consumed: string[] = [];
        for (const record of records) {
            const needle = normalize(record.ItemName);
            if (needle.length < 3 || !normalizedLine.includes(needle) || consumed.some(value => value.includes(needle))) continue;
            let from = 0;
            while (from < normalizedLine.length) {
                const found = normalizedLine.indexOf(needle, from);
                if (found < 0) break;
                occurrences.push({ record, textPosition: offset + found });
                from = found + needle.length;
            }
            consumed.push(needle);
        }
        offset += line.length + 1;
    }

    const found: ScannedEquipmentItem[] = occurrences
        .sort((a, b) => a.textPosition - b.textPosition)
        .map(({ record, textPosition }) => ({
            name: record.ItemName,
            slot: equipmentSlotFromType(record.TypeName)!,
            textPosition,
            item: {
                age: Number(record.Age) || 0,
                idx: Number(record.Idx) || 0,
                level: 1,
                rarity: 'Common',
                secondaryStats: [],
                customName: record.ItemName,
            },
        }));

    if (!found.length) return [];

    for (const match of text.matchAll(/\b(?:lv|level)\.?\s*:?\s*(\d{1,3})\b/gi)) {
        found[nearestIndex(found, match.index || 0)].item.level = Math.max(1, Number(match[1]) || 1);
    }
    for (const match of text.matchAll(/\b(Common|Rare|Epic|Legendary|Ultimate|Mythic|Quantum)\b/gi)) {
        const value = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
        found[nearestIndex(found, match.index || 0)].item.rarity = value;
    }

    offset = 0;
    for (const line of lines) {
        const valueMatch = line.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
        if (valueMatch) {
            const clean = line.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
            const alias = statAliases.find(([label]) => clean.includes(label));
            if (alias) {
                const owner = found[nearestIndex(found, offset + (valueMatch.index || 0))];
                const value = Number(valueMatch[1].replace(',', '.'));
                if (!owner.item.secondaryStats.some(stat => stat.statId === alias[1] && stat.value === value)) {
                    owner.item.secondaryStats.push({ statId: alias[1], value });
                }
            }
        }
        offset += line.length + 1;
    }

    return found;
}
