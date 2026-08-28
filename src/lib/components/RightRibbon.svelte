<script lang="ts">
	import Icon from './Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { createModuleStore } from '$lib/modules/module-store.svelte';
	import type { WorkspaceModule } from '$lib/modules/types';
	import { importFileToTable, exportTableToExcel, exportTableToCsv } from '$lib/data/index';
	import { handleMenuKeydown } from '$lib/ui/menu';

	let {
		store,
		moduleStore,
		theme,
		onToggleTheme,
		onOpenSettings,
		onNotify
	}: {
		store: ReturnType<typeof createTableStore>;
		moduleStore?: ReturnType<typeof createModuleStore>;
		theme: 'dark' | 'light';
		onToggleTheme: () => void;
		onOpenSettings?: () => void;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
	} = $props();

	let moduleFileInputRefs = $state<Record<string, HTMLInputElement | null>>({});

	let fileInputRef = $state<HTMLInputElement | null>(null);
	let showExportMenu = $state<boolean>(false);
	let isExporting = $state<boolean>(false);
	let exportBtnRef = $state<HTMLButtonElement | null>(null);
	let exportMenuItemsRef = $state<HTMLButtonElement[]>([]);

	async function handleFileUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		try {
			const imported = await importFileToTable(file);
			store.loadTable(imported);
			onNotify('success', `Imported "${file.name}" (${imported.rows.length} rows, ${imported.columns.length} columns).`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to import file.';
			onNotify('error', msg);
		} finally {
			target.value = '';
		}
	}

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

		try {
			const result = await moduleStore.runModule(mod.id, files, {
				apiKey: store.apiKey,
				modelId: store.aiModel
			});

			if (result && result.table && result.table.columns.length > 0) {
				store.loadTable(result.table);
				onNotify('success', `Imported ${result.table.rows.length} row(s) via ${mod.name}.`);
				if (result.warnings && result.warnings.length > 0) {
					for (const w of result.warnings) {
						onNotify('warning', w);
					}
				}
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Module processing failed.';
			onNotify('error', msg);
		} finally {
			target.value = '';
		}
	}

	async function handleExportExcel() {
		if (isExporting) return;
		isExporting = true;
		try {
			await exportTableToExcel(
				{
					title: store.title,
					columns: store.columns,
					rows: store.rows
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
					rows: store.rows
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
	<!-- Hidden File Input for Import -->
	<input
		type="file"
		bind:this={fileInputRef}
		accept=".xlsx, .xls, .csv, .tsv"
		style="display: none;"
		onchange={handleFileUpload}
	/>

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

	<!-- Top Group: Primary Tools -->
	<div class="ribbon-group ribbon-top flex flex-col items-center gap-2 w-full max-sm:flex-row max-sm:gap-3 max-sm:w-auto">
		<!-- AI Assistant Tool Button -->
		<button
			class="ribbon-btn btn-ai-ribbon relative group/ribbon w-[34px] h-[34px] rounded-md border flex items-center justify-center cursor-pointer transition-all {store.isAiOpen ? 'active !bg-[var(--accent-primary)] !text-white !border-[var(--accent-primary)] shadow-sm' : 'text-[var(--accent-primary)] bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)]'}"
			onclick={() => store.toggleAi()}
			title="Toggle AI Assistant (Ctrl+/)"
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
					title={mod.ribbon.label}
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
			title="Add Row (Ctrl+N)"
			aria-label="Add Row"
		>
			<Icon name="plus" size={17} aria-hidden="true" />
			<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
				Add Row <kbd class="tooltip-kbd font-mono text-[10px] bg-[var(--surface-1)] border border-[var(--border)] px-1 py-0.5 rounded text-[var(--text-2)]">⌘N</kbd>
			</span>
		</button>

		<!-- Import Tool Button -->
		<button
			class="ribbon-btn relative group/ribbon w-[34px] h-[34px] rounded-md bg-transparent border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] hover:border-[var(--border)] active:bg-[var(--surface-3)] flex items-center justify-center cursor-pointer transition-colors"
			onclick={() => fileInputRef?.click()}
			title="Import Spreadsheet (.xlsx, .csv)"
			aria-label="Import Spreadsheet"
		>
			<Icon name="upload" size={17} aria-hidden="true" />
			<span class="ribbon-tooltip absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 scale-95 bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--border-strong)] text-[11.5px] font-semibold whitespace-nowrap px-2.5 py-1 rounded shadow-md pointer-events-none opacity-0 invisible group-hover/ribbon:opacity-100 group-hover/ribbon:visible group-hover/ribbon:scale-100 transition-all flex items-center gap-1.5 z-50 max-sm:!hidden">
				Import (.xlsx, .csv)
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
				title="Export Spreadsheet"
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
						<span class="menu-icon-wrap icon-excel w-7 h-7 rounded-md bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0"><Icon name="file-spreadsheet" size={14} aria-hidden="true" /></span>
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
						<span class="menu-icon-wrap icon-csv w-7 h-7 rounded-md bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0"><Icon name="file-text" size={14} aria-hidden="true" /></span>
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
			title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
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
				title="Settings & API Key (Ctrl+,)"
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
