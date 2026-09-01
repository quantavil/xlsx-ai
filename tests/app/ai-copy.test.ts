import { describe, it, expect } from 'bun:test';
import { extractSvgElement, isSvgContent } from '../../src/lib/ai/copy';

describe('AI Assistant Copy Affordances', () => {
	describe('extractSvgElement', () => {
		it('returns null when there is no <svg> tag', () => {
			expect(extractSvgElement('just a plain answer with no svg')).toBeNull();
		});

		it('extracts a bare SVG element exactly', () => {
			const svg = '<svg viewBox="0 0 10 10"><rect/></svg>';
			expect(extractSvgElement(svg)).toBe(svg);
		});

		it('extracts a self-closing SVG root exactly', () => {
			const svg = '<svg viewBox="0 0 10 10" />';
			expect(extractSvgElement(`Preview:\n${svg}\nDone.`)).toBe(svg);
		});

		it('extracts only the SVG when the reply wraps it in prose', () => {
			const reply = 'Here is a chart you can use:\n<svg viewBox="0 0 10 10"><rect/></svg>\nLet me know.';
			expect(extractSvgElement(reply)).toBe(
				'<svg viewBox="0 0 10 10"><rect/></svg>'
			);
		});

		it('strips the surrounding ```svg fence before extracting the element', () => {
			const reply =
				'```svg\n<svg viewBox="0 0 10 10"><circle r="5"/></svg>\n```';
			expect(extractSvgElement(reply)).toBe(
				'<svg viewBox="0 0 10 10"><circle r="5"/></svg>'
			);
		});

		it('handles attributes containing ">" inside double-quoted strings', () => {
			const svg =
				'<svg viewBox="0 0 10 10"><text>3 &gt; 2</text></svg>';
			expect(extractSvgElement(svg)).toBe(svg);
		});

		it('returns null when the SVG is unterminated', () => {
			expect(extractSvgElement('oops <svg viewBox="0 0 1 1"><rect/>')).toBeNull();
		});
	});

	describe('isSvgContent', () => {
		it('returns true for a reply that starts with an svg element', () => {
			expect(isSvgContent('<svg viewBox="0 0 1 1"/>')).toBe(true);
		});

		it('returns true when the svg appears after prose', () => {
			expect(isSvgContent('see this:\n<svg viewBox="0 0 1 1"/>')).toBe(true);
		});

		it('returns false for prose-only responses', () => {
			expect(isSvgContent('No graphics here.')).toBe(false);
		});
	});
});
