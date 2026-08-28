<script lang="ts">
	import Icon from './Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { createDocumentStore } from '$lib/table/documents.svelte';
	import { handleMenuKeydown } from '$lib/ui/menu';
	import type { CellAlign } from '$lib/types';

	let {
		store,
		documents,
		onOpenFile,
		onNewFile,
		onImportFile,
		onDeleteFile
	}: {
		store: ReturnType<typeof createTableStore>;
		documents: ReturnType<typeof createDocumentStore>;
		onOpenFile: (id: string) => void;
		onNewFile: () => void;
		onImportFile: () => void;
		onDeleteFile: (id: string) => void;
	} = $props();

	let isEditingTitle = $state(false);
	let titleInputValue = $state('');
	let showFileMenu = $state(false);
	let searchInputRef = $state<HTMLInputElement | null>(null);
	let filesBtnRef = $state<HTMLButtonElement | null>(null);
	let fileMenuItemsRef = $state<HTMLButtonElement[]>([]);
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;

	function startEditTitle() {
		titleInputValue = store.title;
		isEditingTitle = true;
	}

	function saveTitle() {
		if (titleInputValue.trim()) store.setTitle(titleInputValue.trim());
		isEditingTitle = false;
	}

	function handleTitleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveTitle();
		if (e.key === 'Escape') isEditingTitle = false;
	}

	export function focusSearch() {
		searchInputRef?.focus();
		searchInputRef?.select();
	}

	function closeMenu() {
		showFileMenu = false;
	}

	function handleDocumentClick(e: MouseEvent) {
		if (!(e.target as HTMLElement | null)?.closest('.files-wrapper')) closeMenu();
	}

	function handleFileMenuKeyDown(e: KeyboardEvent) {
		const items = fileMenuItemsRef.filter(Boolean);
		handleMenuKeydown(e, {
			itemCount: items.length,
			activeIndex: items.indexOf(document.activeElement as HTMLButtonElement),
			onHighlight: (idx) => items[idx]?.focus(),
			onSelect: (idx) => items[idx]?.click(),
			onClose: () => {
				closeMenu();
				filesBtnRef?.focus();
			}
		});
	}

	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		if (searchDebounce) clearTimeout(searchDebounce);
		if (!val) {
			store.setSearchQuery('');
			return;
		}
		// Debounce the full-table scan; instant clear is handled above.
		searchDebounce = setTimeout(() => store.setSearchQuery(val), 200);
	}

	const ALIGN_OPTIONS: Array<{ value: CellAlign; label: string; keys: string }> = [
		{ value: 'left', label: 'Align left', keys: '⌘⇧L' },
		{ value: 'center', label: 'Align center', keys: '⌘⇧E' },
		{ value: 'right', label: 'Align right', keys: '⌘⇧R' }
	];

	// Reflects the focused cell, so the control shows what the selection currently is.
	let currentAlign = $derived.by<CellAlign | null>(() => {
		const cell = store.activeCell;
		if (!cell) return null;
		const col = store.columns.find((c) => c.id === cell.columnId);
		if (!col) return null;
		return store.alignFor(cell.rowId, col.id, col.type);
	});

	function relativeTime(iso: string): string {
		const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
		if (!Number.isFinite(diffMin) || diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
		return `${Math.round(diffMin / 1440)}d ago`;
	}
</script>

<svelte:window
	onclick={handleDocumentClick}
	onkeydown={(e) => {
		if (e.key === 'Escape' && showFileMenu) {
			closeMenu();
			filesBtnRef?.focus();
		}
	}}
/>

<header
	class="app-header flex items-center justify-between h-12 px-3 bg-[var(--surface-1)] border-b border-[var(--border)] gap-3 z-20 shrink-0 max-sm:h-auto max-sm:p-2 max-sm:gap-2 max-sm:flex-wrap"
>
	<!-- Left: brand, file switcher, editable title -->
	<div class="header-left flex items-center gap-2 min-w-0 shrink-0 max-sm:order-1">
		<div
			class="brand-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent-primary)] text-white shrink-0 shadow-sm"
			title="xlsx-ai"
			aria-hidden="true"
		>
			<Icon name="table" size={16} strokeWidth={2.2} />
		</div>

		<div class="files-wrapper relative shrink-0">
			<button
				bind:this={filesBtnRef}
				class="files-btn inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] font-medium cursor-pointer border transition-colors {showFileMenu
					? 'bg-[var(--surface-3)] border-[var(--border-strong)] text-[var(--text-1)]'
					: 'bg-transparent border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)]'}"
				onclick={() => {
					showFileMenu = !showFileMenu;
					if (showFileMenu) requestAnimationFrame(() => fileMenuItemsRef[0]?.focus());
				}}
				onkeydown={(e) => {
					if (!showFileMenu && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
						e.preventDefault();
						showFileMenu = true;
						requestAnimationFrame(() => fileMenuItemsRef[0]?.focus());
					}
				}}
				aria-haspopup="menu"
				aria-expanded={showFileMenu}
				aria-label="Files"
			>
				<Icon name="layers" size={14} aria-hidden="true" />
				<span class="max-sm:hidden">Files</span>
				<span
					class="files-count text-[10.5px] font-mono font-semibold px-1 rounded bg-[var(--surface-3)] text-[var(--text-3)]"
					>{documents.documents.length}</span
				>
				<Icon name="chevron-down" size={12} aria-hidden="true" />
			</button>

			{#if showFileMenu}
				<div
					class="files-menu absolute top-[calc(100%+6px)] left-0 z-50 w-80 p-1.5 bg-[var(--surface-1)]/97 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-left animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)]"
					role="menu"
					tabindex="-1"
					onkeydown={handleFileMenuKeyDown}
				>
					<button
						bind:this={fileMenuItemsRef[0]}
						class="menu-item files-new flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-1)] text-[13px] font-medium text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={() => {
							closeMenu();
							onNewFile();
						}}
					>
						<Icon name="plus" size={14} aria-hidden="true" />
						<span>New blank file</span>
					</button>
					<button
						bind:this={fileMenuItemsRef[1]}
						class="menu-item files-import flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-1)] text-[13px] font-medium text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={() => {
							closeMenu();
							onImportFile();
						}}
					>
						<Icon name="upload" size={14} aria-hidden="true" />
						<span>Import spreadsheet…</span>
					</button>

					<div class="popover-divider h-px bg-[var(--border)] my-1.5"></div>

					<div class="max-h-[46vh] overflow-y-auto flex flex-col gap-0.5">
						{#each documents.documents as doc, i (doc.id)}
							{@const isActive = doc.id === documents.activeId}
							<div
								class="file-row group/file flex items-center gap-1 rounded-lg pr-1 {isActive
									? 'bg-emerald-500/10'
									: 'hover:bg-[var(--surface-hover)]'}"
							>
								<button
									bind:this={fileMenuItemsRef[i + 2]}
									class="file-open flex-1 flex items-center gap-2.5 min-w-0 px-2.5 py-2 bg-transparent border-none cursor-pointer text-left rounded-lg"
									role="menuitem"
									onclick={() => {
										closeMenu();
										onOpenFile(doc.id);
									}}
								>
									<Icon
										name="file-spreadsheet"
										size={14}
										class={isActive ? 'text-[var(--accent-primary)]' : 'text-[var(--text-3)]'}
										aria-hidden="true"
									/>
									<span class="flex flex-col min-w-0">
										<span
											class="text-[13px] truncate {isActive
												? 'font-semibold text-[var(--accent-primary)]'
												: 'font-medium text-[var(--text-1)]'}">{doc.title}</span
										>
										<span class="text-[10.5px] text-[var(--text-3)]">{relativeTime(doc.updatedAt)}</span>
									</span>
								</button>
								<button
									class="file-delete w-6 h-6 shrink-0 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-3)] hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 transition-opacity"
									onclick={(e) => {
										e.stopPropagation();
										onDeleteFile(doc.id);
									}}
									aria-label="Delete {doc.title}"
								>
									<Icon name="trash" size={12} aria-hidden="true" />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div class="title-container min-w-0 flex items-center">
			{#if isEditingTitle}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					class="title-input bg-[var(--surface-2)] border border-[var(--border-focus)] rounded-md text-[var(--text-1)] font-semibold text-[13px] px-2 h-8 outline-none min-w-[220px]"
					aria-label="File name"
					autofocus
					bind:value={titleInputValue}
					onblur={saveTitle}
					onkeydown={handleTitleKeyDown}
				/>
			{:else}
				<button
					class="title-button inline-flex items-center bg-transparent border border-transparent px-2 h-8 rounded-md cursor-text text-[var(--text-1)] font-semibold text-[13px] tracking-tight hover:bg-[var(--surface-2)] transition-colors max-w-[280px] min-w-0"
					onclick={startEditTitle}
					aria-label="Rename file"
				>
					<span class="title-text truncate max-w-[260px]">{store.title}</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Center: search -->
	<div
		class="header-center flex items-center flex-1 justify-center min-w-0 max-w-[420px] max-sm:order-3 max-sm:w-full max-sm:max-w-full"
	>
		<div
			class="search-box relative flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-2.5 h-8 flex-1 max-w-[340px] min-w-[150px] focus-within:border-[var(--accent-primary)] focus-within:bg-[var(--surface-1)] transition-colors max-sm:max-w-full"
		>
			<Icon name="search" size={13} class="opacity-50 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
			<input
				type="text"
				placeholder="Search rows"
				aria-label="Search all table rows"
				class="bg-transparent border-none outline-none text-[var(--text-1)] text-[12.5px] ml-2 w-full placeholder:text-[var(--text-3)]"
				bind:this={searchInputRef}
				value={store.searchQuery}
				oninput={handleSearchInput}
			/>
			{#if store.searchQuery}
				<button
					class="search-clear bg-[var(--surface-3)] border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--border-strong)] cursor-pointer text-[11px] w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors"
					onclick={() => store.setSearchQuery('')}
					aria-label="Clear search">✕</button
				>
			{:else}
				<kbd
					class="shortcut-kbd bg-[var(--surface-1)] border border-[var(--border)] rounded px-1 py-0.5 text-[10px] font-mono font-semibold text-[var(--text-3)] shrink-0"
					aria-hidden="true">⌘K</kbd
				>
			{/if}
		</div>
	</div>

	<!-- Right: history + live counts -->
	<div class="header-right flex items-center gap-2 shrink-0 max-sm:order-2 max-sm:ml-auto">
		<div
			class="align-group flex items-center gap-0.5 p-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] max-sm:hidden"
			role="group"
			aria-label="Cell alignment"
		>
			{#each ALIGN_OPTIONS as opt (opt.value)}
				<button
					class="align-btn flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors disabled:opacity-25 disabled:cursor-not-allowed {currentAlign ===
					opt.value
						? 'bg-[var(--surface-1)] text-[var(--accent-primary)] shadow-sm'
						: 'text-[var(--text-3)] hover:text-[var(--text-1)]'}"
					disabled={!store.activeCell}
					aria-pressed={currentAlign === opt.value}
					aria-label="{opt.label} ({opt.keys})"
					onclick={() => store.alignSelection(opt.value)}
				>
					<Icon name="align-{opt.value}" size={13} aria-hidden="true" />
				</button>
			{/each}
		</div>

		<div class="history-group flex items-center gap-0.5">
			<button
				class="icon-btn flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors"
				disabled={!store.canUndo}
				onclick={() => store.undo()}
				aria-label="Undo"
			>
				<Icon name="undo" size={14} aria-hidden="true" />
			</button>
			<button
				class="icon-btn flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors"
				disabled={!store.canRedo}
				onclick={() => store.redo()}
				aria-label="Redo"
			>
				<Icon name="redo" size={14} aria-hidden="true" />
			</button>
		</div>

		<div
			class="dataset-stats-badge hidden sm:flex items-center gap-1 text-[11.5px] text-[var(--text-3)] select-none font-mono"
		>
			<span class="font-semibold text-[var(--text-2)]">{store.filteredCount}</span>
			<span>×</span>
			<span class="font-semibold text-[var(--text-2)]">{store.columns.length}</span>
		</div>
	</div>
</header>
