import type { ModuleContext, ModuleResult } from '../types';
import { combineDocumentSources } from './readers';
import { requestIcegridExtraction } from './extract';
import { sanitizeIcegridExtraction } from './sanitize';
import { validateIcegridReport } from './validate';
import { mapReportToTableData } from './to-table';
import { getCatalogSnapshot } from './catalogs';
import { deriveRows, findExchangeRate } from './derive';
import { buildDrawbackOptions, distinctRitcCodes, type DutyLookupEntry } from './duty-lookup';
import { requestDutyLookups } from './duty-lookup.client';
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

	// One request per distinct tariff code, not per row. The answers scope the drawback
	// dropdown per row and settle RoDTEP eligibility; when they do not arrive the bundled
	// schedules answer exactly as they did before, so an outage costs detail, not the run.
	const ritcs = distinctRitcCodes(report.rows);
	let lookupEntries: DutyLookupEntry[] = [];
	let lookupWarnings: string[] = [];
	if (ritcs.length > 0) {
		context.onProgress(`Looking up ${ritcs.length} tariff code(s)...`);
		({ entries: lookupEntries, warnings: lookupWarnings } = await requestDutyLookups(ritcs));
	}
	const lookups = new Map(lookupEntries.map((entry) => [entry.ritc, entry]));

	context.onProgress('Filling schedule and derived values...');
	const derived = deriveRows(report.rows, {
		catalogs,
		profile: loadProfile(),
		sourceText: extraction.content,
		documentExchangeRate: findExchangeRate(extraction.content),
		lookups
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
	const table = mapReportToTableData(filledReport, catalogs, {
		drawback: buildDrawbackOptions(lookups)
	});

	const summary =
		`Filled ${derived.filled.extracted} cell(s) from the documents, ` +
		`${derived.filled.schedule} from the customs schedules, ` +
		`${derived.filled.lookup} from the live duty lookup, ` +
		`${derived.filled.derived} by formula, ` +
		`${derived.filled.profile} from your ICEGrid profile.`;

	return {
		table,
		warnings: [
			summary,
			...sanitizationWarnings,
			...lookupWarnings,
			...derived.warnings,
			...validation.warnings
		]
	};
}
