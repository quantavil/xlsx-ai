<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import type { ToastItem } from './toast.svelte';

	let {
		toasts,
		onDismiss
	}: {
		toasts: ToastItem[];
		onDismiss: (id: string) => void;
	} = $props();
</script>

{#if toasts.length > 0}
	<div class="toast-container fixed bottom-6 right-6 flex flex-col gap-2 z-[1000] pointer-events-none max-w-sm" aria-live="polite" aria-atomic="true">
		{#each toasts as toast (toast.id)}
			<div
				class="toast-item toast-{toast.type} pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-xl shadow-2xl text-[13px] text-[var(--text-1)] border-l-4 animate-[toastSlideIn_150ms_cubic-bezier(0.16,1,0.3,1)] {toast.type === 'success' ? 'border-l-emerald-500' : toast.type === 'error' ? 'border-l-rose-500' : toast.type === 'warning' ? 'border-l-amber-500' : 'border-l-[var(--accent-primary)]'}"
				role="status"
			>
				<span class="toast-icon flex items-center shrink-0 {toast.type === 'success' ? 'text-emerald-400' : toast.type === 'error' ? 'text-rose-400' : toast.type === 'warning' ? 'text-amber-400' : 'text-[var(--accent-primary)]'}" aria-hidden="true">
					{#if toast.type === 'success'}
						<Icon name="check" size={14} />
					{:else if toast.type === 'error'}
						<Icon name="x" size={14} />
					{:else if toast.type === 'warning'}
						<Icon name="alert-triangle" size={14} />
					{:else}
						<Icon name="database" size={14} />
					{/if}
				</span>

				<span class="toast-text flex-1 leading-snug">{toast.message}</span>

				{#if toast.action}
					<button
						class="toast-action-btn bg-[var(--surface-3)] hover:bg-[var(--accent-primary)] hover:text-white border border-[var(--border)] rounded px-2 py-0.5 text-[11.5px] font-semibold text-[var(--text-1)] cursor-pointer transition-colors"
						onclick={() => {
							toast.action?.onClick();
							onDismiss(toast.id);
						}}
					>
						{toast.action.label}
					</button>
				{/if}

				<button
					class="toast-close-btn bg-transparent hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] p-1 rounded cursor-pointer transition-colors"
					onclick={() => onDismiss(toast.id)}
					aria-label="Dismiss notification"
				>
					<Icon name="x" size={12} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
{/if}
