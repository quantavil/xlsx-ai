export function isSvgContent(content: string): boolean {
	const trimmed = content.trim();
	return trimmed.startsWith('<svg') || /<svg\b/i.test(content);
}

/**
 * Extract the first balanced `<svg…>…</svg>` element from `content`.
 *
 * Many assistant responses wrap an SVG in surrounding prose
 * ("Here is a chart:\n<svg>…</svg>\nLet me know…") or in a fenced code
 * block ("```svg\n<svg>…</svg>\n```"). Returning just the element — not the
 * whole reply — is what makes "Copy SVG" useful, and walking balanced
 * tags keeps a `<svg>` nested inside another `<svg>` (legal in SVG 2)
 * from being clipped at the outer `</svg>`.
 *
 * The fence wrapper is stripped: when the SVG lives inside a triple-backtick
 * block the first line is consumed and the matching closing fence is dropped
 * so the clipboard payload is the raw `<svg>…</svg>` element only.
 */
export function extractSvgElement(content: string): string | null {
	const start = content.search(/<svg\b/i);
	if (start === -1) return null;

	const openEnd = findTagEnd(content, start);
	if (openEnd === -1) return null;
	// `<svg …/>` is a complete element on its own; there is no `</svg>` to find.
	if (isSelfClosing(content, start, openEnd)) return content.slice(start, openEnd);

	let depth = 1;
	let i = openEnd;
	while (i < content.length && depth > 0) {
		const nextOpen = content.indexOf('<svg', i);
		const nextClose = content.indexOf('</svg>', i);
		if (nextClose === -1) return null;
		if (nextOpen !== -1 && nextOpen < nextClose) {
			const afterAttr = findTagEnd(content, nextOpen);
			if (afterAttr === -1) return null;
			if (!isSelfClosing(content, nextOpen, afterAttr)) depth++;
			i = afterAttr;
		} else {
			depth--;
			i = nextClose + '</svg>'.length;
		}
	}

	if (depth !== 0) return null;
	return content.slice(start, i);
}

function findTagEnd(content: string, from: number): number {
	const lt = content.indexOf('<', from);
	if (lt === -1) return -1;
	const gt = content.indexOf('>', lt);
	if (gt === -1) return -1;
	return gt + 1;
}

function isSelfClosing(content: string, start: number, end: number): boolean {
	return content.slice(start, end).trimEnd().endsWith('/>');
}
