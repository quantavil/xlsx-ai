import type { WorkspaceModule, ModuleContext, ModuleResult } from '../types';
import { combineDocumentSources } from './readers';
import { requestIcegridExtraction } from './extract';
import { validateIcegridReport } from './validate';
import { mapReportToTableData } from './to-table';

export { ICEGRID_COLUMNS, ICEGRID_HEADERS, buildIcegridTableColumns } from './columns';
export { combineDocumentSources, extractSpreadsheetText, extractPdfText } from './readers';
export { IcegridRowSchema, IcegridReportSchema, type IcegridRow, type IcegridReport } from './schema';
export { requestIcegridExtraction } from './extract';
export { validateIcegridReport } from './validate';
export { mapReportToTableData } from './to-table';

export const icegridModule: WorkspaceModule = {
	id: 'icegrid',
	name: 'ICEGrid Importer',
	description: 'Extract and map commercial invoice and packing list documents into the standardized 37-column ICEGATE format.',
	version: '1.0.0',
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
	async run(files: File[], context: ModuleContext): Promise<ModuleResult> {
		if (files.length === 0) {
			throw new Error('No files selected.');
		}

		// 1. Read and combine files locally with boundary preservation
		const extraction = await combineDocumentSources(files, context.onProgress);

		// 2. Request Gemini structured extraction
		const report = await requestIcegridExtraction(extraction, context);

		context.onProgress(`Validating ${report.rows.length} extracted row(s)...`);

		// 3. Run deterministic validation
		const validation = validateIcegridReport(report, extraction.sourceFiles);

		if (!validation.valid) {
			const errorSummary = validation.blockingErrors.slice(0, 3).join(' ');
			throw new Error(`ICEGrid validation failed: ${errorSummary}`);
		}

		// 4. Map validated report rows to host TableData
		const table = mapReportToTableData(report);

		const allWarnings = [...(report.warnings || []), ...validation.warnings];

		return {
			table,
			warnings: allWarnings
		};
	}
};
