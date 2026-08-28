export function trapFocus(node: HTMLElement) {
	const priorActive = document.activeElement as HTMLElement | null;

	const focusableSelectors = [
		'a[href]',
		'button:not([disabled])',
		'input:not([disabled])',
		'select:not([disabled])',
		'textarea:not([disabled])',
		'[tabindex]:not([tabindex="-1"])'
	].join(', ');

	function getFocusableElements(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
			(el) => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
		);
	}

	// Focus first focusable element on mount
	const focusable = getFocusableElements();
	if (focusable.length > 0) {
		const initial = focusable.find((el) => el.hasAttribute('autofocus')) || focusable[0];
		initial.focus();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;

		const elements = getFocusableElements();
		if (elements.length === 0) {
			e.preventDefault();
			return;
		}

		const first = elements[0];
		const last = elements[elements.length - 1];

		if (e.shiftKey) {
			if (document.activeElement === first || !node.contains(document.activeElement)) {
				e.preventDefault();
				last.focus();
			}
		} else {
			if (document.activeElement === last || !node.contains(document.activeElement)) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	node.addEventListener('keydown', handleKeyDown);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeyDown);
			if (priorActive && typeof priorActive.focus === 'function') {
				priorActive.focus();
			}
		}
	};
}
