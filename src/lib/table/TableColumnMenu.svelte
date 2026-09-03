<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import type { Column, ColumnType } from '$lib/types';
	import { COLUMN_TYPE_CONFIG } from '$lib/constants';

	let {
		column,
		style,
		onAutoFit,
		onSelectColumn,
		onUpdateType,
		onDelete,
		onClose
	}: {
		column: Column;
		style: string;
		onAutoFit: () => void;
		onSelectColumn: () => void;
		onUpdateType: (type: ColumnType) => void;
		onDelete: () => void;
		onClose: () => void;
	} = $props();
</script>

<div
	class="column-popover bezel-card fixed z-50 w-48 p-1.5 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-right animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)]"
	{style}
	role="menu"
>
	<button
		class="popover-item flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onClose();
			onAutoFit();
		}}
	>
		<Icon
			name="chevrons-up-down"
			size={13}
			class="rotate-90"
			aria-hidden="true"
		/>
		<span>Fit to content</span>
	</button>

	<button
		class="popover-item flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onClose();
			onSelectColumn();
		}}
	>
		<Icon
			name="check"
			size={13}
			aria-hidden="true"
		/>
		<span>Select column</span>
	</button>

	<div class="popover-divider h-px bg-[var(--border)] my-1"></div>
	<div
		class="popover-section-label px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]"
	>
		Column type
	</div>

	{#each Object.entries(COLUMN_TYPE_CONFIG) as [typeKey, typeCfg]}
		{@const isActiveType = column.type === typeKey}
		<button
			class="popover-item flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors {isActiveType
				? 'active !text-[var(--accent-primary)] !bg-[var(--accent-primary-bg)] font-semibold'
				: ''}"
			role="menuitem"
			onclick={() => onUpdateType(typeKey as ColumnType)}
		>
			<div class="flex items-center gap-2">
				<Icon
					name={typeCfg.icon}
					size={13}
					aria-hidden="true"
				/>
				<span>{typeCfg.label}</span>
			</div>
			{#if isActiveType}
				<span class="check-icon text-[var(--accent-primary)] font-bold text-[12px]">
					<Icon name="check" size={12} aria-hidden="true" />
				</span>
			{/if}
		</button>
	{/each}

	<div class="popover-divider h-px bg-[var(--border)] my-1"></div>
	<button
		class="popover-item popover-delete flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--accent-rose)] hover:!text-[var(--accent-rose)] hover:!bg-[var(--accent-rose-bg)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={onDelete}
	>
		<Icon
			name="trash"
			size={13}
			aria-hidden="true"
		/>
		<span>Delete Column</span>
	</button>
</div>
