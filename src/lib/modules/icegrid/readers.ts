import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { WorkBook } from 'xlsx';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per file
export const MAX_COMBINED_BYTES = 750_000; // Matches IcegridExtractInputSchema's content cap

async function loadPdfJs() {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
		pdfjs.GlobalWorkerOptions.workerSrc = new URL(
			'pdfjs-dist/legacy/build/pdf.worker.mjs',
			import.meta.url
		).toString();
	}
	return pdfjs;
}

export interface ExtractedDocumentResult {
	filename: string;
	content: string;
	sheetCount?: number;
	pageCount?: number;
	charCount: number;
}

export interface CombinedExtractionResult {
	sourceFiles: string[];
	content: string;
	documents: ExtractedDocumentResult[];
	totalChars: number;
	totalBytes: number;
}

export function isSupportedExtension(filename: string): boolean {
	const lower = filename.toLowerCase();
	return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.pdf');
}

export async function extractSpreadsheetText(file: File): Promise<ExtractedDocumentResult> {
	if (file.size === 0) {
		throw new Error(`File "${file.name}" is empty (0 bytes).`);
	}
	if (file.size > MAX_FILE_BYTES) {
		throw new Error(`File "${file.name}" exceeds the 10 MiB file size limit.`);
	}

	const XLSX = await import('xlsx');
	const buffer = await file.arrayBuffer();
	let workbook: WorkBook;
	try {
		workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
	} catch (err) {
		throw new Error(`Failed to parse spreadsheet "${file.name}". Ensure it is a valid .xlsx or .xls file.`);
	}

	const sections: string[] = [];
	let nonEmptysheets = 0;

	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet || !sheet['!ref']) continue;

		const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }).trim();
		if (tsv.length > 0) {
			nonEmptysheets++;
			sections.push(`=== SHEET: ${sheetName} ===\n${tsv}`);
		}
	}

	if (sections.length === 0) {
		throw new Error(`Spreadsheet "${file.name}" contains no readable data across its sheets.`);
	}

	const joined = sections.join('\n\n');
	return {
		filename: file.name,
		content: joined,
		sheetCount: nonEmptysheets,
		charCount: joined.length
	};
}

export async function extractPdfText(file: File): Promise<ExtractedDocumentResult> {
	if (file.size === 0) {
		throw new Error(`File "${file.name}" is empty (0 bytes).`);
	}
	if (file.size > MAX_FILE_BYTES) {
		throw new Error(`File "${file.name}" exceeds the 10 MiB file size limit.`);
	}

	const buffer = await file.arrayBuffer();
	let pdfDoc: PDFDocumentProxy;

	try {
		const pdfjs = await loadPdfJs();
		const loadingTask = pdfjs.getDocument({
			data: new Uint8Array(buffer),
			useSystemFonts: true
		});
		pdfDoc = await loadingTask.promise;
	} catch (err) {
		throw new Error(`Failed to open PDF "${file.name}". Ensure the file is not password-protected or corrupted.`);
	}

	const pageSections: string[] = [];
	let totalTextLength = 0;

	for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
		const page = await pdfDoc.getPage(pageNum);
		const textContent = await page.getTextContent();
		const pageText = layOutPageText(textContent.items);
		if (pageText.length > 0) {
			totalTextLength += pageText.length;
			pageSections.push(`=== PAGE: ${pageNum} ===\n${pageText}`);
		}
	}

	if (totalTextLength === 0) {
		throw new Error(
			`Failed to read "${file.name}": No searchable text detected. Please upload a searchable digital PDF or spreadsheet source.`
		);
	}

	const joined = pageSections.join('\n\n');
	return {
		filename: file.name,
		content: joined,
		pageCount: pdfDoc.numPages,
		charCount: joined.length
	};
}

interface PositionedGlyphRun {
	str: string;
	transform: number[];
	width: number;
	height: number;
}

