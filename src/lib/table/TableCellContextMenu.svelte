<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';

	let {
		x,
		y,
		selectedRowCount = 1,
		onCopy,
		onCut,
		onPaste,
		onInsertAbove,
		onInsertBelow,
		onDeleteRows,
		onClear,
		onClose
	}: {
		x: number;
		y: number;
		selectedRowCount?: number;
		onCopy: () => void;
		onCut: () => void;
		onPaste: () => void;
		onInsertAbove: () => void;
		onInsertBelow: () => void;
		onDeleteRows: () => void;
		onClear: () => void;
		onClose: () => void;
	} = $props();
</script>

<div
	class="context-menu fixed z-50 w-52 p-1.5 bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-xl shadow-2xl"
	style="left: {x}px; top: {y}px;"
	role="menu"
	aria-label="Cell actions"
>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onCopy();
			onClose();
		}}
	>
		<Icon name="copy" size={13} aria-hidden="true" />
		<span class="flex-1">Copy</span>
		<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">⌘C</kbd>
	</button>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onCut();
			onClose();
		}}
	>
		<Icon name="edit" size={13} aria-hidden="true" />
		<span class="flex-1">Cut</span>
		<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">⌘X</kbd>
	</button>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onPaste();
			onClose();
		}}
	>
		<Icon name="file-text" size={13} aria-hidden="true" />
		<span class="flex-1">Paste</span>
		<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">⌘V</kbd>
	</button>
	<div class="h-px bg-[var(--border)] my-1"></div>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onInsertAbove();
			onClose();
		}}
	>
		<Icon name="plus" size={13} aria-hidden="true" />
		<span>Insert Row Above</span>
	</button>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onInsertBelow();
			onClose();
		}}
	>
		<Icon name="plus" size={13} aria-hidden="true" />
		<span>Insert Row Below</span>
	</button>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--accent-rose)] hover:!bg-[var(--accent-rose-bg)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onDeleteRows();
			onClose();
		}}
	>
		<Icon name="trash" size={13} aria-hidden="true" />
		<span>{selectedRowCount > 1 ? `Delete ${selectedRowCount} Rows` : 'Delete Row'}</span>
	</button>
	<button
		class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
		role="menuitem"
		onclick={() => {
			onClear();
			onClose();
		}}
	>
		<Icon name="x" size={13} aria-hidden="true" />
		<span class="flex-1">Clear Contents</span>
		<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">Del</kbd>
	</button>
</div>
