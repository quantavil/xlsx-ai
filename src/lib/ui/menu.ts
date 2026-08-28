export interface MenuKeyboardOptions {
	itemCount: number;
	activeIndex: number;
	onHighlight: (index: number) => void;
	onSelect: (index: number) => void;
	onClose: () => void;
	orientation?: 'vertical' | 'horizontal';
	loop?: boolean;
}

export function handleMenuKeydown(e: KeyboardEvent, options: MenuKeyboardOptions): void {
	const { itemCount, activeIndex, onHighlight, onSelect, onClose, loop = true } = options;

	if (itemCount === 0) {
		if (e.key === 'Escape' || e.key === 'Tab') {
			e.preventDefault();
			onClose();
		}
		return;
	}

	switch (e.key) {
		case 'ArrowDown':
			e.preventDefault();
			if (activeIndex < 0) {
				onHighlight(0);
			} else if (activeIndex + 1 < itemCount) {
				onHighlight(activeIndex + 1);
			} else if (loop) {
				onHighlight(0);
			}
			break;

		case 'ArrowUp':
			e.preventDefault();
			if (activeIndex <= 0) {
				onHighlight(loop ? itemCount - 1 : 0);
			} else {
				onHighlight(activeIndex - 1);
			}
			break;

		case 'Home':
			e.preventDefault();
			onHighlight(0);
			break;

		case 'End':
			e.preventDefault();
			onHighlight(itemCount - 1);
			break;

		case 'Enter':
		case ' ':
			if (activeIndex >= 0 && activeIndex < itemCount) {
				e.preventDefault();
				onSelect(activeIndex);
			}
			break;

		case 'Escape':
			e.preventDefault();
			onClose();
			break;

		case 'Tab':
			onClose();
			break;
	}
}

export function createFocusRestorer() {
	let triggerElement: HTMLElement | null = null;

	return {
		capture(el?: HTMLElement | null) {
			triggerElement = el || (document.activeElement as HTMLElement | null);
		},
		restore() {
			if (triggerElement && typeof triggerElement.focus === 'function') {
				// Restore focus on next animation frame to prevent race condition with teardown
				requestAnimationFrame(() => {
					if (document.body.contains(triggerElement)) {
						triggerElement?.focus();
					}
				});
			}
		}
	};
}
