export interface ComboboxOptions<T> {
	items: T[];
	query: string;
	highlightIndex: number;
	getItemLabel: (item: T) => string;
	onHighlight: (index: number) => void;
	onSelect: (item: T) => void;
	onCreate?: (query: string) => void;
	onCancel: () => void;
	/**
	 * The row above the options, if the list renders one. It sits at index -1, which is
	 * why the highlight is an index and not a position: a list can offer choices that
	 * are not items.
	 */
	onClear?: () => void;
	/** Whether the `+ Add` row is on screen. It sits at index `items.length`. */
	hasCreateRow?: boolean;
}

export function handleComboboxKeydown<T>(e: KeyboardEvent, options: ComboboxOptions<T>): void {
	const { items, highlightIndex, onHighlight, onSelect, onCreate, onCancel, onClear } = options;
	const total = items.length;

	// The arrow keys walk every row the list actually draws, not just the items. A row
	// the mouse can reach and the keyboard cannot is a row some people simply do not
	// have, so `Clear` at -1 and `+ Add` at `total` are part of the range or they are
	// not rendered at all.
	const first = onClear ? -1 : 0;
	const last = options.hasCreateRow ? total : total - 1;
	const step = (from: number, by: number) => {
		if (last < first) return;
		const next = from + by;
		onHighlight(next > last ? first : next < first ? last : next);
	};

	switch (e.key) {
		case 'ArrowDown':
			e.preventDefault();
			step(highlightIndex, 1);
			break;

		case 'ArrowUp':
			e.preventDefault();
			step(highlightIndex, -1);
			break;

		case 'Enter':
			e.preventDefault();
			if (onClear && highlightIndex === -1) {
				onClear();
			} else if (highlightIndex >= 0 && highlightIndex < total) {
				onSelect(items[highlightIndex]);
			} else if (onCreate && options.query.trim().length > 0) {
				onCreate(options.query.trim());
			}
			break;

		case 'Escape':
			e.preventDefault();
			onCancel();
			break;

		case 'Tab':
			if (highlightIndex >= 0 && highlightIndex < total) {
				onSelect(items[highlightIndex]);
			} else {
				onCancel();
			}
			break;
	}
}
