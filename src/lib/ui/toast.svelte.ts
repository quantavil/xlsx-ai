export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
	id: string;
	type: ToastType;
	message: string;
	action?: {
		label: string;
		onClick: () => void;
	};
	durationMs?: number;
}

export function createToastStore() {
	let toasts = $state<ToastItem[]>([]);

	function notify(
		type: ToastType,
		message: string,
		options: { action?: { label: string; onClick: () => void }; durationMs?: number } = {}
	) {
		const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const duration = options.durationMs ?? (options.action ? 5000 : 3500);

		const item: ToastItem = {
			id,
			type,
			message,
			action: options.action,
			durationMs: duration
		};

		toasts = [...toasts, item];

		setTimeout(() => {
			remove(id);
		}, duration);

		return id;
	}

	function remove(id: string) {
		toasts = toasts.filter((t) => t.id !== id);
	}

	function clear() {
		toasts = [];
	}

	return {
		get toasts() {
			return toasts;
		},
		notify,
		remove,
		clear
	};
}
