<script lang="ts">
	import { onMount } from 'svelte';
	import { computeFloatingPosition } from '$lib/ui/position';
	import { handleComboboxKeydown } from '$lib/ui/combobox';
	import { getDropdownStyle } from '$lib/constants';

	interface Props {
		value: string | null;
		options: string[];
		triggerEl?: HTMLElement | null;
		onCommit: (val: string) => void;
		onCancel: () => void;
	}

	let { value, options, triggerEl = null, onCommit, onCancel }: Props = $props();

	let search = $state('');
	let highlightIndex = $state(0);
	let popoverEl: HTMLElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);

	let floatingStyle = $state('top: 0px; left: 0px; display: none;');
	let isFlipped = $state(false);

	let filteredOptions = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const list = options.filter((opt) => opt && opt.trim().length > 0);
		if (!q) return list;
		return list.filter((opt) => opt.toLowerCase().includes(q));
	});

	let showCreate = $derived.by(() => {
		const q = search.trim();
		if (!q) return false;
		return !options.some((opt) => opt.toLowerCase() === q.toLowerCase());
	});

	function updatePosition() {
		if (!triggerEl || !popoverEl) return;
		const triggerRect = triggerEl.getBoundingClientRect();
		const cellWidth = Math.round(triggerRect.width);
		const layerRect = {
			width: cellWidth,
			height: popoverEl.offsetHeight || 190
		};
		const viewport = {
			width: window.innerWidth,
			height: window.innerHeight
		};

		const pos = computeFloatingPosition(triggerRect, layerRect, viewport, {
			offset: 0,
			margin: 4,
			preferPlacement: 'bottom'
		});

		isFlipped = pos.isFlipped;
		floatingStyle = `position: fixed; top: ${pos.top}px; left: ${pos.left}px; width: ${cellWidth}px; max-height: ${pos.maxHeight}px; z-index: 1050;`;
	}

	onMount(() => {
		requestAnimationFrame(() => {
			inputEl?.focus();
			inputEl?.select();
		});
		updatePosition();

		function handleWindowResizeOrScroll() {
			updatePosition();
		}

		function handleDocumentClick(e: MouseEvent) {
			const target = e.target as Node | null;
			if (popoverEl && !popoverEl.contains(target) && (!triggerEl || !triggerEl.contains(target))) {
				commitSelectedOrCurrent();
			}
		}

		window.addEventListener('resize', handleWindowResizeOrScroll);
		window.addEventListener('scroll', handleWindowResizeOrScroll, true);
		document.addEventListener('mousedown', handleDocumentClick);

		return () => {
			window.removeEventListener('resize', handleWindowResizeOrScroll);
			window.removeEventListener('scroll', handleWindowResizeOrScroll, true);
			document.removeEventListener('mousedown', handleDocumentClick);
		};
	});

	$effect(() => {
		if (filteredOptions.length > 0 || showCreate) {
			updatePosition();
		}
	});

	function commitSelectedOrCurrent() {
		if (search.trim() && showCreate) {
			onCommit(search.trim());
		} else if (filteredOptions.length > 0 && highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
			onCommit(filteredOptions[highlightIndex]);
		} else {
			onCommit(value || '');
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		handleComboboxKeydown(e, {
			items: filteredOptions,
			query: search,
			highlightIndex,
			getItemLabel: (item) => item,
			onHighlight: (idx) => {
				highlightIndex = idx;
			},
			onSelect: (item) => {
				onCommit(item);
			},
			onCreate: (newOption) => {
				onCommit(newOption);
			},
			onCancel: () => {
				onCancel();
			}
		});
	}
</script>

<!-- Cell-width matching dropdown popover with full-width items -->
<div
	bind:this={popoverEl}
	class="status-cell-popover custom-dropdown-popover bg-[var(--surface-1)] border border-[var(--border-strong)] rounded shadow-xl flex flex-col overflow-hidden text-[13px]"
	style={floatingStyle}
	role="dialog"
	aria-label="Dropdown selection"
	tabindex="-1"
>
	<!-- Search / Filter Input -->
	<div class="status-search-header flex items-center px-2 py-1.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
		<input
			bind:this={inputEl}
			type="text"
			class="cell-input cell-input-editor dropdown-search-input flex-1 bg-transparent border-none outline-none text-[var(--text-1)] text-[12.5px] placeholder:text-[var(--text-3)] p-0"
			placeholder="Search or type new..."
			aria-label="Search or add option"
			bind:value={search}
			onkeydown={handleKeyDown}
		/>
		<span class="status-arrow-indicator text-[9px] text-[var(--text-3)] select-none opacity-40 ml-1 font-mono" aria-hidden="true">{isFlipped ? '▲' : '▼'}</span>
	</div>

	<!-- Options List (Full Width) -->
	<div class="status-options-list max-h-48 overflow-y-auto p-1 flex flex-col gap-1 bg-[var(--surface-1)]" role="listbox" aria-label="Dropdown options">
		<!-- Clear Option -->
		<button
			type="button"
			class="dropdown-opt-btn clear-opt-btn flex items-center justify-between px-2.5 py-1.5 border-none bg-transparent cursor-pointer text-left w-full text-[12.5px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors {highlightIndex === -1 ? 'highlighted bg-[var(--surface-hover)] !text-[var(--text-1)]' : ''}"
			role="option"
			aria-selected={value === '' || value === null}
			onclick={() => onCommit('')}
		>
			<span class="dropdown-opt-text empty-text">Clear (empty)</span>
			<span class="clear-icon text-[11px] opacity-40" aria-hidden="true">✕</span>
		</button>

		{#each filteredOptions as opt, idx (opt)}
			{@const style = getDropdownStyle(opt)}
			{@const isSelected = (value || '').toLowerCase() === opt.toLowerCase()}
			{@const isHighlighted = highlightIndex === idx}

			<button
				type="button"
				class="dropdown-opt-btn flex items-center justify-between px-2.5 py-1.5 border cursor-pointer text-left w-full text-[12.5px] font-medium rounded transition-colors {isHighlighted ? 'highlighted brightness-110' : ''} {isSelected ? 'active' : ''}"
				style="background: {style.bg}; color: {style.text}; border-color: {style.border};"
				role="option"
				aria-selected={isSelected}
				onclick={() => onCommit(opt)}
				onmouseenter={() => (highlightIndex = idx)}
			>
				<span class="truncate">{opt}</span>
				{#if isSelected}
					<span class="check-icon font-bold text-[12px] ml-1 shrink-0" style="color: {style.text};" aria-hidden="true">✓</span>
				{/if}
			</button>
		{/each}

		{#if showCreate}
			{@const newStyle = getDropdownStyle(search.trim())}
			<button
				type="button"
				class="dropdown-opt-btn create-btn flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-[var(--border)] cursor-pointer text-left w-full text-[12.5px] font-medium rounded transition-colors {highlightIndex === filteredOptions.length ? 'highlighted brightness-110' : ''}"
				style="background: {newStyle.bg}; color: {newStyle.text}; border-color: {newStyle.border};"
				role="option"
				aria-selected={false}
				onclick={() => onCommit(search.trim())}
				onmouseenter={() => (highlightIndex = filteredOptions.length)}
			>
				<span class="create-label text-[11px] font-bold shrink-0" style="color: {newStyle.text};">+ Add</span>
				<span class="truncate">{search.trim()}</span>
			</button>
		{/if}
	</div>
</div>
