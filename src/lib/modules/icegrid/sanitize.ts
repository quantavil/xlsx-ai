import { ICEGRID_COLUMNS, MECHANICAL_HEADERS } from './columns';
import { getCatalogSnapshot, resolveCatalogValue } from './catalogs';
import type { IcegridCatalogId, IcegridCatalogSnapshot } from './catalogs/types';
import { verifyEvidenceSpan, quoteSupportsValue, normalizeEvidenceText } from './evidence';
import type { CombinedExtractionResult } from './readers';
import type {
	IcegridAiReport,
	IcegridCandidateRow,
	IcegridHeader,
	IcegridReport,
	IcegridRow
} from './schema';

export interface SanitizationResult {
	report: IcegridReport;
	warnings: string[];
}

/** Headers the module fills mechanically, so AI evidence is neither needed nor trusted. */
const MECHANICAL = new Set<string>(MECHANICAL_HEADERS);

/**
 * Free-text prose the model reconstructs rather than copies.
 *
 * PDF table layout puts quantities and prices between the wrapped lines of one
 * description cell, so no single printed run ever contains the whole value. These
 * fields are judged on overlap instead. Nothing that reaches a customs filing as a
 * code or an amount belongs in this set.
 */
const TRUSTED_TEXT = new Set<string>(['Description', 'dbk_desc']);

/** One string contains the other, after evidence-grade folding. */
function overlaps(quote: string, value: string): boolean {
	const [q, v] = [normalizeEvidenceText(quote), normalizeEvidenceText(value)];
	return !!q && !!v && (q.includes(v) || v.includes(q));
}

const CATALOG_BY_HEADER = new Map<string, IcegridCatalogId>(
	ICEGRID_COLUMNS.filter((c) => c.catalog).map((c) => [c.header, c.catalog!])
);

const HEADER_TYPE = new Map(ICEGRID_COLUMNS.map((c) => [c.header, c.type]));

const blankRow = (): IcegridRow =>
	Object.fromEntries(ICEGRID_COLUMNS.map((c) => [c.header, null])) as unknown as IcegridRow;

/**
 * Turn candidate rows into a clean report by keeping only what the sources prove.
 *
 * Each field is judged on its own: one unsupported value blanks that cell and adds a
 * warning, never the row and never its siblings. The order matters — evidence is
 * verified *before* catalog normalization, because matching a catalog is not
 * evidence that the document said so.
 */
export function sanitizeIcegridExtraction(
	candidate: IcegridAiReport,
	extraction: CombinedExtractionResult,
	catalogs: IcegridCatalogSnapshot = getCatalogSnapshot()
): SanitizationResult {
	const warnings: string[] = [...(candidate.warnings ?? [])];

	const rows = candidate.rows.map((candidateRow, index) => {
		const rowNo = index + 1;
		const clean = blankRow();
		const spans = Array.isArray(candidateRow.evidence) ? candidateRow.evidence : [];

		// Verify each span once, not once per field.
		const verifiedSpans = spans.filter((span) => verifyEvidenceSpan(span, extraction).ok);

		for (const col of ICEGRID_COLUMNS) {
			const header = col.header as IcegridHeader;
			if (MECHANICAL.has(header)) continue;

			const raw = (candidateRow as Record<string, unknown>)[header];
			if (raw === null || raw === undefined || raw === '') continue;

			const value = typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw);

			// Reconstructed prose only has to overlap a real source fragment; every customs
			// code and amount still needs the quote to contain the value character for
			// character. A wrong description costs an edit, a wrong RITC costs a penalty.
			const fieldSpans = verifiedSpans.filter((span) => span.fields.includes(header));
			const supporting = TRUSTED_TEXT.has(header)
				? fieldSpans.find((span) => overlaps(span.quote, String(value)))
				: fieldSpans.find((span) => quoteSupportsValue(span.quote, value));

			if (!supporting) {
				const named = spans.some((span) => span.fields.includes(header));
				warnings.push(
					!named
						? `Row ${rowNo}: ${header} cleared - no source evidence was provided for "${value}".`
						: TRUSTED_TEXT.has(header)
							? `Row ${rowNo}: ${header} cleared - the cited source evidence could not be verified.`
							: `Row ${rowNo}: ${header} cleared - the cited source text does not contain "${value}".`
				);
				continue;
			}

			// 2. Only now may the supported raw token be converted to a catalog value.
			const catalogId = CATALOG_BY_HEADER.get(header);
			if (catalogId) {
				const parentValue =
					col.dependsOn !== undefined
						? ((clean as Record<string, unknown>)[col.dependsOn] as string | null)
						: undefined;

				const resolution = resolveCatalogValue(value, catalogs[catalogId], {
					...(col.dependsOn !== undefined ? { parentValue } : {}),
					allowNumericPrefix: catalogId === 'scheme'
				});

				if (resolution.status === 'resolved') {
					(clean as Record<string, unknown>)[header] = resolution.value;
				} else {
					warnings.push(
						`Row ${rowNo}: ${header} cleared - ${describeUnresolved(resolution.reason, header)} ("${resolution.raw}").`
					);
				}
				continue;
			}

			// 3. Free text and numbers pass through with plain parsing only.
			const type = HEADER_TYPE.get(header);
			if (type === 'number' || type === 'currency') {
				const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
				if (Number.isFinite(num)) {
					(clean as Record<string, unknown>)[header] = num;
				} else {
					warnings.push(`Row ${rowNo}: ${header} cleared - "${value}" is not a number.`);
				}
			} else {
				(clean as Record<string, unknown>)[header] = String(value).trim();
			}
		}

		return clean;
	});

	return {
		report: {
			reportVersion: 1,
			sourceFiles: candidate.sourceFiles,
			rows,
			warnings: []
		},
		warnings
	};
}

function describeUnresolved(
	reason: 'unknown' | 'ambiguous' | 'wrong_parent',
	header: string
): string {
	if (reason === 'ambiguous') {
		return `the value is ambiguous and matches more than one ${header} entry`;
	}
	if (reason === 'wrong_parent') {
		return 'the value does not belong to the selected StateOrigin';
	}
	return `the value is not a known ${header} option`;
}

export type { IcegridCandidateRow };
