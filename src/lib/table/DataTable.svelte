<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import DropdownCellEditor from './DropdownCellEditor.svelte';
	import type { createTableStore } from './store.svelte';
	import type { CellAlign, Column, ColumnType, CellValue, Row } from '$lib/types';
	import { COLUMN_TYPE_CONFIG, formatCellValue, getDropdownStyle } from '$lib/constants';
	import { computeFloatingPosition } from '$lib/ui/position';
	import { resolveDropdownOptionsForRows } from './cells';
	import { resolveEditTargets, type EditTarget } from './range-edit';

	let {
		store,
		onNotify
	}: {
		store: ReturnType<typeof createTableStore>;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
	} = $props();

	// Selection lives in the store so the header's alignment control acts on the same range.
	let activeCell = $derived(store.activeCell);

	// #2 Clamp the selection when filteredRows shrinks (search/sort) to avoid OOB TypeError
	$effect(() => {
		const rows = store.filteredRows;
		const cols = store.columns;
		const cell = store.activeCell;
		if (!cell) return;
		if (rows.length === 0 || cols.length === 0) {
			store.setSelection(null);
			return;
		}
		let next = cell;
		if (next.rowIndex >= rows.length || !rows.some((r) => r.id === next.rowId)) {
			const clampRow = Math.min(next.rowIndex, rows.length - 1);
			next = { ...next, rowId: rows[clampRow].id, rowIndex: clampRow };
		}
		if (next.colIndex >= cols.length) {
			next = { ...next, colIndex: cols.length - 1, columnId: cols[cols.length - 1].id };
		}
		if (!cols.some((c) => c.id === next.columnId)) {
			next = { ...next, columnId: cols[next.colIndex]?.id ?? cols[0].id };
		}
		if (next !== cell) store.setSelection(next);
	});
	let editingCell = $state<{ rowId: string; columnId: string } | null>(null);
	let editTargets = $state<EditTarget[]>([]);
	let cellNodes = new Map<string, HTMLElement>();

	let editValue = $state<string>('');
	let activeColMenu = $state<string | null>(null);
	let renamingColId = $state<string | null>(null);
	let renamingColValue = $state<string>('');
	// #17 column menu fixed positioning to escape scroll clipping
	let colMenuTriggerEls = new Map<string, HTMLElement>();
	let colMenuStyle = $state<string>('');
	function syncColMenuPos() {
		if (!activeColMenu) { colMenuStyle=''; return; }
		const trigger = colMenuTriggerEls.get(activeColMenu);
		if (!trigger) return;
		const tr = trigger.getBoundingClientRect();
		const layer = { width: 192, height: 280 };
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		const pos = computeFloatingPosition(
			{ top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right, width: tr.width, height: tr.height },
			layer,
			viewport,
			{ offset: 6, margin: 8, preferPlacement: 'bottom', align: 'end' }
		);
		colMenuStyle = `top:${pos.top}px; left:${pos.left}px;`;
	}
	$effect(() => {
		// track active menu change + viewport resize
		if (activeColMenu) {
			// next tick ensures DOM exists
			requestAnimationFrame(syncColMenuPos);
		}
	});

	// Column Resizing state
	let resizingColId = $state<string | null>(null);
	let resizeStartX = $state<number>(0);
	let resizeStartWidth = $state<number>(0);
	let isResizing = $state<boolean>(false);

	// Index column (w-10) + add-column header (w-20) + the declared column widths, each
	// floored at the `min-width: 70px` the cells carry.
	let gridW = $derived(
		40 + 80 + store.columns.reduce((sum, c) => sum + Math.max(70, c.width || 180), 0)
	);

	// #9 Row virtualization — cap DOM at ~60 rows even for 10k import
	const ROW_H = 36;
	let tableScrollEl = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
	function onTableScroll(e: Event) {
		scrollTop = (e.target as HTMLElement).scrollTop;
	}
	let visibleStart = $derived(Math.max(0, Math.min(store.filteredRows.length - 1, Math.floor(scrollTop / ROW_H))));
	let viewportCount = $derived(Math.ceil(viewportH / ROW_H) + 14);
	let renderedRows = $derived.by(() => {
		const rows = store.filteredRows;
		if (rows.length <= 80) return rows.map((r, i) => ({ row: r, idx: i }));
		const end = Math.min(rows.length, visibleStart + viewportCount);
		const slice: Array<{ row: (typeof rows)[number]; idx: number }> = [];
		for (let i = visibleStart; i < end; i++) slice.push({ row: rows[i], idx: i });
		return slice;
	});
	let topPadH = $derived(store.filteredRows.length <= 80 ? 0 : visibleStart * ROW_H);
	let bottomPadH = $derived.by(() => {
		if (store.filteredRows.length <= 80) return 0;
		const remaining = store.filteredRows.length - (visibleStart + viewportCount);
		return remaining > 0 ? remaining * ROW_H : 0;
	});
	$effect(() => {
		if (!tableScrollEl) return;
		viewportH = tableScrollEl.clientHeight || 600;
		const ro = new ResizeObserver(() => {
			if (tableScrollEl) viewportH = tableScrollEl.clientHeight;
		});
		ro.observe(tableScrollEl);
		return () => ro.disconnect();
	});
	// Keep active cell visible inside virtual window
	$effect(() => {
		if (!activeCell || !tableScrollEl || store.filteredRows.length <= 80) return;
		const idx = activeCell.rowIndex;
		if (idx < visibleStart) tableScrollEl.scrollTop = idx * ROW_H;
		else if (idx >= visibleStart + viewportCount - 4)
			tableScrollEl.scrollTop = (idx - viewportCount + 6) * ROW_H;
	});

	// Svelte Action for autofocus
	function autoFocus(node: HTMLElement) {
		node.focus();
		if (node instanceof HTMLInputElement) {
			node.select();
		}
	}

	function registerCellNode(node: HTMLElement, key: string) {
		cellNodes.set(key, node);
		return {
			destroy() {
				cellNodes.delete(key);
			}
		};
	}

	function startResize(e: MouseEvent, colId: string, currentWidth: number) {
		e.stopPropagation();
		e.preventDefault();
		resizingColId = colId;
		resizeStartX = e.clientX;
		resizeStartWidth = currentWidth;
		isResizing = true;
		let pendingWidth = currentWidth;
		let rafId: number | null = null;

		function onMouseMove(moveEvent: MouseEvent) {
			if (!resizingColId) return;
			const delta = moveEvent.clientX - resizeStartX;
			pendingWidth = Math.max(60, resizeStartWidth + delta);
			// #15 throttle per frame — store clone + save each pixel is thrash
			if (rafId !== null) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (resizingColId) store.updateColumnWidth(resizingColId, pendingWidth);
			});
		}

		function onMouseUp() {
			if (rafId !== null) cancelAnimationFrame(rafId);
			if (resizingColId) store.updateColumnWidth(resizingColId, pendingWidth);
			isResizing = false;
			resizingColId = null;
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	function autoFitColumn(colId: string) {
		const col = store.columns.find((c) => c.id === colId);
		if (!col) return;
		let maxLen = col.name.length;
		for (const row of store.rows) {
			const str = String(row[colId] ?? '');
			if (str.length > maxLen) maxLen = str.length;
		}
		const fitWidth = Math.max(80, Math.min(380, Math.round(maxLen * 8.8 + 48)));
		store.updateColumnWidth(colId, fitWidth);
	}

	function selectCell(
		rowId: string,
		columnId: string,
		rowIndex: number,
		colIndex: number,
		extend = false
	) {
		if (editingCell && (editingCell.rowId !== rowId || editingCell.columnId !== columnId)) {
			commitEdit();
		}
		store.setSelection({ rowId, columnId, rowIndex, colIndex }, extend);
		const key = `${rowId}-${columnId}`;
		const el = cellNodes.get(key);
		if (el && document.activeElement !== el && !editingCell) {
			el.focus();
		}
	}

	function rowsForEditTargets(): Row[] {
		const rowMap = new Map(store.rows.map((row) => [row.id, row]));
		return editTargets.flatMap((target) => {
			const row = rowMap.get(target.rowId);
			return row ? [row] : [];
		});
	}

	function getCellDropdownOptions(col: Column, rowId: string) {
		const activeRow = store.rows.find((row) => row.id === rowId);
		return resolveDropdownOptionsForRows(col, activeRow, rowsForEditTargets(), store.rows);
	}

	function dropdownEditorValue(columnId: string): string {
		const selectedRows = rowsForEditTargets();
		if (selectedRows.length <= 1) return editValue;
		const first = selectedRows[0]?.[columnId] ?? null;
		return selectedRows.every((row) => Object.is(row[columnId] ?? null, first))
			? String(first ?? '')
			: '';
	}

	function dropdownEditorIsMixed(columnId: string): boolean {
		const selectedRows = rowsForEditTargets();
		if (selectedRows.length <= 1) return false;
		const first = selectedRows[0]?.[columnId] ?? null;
		return !selectedRows.every((row) => Object.is(row[columnId] ?? null, first));
	}

	function startEditing(rowId: string, columnId: string, initialVal: unknown) {
		const requestedCell = {
			rowId,
			columnId,
			rowIndex: store.filteredRows.findIndex((row) => row.id === rowId),
			colIndex: store.columns.findIndex((column) => column.id === columnId)
		};
		const targets = resolveEditTargets(
			store.selectionRect,
			store.activeCell,
			requestedCell,
			store.filteredRows,
			store.columns
		);
		if (targets.length === 1) store.setSelection(requestedCell);
		editTargets = targets;
		editingCell = { rowId, columnId };
		editValue = initialVal !== null && initialVal !== undefined ? String(initialVal) : '';
	}

	function commitEdit(): boolean {
		if (!editingCell) return false;
		const wasBulk = editTargets.length > 1;
		store.applyCellPatches(
			editTargets.map((target) => ({
				rowId: target.rowId,
				columnId: target.columnId,
				newValue: editValue
			}))
		);
		const { rowId, columnId } = editingCell;
		editingCell = null;
		editTargets = [];
		cellNodes.get(`${rowId}-${columnId}`)?.focus();
		return wasBulk;
	}

	function cancelEdit() {
		editingCell = null;
		editTargets = [];
		if (activeCell) cellNodes.get(`${activeCell.rowId}-${activeCell.columnId}`)?.focus();
	}

	const ALIGN_CLASS: Record<CellAlign, string> = {
		left: 'text-left',
		center: 'text-center',
		right: 'text-right'
	};

	// focus fires between mousedown and click, so without this the focus handler would
	// reset the anchor and a shift-click would collapse the range to a single cell.
	let pointerExtend = false;

	function isInSelection(rowIndex: number, colIndex: number): boolean {
		const rect = store.selectionRect;
		if (!rect) return false;
		if (rect.r0 === rect.r1 && rect.c0 === rect.c1) return false;
		return (
			rowIndex >= rect.r0 && rowIndex <= rect.r1 && colIndex >= rect.c0 && colIndex <= rect.c1
		);
	}

	/** Every (row, column) pair inside the current selection rectangle, in reading order. */
	function selectedCells(): Array<{ row: Row; col: Column }> {
		const rect = store.selectionRect;
		if (!rect) return [];
		const out: Array<{ row: Row; col: Column }> = [];
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = store.filteredRows[r];
			if (!row) continue;
			for (let c = rect.c0; c <= rect.c1; c++) {
				const col = store.columns[c];
				if (col) out.push({ row, col });
			}
		}
		return out;
	}

	function selectionAsTsv(): string {
		const rect = store.selectionRect;
		if (!rect) return '';
		const lines: string[] = [];
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = store.filteredRows[r];
			if (!row) continue;
			const cells: string[] = [];
			for (let c = rect.c0; c <= rect.c1; c++) {
				const col = store.columns[c];
				if (col) cells.push(formatCellValue(col.type, row[col.id]));
			}
			lines.push(cells.join('\t'));
		}
		return lines.join('\n');
	}

	function handleTableKeyDown(e: KeyboardEvent) {
		if (editingCell) return;
		if (!activeCell && store.filteredRows.length > 0 && store.columns.length > 0) {
			if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].includes(e.key)) {
				e.preventDefault();
				selectCell(store.filteredRows[0].id, store.columns[0].id, 0, 0);
				return;
			}
		}

		if (!activeCell) return;
		let { rowIndex, colIndex } = activeCell;
		const totalRows = store.filteredRows.length;
		const totalCols = store.columns.length;
		// #2 Guard stale indexes after filter/sort shrinks the list
		if (totalRows === 0 || totalCols === 0) return;
		if (rowIndex >= totalRows || colIndex >= totalCols || rowIndex < 0 || colIndex < 0) return;
		const currentRow = store.filteredRows[rowIndex];
		if (!currentRow) return;

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			if (colIndex < totalCols - 1) {
				const nextCol = store.columns[colIndex + 1];
				selectCell(currentRow.id, nextCol.id, rowIndex, colIndex + 1, e.shiftKey);
			}
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			if (colIndex > 0) {
				const prevCol = store.columns[colIndex - 1];
				selectCell(currentRow.id, prevCol.id, rowIndex, colIndex - 1, e.shiftKey);
			}
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (rowIndex < totalRows - 1) {
				const nextRow = store.filteredRows[rowIndex + 1];
				if (nextRow) selectCell(nextRow.id, store.columns[colIndex].id, rowIndex + 1, colIndex, e.shiftKey);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (rowIndex > 0) {
				const prevRow = store.filteredRows[rowIndex - 1];
				if (prevRow) selectCell(prevRow.id, store.columns[colIndex].id, rowIndex - 1, colIndex, e.shiftKey);
			}
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				if (colIndex > 0) {
					const prevCol = store.columns[colIndex - 1];
					selectCell(currentRow.id, prevCol.id, rowIndex, colIndex - 1);
				} else if (rowIndex > 0) {
					const prevRow = store.filteredRows[rowIndex - 1];
					if (prevRow) {
						const lastCol = store.columns[totalCols - 1];
						selectCell(prevRow.id, lastCol.id, rowIndex - 1, totalCols - 1);
					}
				}
			} else {
				if (colIndex < totalCols - 1) {
					const nextCol = store.columns[colIndex + 1];
					selectCell(currentRow.id, nextCol.id, rowIndex, colIndex + 1);
				} else if (rowIndex < totalRows - 1) {
					const nextRow = store.filteredRows[rowIndex + 1];
					if (nextRow) {
						const firstCol = store.columns[0];
						selectCell(nextRow.id, firstCol.id, rowIndex + 1, 0);
					}
				}
			}
		} else if (e.key === 'Enter' || e.key === 'F2') {
			e.preventDefault();
			const col = store.columns[colIndex];
			if (col) startEditing(currentRow.id, col.id, currentRow[col.id]);
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			store.applyCellPatches(
				selectedCells().map(({ row, col }) => ({ rowId: row.id, columnId: col.id, newValue: null }))
			);
		} else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
			// The grid is select-none, so without this there is no way to get values out
			// short of exporting the whole file. TSV so it pastes back into Excel as a range.
			e.preventDefault();
			navigator.clipboard?.writeText(selectionAsTsv());
		} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const col = store.columns[colIndex];
			if (col) {
				startEditing(currentRow.id, col.id, '');
				editValue = e.key;
			}
		}
	}

	function handleEditorKeyDown(e: KeyboardEvent, rowIndex: number, colIndex: number) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			const wasBulk = commitEdit();
			if (!wasBulk && rowIndex < store.filteredRows.length - 1) {
				const nextRow = store.filteredRows[rowIndex + 1];
				selectCell(nextRow.id, store.columns[colIndex].id, rowIndex + 1, colIndex);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		} else if (e.key === 'Tab') {
			e.preventDefault();
			const wasBulk = commitEdit();
			if (wasBulk) return;
			if (e.shiftKey) {
				if (colIndex > 0) {
					selectCell(store.filteredRows[rowIndex].id, store.columns[colIndex - 1].id, rowIndex, colIndex - 1);
				}
			} else if (colIndex < store.columns.length - 1) {
				selectCell(store.filteredRows[rowIndex].id, store.columns[colIndex + 1].id, rowIndex, colIndex + 1);
			}
		}
	}

	function handleAddColumn() {
		// Pony: default to text, no popup. User can change type via column menu afterwards.
		const existing = new Set(store.columns.map((c) => c.name));
		let n = store.columns.length + 1;
		let name = `Column ${n}`;
		while (existing.has(name)) {
			n += 1;
			name = `Column ${n}`;
		}
		store.addColumn(name, 'text');
		activeColMenu = null;
		onNotify('success', `Added column "${name}" (Text). Change type via ··· menu.`);
		// auto-focus rename for power users? start rename next tick
		requestAnimationFrame(() => {
			const newCol = store.columns[store.columns.length - 1];
			if (newCol) {
				renamingColId = newCol.id;
				renamingColValue = newCol.name;
			}
		});
	}

	function startRenameColumn(colId: string, currentName: string) {
		activeColMenu = null;
		renamingColId = colId;
		renamingColValue = currentName;
	}

	function commitRenameColumn() {
		if (renamingColId && renamingColValue.trim()) {
			store.renameColumn(renamingColId, renamingColValue.trim());
		}
		renamingColId = null;
	}

	function handleUpdateColumnType(colId: string, newType: ColumnType) {
		activeColMenu = null;
		const { invalidCount } = store.updateColumnType(colId, newType);
		if (invalidCount > 0) {
			onNotify('warning', `Changed to ${COLUMN_TYPE_CONFIG[newType]?.label || newType} — ${invalidCount} value(s) cleared as invalid. Undo with Ctrl+Z.`);
		} else {
			onNotify('info', `Changed column type to ${COLUMN_TYPE_CONFIG[newType]?.label || newType}.`);
		}
	}

	function requestDeleteColumn(colId: string, colName: string) {
		activeColMenu = null;
		if (store.columns.length <= 1) {
			onNotify('warning', 'Table must have at least one column.');
			return;
		}
		store.deleteColumn(colId);
		onNotify('info', `Deleted column "${colName}" — Undo with Ctrl+Z.`);
	}

	function handleDocumentClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.column-menu-wrapper') && !target?.closest('.column-popover')) {
			activeColMenu = null;
		}
	}
