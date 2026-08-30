<script lang="ts">
	import Icon from './Icons.svelte';
	import { preloadData } from '$app/navigation';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { createModuleStore } from '$lib/modules/module-store.svelte';
	import type { WorkspaceModule } from '$lib/modules/types';
	import { downloadTableAsXlsx, exportTableToCsv } from '$lib/data/index';
	import { handleMenuKeydown } from '$lib/ui/menu';
	import type { NotifyFn } from '$lib/ui/toast.svelte';
	import type { TableData } from '$lib/types';

	let {
		store,
		moduleStore,
		theme,
		onToggleTheme,
		onOpenSettings,
		onNotify,
		onCreateFile
	}: {
		store: ReturnType<typeof createTableStore>;
		moduleStore?: ReturnType<typeof createModuleStore>;
		theme: 'dark' | 'light';
		onToggleTheme: () => void;
		onOpenSettings?: () => void;
		onNotify: NotifyFn;
		onCreateFile: (table: TableData) => void;
	} = $props();

	let moduleFileInputRefs = $state<Record<string, HTMLInputElement | null>>({});
	let moduleWarnings = $state<string[]>([]);
	let showWarnings = $state<boolean>(false);

	let showExportMenu = $state<boolean>(false);
	let isExporting = $state<boolean>(false);
	let exportBtnRef = $state<HTMLButtonElement | null>(null);
	let exportMenuItemsRef = $state<HTMLButtonElement[]>([]);

	async function handleModuleTrigger(mod: WorkspaceModule) {
		if (mod.requirements.gemini && (!store.apiKey || store.apiKey.trim().length < 20)) {
			onNotify('warning', `Google Gemini API key required for ${mod.name}. Please configure it in Settings.`);
			onOpenSettings?.();
			return;
		}
		moduleFileInputRefs[mod.id]?.click();
	}

	async function handleModuleFiles(e: Event, mod: WorkspaceModule) {
		const target = e.target as HTMLInputElement;
		const files = target.files ? Array.from(target.files) : [];
		if (files.length === 0 || !moduleStore) return;

		moduleWarnings = [];
		showWarnings = false;
		try {
			const result = await moduleStore.runModule(mod.id, files, {
				apiKey: store.apiKey,
				modelId: store.aiModel
			});

			if (result && result.table && result.table.columns.length > 0) {
				onCreateFile(result.table);
				onNotify('success', `Imported ${result.table.rows.length} row(s) via ${mod.name}.`);
				// One summary toast. A 40-row extraction can raise 40 warnings; firing one
				// toast each buries the screen and pushes the success message off-stack.
				const warnings = result.warnings ?? [];
				if (warnings.length > 0) {
					moduleWarnings = warnings;
					onNotify(
						'warning',
						`${warnings.length} row(s) need review after import.`,
						{ action: { label: 'Show', onClick: () => (showWarnings = true) } }
					);
				}
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Module processing failed.';
			// A module that asks the user something can be answered "no". That is an
			// outcome, not a fault, so it must not surface as a red error toast.
			onNotify((err as { name?: string })?.name === 'AbortError' ? 'info' : 'error', msg);
		} finally {
			target.value = '';
		}
	}

	async function handleExportExcel() {
		if (isExporting) return;
		isExporting = true;
		try {
			await downloadTableAsXlsx(
				{
					title: store.title,
					columns: store.columns,
					rows: store.rows,
					cellAlign: store.cellAlign
				},
				store.title
			);
			showExportMenu = false;
			onNotify('success', `Exported "${store.title}.xlsx" successfully.`);
		} catch {
			onNotify('error', 'Failed to export to Excel.');
		} finally {
			isExporting = false;
		}
	}

	async function handleExportCsv() {
		if (isExporting) return;
		isExporting = true;
		try {
			await exportTableToCsv(
				{
					title: store.title,
					columns: store.columns,
					// CSV has no formulas — a `.xlsx` keeps `=SUM(..)`, a `.csv` carries
					// what it computed. Passing store.rows here would escape the formula
					// to literal `'=SUM(..)` text via sanitizeCsvValue.
					rows: store.resolvedRows
				},
				store.title
			);
			showExportMenu = false;
			onNotify('success', `Exported "${store.title}.csv" successfully.`);
		} catch {
			onNotify('error', 'Failed to export to CSV.');
		} finally {
			isExporting = false;
		}
	}

	function handleRibbonWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.ribbon-export-wrapper')) {
			showExportMenu = false;
		}
	}

	function handleExportMenuKeyDown(e: KeyboardEvent) {
		const items = exportMenuItemsRef.filter(Boolean);
		const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
		handleMenuKeydown(e, {
			itemCount: items.length,
			activeIndex: currentIndex,
			onHighlight: (idx) => items[idx]?.focus(),
			onSelect: (idx) => items[idx]?.click(),
			onClose: () => {
				showExportMenu = false;
				exportBtnRef?.focus();
			}
		});
	}