function isPositioned(item: unknown): item is PositionedGlyphRun {
	const i = item as Partial<PositionedGlyphRun>;
	return typeof i?.str === 'string' && Array.isArray(i.transform) && i.transform.length >= 6;
}

/**
 * Rebuild a page's reading order from glyph positions.
 *
 * pdf.js hands back text runs in content-stream order, which on a form-drawn
 * invoice is the order the generator painted boxes - every quantity, then every
 * rate, then every amount, with the descriptions somewhere else entirely. Joining
 * that stream on `hasEOL` produced text where no number sat beside the line it
 * belonged to, so which cells the model could fill came down to which column it
 * guessed right on a given run. That is the whole nondeterministic-blank problem.
 *
 * Runs are therefore bucketed by baseline (`transform[5]`) and ordered by x within
 * the bucket, and a horizontal gap wider than a space becomes a tab so a table row
 * stays a table row.
 */
export function layOutPageText(items: unknown[]): string {
	const runs = items.filter(isPositioned).filter((i) => i.str.trim().length > 0);
	if (runs.length === 0) return '';

	// Half a line height tolerates the baseline jitter of sub/superscripts and mixed
	// font sizes without merging two genuinely different rows.
	const medianHeight =
		runs.map((r) => r.height || 0).sort((a, b) => a - b)[Math.floor(runs.length / 2)] || 8;
	const rowTolerance = Math.max(medianHeight * 0.5, 2);

	const lines: PositionedGlyphRun[][] = [];
	for (const run of [...runs].sort((a, b) => b.transform[5] - a.transform[5])) {
		const last = lines[lines.length - 1];
		if (last && Math.abs(last[0].transform[5] - run.transform[5]) <= rowTolerance) {
			last.push(run);
		} else {
			lines.push([run]);
		}
	}

	return lines
		.map((line) => {
			line.sort((a, b) => a.transform[4] - b.transform[4]);
			let text = '';
			let cursor = -Infinity;
			for (const run of line) {
				const gap = run.transform[4] - cursor;
				// A gap wider than roughly one character is column spacing, not a word space.
				if (text) text += gap > medianHeight * 0.8 ? '\t' : gap > 0.1 ? ' ' : '';
				text += run.str.trim();
				cursor = run.transform[4] + (run.width || 0);
			}
			return text.trim();
		})
		.filter((line) => line.length > 0)
		.join('\n')
		.trim();
}

export async function combineDocumentSources(
	files: File[],
	onProgress?: (msg: string) => void
): Promise<CombinedExtractionResult> {
	if (files.length === 0) {
		throw new Error('No files provided for extraction.');
	}

	const results: ExtractedDocumentResult[] = [];
	const combinedBlocks: string[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const ext = file.name.toLowerCase();

		onProgress?.(`Reading ${file.name} (${i + 1}/${files.length})...`);

		if (!isSupportedExtension(file.name)) {
			throw new Error(`Unsupported file type for "${file.name}". Supported formats: .pdf, .xlsx, .xls`);
		}
		const extracted = ext.endsWith('.pdf')
			? await extractPdfText(file)
			: await extractSpreadsheetText(file);

		results.push(extracted);
		combinedBlocks.push(`=== FILE: ${file.name} ===\n${extracted.content}`);
	}

	const fullText = combinedBlocks.join('\n\n');
	const byteLength = new TextEncoder().encode(fullText).byteLength;

	if (byteLength > MAX_COMBINED_BYTES) {
		throw new Error(
			`Combined document text (${(byteLength / 1024).toFixed(1)} KB) exceeds the single-prompt extraction limit (${(MAX_COMBINED_BYTES / 1024).toFixed(1)} KB). Please select fewer files or smaller batches.`
		);
	}

	return {
		sourceFiles: files.map((f) => f.name),
		content: fullText,
		documents: results,
		totalChars: fullText.length,
		totalBytes: byteLength
	};
}
