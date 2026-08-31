<script lang="ts">
	import Icon from './Icons.svelte';
	import { columnLetter, sheetRowNumber } from '$lib/table/formulas';
	import type { FindStore } from '$lib/table/find.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { NotifyFn } from '$lib/ui/toast.svelte';

	let {
		findStore,
		store,
		onNotify,
		onClose
	}: {
		findStore: FindStore;
		store: ReturnType<typeof createTableStore>;
		onNotify: NotifyFn;
		onClose: () => void;
	} = $props();

	let findInputRef = $state<HTMLInputElement | null>(null);
	let replaceInputRef = $state<HTMLInputElement | null>(null);

	// Focus find input whenever drawer is opened
	$effect(() => {
		if (findStore.isOpen) {
			requestAnimationFrame(() => {
				findInputRef?.focus();
				findInputRef?.select();
			});
		}
	});

	function handleFindKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) {
				findStore.prevMatch();
			} else {
				findStore.nextMatch();
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	function handleReplaceKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			handleReplace();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	function handleReplace() {
		const res = findStore.replaceCurrent();
		if (res.success && res.match) {
			onNotify('success', `Replaced 1 occurrence in ${res.match.displayAddress}.`);
		} else if (res.formulaProtected) {
			onNotify('warning', 'Formulas are protected when searching values. Switch Look In to Formulas to edit formulas.');
		} else {
			onNotify('info', 'No active match to replace.');
		}
	}

	function handleReplaceAll() {
		const res = findStore.replaceAll();
		if (res.replacedCount > 0) {
			const scopeLabel = findStore.options.scope === 'selection' ? 'selection' : 'sheet';
			onNotify(
				'success',
				`Replaced ${res.replacedCount} of ${res.totalMatches} match(es) across ${scopeLabel}. Undo with ⌘Z.`
			);
		} else if (res.formulaProtectedCount > 0) {
			onNotify('warning', 'Formula cells were skipped. Switch Look In to Formulas to replace inside formulas.');
		} else {
			onNotify('info', 'No matching cells were replaced.');
		}
	}

	const isRangeSelected = $derived(store.selectionKeys.size > 1);

	const rangeLabel = $derived.by<string>(() => {
		const rect = store.selectionRect;
		if (!rect) return '';
		const c0Letter = columnLetter(rect.c0);
		const c1Letter = columnLetter(rect.c1);
		const r0Num = sheetRowNumber(rect.r0);
		const r1Num = sheetRowNumber(rect.r1);
		if (rect.r0 === rect.r1 && rect.c0 === rect.c1) {
			return `${c0Letter}${r0Num}`;
		}
		if (rect.c0 === rect.c1 && rect.r0 === 0 && rect.r1 === store.filteredRows.length - 1) {
			const col = store.columns[rect.c0];
			return `Col ${col?.name || c0Letter}`;
		}
		return `${c0Letter}${r0Num}:${c1Letter}${r1Num}`;
	});

	// Auto-switch to 'selection' scope when the user selects more than one cell while the
	// drawer is open. Keyed off the rectangle rather than the cell set, which can run to
	// thousands of entries on a whole-column selection.
	let lastSelectionKey = '';
	$effect(() => {
		const rect = store.selectionRect;
		if (!rect) return;
		const key = `${rect.r0}:${rect.r1}:${rect.c0}:${rect.c1}`;
		if (key === lastSelectionKey) return;
		lastSelectionKey = key;
		if (store.selectionKeys.size > 1 && findStore.isOpen) findStore.setScope('selection');
	});
</script>

<aside
	class="find-replace-drawer relative h-full bg-[var(--surface-1)] border-l border-[var(--border-strong)] z-10 flex flex-col shrink-0 overflow-hidden transition-all duration-200 ease-out {findStore.isOpen ? 'open w-[380px] max-w-[420px] opacity-100 visible' : 'closed w-0 border-l-transparent opacity-0 pointer-events-none invisible'} max-sm:fixed max-sm:inset-0 max-sm:w-full max-sm:z-50"
	aria-label="Find and Replace"
>
	<div class="find-replace-drawer-inner w-[380px] min-w-[380px] h-full flex flex-col overflow-hidden bg-[var(--surface-1)]">
		<!-- Header -->
		<div
			class="drawer-header flex items-center justify-between px-3.5 py-3 border-b border-[var(--border)] bg-[var(--surface-1)] shrink-0"
		>
			<div class="flex items-center gap-2">
				<div
					class="w-6 h-6 rounded-md bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] flex items-center justify-center"
				>
					<Icon name="search" size={13} strokeWidth={2.4} aria-hidden="true" />
				</div>
				<span class="text-[13px] font-semibold text-[var(--text-1)]">Find & Replace</span>
			</div>

			<div class="flex items-center gap-2">
				{#if findStore.matchCount > 0}
					<span
						class="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border border-[var(--accent-amber-border)]"
					>
						{findStore.activeMatchIndex + 1} of {findStore.matchCount}
					</span>
				{:else if findStore.regexError}
					<span class="text-[11px] font-mono text-[var(--accent-rose)] px-2 py-0.5 rounded bg-[var(--accent-rose-bg)]">
						Regex error
					</span>
				{:else if findStore.query.trim()}
					<span class="text-[11px] font-mono text-[var(--text-3)] px-2 py-0.5 rounded bg-[var(--surface-3)]">
						0 matches
					</span>
				{/if}
			</div>
		</div>

		<!-- Body -->
		<div class="drawer-body flex-1 overflow-y-auto p-3.5 flex flex-col gap-3.5">
			<!-- Find Section -->
			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<label for="find-drawer-input" class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
						Find
					</label>
					<div class="flex items-center gap-1">
						<button
							class="w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors {findStore.options.matchCase
								? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)]'
								: 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'}"
							onclick={() => findStore.toggleOption('matchCase')}
							title="Match Case (Case Sensitive)"
							aria-label="Match Case"
							aria-pressed={findStore.options.matchCase}
						>
							<span class="text-[10.5px] font-mono font-bold">Aa</span>
						</button>
						<button
							class="w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors {findStore.options.wholeCell
								? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)]'
								: 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'}"
							onclick={() => findStore.toggleOption('wholeCell')}
							title="Match Entire Cell"
							aria-label="Match Entire Cell"
							aria-pressed={findStore.options.wholeCell}
						>
							<span class="text-[10.5px] font-mono font-bold">[ab]</span>
						</button>
						<button
							class="w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors {findStore.options.useRegex
								? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)]'
								: 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'}"
							onclick={() => findStore.toggleOption('useRegex')}
							title="Regular Expression"
							aria-label="Use Regular Expression"
							aria-pressed={findStore.options.useRegex}
						>
							<span class="text-[10.5px] font-mono font-bold">.*</span>
						</button>
					</div>
				</div>

				<div class="relative flex items-center">
					<input
						id="find-drawer-input"
						bind:this={findInputRef}
						type="text"
						placeholder="Find in sheet…"
						class="w-full h-8 px-2.5 pr-8 bg-[var(--surface-2)] border {findStore.regexError ? 'border-[var(--accent-rose)]' : 'border-[var(--border)]'} rounded-md text-[12.5px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-primary)] focus:bg-[var(--surface-1)] transition-colors"
						value={findStore.query}
						oninput={(e) => findStore.setQuery((e.target as HTMLInputElement).value)}
						onkeydown={handleFindKeydown}
					/>
					{#if findStore.query}
						<button
							class="absolute right-2 text-[var(--text-3)] hover:text-[var(--text-1)] text-[12px] cursor-pointer bg-transparent border-none"
							onclick={() => findStore.setQuery('')}
							aria-label="Clear search"
						>
							✕
						</button>
					{/if}
				</div>
				{#if findStore.regexError}
					<span class="text-[11px] text-[var(--accent-rose)] leading-tight px-0.5">
						{findStore.regexError}
					</span>
				{/if}
			</div>

			<!-- Replace Section -->
			<div class="flex flex-col gap-1.5">
				<label for="replace-drawer-input" class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
					Replace With
				</label>
				<div class="relative flex items-center">
					<input
						id="replace-drawer-input"
						bind:this={replaceInputRef}
						type="text"
						placeholder="Replace with…"
						class="w-full h-8 px-2.5 pr-8 bg-[var(--surface-2)] border border-[var(--border)] rounded-md text-[12.5px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-primary)] focus:bg-[var(--surface-1)] transition-colors"
						value={findStore.replaceText}
						oninput={(e) => findStore.setReplaceText((e.target as HTMLInputElement).value)}
						onkeydown={handleReplaceKeydown}
					/>
					{#if findStore.replaceText}
						<button
							class="absolute right-2 text-[var(--text-3)] hover:text-[var(--text-1)] text-[12px] cursor-pointer bg-transparent border-none"
							onclick={() => findStore.setReplaceText('')}
							aria-label="Clear replacement"
						>
							✕
						</button>
					{/if}
				</div>

				<div class="flex items-center gap-2 mt-1">
					<button
						class="flex-1 h-7 rounded-md bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[12px] font-semibold text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
						disabled={findStore.matchCount === 0}
						onclick={handleReplace}
						title="Replace active match (⌘↵)"
					>
						Replace
					</button>
					<button
						class="flex-1 h-7 rounded-md bg-[var(--accent-primary)] border border-transparent text-[var(--text-inverse)] hover:brightness-110 text-[12px] font-semibold cursor-pointer transition-all disabled:opacity-35 disabled:cursor-not-allowed shadow-sm"
						disabled={findStore.matchCount === 0}
						onclick={handleReplaceAll}
						title="Replace all matches in scope"
					>
						Replace All
					</button>
				</div>
			</div>

			<!-- Scope Segmented Toggle -->
			<div class="flex flex-col gap-1.5 pt-1 border-t border-[var(--border)]">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
						Scope
					</span>
					{#if rangeLabel && findStore.options.scope === 'selection'}
						<span class="text-[10.5px] font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)]">
							{rangeLabel}
						</span>
					{/if}
				</div>
				<div class="flex items-center p-0.5 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] gap-1">
					<button
						type="button"
						class="flex-1 py-1 px-2 rounded-md text-[11.5px] font-medium transition-all cursor-pointer {findStore.options.scope === 'sheet'
							? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-xs font-semibold border border-[var(--border)]'
							: 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] border border-transparent'}"
						onclick={() => findStore.setScope('sheet')}
					>
						Entire Sheet
					</button>
					<button
						type="button"
						class="flex-1 py-1 px-2 rounded-md text-[11.5px] font-medium transition-all cursor-pointer {findStore.options.scope === 'selection'
							? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)] shadow-xs font-semibold'
							: 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] border border-transparent'} disabled:opacity-35 disabled:cursor-not-allowed"
						disabled={!isRangeSelected}
						onclick={() => findStore.setScope('selection')}
						title={isRangeSelected ? `Search inside ${rangeLabel}` : 'Select a range or column first'}
					>
						In Selection {rangeLabel ? `(${rangeLabel})` : ''}
					</button>
				</div>
			</div>

			<!-- Look In Selector -->
			<div class="flex flex-col gap-1">
				<label for="find-lookin-select" class="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
					Look In
				</label>
				<select
					id="find-lookin-select"
					class="h-7 px-2 bg-[var(--surface-2)] border border-[var(--border)] rounded text-[11.5px] text-[var(--text-1)] outline-none cursor-pointer focus:border-[var(--accent-primary)]"
					value={findStore.options.lookIn}
					onchange={(e) => findStore.setLookIn((e.target as HTMLSelectElement).value as 'values' | 'formulas')}
				>
					<option value="values">Values (Evaluated results)</option>
					<option value="formulas">Formulas (Raw formula strings)</option>
				</select>
			</div>

			<!-- Live Matches List -->
			<div class="flex-1 min-h-[140px] flex flex-col gap-1.5 pt-1 border-t border-[var(--border)] overflow-hidden">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
						Matches ({findStore.matchCount})
					</span>
					<div class="flex items-center gap-1">
						<button
							class="h-6 px-1.5 rounded flex items-center gap-1 bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
							disabled={findStore.matchCount === 0}
							onclick={() => findStore.prevMatch()}
							title="Previous match (⇧↵)"
							aria-label="Previous match"
						>
							<Icon name="chevron-up" size={12} aria-hidden="true" />
						</button>
						<button
							class="h-6 px-1.5 rounded flex items-center gap-1 bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
							disabled={findStore.matchCount === 0}
							onclick={() => findStore.nextMatch()}
							title="Next match (↵)"
							aria-label="Next match"
						>
							<Icon name="chevron-down" size={12} aria-hidden="true" />
						</button>
					</div>
				</div>

				<div
					class="flex-1 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1 flex flex-col gap-0.5"
					role="listbox"
					aria-label="Matches"
				>
					{#if findStore.matchCount === 0}
						<div class="h-full flex items-center justify-center p-4 text-[12px] text-[var(--text-3)] text-center">
							{#if findStore.regexError}
								<span class="text-[var(--accent-rose)]">Invalid regular expression</span>
							{:else if findStore.query.trim()}
								No matching cells found
							{:else}
								Type a query to search
							{/if}
						</div>
					{:else}
						{#each findStore.matches as match, i (match.rowId + '::' + match.columnId)}
							{@const isActive = i === findStore.activeMatchIndex}
							<button
								role="option"
								aria-selected={isActive}
								class="flex items-center justify-between w-full px-2 py-1.5 rounded text-left border-none cursor-pointer transition-colors {isActive
									? 'bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] font-semibold shadow-xs'
									: 'bg-transparent text-[var(--text-1)] hover:bg-[var(--surface-hover)]'}"
								onclick={() => findStore.selectMatch(i)}
								aria-label="Match in {match.displayAddress}"
							>
								<div class="flex items-center gap-2 min-w-0">
									<span
										class="font-mono text-[11px] px-1 rounded {isActive
											? 'bg-[var(--accent-amber)] text-black'
											: 'bg-[var(--surface-3)] text-[var(--text-2)]'}"
									>
										{match.displayAddress}
									</span>
									<span class="text-[12px] truncate max-w-[140px] text-[var(--text-2)]">
										{match.colName}
									</span>
								</div>
								<span
									class="font-mono text-[11px] truncate max-w-[100px] {isActive
										? 'text-[var(--accent-amber)]'
										: 'text-[var(--text-3)]'}"
								>
									{match.value}
								</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="px-3.5 py-2 border-t border-[var(--border)] bg-[var(--surface-2)] text-[11px] text-[var(--text-3)] flex items-center justify-between">
			<div class="flex items-center gap-2 font-mono text-[10px]">
				<span>↵ Next</span>
				<span>⇧↵ Prev</span>
				<span>Esc Close</span>
			</div>
			<span>⌘Z Undo</span>
		</div>
	</div>
</aside>
