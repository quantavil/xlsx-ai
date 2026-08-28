import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { WorkBook } from 'xlsx';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per file
export const MAX_COMBINED_BYTES = 750_000; // Must not exceed the server module content limit

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
		
		const pageLines: string[] = [];
		let currentLine = '';

		for (const item of textContent.items) {
			if ('str' in item && typeof item.str === 'string') {
				const str = item.str.trim();
				if (str) {
					currentLine = currentLine ? `${currentLine} ${str}` : str;
				}
				if ('hasEOL' in item && item.hasEOL && currentLine) {
					pageLines.push(currentLine);
					currentLine = '';
				}
			}
		}
		if (currentLine) {
			pageLines.push(currentLine);
		}

		const pageText = pageLines.join('\n').trim();
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

		let extracted: ExtractedDocumentResult;
		if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
			extracted = await extractSpreadsheetText(file);
		} else if (ext.endsWith('.pdf')) {
			extracted = await extractPdfText(file);
		} else {
			throw new Error(`Unsupported file type for "${file.name}". Supported formats: .pdf, .xlsx, .xls`);
		}

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
