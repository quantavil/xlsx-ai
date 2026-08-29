import type { WorkspaceModule, ModuleContext, ModuleResult } from '../types';
import { combineDocumentSources } from './readers';
import { requestIcegridExtraction } from './extract';
import { sanitizeIcegridExtraction } from './sanitize';
import { validateIcegridReport } from './validate';
import { mapReportToTableData } from './to-table';
import { getCatalogSnapshot } from './catalogs';
import { deriveRows, findExchangeRate } from './derive';
import { loadProfile } from './profile';
import IcegridSettings from './IcegridSettings.svelte';

export { ICEGRID_COLUMNS, ICEGRID_HEADERS, buildIcegridTableColumns } from './columns';
export { combineDocumentSources, extractSpreadsheetText, extractPdfText } from './readers';
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
export { requestIcegridExtraction } from './extract';
export { sanitizeIcegridExtraction } from './sanitize';
export { validateIcegridReport } from './validate';
export { mapReportToTableData, applyMechanicalRules } from './to-table';
export { getCatalogSnapshot } from './catalogs';
export { deriveRows, findExchangeRate, stateCodeFromGstin, type Provenance } from './derive';
export {
	loadProfile,
	saveProfile,
	parseProfile,
	EMPTY_PROFILE,
	IcegridProfileSchema,
	LS_ICEGRID_PROFILE_KEY,
	type IcegridProfile
} from './profile';
export {
	lookupDrawback,
	lookupRodtep,
	uqcToUnit,
	SCHEDULES_PROVENANCE
} from './catalogs/generated/schedules';

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
		gemini: true
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
		if (files.length === 0) {
			throw new Error('No files selected.');
		}

		// Captured once so a catalog change mid-run cannot alter how this run resolves
		// values or which options the resulting table carries.
		const catalogs = getCatalogSnapshot();

		context.onProgress('Reading documents...');
		const extraction = await combineDocumentSources(files, context.onProgress);

		context.onProgress('Extracting line items...');
		const candidate = await requestIcegridExtraction(extraction, context);

		context.onProgress(`Verifying evidence for ${candidate.rows.length} row(s)...`);
		const { report, warnings: sanitizationWarnings } = sanitizeIcegridExtraction(
			candidate,
			extraction,
			catalogs
		);

		context.onProgress('Filling schedule and derived values...');
		const derived = deriveRows(report.rows, {
			catalogs,
			profile: loadProfile(),
			sourceText: extraction.content,
			documentExchangeRate: findExchangeRate(extraction.content)
		});
		const filledReport = { ...report, rows: derived.rows };

		context.onProgress('Validating...');
		const validation = validateIcegridReport(filledReport, extraction.sourceFiles, catalogs);

		if (!validation.valid) {
			throw new Error(
				`ICEGrid validation failed: ${validation.blockingErrors.slice(0, 3).join(' ')}`
			);
		}

		context.onProgress('Preparing table...');
		const table = mapReportToTableData(filledReport, catalogs);

		const summary =
			`Filled ${derived.filled.extracted} cell(s) from the documents, ` +
			`${derived.filled.schedule} from the customs schedules, ` +
			`${derived.filled.derived} by formula, ` +
			`${derived.filled.profile} from your ICEGrid profile.`;

		return {
			table,
			warnings: [summary, ...sanitizationWarnings, ...derived.warnings, ...validation.warnings]
		};
	}
};
