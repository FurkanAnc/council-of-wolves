/**
 * Display helpers for council members (handles old model-only records too).
 */

export function shortModel(model) {
  if (!model) return '';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.split('/').pop();
}

export function memberLabel(item) {
  if (!item) return '';
  // New format: "Şüpheci · Opus"; old format: model name only
  if (item.member_name) return `${item.member_name} · ${shortModel(item.model)}`;
  return item.model?.split('/')[1] || item.model || '';
}

/** Member name alone (names are unique); falls back to the model for old records. */
export function memberName(item) {
  if (!item) return '';
  return item.member_name || memberLabel(item);
}

/**
 * Normalize a label mapping entry: new records map to member objects,
 * old records (label_to_model) map to a plain model string.
 */
export function labelInfo(mapping, label) {
  const value = mapping?.[label];
  if (!value) return null;
  return typeof value === 'string' ? { model: value } : value;
}

// Palette slot per member id; the saved council overrides these defaults.
// A member keeps its slot when others are added or removed (color follows the member).
const DEFAULT_SLOTS = { expert: 1, skeptic: 2, pragmatist: 3, contrarian: 4 };
let councilSlots = {};

/** Called whenever the council is (re)loaded. */
export function setCouncilColors(members) {
  councilSlots = Object.fromEntries((members || []).map((m) => [m.id, m.color]));
}

export function colorVar(slot) {
  return slot ? `var(--c-${slot})` : 'var(--text-3)';
}

/** Identity color of a member; unknown members get a neutral color. */
export function memberColor(memberId) {
  if (memberId === 'chairman') return 'var(--m-chairman)';
  return colorVar(councilSlots[memberId] || DEFAULT_SLOTS[memberId]);
}

/** First letter of the member (or model) name, for avatars. */
export function memberInitial(item) {
  const name = item?.member_name || item?.name || shortModel(item?.model) || '?';
  return name.trim().charAt(0).toLocaleUpperCase('tr');
}