</script>

<svelte:window onclick={handleDocumentClick} />

<!-- Main DataTable Container -->
<div class="data-table-container flex-1 flex flex-col h-full bg-[var(--bg)] overflow-hidden relative select-none" role="region" aria-label="Interactive Spreadsheet">
	{#if store.columns.length === 0}
		<!-- Zero Column Empty State -->
		<div class="empty-state-wrap flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--text-3)] gap-3">
			<div class="empty-icon-box w-12 h-12 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-primary)] shadow-sm">
				<Icon name="table" size={24} />
			</div>
			<h3 class="empty-title text-base font-bold text-[var(--text-1)] m-0">Spreadsheet is empty</h3>
			<p class="empty-subtitle text-[13px] text-[var(--text-3)] max-w-sm m-0">Start a blank sheet, import a file, or load a sample dataset.</p>
			<div class="empty-actions flex items-center gap-2 mt-2">
				<button class="btn-tactile btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] cursor-pointer shadow-sm" onclick={() => store.newSheet()}>
					<Icon name="file-spreadsheet" size={14} />
					<span>New Blank Sheet</span>
				</button>
				<button class="btn-tactile inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer" onclick={() => store.addColumn('Column 1', 'text')}>
					<Icon name="plus" size={14} />
					<span>Add One Column</span>
				</button>
			</div>
		</div>
	{:else}
		<!-- Scrollable Grid Table -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={tableScrollEl}
			class="table-scroll-wrap flex-1 overflow-auto outline-none relative [scrollbar-gutter:stable] isolate bg-[var(--surface-1)]"
			tabindex="0"
			role="grid"
			aria-label="Spreadsheet grid"
			aria-rowcount={store.filteredRows.length}
			aria-colcount={store.columns.length}
			onscroll={onTableScroll}
			onkeydown={handleTableKeyDown}
		>
			<!-- Explicit px width, not `min-w-max`: Firefox blows up `max-content` on a
			     fixed-layout table (17.9M px), while `min-width:100%` still fills a wide viewport. -->
			<table
				class="grid-table border-separate border-spacing-0 h-full text-[13.5px] table-fixed"
				style="width: {gridW}px; min-width: 100%"
			>
				<!-- Column Header Row -->
				<thead>
					<!-- Explicit height: the filler row must be the only unconstrained one, or
					     Firefox dumps the table's leftover height into this header instead. -->
					<tr class="h-8">
						<!-- Index / Row number column -->
						<th class="th-index sticky top-0 z-10 w-10 min-w-10 text-center bg-[var(--surface-2)] border-b border-[var(--border-strong)] border-r border-[var(--border)] p-0 select-none" scope="col">
							<span class="index-hdr-label font-mono text-[10.5px] font-bold text-[var(--text-3)] tracking-wider">#</span>
						</th>

						<!-- Dynamic Columns -->
						{#each store.columns as col, colIndex (col.id)}
							{@const colConfig = COLUMN_TYPE_CONFIG[col.type || 'text']}
							{@const isSorted = store.sortConfig?.columnId === col.id}
							{@const sortDir = isSorted ? store.sortConfig?.direction : null}

							<th
								class="th-column sticky top-0 z-10 bg-[var(--surface-1)] border-b border-[var(--border-strong)] border-r border-[var(--table-grid-line)] p-0 select-none text-[var(--text-1)] group/col"
								style="width: {col.width ? col.width + 'px' : '180px'}; min-width: 70px;"
								scope="col"
								role="columnheader"
								aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'}
							>
								<div class="th-content flex items-center px-2 h-8 gap-1.5">
									<!-- Type glyph: unboxed, muted. It labels the column, it isn't a control. -->
									<span class="th-type-icon flex text-[var(--text-3)] shrink-0" aria-hidden="true">
										<Icon name={colConfig?.icon || 'type'} size={12} />
									</span>

									<!-- Click sorts, double-click renames in place. -->
									{#if renamingColId === col.id}
										<input
											type="text"
											class="th-rename-input bg-[var(--surface-2)] border border-[var(--border-focus)] rounded px-1.5 py-0.5 text-[12.5px] font-semibold text-[var(--text-1)] outline-none w-full min-w-0"
											aria-label="Column name"
											bind:value={renamingColValue}
											use:autoFocus
											onblur={commitRenameColumn}
											onkeydown={(e) => {
												e.stopPropagation();
												if (e.key === 'Enter') commitRenameColumn();
												if (e.key === 'Escape') renamingColId = null;
											}}
										/>
									{:else}
										<button
											class="th-title-btn flex items-center justify-between flex-1 bg-transparent border-none cursor-pointer text-[var(--text-1)] font-semibold text-[12.5px] tracking-tight p-0 hover:text-[var(--accent-primary)] transition-colors min-w-0"
											onclick={() => store.setSort(col.id)}
											ondblclick={(e) => {
												e.stopPropagation();
												startRenameColumn(col.id, col.name);
											}}
											aria-label="Sort by {col.name} (double-click to rename)"
										>
											<span class="th-title-text truncate">{col.name}</span>
											<!-- Only shown when it means something, or on hover. Six idle
											     chevrons per screen is noise, not affordance. -->
											<span
												class="th-sort-icon flex shrink-0 ml-1 transition-opacity {isSorted
													? 'active opacity-100 text-[var(--accent-primary)]'
													: 'opacity-0 group-hover/col:opacity-40'}"
												aria-hidden="true"
											>
												{#if sortDir === 'desc'}
													<Icon name="chevron-down" size={12} />
												{:else if sortDir === 'asc'}
													<Icon name="chevron-up" size={12} />
												{:else}
													<Icon name="chevrons-up-down" size={11} />
												{/if}
											</span>
										</button>
									{/if}

									<!-- Column Options Menu Trigger -->
									<div class="column-menu-wrapper relative flex items-center">
										<button
											class="th-menu-trigger flex items-center justify-center w-5 h-5 rounded bg-transparent hover:bg-[var(--surface-2)] border-none text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer transition-opacity focus-visible:opacity-100 {activeColMenu ===
										col.id
											? 'opacity-100'
											: 'opacity-0 group-hover/col:opacity-100'}"
											onclick={(e) => {
												e.stopPropagation();
												const el = e.currentTarget as HTMLElement;
												colMenuTriggerEls.set(col.id, el);
												activeColMenu = activeColMenu === col.id ? null : col.id;
												if (activeColMenu) requestAnimationFrame(syncColMenuPos);
											}}
											aria-label="Column options for {col.name}"
											aria-haspopup="menu"
											aria-expanded={activeColMenu === col.id}
										>
											<Icon name="more-horizontal" size={13} aria-hidden="true" />
										</button>

										{#if activeColMenu === col.id}
											<div class="column-popover bezel-card fixed z-50 w-48 p-1.5 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-right animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)]" style={colMenuStyle} role="menu">
												<button
													class="popover-item flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
													role="menuitem"
													onclick={() => {
														activeColMenu = null;
														autoFitColumn(col.id);
													}}
												>
													<Icon name="chevrons-up-down" size={13} class="rotate-90" aria-hidden="true" />
													<span>Fit to content</span>
												</button>

												<div class="popover-divider h-px bg-[var(--border)] my-1"></div>
												<div class="popover-section-label px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">Column type</div>

												{#each Object.entries(COLUMN_TYPE_CONFIG) as [typeKey, typeCfg]}
													{@const isActiveType = col.type === typeKey}
													<button
														class="popover-item flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors {isActiveType ? 'active !text-[var(--accent-primary)] !bg-[var(--accent-primary-bg)] font-semibold' : ''}"
														role="menuitem"
														onclick={() => handleUpdateColumnType(col.id, typeKey as ColumnType)}
													>
														<div class="flex items-center gap-2">
															<Icon name={typeCfg.icon} size={13} aria-hidden="true" />
															<span>{typeCfg.label}</span>
														</div>
														{#if isActiveType}
															<span class="check-icon text-[var(--accent-primary)] font-bold text-[12px]"><Icon name="check" size={12} aria-hidden="true" /></span>
														{/if}
													</button>
												{/each}

												<div class="popover-divider h-px bg-[var(--border)] my-1"></div>
												<button
													class="popover-item popover-delete flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--accent-rose)] hover:!text-[var(--accent-rose)] hover:!bg-[var(--accent-rose-bg)] cursor-pointer text-left transition-colors"
													role="menuitem"
													onclick={() => requestDeleteColumn(col.id, col.name)}
												>
													<Icon name="trash" size={13} aria-hidden="true" />
													<span>Delete Column</span>
												</button>
											</div>
										{/if}
									</div>
								</div>

								<!-- Interactive Column Resize Handle -->
								<button
									type="button"
									class="th-resize-handle absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--accent-primary-hover)] active:bg-[var(--accent-primary)] transition-colors z-10 bg-transparent border-none"
									tabindex="-1"
									onmousedown={(e) => startResize(e, col.id, col.width || 180)}
									ondblclick={(e) => {
										e.stopPropagation();
										autoFitColumn(col.id);
									}}
									aria-label="Resize column {col.name}"
								></button>
							</th>
						{/each}

						<!-- Add New Column Header Button — pony: one-click, default Text, no modal -->
						<th class="th-add-col sticky top-0 z-10 w-20 min-w-20 bg-[var(--surface-1)] border-b border-[var(--border-strong)] p-0" scope="col">
							<button
								class="add-col-btn flex items-center justify-center gap-1.5 w-full h-8 bg-transparent border-none text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] text-[12px] font-medium cursor-pointer transition-colors"
								onclick={handleAddColumn}
								aria-label="Add column"
							>
								<Icon name="plus" size={13} aria-hidden="true" />
								<span>Add</span>
							</button>
						</th>
					</tr>
				</thead>

				<!-- Table Rows (#9 virtualized) -->
				<tbody>
					{#if store.filteredRows.length === 0}
						<tr>
							<td colspan={store.columns.length + 2} class="td-no-results text-center py-8 text-[var(--text-3)] text-[13px]" role="gridcell">
								<span>No matching rows found for "{store.searchQuery}".</span>
							</td>
						</tr>
					{:else}
						{#if topPadH > 0}
							<tr class="virtual-spacer" aria-hidden="true"><td colspan={store.columns.length + 2} style="height: {topPadH}px; padding:0; border:none"></td></tr>
						{/if}
						{#each renderedRows as { row, idx: rowIndex } (row.id)}
							<tr class="data-row table-data-row h-9 border-b border-[var(--table-grid-line)] hover:bg-[var(--table-row-hover)] transition-colors group/row odd:bg-transparent even:bg-[var(--table-row-even)]" aria-rowindex={rowIndex + 1}>
								<!-- Row Index & Hover Actions -->
								<td class="td-index w-10 min-w-10 text-center bg-[var(--surface-2)] border-r border-[var(--border)] relative font-mono text-[10.5px] text-[var(--text-3)] select-none p-0" role="gridcell">
									<span class="row-num block group-hover/row:hidden" aria-hidden="true">{rowIndex + 1}</span>
									<div class="row-actions-hover hidden group-hover/row:flex items-center justify-center gap-0.5 absolute inset-0 bg-[var(--surface-2)]">
										<button
											class="row-action-btn w-5 h-5 rounded flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer transition-colors"
											onclick={() => store.duplicateRow(row.id)}
											title="Duplicate row"
											aria-label="Duplicate row {rowIndex + 1}"
										>
											<Icon name="copy" size={11} aria-hidden="true" />
										</button>
										<button
											class="row-action-btn delete w-5 h-5 rounded flex items-center justify-center text-[var(--text-3)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose-bg)] cursor-pointer transition-colors"
											onclick={() => store.deleteRow(row.id)}
											title="Delete row"
											aria-label="Delete row {rowIndex + 1}"
										>
											<Icon name="trash" size={11} aria-hidden="true" />
										</button>
									</div>
								</td>

								<!-- Cells -->
								{#each store.columns as col, colIndex (col.id)}
									{@const colType = col.type || 'text'}
									{@const isDropdown = colType === 'dropdown'}
									{@const cellVal = row ? row[col.id] : null}
									{@const isEditing = editingCell?.rowId === row?.id && editingCell?.columnId === col.id}
									{@const isActive = activeCell?.rowId === row?.id && activeCell?.columnId === col.id}
									{@const isNumeric = colType === 'number' || colType === 'currency' || colType === 'percent'}
									{@const hasVal = cellVal !== null && cellVal !== undefined && cellVal !== ''}
									{@const dropdownStyle = isDropdown && hasVal ? getDropdownStyle(String(cellVal)) : null}

									{@const isRovingActive = isActive || (!activeCell && rowIndex === 0 && colIndex === 0)}
									{@const inRange = !isActive && isInSelection(rowIndex, colIndex)}
									{@const align = store.alignFor(row.id, col.id, colType)}
									<td
										class="td-cell px-2.5 border-r border-[var(--table-grid-line)] relative outline-none cursor-default text-[13px] text-[var(--text-1)] select-none overflow-hidden {ALIGN_CLASS[align]} {isNumeric ? 'numeric-cell font-mono tabular-nums' : ''} {isActive ? 'active-cell z-[2] shadow-[inset_0_0_0_2px_var(--border-focus)]' : ''} {inRange ? 'in-range bg-[var(--accent-primary)]/10' : ''} {isEditing ? 'editing' : ''} {isDropdown ? 'status-cell dropdown-cell' : ''} {isDropdown && hasVal ? 'dropdown-filled-cell' : ''}"
										style="width: {col.width ? col.width + 'px' : '180px'}; min-width: 70px; {isDropdown && hasVal ? `background: ${dropdownStyle!.bg};` : ''}"
										role="gridcell"
										aria-selected={isActive || inRange}
										tabindex={isRovingActive ? 0 : -1}
										use:registerCellNode={`${row.id}-${col.id}`}
										onmousedown={(e) => (pointerExtend = e.shiftKey)}
										onfocus={() => {
											if (!isActive) {
												selectCell(row.id, col.id, rowIndex, colIndex, pointerExtend);
											}
										}}
										onclick={(e) => {
											selectCell(row.id, col.id, rowIndex, colIndex, e.shiftKey);
											pointerExtend = false;
											if (isDropdown && typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
												startEditing(row.id, col.id, cellVal);
											}
										}}
										ondblclick={() => startEditing(row.id, col.id, cellVal)}
									>
										{#if isDropdown}
											<div class="status-cell-wrap flex items-center justify-between w-full h-full gap-1">
												{#if hasVal && dropdownStyle}
													<span class="status-cell-text status-val font-medium text-[12.5px] truncate" style="color: {dropdownStyle.text};">
														<span class="truncate">{cellVal}</span>
													</span>
												{:else}
													<span class="status-cell-text" aria-hidden="true"></span>
												{/if}
												{#if isEditing}
													<span class="dropdown-cell-arrow text-[10px] shrink-0" style="color: {hasVal && dropdownStyle ? dropdownStyle.text : 'var(--text-3)'}; opacity: 0.6;" aria-hidden="true">▾</span>
												{:else}
													<button
														type="button"
														class="dropdown-cell-arrow text-[10px] cursor-pointer px-1 bg-transparent border-none shrink-0 opacity-0 group-hover/row:opacity-60 hover:!opacity-100 focus-visible:opacity-100 transition-opacity"
														style="color: {hasVal && dropdownStyle ? dropdownStyle.text : 'var(--text-3)'};"
														aria-label="Open dropdown options"
														onclick={(e) => {
															e.stopPropagation();
															if (!isActive) selectCell(row.id, col.id, rowIndex, colIndex);
															startEditing(row.id, col.id, cellVal);
														}}
													>▾</button>
												{/if}
											</div>
											{#if isEditing}
												{@const cellKey = `${row.id}-${col.id}`}
												<DropdownCellEditor
													value={dropdownEditorValue(col.id)}
													mixed={dropdownEditorIsMixed(col.id)}
													options={getCellDropdownOptions(col, row.id)}
													emptyMessage={editTargets.length > 1
														? 'No options are valid for all selected cells.'
														: 'No matching options.'}
													allowCustom={col.dropdown?.allowCustom ?? true}
													triggerEl={cellNodes.get(cellKey)}
													onCommit={(newVal) => {
														editValue = newVal;
														commitEdit();
													}}
													onCancel={cancelEdit}
												/>
											{/if}
										{:else if isEditing}
											{#if colType === 'date'}
												<input
													type="text"
													class="cell-input cell-input-editor w-full h-full bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] font-inherit p-0 placeholder:text-[var(--text-3)]"
													aria-label="Edit Date Value"
													placeholder="e.g. 2025-03-01 or 03/15/2025"
													bind:value={editValue}
													onclick={(e) => e.stopPropagation()}
													use:autoFocus
													onblur={commitEdit}
													onkeydown={(e) => handleEditorKeyDown(e, rowIndex, colIndex)}
												/>
											{:else}
												<input
													type="text"
													class="cell-input cell-input-editor w-full h-full bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] font-inherit p-0 {ALIGN_CLASS[align]} {isNumeric ? 'numeric-input font-mono tabular-nums' : ''}"
													aria-label="Edit Cell Value"
													bind:value={editValue}
													onclick={(e) => e.stopPropagation()}
													use:autoFocus
													onblur={commitEdit}
													onkeydown={(e) => handleEditorKeyDown(e, rowIndex, colIndex)}
												/>
											{/if}
										{:else}
											<span class="cell-text-display block w-full truncate">
												{formatCellValue(colType, cellVal)}
											</span>
										{/if}

										{#if isActive && !isEditing}
											<span class="active-cell-handle absolute right-[-2px] bottom-[-2px] w-1.5 h-1.5 bg-[var(--border-focus)] pointer-events-none" aria-hidden="true"></span>
										{/if}
									</td>
								{/each}

								<!-- Trailing blank cell -->
								<td class="td-blank bg-transparent" role="gridcell"></td>
							</tr>
						{/each}
						{#if bottomPadH > 0}
							<tr class="virtual-spacer" aria-hidden="true"><td colspan={store.columns.length + 2} style="height: {bottomPadH}px; padding:0; border:none"></td></tr>
						{/if}
					{/if}
					<!-- Absorbs leftover height so the summary row sits on the floor, not mid-page. -->
					<tr class="grid-filler" aria-hidden="true">
						<td colspan={store.columns.length + 2} style="padding:0; border:none"></td>
					</tr>
				</tbody>

				<!-- Sticky Footer Summary — pony: slightly grey, visually separate -->
				<tfoot>
					<tr class="summary-row tfoot-summary-row sticky bottom-0 z-10 bg-[var(--surface-3)] border-t border-[var(--border-strong)] h-11 shadow-[0_-2px_8px_rgba(0,0,0,0.12)]">
						<td class="tf-index w-10 min-w-10 text-center border-r border-[var(--border)] font-mono text-[9.5px] font-bold text-[var(--text-3)] uppercase tracking-wider p-0 align-middle" role="gridcell">
							<span class="tf-label flex items-center justify-center h-full">Σ</span>
						</td>

						{#each store.columns as col (col.id)}
							{@const colType = col.type || 'text'}
							{@const summary = store.columnSummaries ? store.columnSummaries[col.id] : undefined}
							{@const isNumericSummable = colType === 'number' || colType === 'currency'}
							{@const isPercent = colType === 'percent'}

							<td
								class="tf-cell px-2.5 border-r border-[var(--table-grid-line)] text-[12px] align-middle {isNumericSummable || isPercent ? 'numeric-cell text-right font-mono tabular-nums' : ''}"
								style="width: {col.width ? col.width + 'px' : '180px'}; min-width: 70px;"
								role="gridcell"
							>
								<div class="summary-metric-group flex flex-col justify-center leading-tight">
									{#if isNumericSummable && summary?.sum !== undefined}
										<div class="summary-line primary-sum flex items-center gap-1.5" title="Sum: {formatCellValue(colType, summary.sum)} | Avg: {formatCellValue(colType, summary.avg)} | Min: {formatCellValue(colType, summary.min)} | Max: {formatCellValue(colType, summary.max)}">
											<span class="sum-tag text-[9.5px] font-mono font-bold px-1 rounded bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">SUM</span>
											<span class="sum-val font-mono font-bold text-[var(--text-1)] text-[12px]">{formatCellValue(colType, summary.sum)}</span>
										</div>
										<div class="summary-line secondary-stats text-[10.5px] text-[var(--text-3)] font-mono mt-0.5">
											<span>avg {formatCellValue(colType, summary.avg)}</span>
										</div>
									{:else if isPercent && summary?.avg !== undefined}
										<div class="summary-line primary-sum flex items-center gap-1.5" title="Avg: {formatCellValue(colType, summary.avg)} | Min: {formatCellValue(colType, summary.min)} | Max: {formatCellValue(colType, summary.max)} | {summary ? summary.countNonEmpty : 0} rows">
											<span class="sum-tag tag-avg text-[9.5px] font-mono font-bold px-1 rounded bg-[var(--accent-sky-bg)] text-[var(--accent-sky)]">AVG</span>
											<span class="sum-val font-mono font-bold text-[var(--text-1)] text-[12px]">{formatCellValue(colType, summary.avg)}</span>
										</div>
										<div class="summary-line secondary-stats text-[10.5px] text-[var(--text-3)] font-mono mt-0.5">
											<span>min {formatCellValue(colType, summary.min)} · max {formatCellValue(colType, summary.max)}</span>
										</div>
									{:else}
										<div class="summary-line count-stat flex items-center gap-1.5">
											<span class="count-tag text-[9.5px] font-mono font-bold px-1 rounded bg-[var(--surface-3)] text-[var(--text-3)]">COUNT</span>
											<span class="count-val font-mono font-bold text-[var(--text-1)] text-[12px]">{summary ? summary.countNonEmpty : 0}</span>
										</div>
									{/if}
								</div>
							</td>
						{/each}

						<td class="tf-blank bg-transparent" role="gridcell"></td>
					</tr>
				</tfoot>
			</table>
		</div>

	{/if}
</div>
