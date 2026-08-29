import type { IcegridCatalogId, IcegridCatalogSnapshot } from './types';
import {
	UNIT_OPTIONS,
	SCHEME_OPTIONS,
	END_USE_OPTIONS,
	IGST_PAYMENT_STATUS_OPTIONS,
	REWARD_ITEM_OPTIONS,
	RODTEP_OPTIONS,
	COUNTRY_OPTIONS,
	FTA_OPTIONS,
	STATE_OPTIONS,
	DISTRICT_OPTIONS
} from './fixed';

export * from './types';
export * from './resolve';
export * from './fixed';

const BUILTIN: IcegridCatalogSnapshot = Object.freeze({
	unit: UNIT_OPTIONS,
	scheme: SCHEME_OPTIONS,
	endUse: END_USE_OPTIONS,
	igstPaymentStatus: IGST_PAYMENT_STATUS_OPTIONS,
	rewardItem: REWARD_ITEM_OPTIONS,
	rodtep: RODTEP_OPTIONS,
	country: COUNTRY_OPTIONS,
	fta: FTA_OPTIONS,
	state: STATE_OPTIONS,
	district: DISTRICT_OPTIONS
});

export const ICEGRID_CATALOG_IDS = Object.keys(BUILTIN) as IcegridCatalogId[];

/**
 * The catalogs one import run should use. Callers capture this once at the start of
 * a run and thread the same object through sanitization and mapping, so the run is
 * reproducible even if built-ins are swapped later.
 */
export function getCatalogSnapshot(): IcegridCatalogSnapshot {
	return BUILTIN;
}
