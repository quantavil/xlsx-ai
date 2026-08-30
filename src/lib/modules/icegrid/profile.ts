import { z } from 'zod';

/**
 * The values that are constant for a shipment and appear in no shipping document.
 *
 * Across the 17-shipment reference corpus every one of these was populated in the
 * expected output and absent from every input file.
 *
 * These are the ones that genuinely never change between shipments. State and
 * district of origin, the invoice currency and its exchange rate used to live here
 * too and no longer do: they vary per consignment, so the import's confirmation
 * dialog asks for them against the shipment in hand rather than remembering a
 * default that is wrong as often as it is right.
 */
export const IcegridProfileSchema = z.object({
	endUse: z.string().max(200).nullable().default(null),
	rewardItem: z.string().max(200).nullable().default(null),
	igstPaymentStatus: z.string().max(200).nullable().default(null),
	applicableExpSchemes: z.string().max(200).nullable().default(null),
	ftaCode: z.string().max(200).nullable().default(null)
});

export type IcegridProfile = z.infer<typeof IcegridProfileSchema>;

export const EMPTY_PROFILE: IcegridProfile = Object.freeze({
	endUse: null,
	rewardItem: null,
	igstPaymentStatus: null,
	applicableExpSchemes: null,
	ftaCode: null
});

/** Which output header each profile field fills. */
export const PROFILE_FIELD_HEADERS = {
	endUse: 'EndUse',
	rewardItem: 'RewardItem',
	igstPaymentStatus: 'IGST_PaymentStatus',
	applicableExpSchemes: 'ApplicableExpSchemes',
	ftaCode: 'FTACode'
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
