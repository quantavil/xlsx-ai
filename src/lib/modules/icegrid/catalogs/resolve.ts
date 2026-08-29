import type { CatalogResolution, IcegridCatalogOption } from './types';

/** Trim and collapse internal whitespace. Nothing else — no stemming, no synonyms. */
export function normalizeCatalogText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

const fold = (value: string) => normalizeCatalogText(value).toLowerCase();

/** ICEGATE writes a state as `08` but a district's parent as `8`; both mean state 8. */
export function normalizeStateKey(value: string | undefined | null): string {
	const trimmed = normalizeCatalogText(String(value ?? ''));
	if (!trimmed) return '';
	return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed.toLowerCase();
}

/** `08 — RAJASTHAN`, the exact string the dropdown shows. */
export function displayString(option: IcegridCatalogOption): string {
	return option.label ? `${option.value} — ${option.label}` : option.value;
}

export interface ResolveOptions {
	/** For a dependent catalog: the row's parent value, e.g. the state behind a district. */
	parentValue?: string | null;
	/**
	 * Export schemes only. Lets a bare `19` reach the complete `19-Drawback (DBK)`,
	 * but only when exactly one canonical entry carries that numeric prefix.
	 */
	allowNumericPrefix?: boolean;
}

/**
 * Exact-only catalog resolution.
 *
 * Matching is limited to whitespace/case normalization over four exact forms: the
 * stored value, the complete `value — label` display string, a unique label, and
 * (schemes only) an unambiguous numeric prefix. There is deliberately no substring,
 * edit-distance, prefix-guessing or nearest-option fallback — an unrecognized value
 * comes back `unresolved` and the caller blanks the cell with a warning rather than
 * writing a plausible guess into a customs declaration.
 */
export function resolveCatalogValue(
	raw: string | number | null | undefined,
	options: readonly IcegridCatalogOption[],
	resolveOptions: ResolveOptions = {}
): CatalogResolution {
	const rawText = normalizeCatalogText(String(raw ?? ''));
	if (!rawText) return { status: 'unresolved', raw: '', reason: 'unknown' };

	const { parentValue, allowNumericPrefix = false } = resolveOptions;
	const needle = fold(rawText);

	// A dependent catalog only ever considers options under the given parent, so a
	// district can never resolve against the wrong state.
	const parentKey = normalizeStateKey(parentValue);
	const scoped = options.filter((opt) =>
		opt.parentValue === undefined ? true : normalizeStateKey(opt.parentValue) === parentKey
	);

	if (scoped.length === 0 && options.length > 0) {
		return { status: 'unresolved', raw: rawText, reason: 'wrong_parent' };
	}

	const finish = (matches: IcegridCatalogOption[]): CatalogResolution | null => {
		if (matches.length === 0) return null;
		// Distinct stored values that tie means genuinely ambiguous input.
		const distinct = new Set(matches.map((m) => m.value));
		if (distinct.size > 1) return { status: 'unresolved', raw: rawText, reason: 'ambiguous' };
		return { status: 'resolved', value: matches[0].value, option: matches[0] };
	};

	// 1. exact stored value
	const byValue = finish(scoped.filter((o) => fold(o.value) === needle));
	if (byValue) return byValue;

	// 2. exact complete display string, e.g. "08 — RAJASTHAN"
	const byDisplay = finish(scoped.filter((o) => fold(displayString(o)) === needle));
	if (byDisplay) return byDisplay;

	// 3. exact unique label, e.g. "RAJASTHAN"
	const byLabel = finish(scoped.filter((o) => o.label !== undefined && fold(o.label) === needle));
	if (byLabel) return byLabel;

	// 4. schemes only: unambiguous numeric prefix, e.g. "19" -> "19-Drawback (DBK)"
	if (allowNumericPrefix && /^\d+$/.test(rawText)) {
		const code = String(Number(rawText));
		const byPrefix = scoped.filter((o) => {
			const m = o.value.match(/^(\d+)\s*-/);
			return m !== null && String(Number(m[1])) === code;
		});
		// Codes 36 and 56 map to two canonical entries each; both stay unresolved.
		const resolved = finish(byPrefix);
		if (resolved) return resolved;
		if (byPrefix.length > 1) return { status: 'unresolved', raw: rawText, reason: 'ambiguous' };
	}

	// A value that exists only under a different parent is a parent error, not an
	// unknown value — the warning should say so.
	if (parentValue !== undefined && options.some((o) => fold(o.value) === needle)) {
		return { status: 'unresolved', raw: rawText, reason: 'wrong_parent' };
	}

	return { status: 'unresolved', raw: rawText, reason: 'unknown' };
}
