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
import { detectInvoiceCurrency, rateFor, requestExchangeRates } from './exchange-rate';
import {
	applyIcegridAnswers,
	buildConfirmInput,
	newlyAssignedRitcs,
	tariffQueriesFor
} from './confirm';
import { requestTariffClassification, type TariffClassification } from './tariff';
import { confirmIcegridChoices } from './confirm.client';
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

	// Nothing downstream is meaningful without rows - no tariff codes to look up, no
	// values to confirm - so stop here rather than opening an empty dialog. The
	// model's own warnings are the message: it says *why* it found no invoice lines,
	// and that is far more useful than "extraction returned no rows".
	if (candidate.rows.length === 0) {
		throw new Error(
			`No commercial invoice line items were found in the selected file(s). ${
				candidate.warnings.slice(0, 3).join(' ') ||
				'Check that a commercial invoice is among the files you selected.'
			}`
		);
	}

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

	context.onProgress('Fetching customs exchange rates...');
	const { rates, warnings: rateWarnings } = await requestExchangeRates();
	const documentExchangeRate = findExchangeRate(extraction.content);
	const currency = detectInvoiceCurrency(extraction.content, rates);
	// The notified board is the rate a shipping bill is assessed at; a rate printed on
	// the invoice is the exporter's own and is offered as the fallback, not the default.
	const proposedRate = rateFor(rates, currency) ?? documentExchangeRate;

	const deriveBase = {
		catalogs,
		profile: loadProfile(),
		sourceText: extraction.content,
		lookups
	};

	// Two derivation passes on purpose. The first is what the pipeline proposes, and it
	// exists only to fill the dialog: showing the user a blank form and asking them to
	// classify forty rows is the thing this module was built to avoid. Their answers then
	// go back onto the raw rows and the same derivation runs again, so a changed drawback
	// serial pulls its own rate, description and unit along with it, and an IGST status
	// changed to LUT zeroes the tax fields - exactly as if the importer had chosen them.
	context.onProgress('Filling schedule and derived values...');
	const proposed = deriveRows(report.rows, { ...deriveBase, exchangeRate: proposedRate });

	// Items the documents left without a filable code. A printed heading narrows the
	// answer but is not one, so `9403` needs choosing just as a blank does. Suggestions
	// come from DGFT's own ITC-HS master; the model only supplies the words to search
	// it with, so a code it imagined cannot reach the dialog.
	const tariffQueries = tariffQueriesFor(proposed.rows);
	let classifications = new Map<string, TariffClassification>();
	let classifyWarnings: string[] = [];
	if (tariffQueries.length > 0) {
		context.onProgress(`Finding tariff codes for ${tariffQueries.length} item(s)...`);
		({ classifications, warnings: classifyWarnings } = await requestTariffClassification(
			tariffQueries,
			context.ai,
			context.signal
		));
	}

	context.onProgress('Waiting for your confirmation...');
	const answers = await confirmIcegridChoices(
		buildConfirmInput(proposed.rows, {
			lookups,
			catalogs,
			rates,
			currency,
			exchangeRate: proposedRate,
			documentExchangeRate,
			classifications,
			classifyWarning: classifyWarnings.join(' ')
		}),
		context.signal
	);
	// An AbortError so the caller can tell a deliberate cancellation from a failure.
	if (!answers) throw new DOMException('ICEGrid import cancelled.', 'AbortError');

	// A code chosen in the dialog has no duty lookup behind it yet - the batch above
	// ran before it existed. Fetching it now is what lets the same derivation fill its
	// drawback serial, rate and RoDTEP verdict as if the documents had printed it.
	const assigned = newlyAssignedRitcs(answers).filter((code) => !lookups.has(code));
	if (assigned.length > 0) {
		context.onProgress(`Looking up ${assigned.length} newly assigned tariff code(s)...`);
		const extra = await requestDutyLookups(assigned);
		for (const entry of extra.entries) lookups.set(entry.ritc, entry);
		lookupWarnings = [...lookupWarnings, ...extra.warnings];
	}

	const derived = deriveRows(applyIcegridAnswers(report.rows, answers), {
		...deriveBase,
		exchangeRate: answers.exchangeRate
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
		`Filled ${derived.filled.extracted} cell(s) from the documents and your confirmation, ` +
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
			...rateWarnings,
			...classifyWarnings,
			...derived.warnings,
			...validation.warnings
		]
	};
}
