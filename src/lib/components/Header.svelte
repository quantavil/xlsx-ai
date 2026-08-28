<script lang="ts">
	import Icon from './Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import { sampleTables } from '$lib/data/index';
	import { handleMenuKeydown } from '$lib/ui/menu';

	let {
		store,
		onNotify
	}: {
		store: ReturnType<typeof createTableStore>;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
	} = $props();

	let isEditingTitle = $state(false);
	let titleInputValue = $state('');
	let showSampleMenu = $state(false);
	let searchInputRef = $state<HTMLInputElement | null>(null);
	let sampleBtnRef = $state<HTMLButtonElement | null>(null);
	let sampleMenuItemsRef = $state<HTMLButtonElement[]>([]);
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;

	function startEditTitle() {
		titleInputValue = store.title;
		isEditingTitle = true;
	}

	function saveTitle() {
		if (titleInputValue.trim()) {
			store.setTitle(titleInputValue.trim());
		}
		isEditingTitle = false;
	}

	function handleTitleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveTitle();
		if (e.key === 'Escape') isEditingTitle = false;
	}

	function requestLoadSample(key: 'saas' | 'sales' | 'inventory') {
		showSampleMenu = false;
		// Pony: no confirmation modal — instant load, undo via Ctrl+Z
		store.loadTable(sampleTables[key]);
		onNotify('success', `Loaded "${sampleTables[key].title}" sample dataset.`);
	}

	export function focusSearch() {
		searchInputRef?.focus();
		searchInputRef?.select();
	}

	function handleDocumentClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.dropdown-wrapper')) {
			showSampleMenu = false;
		}
	}

	function handleSampleMenuKeyDown(e: KeyboardEvent) {
		const items = sampleMenuItemsRef.filter(Boolean);
		const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
		handleMenuKeydown(e, {
			itemCount: items.length,
			activeIndex: currentIndex,
			onHighlight: (idx) => items[idx]?.focus(),
			onSelect: (idx) => items[idx]?.click(),
			onClose: () => {
				showSampleMenu = false;
				sampleBtnRef?.focus();
			}
		});
	}

	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		if (searchDebounce) clearTimeout(searchDebounce);
		// #7 Debounce heavy filteredRows scan (10k×100)
		searchDebounce = setTimeout(() => store.setSearchQuery(val), 200);
		// allow instant clear without delay
		if (!val) {
			if (searchDebounce) clearTimeout(searchDebounce);
			store.setSearchQuery('');
		}
	}
</script>

<svelte:window onclick={handleDocumentClick} onkeydown={(e) => {
	if (e.key === 'Escape' && showSampleMenu) {
		showSampleMenu = false;
		sampleBtnRef?.focus();
	}
}} />

