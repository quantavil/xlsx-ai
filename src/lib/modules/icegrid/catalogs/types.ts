import type { DropdownOption } from '$lib/types';

export type IcegridCatalogId =
	| 'unit'
	| 'scheme'
	| 'endUse'
	| 'igstPaymentStatus'
	| 'rewardItem'
	| 'rodtep'
	| 'country'
	| 'fta'
	| 'state'
	| 'district';

/** Same shape the host table consumes, so a catalog drops straight into a column. */
export type IcegridCatalogOption = DropdownOption;

export interface CatalogProvenance {
	sourceUrl: string;
	retrievedAt: string;
	sha256: string;
	entryCount: number;
}

/**
 * One immutable set of catalogs captured at the start of an import, so a mid-run
 * settings change cannot alter how that run resolves values.
 */
export type IcegridCatalogSnapshot = Readonly<
	Record<IcegridCatalogId, readonly IcegridCatalogOption[]>
>;

export type CatalogResolution =
	| { status: 'resolved'; value: string; option: IcegridCatalogOption }
	| { status: 'unresolved'; raw: string; reason: 'unknown' | 'ambiguous' | 'wrong_parent' };
