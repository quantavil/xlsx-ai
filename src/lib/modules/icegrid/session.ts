import type { TariffCandidate } from './tariff';
import type { IcegridRitcAnswer } from './confirm';
import type { IcegridRow } from './schema';
import { normalizeRitcCode } from './duty-lookup';

export interface IcegridUnclassifiedSessionItem {
	key: string;
	description: string;
	printed: string;
	rowCount: number;
	candidates: TariffCandidate[];
	terms: string[];
	note: string;
	materials?: string | null;
	netWeight?: number | null;
	assignedRitc?: string | null;
	values?: IcegridRitcAnswer | null;
}

export interface IcegridClassificationSession {
	items: IcegridUnclassifiedSessionItem[];
	updatedAt: number;
}

const STORAGE_PREFIX = 'xlsx-ai:icegrid-session:';
const sessionCache = new Map<string, IcegridClassificationSession>();
let latestSession: IcegridClassificationSession | null = null;

function normalizeTitle(raw?: string): string {
	return (raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

export function computeSessionKey(title?: string, rows?: readonly IcegridRow[]): string {
	const normTitle = normalizeTitle(title);
	if (!rows || rows.length === 0) return normTitle || 'default';
	const sample = rows
		.slice(0, 5)
		.map((r) => String(r.Description ?? '').trim().toLowerCase())
		.filter(Boolean)
		.join('|');
	return `${normTitle}::${rows.length}::${sample}`;
}

function safeSessionStorageSet(key: string, value: IcegridClassificationSession) {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
	} catch {
		// Ignore quota or security errors (e.g. private mode)
	}
}

function safeSessionStorageGet(key: string): IcegridClassificationSession | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed && Array.isArray(parsed.items)) {
			return parsed as IcegridClassificationSession;
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}

/**
 * Persists unclassified tariff session items in memory and sessionStorage.
 */
export function saveIcegridSession(
	title: string,
	items: IcegridUnclassifiedSessionItem[],
	rows?: readonly IcegridRow[]
): void {
	const session: IcegridClassificationSession = {
		items: items.map((it) => ({
			...it,
			candidates: [...it.candidates],
			terms: [...it.terms],
			assignedRitc: it.assignedRitc ? normalizeRitcCode(it.assignedRitc) : null,
			values: it.values ? { ...it.values } : null
		})),
		updatedAt: Date.now()
	};

	const normTitle = normalizeTitle(title);
	const fullKey = computeSessionKey(title, rows);

	sessionCache.set(fullKey, session);
	if (normTitle) {
		sessionCache.set(normTitle, session);
	}
	latestSession = session;

	safeSessionStorageSet(fullKey, session);
	if (normTitle) {
		safeSessionStorageSet(normTitle, session);
	}
	safeSessionStorageSet('latest', session);
}

/**
 * Retrieves the saved unclassified tariff session for a given table or rows.
 */
export function getIcegridSession(
	title?: string,
	rows?: readonly IcegridRow[]
): IcegridClassificationSession | null {
	const fullKey = computeSessionKey(title, rows);
	const normTitle = normalizeTitle(title);

	// 1. Exact composite key
	if (sessionCache.has(fullKey)) {
		return sessionCache.get(fullKey)!;
	}
	const storedFull = safeSessionStorageGet(fullKey);
	if (storedFull) {
		sessionCache.set(fullKey, storedFull);
		return storedFull;
	}

	// 2. Title key
	if (normTitle && sessionCache.has(normTitle)) {
		return sessionCache.get(normTitle)!;
	}
	if (normTitle) {
		const storedTitle = safeSessionStorageGet(normTitle);
		if (storedTitle) {
			sessionCache.set(normTitle, storedTitle);
			return storedTitle;
		}
	}

	// 3. Match against rows if unclassified keys or descriptions overlap
	if (rows && rows.length > 0) {
		const rowUnclassifiedKeys = new Set(
			rows.map((r) => r._unclassifiedKey).filter((k): k is string => Boolean(k))
		);
		const rowDescriptions = new Set(
			rows.map((r) => String(r.Description ?? '').trim().toLowerCase()).filter(Boolean)
		);

		for (const session of sessionCache.values()) {
			const hasKeyOverlap = session.items.some((it) => rowUnclassifiedKeys.has(it.key));
			const hasDescOverlap = session.items.some((it) =>
				rowDescriptions.has(it.description.trim().toLowerCase())
			);
			if (hasKeyOverlap || hasDescOverlap) {
				return session;
			}
		}
	}

	// 4. Latest session fallback
	if (latestSession) {
		return latestSession;
	}
	const storedLatest = safeSessionStorageGet('latest');
	if (storedLatest) {
		latestSession = storedLatest;
		return storedLatest;
	}

	return null;
}

/**
 * Clears all cached sessions (used for testing or explicit resets).
 */
export function clearIcegridSessions(): void {
	sessionCache.clear();
	latestSession = null;
	if (typeof sessionStorage !== 'undefined') {
		try {
			for (let i = sessionStorage.length - 1; i >= 0; i--) {
				const key = sessionStorage.key(i);
				if (key && key.startsWith(STORAGE_PREFIX)) {
					sessionStorage.removeItem(key);
				}
			}
		} catch {
			// Ignore
		}
	}
}
