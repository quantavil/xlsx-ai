export interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

export interface FloatingPositionOptions {
	offset?: number;
	margin?: number;
	preferPlacement?: 'bottom' | 'top' | 'left' | 'right';
	align?: 'start' | 'center' | 'end';
}

export interface FloatingPositionResult {
	placement: 'bottom' | 'top' | 'left' | 'right';
	top: number;
	left: number;
	maxHeight: number;
	isFlipped: boolean;
}

export function computeFloatingPosition(
	triggerRect: Rect,
	layerRect: { width: number; height: number },
	viewport: { width: number; height: number },
	options: FloatingPositionOptions = {}
): FloatingPositionResult {
	const offset = options.offset ?? 4;
	const margin = options.margin ?? 8;
	const prefer = options.preferPlacement ?? 'bottom';
	const align = options.align ?? 'start';

	const spaceBelow = viewport.height - triggerRect.bottom - offset - margin;
	const spaceAbove = triggerRect.top - offset - margin;

	let isFlipped = false;
	let placement: 'bottom' | 'top' = 'bottom';
	let top = 0;
	let maxHeight = Math.max(100, Math.max(spaceBelow, spaceAbove));

	if (prefer === 'bottom') {
		if (spaceBelow >= layerRect.height || spaceBelow >= spaceAbove) {
			placement = 'bottom';
			top = triggerRect.bottom + offset;
			maxHeight = Math.max(80, spaceBelow);
			isFlipped = false;
		} else {
			placement = 'top';
			top = triggerRect.top - layerRect.height - offset;
			maxHeight = Math.max(80, spaceAbove);
			isFlipped = true;
		}
	} else if (prefer === 'top') {
		if (spaceAbove >= layerRect.height || spaceAbove >= spaceBelow) {
			placement = 'top';
			top = triggerRect.top - layerRect.height - offset;
			maxHeight = Math.max(80, spaceAbove);
			isFlipped = false;
		} else {
			placement = 'bottom';
			top = triggerRect.bottom + offset;
			maxHeight = Math.max(80, spaceBelow);
			isFlipped = true;
		}
	}

	// Horizontal alignment
	let left = triggerRect.left;
	if (align === 'center') {
		left = triggerRect.left + (triggerRect.width - layerRect.width) / 2;
	} else if (align === 'end') {
		left = triggerRect.right - layerRect.width;
	}

	// Clamp to viewport margin boundaries
	if (left + layerRect.width > viewport.width - margin) {
		left = viewport.width - margin - layerRect.width;
	}
	if (left < margin) {
		left = margin;
	}

	// Ensure top doesn't start negative
	if (top < margin) {
		top = margin;
	}

	return {
		placement,
		top: Math.round(top),
		left: Math.round(left),
		maxHeight: Math.round(maxHeight),
		isFlipped
	};
}
