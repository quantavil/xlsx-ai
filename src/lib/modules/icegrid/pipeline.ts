import type { ModuleContext, ModuleResult } from '../types';
import { combineDocumentSources } from './readers';
import { requestIcegridExtraction } from './extract';
import { sanitizeIcegridExtraction } from './sanitize';
import { validateIcegridReport } from './validate';
import { mapReportToTableData } from './to-table';
import { getCatalogSnapshot } from './catalogs';
import { deriveRows, findExchangeRate } from './derive';
import { loadProfile } from './profile';

export async function runIcegridPipeline(files: File[], context: ModuleContext): Promise<ModuleResult> {
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
