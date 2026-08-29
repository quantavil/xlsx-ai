import { z } from 'zod';

/**
 * The values that are constant for a shipment and appear in no shipping document.
 *
 * Across the 17-shipment reference corpus every one of these was populated in the
 * expected output and absent from every input file. `EndUse` is the clearest case:
 * it is a statement about what the buyer does with the goods, so two shipments of
 * the same motor-vehicle parts legitimately carry different codes. Asking once is
 * the only honest way to fill them.
 */
export const IcegridProfileSchema = z.object({
	endUse: z.string().max(200).nullable().default(null),
	rewardItem: z.string().max(200).nullable().default(null),
	igstPaymentStatus: z.string().max(200).nullable().default(null),
	applicableExpSchemes: z.string().max(200).nullable().default(null),
	ftaCode: z.string().max(200).nullable().default(null),
	stateOrigin: z.string().max(200).nullable().default(null),
	districtOrigin: z.string().max(200).nullable().default(null),
	/**
	 * Customs exchange rate for the invoice currency. Printed on the invoice in only
	 * 2 of 17 corpus shipments, so it is offered here as a fallback. Taxable_Value is
	 * left blank when neither source supplies it.
	 */
	exchangeRate: z.number().positive().max(10_000).nullable().default(null)
});

export type IcegridProfile = z.infer<typeof IcegridProfileSchema>;

export const EMPTY_PROFILE: IcegridProfile = Object.freeze({
	endUse: null,
	rewardItem: null,
	igstPaymentStatus: null,
	applicableExpSchemes: null,
	ftaCode: null,
	stateOrigin: null,
	districtOrigin: null,
	exchangeRate: null
});

/** Which output header each profile field fills. */
export const PROFILE_FIELD_HEADERS = {
	endUse: 'EndUse',
	rewardItem: 'RewardItem',
	igstPaymentStatus: 'IGST_PaymentStatus',
	applicableExpSchemes: 'ApplicableExpSchemes',
	ftaCode: 'FTACode',
	stateOrigin: 'StateOrigin',
	districtOrigin: 'DistrictOrigin'
} as const;

export const LS_ICEGRID_PROFILE_KEY = 'xlsx-ai:module:icegrid:profile:v1';

export function parseProfile(raw: unknown): IcegridProfile {
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw);
		} catch {
			return { ...EMPTY_PROFILE };
		}
	}
	const parsed = IcegridProfileSchema.safeParse(raw);
	return parsed.success ? parsed.data : { ...EMPTY_PROFILE };
}

export function loadProfile(): IcegridProfile {
	if (typeof localStorage === 'undefined') return { ...EMPTY_PROFILE };
	try {
		return parseProfile(localStorage.getItem(LS_ICEGRID_PROFILE_KEY));
	} catch {
		return { ...EMPTY_PROFILE };
	}
}

export function saveProfile(profile: IcegridProfile): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(LS_ICEGRID_PROFILE_KEY, JSON.stringify(profile));
	} catch {
		/* storage unavailable or full; the profile is a convenience, not a requirement */
	}
}
