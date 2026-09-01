import type { WorkspaceModule, ModuleContext, ModuleResult } from '../types';
import IcegridSettings from './IcegridSettings.svelte';

export { ICEGRID_COLUMNS, ICEGRID_HEADERS, buildIcegridTableColumns } from './columns';
export {
	IcegridRowSchema,
	IcegridReportSchema,
	IcegridAiReportSchema,
	IcegridEvidenceSpanSchema,
	type IcegridRow,
	type IcegridReport,
	type IcegridAiReport,
	type IcegridEvidenceSpan
} from './schema';
export {
	loadProfile,
	saveProfile,
	parseProfile,
	EMPTY_PROFILE,
	IcegridProfileSchema,
	LS_ICEGRID_PROFILE_KEY,
	type IcegridProfile
} from './profile';
export { SCHEDULES_PROVENANCE } from './catalogs/generated/provenance';

/** Keep the first few warnings readable instead of dumping hundreds into a toast. */
export function summarizeWarnings(warnings: string[], limit = 3): string[] {
	if (warnings.length <= limit) return warnings;
	return [...warnings.slice(0, limit), `...and ${warnings.length - limit} more review notes.`];
}

export const icegridModule: WorkspaceModule = {
	id: 'icegrid',
	name: 'ICEGrid Importer',
	description:
		'Extract and map commercial invoice and packing list documents into the standardized 37-column ICEGATE format.',
	version: '1.1.0',
	defaultEnabled: true,
	requirements: {
		ai: true
	},
	ribbon: {
		label: 'ICEGrid Documents',
		icon: 'layers',
		fileInput: {
			accept: '.pdf,.xls,.xlsx',
			multiple: true
		}
	},
	settings: {
		label: 'Shipment defaults',
		component: IcegridSettings
	},
	async run(files: File[], context: ModuleContext): Promise<ModuleResult> {
		const { runIcegridPipeline } = await import('./pipeline');
		return runIcegridPipeline(files, context);
	}
};
