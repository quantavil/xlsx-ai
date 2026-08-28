export interface ComboboxOptions<T> {
	items: T[];
	query: string;
	highlightIndex: number;
	getItemLabel: (item: T) => string;
	onHighlight: (index: number) => void;
	onSelect: (item: T) => void;
	onCreate?: (query: string) => void;
	onCancel: () => void;
}

export function filterComboboxItems<T>(items: T[], query: string, getLabel: (item: T) => string): T[] {
	const clean = query.trim().toLowerCase();
	if (!clean) return items;
	return items.filter((item) => getLabel(item).toLowerCase().includes(clean));
}

export function handleComboboxKeydown<T>(e: KeyboardEvent, options: ComboboxOptions<T>): void {
	const { items, highlightIndex, onHighlight, onSelect, onCreate, onCancel } = options;
	const total = items.length;

	switch (e.key) {
		case 'ArrowDown':
			e.preventDefault();
			if (total === 0) return;
			if (highlightIndex < 0 || highlightIndex >= total - 1) {
				onHighlight(0);
			} else {
				onHighlight(highlightIndex + 1);
			}
			break;

		case 'ArrowUp':
			e.preventDefault();
			if (total === 0) return;
			if (highlightIndex <= 0) {
				onHighlight(total - 1);
			} else {
				onHighlight(highlightIndex - 1);
			}
			break;

		case 'Enter':
			e.preventDefault();
			if (highlightIndex >= 0 && highlightIndex < total) {
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