</script>

<svelte:window onclick={handleRibbonWindowClick} onkeydown={(e) => {
	if (e.key === 'Escape' && showExportMenu) {
		showExportMenu = false;
		exportBtnRef?.focus();
	}
}} />

<!-- Right-End Tool Ribbon -->
<aside class="right-tool-ribbon w-12 h-full bg-[var(--surface-1)] border-l border-[var(--border)] flex flex-col justify-between items-center py-2.5 shrink-0 z-15 select-none max-sm:fixed max-sm:bottom-0 max-sm:inset-x-0 max-sm:w-full max-sm:h-[54px] max-sm:flex-row max-sm:border-l-0 max-sm:border-t max-sm:px-4 max-sm:z-50" aria-label="Quick Tools Ribbon">
	<!-- Hidden File Inputs for Modules -->
	{#if moduleStore}
		{#each moduleStore.enabledModules as mod (mod.id)}
			<input
				type="file"
				bind:this={moduleFileInputRefs[mod.id]}
				accept={mod.ribbon.fileInput.accept}
				multiple={mod.ribbon.fileInput.multiple}
				style="display: none;"
				onchange={(e) => handleModuleFiles(e, mod)}
			/>
		{/each}
	{/if}

	<!-- Long-running module progress. Without this a 30s Gemini extraction shows nothing but
	     a spinning glyph — the module store's progress messages went nowhere. -->
	{#if moduleStore?.runningModuleId}
		<div
			class="module-progress-banner fixed bottom-6 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--surface-1)] border border-[var(--border-strong)] shadow-2xl text-[12.5px] text-[var(--text-1)] max-w-[min(92vw,460px)]"
			role="status"
			aria-live="polite"
		>
			<Icon name="loader" size={14} class="animate-spin text-[var(--accent-primary)] shrink-0" aria-hidden="true" />
			<span class="truncate">{moduleStore.progressMessage || 'Working…'}</span>
			<button
				class="module-progress-cancel shrink-0 px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--surface-2)] text-[11.5px] font-semibold text-[var(--text-2)] hover:text-[var(--accent-rose)] hover:border-[var(--accent-rose-border)] cursor-pointer transition-colors"
				onclick={() => moduleStore?.cancelRun()}
			>
				Cancel
			</button>
		</div>
	{/if}

	<!-- Consolidated import warnings, opened from the summary toast -->
	{#if showWarnings && moduleWarnings.length > 0}
		<div
			class="module-warnings-panel fixed bottom-6 right-6 z-[950] w-[min(92vw,420px)] max-h-[46vh] flex flex-col rounded-xl bg-[var(--surface-1)] border border-[var(--accent-amber-border)] shadow-2xl overflow-hidden"
			role="dialog"
			aria-label="Import warnings"
		>
			<div class="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
				<span class="text-[12.5px] font-bold text-[var(--text-1)]">
					Rows needing review ({moduleWarnings.length})
				</span>
				<button
					class="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer transition-colors"
					onclick={() => (showWarnings = false)}
					aria-label="Close warnings"
				>
					<Icon name="x" size={13} aria-hidden="true" />
				</button>
			</div>
			<ul class="flex-1 overflow-y-auto p-2 m-0 list-none flex flex-col gap-1">
				{#each moduleWarnings as warning, i (i)}
					<li class="text-[11.5px] leading-snug text-[var(--text-2)] px-2 py-1.5 rounded bg-[var(--surface-2)]">
						{warning}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Top Group: Primary Tools -->
	<div class="ribbon-group ribbon-top flex flex-col items-center gap-2 w-full max-sm:flex-row max-sm:gap-3 max-sm:w-auto">
		<!-- AI Assistant Tool Button -->
		<button
			class="ribbon-btn btn-ai-ribbon relative group/ribbon w-[34px] h-[34px] rounded-md border flex items-center justify-center cursor-pointer transition-all {store.isAiOpen ? 'active !bg-[var(--accent-primary)] !text-[var(--text-inverse)] !border-[var(--accent-primary)] shadow-sm' : 'text-[var(--accent-primary)] bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)]'}"
			onclick={() => store.toggleAi()}
			aria-label="Toggle AI Assistant"
			aria-expanded={store.isAiOpen}
		>
			<Icon name="sparkles" size={17} aria-hidden="true" />
			{#if store.isAiOpen}
				<span class="ribbon-active-indicator absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-white" aria-hidden="true"></span>
			{/if}
			<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
				AI Assistant <kbd class="tooltip-kbd font-mono text-[10px] bg-[var(--surface-1)] border border-[var(--border)] px-1 py-0.5 rounded text-[var(--text-2)]">⌘/</kbd>
			</span>
		</button>

		<!-- Enabled Workspace Module Buttons -->
		{#if moduleStore}
			{#each moduleStore.enabledModules as mod (mod.id)}
				{@const isRunning = moduleStore.runningModuleId === mod.id}
				<button
					class="ribbon-btn relative group/ribbon w-[34px] h-[34px] rounded-md bg-transparent border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)] active:bg-[var(--surface-3)] flex items-center justify-center cursor-pointer transition-colors disabled:opacity-60"
					onclick={() => handleModuleTrigger(mod)}
					disabled={Boolean(moduleStore.runningModuleId)}
					aria-label={mod.ribbon.label}
				>
					{#if isRunning}
						<Icon name="loader" size={17} class="animate-spin text-[var(--accent-primary)]" aria-hidden="true" />
					{:else}
						<Icon name={mod.ribbon.icon} size={17} aria-hidden="true" />
					{/if}
					<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
						{mod.ribbon.label}
					</span>
				</button>
			{/each}
		{/if}

		<!-- Add Row Tool Button -->
		<button
			class="ribbon-btn relative group/ribbon w-[34px] h-[34px] rounded-md bg-transparent border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)] active:bg-[var(--surface-3)] flex items-center justify-center cursor-pointer transition-colors"
			onclick={() => {
				store.addRow();
				onNotify('info', 'Added new row.');
			}}
			aria-label="Add Row"
		>
			<Icon name="plus" size={17} aria-hidden="true" />
			<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
				Add Row <kbd class="tooltip-kbd font-mono text-[10px] bg-[var(--surface-1)] border border-[var(--border)] px-1 py-0.5 rounded text-[var(--text-2)]">⌘N</kbd>
			</span>
		</button>

		<!-- Export Tool Button & Dropdown -->
		<div class="ribbon-export-wrapper relative">
			<button
				bind:this={exportBtnRef}
				class="ribbon-btn relative group/ribbon w-[34px] h-[34px] rounded-md border flex items-center justify-center cursor-pointer transition-colors {showExportMenu ? 'active-menu bg-[var(--surface-3)] border-[var(--border-strong)] text-[var(--text-1)]' : 'bg-transparent border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)]'}"
				onclick={() => {
					showExportMenu = !showExportMenu;
					if (showExportMenu) requestAnimationFrame(() => exportMenuItemsRef[0]?.focus());
				}}
				onkeydown={(e) => {
					if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
						if (!showExportMenu) {
							e.preventDefault();
							showExportMenu = true;
							requestAnimationFrame(() => exportMenuItemsRef[0]?.focus());
						}
					}
				}}
				aria-label="Export Spreadsheet Options"
				aria-haspopup="menu"
				aria-expanded={showExportMenu}
				disabled={isExporting}
			>
				<Icon name="download" size={17} aria-hidden="true" />
				<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
					Export File
				</span>
			</button>

			{#if showExportMenu}
				<div
					class="ribbon-dropdown-menu bezel-card absolute right-[calc(100%+8px)] bottom-[-6px] w-48 p-1.5 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl z-50 origin-bottom-right animate-[ribbonMenuPop_120ms_cubic-bezier(0.16,1,0.3,1)] max-sm:right-auto max-sm:left-1/2 max-sm:bottom-[calc(100%+8px)] max-sm:-translate-x-1/2 max-sm:origin-bottom"
					role="menu"
					tabindex="-1"
					onkeydown={handleExportMenuKeyDown}
				>
					<button
						bind:this={exportMenuItemsRef[0]}
						class="ribbon-menu-item flex items-center gap-2.5 w-full p-2 bg-transparent border-none rounded-lg cursor-pointer text-[var(--text-1)] text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={handleExportExcel}
						disabled={isExporting}
					>
						<span class="menu-icon-wrap icon-excel w-7 h-7 rounded-md bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] flex items-center justify-center shrink-0"><Icon name="file-spreadsheet" size={14} aria-hidden="true" /></span>
						<div class="menu-item-text flex flex-col">
							<span class="menu-title text-[12.5px] font-semibold text-[var(--text-1)]">Excel (.xlsx)</span>
							<span class="menu-sub text-[10.5px] text-[var(--text-3)]">Standard workbook</span>
						</div>
					</button>
					<button
						bind:this={exportMenuItemsRef[1]}
						class="ribbon-menu-item flex items-center gap-2.5 w-full p-2 bg-transparent border-none rounded-lg cursor-pointer text-[var(--text-1)] text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] transition-colors"
						role="menuitem"
						onclick={handleExportCsv}
						disabled={isExporting}
					>
						<span class="menu-icon-wrap icon-csv w-7 h-7 rounded-md bg-[var(--accent-sky-bg)] text-[var(--accent-sky)] flex items-center justify-center shrink-0"><Icon name="file-text" size={14} aria-hidden="true" /></span>
						<div class="menu-item-text flex flex-col">
							<span class="menu-title text-[12.5px] font-semibold text-[var(--text-1)]">CSV (.csv)</span>
							<span class="menu-sub text-[10.5px] text-[var(--text-3)]">Plain text data</span>
						</div>
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Bottom Group: Theme & Settings -->
	<div class="ribbon-group ribbon-bottom flex flex-col items-center gap-2 w-full max-sm:flex-row max-sm:gap-3 max-sm:w-auto">
		<!-- Dark / Light Theme Toggle -->
		<button
			class="ribbon-btn theme-toggle-btn relative group/ribbon w-[34px] h-[34px] rounded-md bg-transparent border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)] active:bg-[var(--surface-3)] flex items-center justify-center cursor-pointer transition-colors"
			onclick={onToggleTheme}
			aria-label="Toggle Theme"
		>
			{#if theme === 'dark'}
				<Icon name="sun" size={17} aria-hidden="true" />
				<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">Light Mode</span>
			{:else}
				<Icon name="moon" size={17} aria-hidden="true" />
				<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">Dark Mode</span>
			{/if}
		</button>

		<!-- Settings Page Trigger -->
		{#if onOpenSettings}
			<button
				class="ribbon-btn settings-toggle-btn relative group/ribbon w-[34px] h-[34px] rounded-md bg-transparent border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)] active:bg-[var(--surface-3)] flex items-center justify-center cursor-pointer transition-colors"
				onclick={onOpenSettings}
				onmouseenter={() => preloadData('/settings')}
				aria-label="Open Settings"
			>
				<Icon name="settings" size={17} aria-hidden="true" />
				<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
					Settings <kbd class="tooltip-kbd font-mono text-[10px] bg-[var(--surface-1)] border border-[var(--border)] px-1 py-0.5 rounded text-[var(--text-2)]">⌘,</kbd>
				</span>
			</button>
		{/if}
	</div>
</aside>
