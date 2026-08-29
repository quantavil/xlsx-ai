export interface SchedulesProvenance {
	readonly drawback: { readonly notification: string; readonly effectiveFrom: string; readonly sourceUrl: string; readonly sha256: string; readonly entryCount: number };
	readonly rodtep: { readonly notification: string; readonly effectiveFrom: string; readonly sourceUrl: string; readonly sha256: string; readonly entryCount: number };
}

export const SCHEDULES_PROVENANCE: SchedulesProvenance = Object.freeze({
	drawback: Object.freeze({
		notification: 'No. 77/2023-Customs (N.T.) dated 20.10.2023',
		effectiveFrom: '2023-10-30',
		sourceUrl: 'https://www.aepcindia.com/system/files/Duty%20Drawback%20Rates%202023.pdf',
		sha256: '8cd700ce6f961b03cb0680adee3f2c77e5fb2f6b4229ba3007457fd5f70c64c0',
		entryCount: 2209
	}),
	rodtep: Object.freeze({
		notification: 'Appendix 4R, Notification No. 32 dated 30.09.2024',
		effectiveFrom: '2024-10-10',
		sourceUrl: 'https://content.dgft.gov.in/Website/Appendix+4R+wef+10th+October+2024.pdf',
		sha256: 'fc9c27c9e354b014e192794e66eb914bbf4abd68f01fdf626129176aa1a35827',
		entryCount: 8563
	})
});