<header class="app-header flex items-center justify-between h-14 px-4 bg-[var(--surface-1)] border-b border-[var(--border)] gap-4 z-20 shrink-0 max-sm:h-auto max-sm:p-2.5 max-sm:gap-2 max-sm:flex-wrap">
	<!-- Left: Brand & Editable Table Title -->
	<div class="header-left flex items-center gap-3 min-w-0 shrink-0 max-sm:order-1">
		<div class="brand-badge flex items-center gap-2 select-none shrink-0">
			<div class="brand-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent-primary)] text-white shrink-0 shadow-sm" aria-hidden="true">
				<Icon name="table" size={16} strokeWidth={2.2} />
			</div>
			<span class="brand-name font-bold text-[14.5px] tracking-tight text-[var(--text-1)] whitespace-nowrap">Table AI</span>
		</div>

		<div class="divider-v w-px h-5 bg-[var(--border)] shrink-0" aria-hidden="true"></div>

		<div class="title-container min-w-0 flex items-center">
			{#if isEditingTitle}
				<input
					type="text"
					class="title-input bg-[var(--surface-2)] border-2 border-[var(--border-focus)] rounded-md text-[var(--text-1)] font-semibold text-[13.5px] px-2.5 py-1 outline-none min-w-[220px] ring-2 ring-emerald-500/20"
					aria-label="Table Title"
					bind:value={titleInputValue}
					onblur={saveTitle}
					onkeydown={handleTitleKeyDown}
				/>
			{:else}
				<button
					class="title-button inline-flex items-center gap-1.5 bg-transparent border border-transparent px-2 py-1 rounded-md cursor-pointer text-[var(--text-1)] font-semibold text-[13.5px] tracking-tight hover:bg-[var(--surface-2)] hover:border-[var(--border)] transition-colors max-w-[280px] min-w-0"
					onclick={startEditTitle}
					title="Click to rename table"
					aria-label="Rename table"
				>
					<span class="title-text truncate max-w-[240px]">{store.title}</span>
					<span class="edit-icon flex opacity-40 hover:opacity-100 shrink-0 transition-opacity" aria-hidden="true">
						<Icon name="edit" size={12} />
					</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Center: Search & Sample Switcher -->
	<div class="header-center flex items-center gap-2.5 flex-1 justify-center min-w-0 max-w-[520px] max-sm:order-3 max-sm:w-full max-sm:max-w-full">
		<!-- Instant Search Bar -->
		<div class="search-box relative flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 h-9 flex-1 max-w-[340px] min-w-[160px] focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:bg-[var(--surface-1)] transition-all max-sm:max-w-full">
			<Icon name="search" size={14} class="search-icon opacity-50 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
			<input
				type="text"
				placeholder="Search all rows..."
				aria-label="Search all table rows"
				class="bg-transparent border-none outline-none text-[var(--text-1)] text-[13px] ml-2 w-full placeholder:text-[var(--text-3)] font-normal"
				bind:this={searchInputRef}
				value={store.searchQuery}
				oninput={handleSearchInput}
			/>
			{#if store.searchQuery}
				<button class="search-clear bg-[var(--surface-3)] border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--border-strong)] cursor-pointer text-[11px] w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors" onclick={() => store.setSearchQuery('')} aria-label="Clear search">✕</button>
			{:else}
				<kbd class="shortcut-kbd bg-[var(--surface-1)] border border-[var(--border)] border-b-2 rounded px-1.5 py-0.5 text-[10.5px] font-mono font-semibold text-[var(--text-2)] shrink-0" aria-hidden="true">⌘K</kbd>
			{/if}
		</div>

		<!-- Sample Data Selector -->
		<div class="dropdown-wrapper relative shrink-0">
			<button
				bind:this={sampleBtnRef}
				class="btn-tactile btn-ghost sample-btn inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-md cursor-pointer text-[var(--text-2)] hover:text-[var(--text-1)] bg-transparent hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--border)] transition-colors select-none"
				onclick={() => {
					showSampleMenu = !showSampleMenu;
					if (showSampleMenu) requestAnimationFrame(() => sampleMenuItemsRef[0]?.focus());
				}}
				onkeydown={(e) => {
					if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
						if (!showSampleMenu) {
							e.preventDefault();
							showSampleMenu = true;
							requestAnimationFrame(() => sampleMenuItemsRef[0]?.focus());
						}
					}
				}}
				aria-haspopup="menu"
				aria-expanded={showSampleMenu}
				title="Choose sample dataset"
			>
				<Icon name="layers" size={14} aria-hidden="true" />
				<span>Samples</span>
				<Icon name="chevron-down" size={12} aria-hidden="true" />
			</button>

			{#if showSampleMenu}
				<div
					class="dropdown-menu sample-menu bezel-card absolute top-[calc(100%+8px)] left-0 z-50 w-72 p-1.5 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-left animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)]"
					role="menu"
					tabindex="-1"
					onkeydown={handleSampleMenuKeyDown}
				>
					<button
						bind:this={sampleMenuItemsRef[0]}
						class="menu-item flex flex-col items-start w-full px-3 py-2 bg-transparent border-none rounded-lg cursor-pointer text-[var(--text-1)] text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={() => requestLoadSample('saas')}
					>
						<div class="item-title font-semibold text-[13px] text-[var(--text-1)]">SaaS Revenue</div>
						<div class="item-desc text-[11.5px] text-[var(--text-3)] mt-0.5 leading-tight">MRR, Accounts, Churn Risk, Plans (25 rows)</div>
					</button>
					<button
						bind:this={sampleMenuItemsRef[1]}
						class="menu-item flex flex-col items-start w-full px-3 py-2 bg-transparent border-none rounded-lg cursor-pointer text-[var(--text-1)] text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={() => requestLoadSample('sales')}
					>
						<div class="item-title font-semibold text-[13px] text-[var(--text-1)]">Sales Pipeline</div>
						<div class="item-desc text-[11.5px] text-[var(--text-3)] mt-0.5 leading-tight">Deal Value, Stage, Win Probability (25 rows)</div>
					</button>
					<button
						bind:this={sampleMenuItemsRef[2]}
						class="menu-item flex flex-col items-start w-full px-3 py-2 bg-transparent border-none rounded-lg cursor-pointer text-[var(--text-1)] text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={() => requestLoadSample('inventory')}
					>
						<div class="item-title font-semibold text-[13px] text-[var(--text-1)]">Hardware Inventory</div>
						<div class="item-desc text-[11.5px] text-[var(--text-3)] mt-0.5 leading-tight">SKU, Stock Levels, Unit Cost, Risks (25 rows)</div>
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Right: Undo/Redo & Live Metrics -->
	<div class="header-right flex items-center gap-3 shrink-0 max-sm:order-2 max-sm:ml-auto">
		<!-- Undo / Redo Buttons -->
		<div class="history-group flex items-center gap-0.5 bg-[var(--surface-2)] p-0.5 rounded-full border border-[var(--border)]">
			<button
				class="icon-btn flex items-center justify-center w-7 h-7 rounded-full text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
				disabled={!store.canUndo}
				onclick={() => store.undo()}
				title="Undo (Ctrl+Z)"
				aria-label="Undo"
			>
				<Icon name="undo" size={14} aria-hidden="true" />
			</button>
			<button
				class="icon-btn flex items-center justify-center w-7 h-7 rounded-full text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
				disabled={!store.canRedo}
				onclick={() => store.redo()}
				title="Redo (Ctrl+Y)"
				aria-label="Redo"
			>
				<Icon name="redo" size={14} aria-hidden="true" />
			</button>
		</div>

		<!-- Clean Live Data Stats Badge -->
		<div class="dataset-stats-badge hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[11.5px] text-[var(--text-2)] select-none" title="{store.filteredCount} visible rows across {store.columns.length} columns">
			<span class="stats-num font-mono font-bold text-[var(--text-1)]">{store.filteredCount}</span>
			<span class="stats-label text-[11px] text-[var(--text-3)]">{store.filteredCount === 1 ? 'row' : 'rows'}</span>
			<span class="stats-dot text-[var(--text-3)] mx-0.5" aria-hidden="true">·</span>
			<span class="stats-num font-mono font-bold text-[var(--text-1)]">{store.columns.length}</span>
			<span class="stats-label text-[11px] text-[var(--text-3)]">{store.columns.length === 1 ? 'col' : 'cols'}</span>
		</div>
	</div>
</header>
