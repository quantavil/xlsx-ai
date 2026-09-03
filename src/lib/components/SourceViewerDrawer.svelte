<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icons.svelte';
	import { documents, isSourceOpen, closeDrawers } from '$lib/workspace.svelte';
	import type { NotifyFn } from '$lib/ui/toast.svelte';
	import { loadSourceFiles, type StoredSourceFile } from '$lib/table/source-files';

	let {
		onNotify,
		onClose = closeDrawers
	}: {
		onNotify?: NotifyFn;
		onClose?: () => void;
	} = $props();

	const LS_DRAWER_WIDTH_KEY = 'xlsx-ai:source-viewer-width';
	const DEFAULT_WIDTH = 520;
	const MIN_WIDTH = 340;

	let files = $state<StoredSourceFile[]>([]);
	let selectedIndex = $state(0);
	let isLoading = $state(false);
	let activeBlobUrl = $state<string | null>(null);
	let drawerWidth = $state(DEFAULT_WIDTH);
	let isResizing = $state(false);

	const activeDocId = $derived(documents.activeId);
	const activeFile = $derived(files[selectedIndex] ?? null);
	const isOpen = $derived(isSourceOpen());

	onMount(() => {
		try {
			const saved = localStorage.getItem(LS_DRAWER_WIDTH_KEY);
			if (saved) {
				const num = parseInt(saved, 10);
				if (!isNaN(num) && num >= MIN_WIDTH) {
					drawerWidth = Math.min(num, Math.max(MIN_WIDTH, window.innerWidth - 320));
				}
			}
		} catch {
			// private browsing fallback
		}
	});

	// Whenever the drawer opens or active document changes, fetch files from IndexedDB
	$effect(() => {
		if (isOpen && activeDocId) {
			loadFiles(activeDocId);
		}
	});

	// Whenever selected file changes, manage object URL with automatic Svelte effect teardown.
	// We never read activeBlobUrl inside the effect so it does not re-trigger itself in a loop.
	$effect(() => {
		const file = activeFile;
		if (isOpen && file && file.blob) {
			const url = URL.createObjectURL(file.blob);
			activeBlobUrl = url;
			return () => {
				URL.revokeObjectURL(url);
			};
		} else {
			activeBlobUrl = null;
		}
	});

	let loadToken = 0;

	async function loadFiles(docId: string) {
		const token = ++loadToken;
		isLoading = true;
		files = [];
		try {
			const loaded = await loadSourceFiles(docId);
			if (token !== loadToken || docId !== documents.activeId) return;
			files = loaded;
			selectedIndex = 0;
		} catch {
			if (token !== loadToken || docId !== documents.activeId) return;
			files = [];
			selectedIndex = 0;
		} finally {
			if (token === loadToken) {
				isLoading = false;
			}
		}
	}

	function handleDrawerKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && isOpen) {
			e.stopPropagation();
			onClose();
		}
	}

	function persistWidth(w: number) {
		try {
			localStorage.setItem(LS_DRAWER_WIDTH_KEY, String(w));
		} catch {
			// private mode fallback
		}
	}

	function startResize(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;

		function onMouseMove(ev: MouseEvent) {
			const ribbonWidth = 48;
			const newWidth = window.innerWidth - ev.clientX - ribbonWidth;
			const maxAllowed = Math.max(MIN_WIDTH, window.innerWidth - 320);
			drawerWidth = Math.max(MIN_WIDTH, Math.min(maxAllowed, newWidth));
		}

		function onMouseUp() {
			isResizing = false;
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('blur', onMouseUp);
			persistWidth(drawerWidth);
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		window.addEventListener('blur', onMouseUp);
	}

	function resetWidth() {
		drawerWidth = DEFAULT_WIDTH;
		persistWidth(DEFAULT_WIDTH);
	}

	function handleResizeKeydown(e: KeyboardEvent) {
		const maxAllowed = Math.max(MIN_WIDTH, window.innerWidth - 320);
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			drawerWidth = Math.min(maxAllowed, drawerWidth + 24);
			persistWidth(drawerWidth);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			drawerWidth = Math.max(MIN_WIDTH, drawerWidth - 24);
			persistWidth(drawerWidth);
		} else if (e.key === 'Home') {
			e.preventDefault();
			drawerWidth = MIN_WIDTH;
			persistWidth(drawerWidth);
		} else if (e.key === 'End') {
			e.preventDefault();
			drawerWidth = maxAllowed;
			persistWidth(drawerWidth);
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}

	function handleDownloadActiveFile() {
		if (!activeFile || !activeBlobUrl) return;
		const a = document.createElement('a');
		a.href = activeBlobUrl;
		a.download = activeFile.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		onNotify?.('info', `Downloading "${activeFile.name}"...`);
	}
</script>

<svelte:window onkeydown={handleDrawerKeydown} />

{#if isResizing}
	<div
		class="fixed inset-0 z-[100] cursor-col-resize select-none"
		style="user-select: none; -webkit-user-select: none;"
		aria-hidden="true"
	></div>
{/if}

<aside
	class="source-viewer-drawer relative h-full bg-[var(--surface-1)] border-l border-[var(--border-strong)] z-10 flex flex-col shrink-0 overflow-hidden {isResizing
		? 'transition-none select-none'
		: 'transition-all duration-200 ease-out'} {isOpen
		? 'open opacity-100 visible'
		: 'closed !w-0 border-l-transparent opacity-0 pointer-events-none invisible'}"
	style={isOpen ? `width: ${drawerWidth}px; max-width: calc(100vw - 320px);` : 'width: 0px;'}
	aria-label="Source Document Viewer"
>
	{#if isOpen}
		<!-- Draggable left border resize handle -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="resize-handle absolute left-0 top-0 bottom-0 w-2.5 cursor-col-resize z-30 flex items-center justify-center select-none group hover:bg-[var(--accent-primary)]/15 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
			onmousedown={startResize}
			ondblclick={resetWidth}
			onkeydown={handleResizeKeydown}
			title="Drag to resize (Double-click to reset)"
			aria-label="Resize document viewer"
			role="separator"
			aria-orientation="vertical"
			aria-valuenow={drawerWidth}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={Math.max(MIN_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 320 : 1200)}
			tabindex="0"
		>
			<div
				class="w-1 h-8 rounded-full bg-[var(--border-strong)] group-hover:bg-[var(--accent-primary)] transition-colors {isResizing
					? '!bg-[var(--accent-primary)]'
					: ''}"
			></div>
		</div>
	{/if}

	<div
		class="drawer-inner h-full flex flex-col overflow-hidden bg-[var(--surface-1)]"
		style={`width: ${drawerWidth}px;`}
	>
		<!-- Header (without redundant close X button; user toggles via ribbon/badge/Esc) -->
		<div class="drawer-header flex items-center justify-between p-3.5 border-b border-[var(--border)] shrink-0 gap-3">
			<div class="header-left flex items-center gap-2.5 min-w-0">
				<div class="badge-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface-2)] text-[var(--accent-primary)] border border-[var(--border)] shrink-0 shadow-sm" aria-hidden="true">
					<Icon name="file-text" size={15} />
				</div>
				<div class="header-titles min-w-0">
					<h3 class="text-[13.5px] font-bold tracking-tight text-[var(--text-1)] m-0 leading-none">
						Source Documents
					</h3>
					<span class="text-[11.5px] text-[var(--text-3)] truncate block mt-0.5">
						{#if files.length > 0}
							{files.length} attached file{files.length > 1 ? 's' : ''}
						{:else}
							Original audit attachments
						{/if}
					</span>
				</div>
			</div>

			<div class="header-actions flex items-center gap-1 shrink-0">
				{#if activeFile && activeBlobUrl}
					<button
						class="action-btn w-7 h-7 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] flex items-center justify-center cursor-pointer transition-colors"
						onclick={handleDownloadActiveFile}
						title="Download original file"
						aria-label="Download original file"
					>
						<Icon name="download" size={14} />
					</button>
				{/if}
			</div>
		</div>

		<!-- File Tabs (when multiple files exist) -->
		{#if files.length > 1}
			<div class="file-tabs flex items-center gap-1.5 p-2 px-3 bg-[var(--surface-2)] border-b border-[var(--border)] overflow-x-auto shrink-0">
				{#each files as file, idx}
					<button
						class="tab-btn px-2.5 py-1 text-[11.5px] rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer shrink-0 {selectedIndex === idx
							? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-xs border border-[var(--border)]'
							: 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-3)]'}"
						onclick={() => (selectedIndex = idx)}
						title={file.name}
					>
						<Icon name="file-text" size={12} />
						<span class="truncate max-w-[140px]">{file.name}</span>
						<span class="text-[10px] text-[var(--text-3)] font-mono opacity-80">({formatBytes(file.size)})</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Body Viewport -->
		<div
			class="viewer-body flex-1 overflow-hidden relative bg-[var(--surface-2)] flex flex-col {isResizing
				? 'pointer-events-none'
				: ''}"
		>
			{#if isLoading}
				<div class="loading-state flex flex-col items-center justify-center h-full gap-2 text-[var(--text-3)]">
					<Icon name="loader" size={24} class="animate-spin text-[var(--accent-primary)]" />
					<span class="text-[12px]">Loading document from local storage...</span>
				</div>
			{:else if files.length === 0}
				<div class="empty-state flex flex-col items-center justify-center h-full p-6 text-center gap-3 text-[var(--text-3)]">
					<div class="w-12 h-12 rounded-xl bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-2)]">
						<Icon name="file-text" size={24} />
					</div>
					<div class="empty-text">
						<h4 class="text-[13.5px] font-semibold text-[var(--text-1)] m-0 mb-1">No source files attached</h4>
						<p class="text-[12px] text-[var(--text-3)] max-w-[280px] m-0 leading-relaxed">
							When you import shipping documents via ICEGrid or upload spreadsheets, original files are attached here for instant auditing.
						</p>
					</div>
				</div>
			{:else if activeFile}
				{#if activeFile.type === 'application/pdf' || activeFile.name.toLowerCase().endsWith('.pdf')}
					{#if activeBlobUrl}
						<object
							data={activeBlobUrl}
							type="application/pdf"
							class="w-full h-full border-0 bg-[var(--surface-1)]"
							title={activeFile.name}
						>
							<div class="fallback-preview p-6 flex flex-col items-center justify-center h-full text-center gap-3">
								<p class="text-[13px] text-[var(--text-2)] m-0">
									Browser preview is not supported for this document format.
								</p>
								<button
									class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent-primary)] text-[var(--text-inverse)] text-[12px] font-medium cursor-pointer shadow-xs hover:opacity-90"
									onclick={handleDownloadActiveFile}
								>
									<Icon name="download" size={13} />
									<span>Download {activeFile.name}</span>
								</button>
							</div>
						</object>
					{/if}
				{:else}
					<!-- Tabular/Generic File Card Preview -->
					<div class="generic-file-preview p-6 flex flex-col items-center justify-center h-full text-center gap-4">
						<div class="w-16 h-16 rounded-2xl bg-[var(--surface-1)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-primary)] shadow-sm">
							<Icon name="file-spreadsheet" size={32} />
						</div>
						<div class="file-details">
							<h4 class="text-[14px] font-bold text-[var(--text-1)] m-0 mb-1">{activeFile.name}</h4>
							<span class="text-[12px] text-[var(--text-3)] font-mono">
								{formatBytes(activeFile.size)} • {activeFile.type || 'Spreadsheet'}
							</span>
						</div>
						<button
							class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[12.5px] font-medium cursor-pointer transition-colors shadow-xs"
							onclick={handleDownloadActiveFile}
						>
							<Icon name="download" size={14} />
							<span>Download Original File</span>
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</aside>

<style>
	.source-viewer-drawer {
		will-change: width, opacity;
	}
</style>
