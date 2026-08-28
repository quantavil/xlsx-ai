<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import DropdownCellEditor from './DropdownCellEditor.svelte';
	import type { createTableStore } from './store.svelte';
	import type { ColumnType, CellValue } from '$lib/types';
	import { COLUMN_TYPE_CONFIG, formatCellValue, getDropdownStyle } from '$lib/constants';

	let {
		store,
		onNotify
	}: {
		store: ReturnType<typeof createTableStore>;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
	} = $props();

	// Local UI states
	let activeCell = $state<{ rowId: string; columnId: string; rowIndex: number; colIndex: number } | null>(null);
	let editingCell = $state<{ rowId: string; columnId: string } | null>(null);
	let cellNodes = new Map<string, HTMLElement>();

	let editValue = $state<string>('');
	let activeColMenu = $state<string | null>(null);
	let renamingColId = $state<string | null>(null);
	let renamingColValue = $state<string>('');

	// Column Resizing state
	let resizingColId = $state<string | null>(null);
	let resizeStartX = $state<number>(0);
	let resizeStartWidth = $state<number>(0);
	let isResizing = $state<boolean>(false);

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

		function onMouseMove(moveEvent: MouseEvent) {
			if (!resizingColId) return;
			const delta = moveEvent.clientX - resizeStartX;
			const newWidth = Math.max(60, resizeStartWidth + delta);
			store.updateColumnWidth(resizingColId, newWidth);
		}

		function onMouseUp() {
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

	function getColumnUniqueValues(columnId: string): string[] {
		const set = new Set<string>();
		for (const row of store.rows) {
			const val = row[columnId];
			if (typeof val === 'string' && val.trim().length > 0) {
				set.add(val.trim());
			}
		}
		return Array.from(set);
	}

	function selectCell(rowId: string, columnId: string, rowIndex: number, colIndex: number) {
		if (editingCell && (editingCell.rowId !== rowId || editingCell.columnId !== columnId)) {
			commitEdit();
		}
		activeCell = { rowId, columnId, rowIndex, colIndex };
		const key = `${rowId}-${columnId}`;
		const el = cellNodes.get(key);
		if (el && document.activeElement !== el && !editingCell) {
			el.focus();
		}
	}

	function startEditing(rowId: string, columnId: string, initialVal: unknown) {
		activeCell = {
			rowId,
			columnId,
			rowIndex: store.filteredRows.findIndex((r) => r.id === rowId),
			colIndex: store.columns.findIndex((c) => c.id === columnId)
		};
		editingCell = { rowId, columnId };
		editValue = initialVal !== null && initialVal !== undefined ? String(initialVal) : '';
	}

	function commitEdit() {
		if (!editingCell) return;
		const { rowId, columnId } = editingCell;
		store.setCell(rowId, columnId, editValue);
		editingCell = null;
		const key = `${rowId}-${columnId}`;
		cellNodes.get(key)?.focus();
	}

	function cancelEdit() {
		editingCell = null;
		if (activeCell) {
			const key = `${activeCell.rowId}-${activeCell.columnId}`;
			cellNodes.get(key)?.focus();
		}
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
		const { rowIndex, colIndex } = activeCell;
		const totalRows = store.filteredRows.length;
		const totalCols = store.columns.length;

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			if (colIndex < totalCols - 1) {
				const nextCol = store.columns[colIndex + 1];
				selectCell(store.filteredRows[rowIndex].id, nextCol.id, rowIndex, colIndex + 1);
			}
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			if (colIndex > 0) {
				const prevCol = store.columns[colIndex - 1];
				selectCell(store.filteredRows[rowIndex].id, prevCol.id, rowIndex, colIndex - 1);
			}
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (rowIndex < totalRows - 1) {
				const nextRow = store.filteredRows[rowIndex + 1];
				selectCell(nextRow.id, store.columns[colIndex].id, rowIndex + 1, colIndex);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (rowIndex > 0) {
				const prevRow = store.filteredRows[rowIndex - 1];
				selectCell(prevRow.id, store.columns[colIndex].id, rowIndex - 1, colIndex);
			}
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				if (colIndex > 0) {
					const prevCol = store.columns[colIndex - 1];
					selectCell(store.filteredRows[rowIndex].id, prevCol.id, rowIndex, colIndex - 1);
				} else if (rowIndex > 0) {
					const prevRow = store.filteredRows[rowIndex - 1];
					const lastCol = store.columns[totalCols - 1];
					selectCell(prevRow.id, lastCol.id, rowIndex - 1, totalCols - 1);
				}
			} else {
				if (colIndex < totalCols - 1) {
					const nextCol = store.columns[colIndex + 1];
					selectCell(store.filteredRows[rowIndex].id, nextCol.id, rowIndex, colIndex + 1);
				} else if (rowIndex < totalRows - 1) {
					const nextRow = store.filteredRows[rowIndex + 1];
					const firstCol = store.columns[0];
					selectCell(nextRow.id, firstCol.id, rowIndex + 1, 0);
				}
			}
		} else if (e.key === 'Enter' || e.key === 'F2') {
			e.preventDefault();
			const row = store.filteredRows[rowIndex];
			const col = store.columns[colIndex];
			startEditing(row.id, col.id, row[col.id]);
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			const row = store.filteredRows[rowIndex];
			const col = store.columns[colIndex];
			store.setCell(row.id, col.id, null);
		} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const row = store.filteredRows[rowIndex];
			const col = store.columns[colIndex];
			startEditing(row.id, col.id, '');
			editValue = e.key;
		}
	}

	function handleEditorKeyDown(e: KeyboardEvent, rowIndex: number, colIndex: number) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			commitEdit();
			if (rowIndex < store.filteredRows.length - 1) {
				const nextRow = store.filteredRows[rowIndex + 1];
				selectCell(nextRow.id, store.columns[colIndex].id, rowIndex + 1, colIndex);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		} else if (e.key === 'Tab') {
			e.preventDefault();
			commitEdit();
			if (e.shiftKey) {
				if (colIndex > 0) {
					selectCell(store.filteredRows[rowIndex].id, store.columns[colIndex - 1].id, rowIndex, colIndex - 1);
				}
			} else {
				if (colIndex < store.columns.length - 1) {
					selectCell(store.filteredRows[rowIndex].id, store.columns[colIndex + 1].id, rowIndex, colIndex + 1);
				}
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
		store.updateColumnType(colId, newType);
		onNotify('info', `Changed column type to ${COLUMN_TYPE_CONFIG[newType]?.label || newType}.`);
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
		if (!target?.closest('.column-menu-wrapper')) {
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
			<p class="empty-subtitle text-[13px] text-[var(--text-3)] max-w-sm m-0">Add a column or load a sample dataset to begin editing your tabular data.</p>
			<button class="btn-tactile btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white cursor-pointer shadow-sm mt-2" onclick={() => store.addColumn('Column 1', 'text')}>
				<Icon name="plus" size={14} />
				<span>Add First Column</span>
			</button>
		</div>
	{:else}
		<!-- Scrollable Grid Table -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="table-scroll-wrap flex-1 overflow-auto outline-none relative [scrollbar-gutter:stable] isolate bg-[var(--surface-1)]"
			tabindex="0"
			role="grid"
			aria-label="Spreadsheet grid"
			aria-rowcount={store.filteredRows.length}
			aria-colcount={store.columns.length}
			onkeydown={handleTableKeyDown}
		>
			<table class="grid-table border-separate border-spacing-0 w-full min-w-max text-[13.5px] table-fixed">
				<!-- Column Header Row -->
				<thead>
					<tr>
						<!-- Index / Row number column -->
						<th class="th-index sticky top-0 z-10 w-12 min-w-12 text-center bg-[var(--surface-2)] border-b-2 border-[var(--border-strong)] border-r border-[var(--border)] p-0 select-none" scope="col">
							<span class="index-hdr-label font-mono text-[10.5px] font-bold text-[var(--text-3)] tracking-wider">#</span>
						</th>

						<!-- Dynamic Columns -->
						{#each store.columns as col, colIndex (col.id)}
							{@const colConfig = COLUMN_TYPE_CONFIG[col.type || 'text']}
							{@const isSorted = store.sortConfig?.columnId === col.id}
							{@const sortDir = isSorted ? store.sortConfig?.direction : null}

							<th
								class="th-column sticky top-0 z-10 bg-[var(--surface-1)] border-b-2 border-[var(--border-strong)] border-r border-[var(--table-grid-line)] p-0 select-none text-[var(--text-1)] group/col"
								style="width: {col.width ? col.width + 'px' : '180px'}; min-width: 70px;"
								scope="col"
								role="columnheader"
								aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'}
							>
								<div class="th-content flex items-center px-2.5 h-[42px] gap-2">
									<!-- Column Type Icon -->
									<div class="th-type-icon flex items-center justify-center w-5 h-5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] shrink-0" title="Type: {colConfig?.label || 'Text'}" aria-hidden="true">
										<Icon name={colConfig?.icon || 'type'} size={13} />
									</div>

									<!-- Editable or Static Column Name -->
									{#if renamingColId === col.id}
										<input
											type="text"
											class="th-rename-input bg-[var(--surface-2)] border-2 border-[var(--border-focus)] rounded px-1.5 py-0.5 text-[12.8px] font-semibold text-[var(--text-1)] outline-none w-full"
											aria-label="Column Name"
											bind:value={renamingColValue}
											use:autoFocus
											onblur={commitRenameColumn}
											onkeydown={(e) => {
												if (e.key === 'Enter') commitRenameColumn();
												if (e.key === 'Escape') renamingColId = null;
											}}
										/>
									{:else}
										<button
											class="th-title-btn flex items-center justify-between flex-1 bg-transparent border-none cursor-pointer text-[var(--text-1)] font-semibold text-[12.8px] tracking-tight p-0 hover:text-[var(--accent-primary)] transition-colors min-w-0"
											onclick={() => store.setSort(col.id)}
											title="Click to sort by {col.name}"
											aria-label="Sort by {col.name}"
										>
											<span class="th-title-text truncate max-w-[130px]">{col.name}</span>
											<span class="th-sort-icon flex transition-opacity {isSorted ? 'active opacity-100 text-[var(--accent-primary)]' : 'opacity-35'}" aria-hidden="true">
												{#if sortDir === 'asc'}
													<Icon name="chevron-up" size={13} />
												{:else if sortDir === 'desc'}
													<Icon name="chevron-down" size={13} />
												{:else}
													<Icon name="chevrons-up-down" size={12} />
												{/if}
											</span>
										</button>
									{/if}

									<!-- Column Options Menu Trigger -->
									<div class="column-menu-wrapper relative flex items-center">
										<button
											class="th-menu-trigger flex items-center justify-center w-6 h-6 rounded bg-transparent hover:bg-[var(--surface-2)] border-none text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer transition-colors"
											onclick={(e) => {
												e.stopPropagation();
												activeColMenu = activeColMenu === col.id ? null : col.id;
											}}
											title="Column options"
											aria-label="Column options for {col.name}"
											aria-haspopup="menu"
											aria-expanded={activeColMenu === col.id}
										>
											<Icon name="more-horizontal" size={13} aria-hidden="true" />
										</button>

										{#if activeColMenu === col.id}
											<div class="column-popover bezel-card absolute top-[calc(100%+6px)] right-0 z-50 w-48 p-1.5 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-right animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)]" role="menu">
												<div class="popover-section-label px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">Rename / Manage</div>
												<button
													class="popover-item flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
													role="menuitem"
													onclick={() => startRenameColumn(col.id, col.name)}
												>
													<Icon name="edit" size={13} aria-hidden="true" />
													<span>Rename Column</span>
												</button>

												<div class="popover-divider h-px bg-[var(--border)] my-1"></div>
												<div class="popover-section-label px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">Column Type</div>

												{#each Object.entries(COLUMN_TYPE_CONFIG).filter(([k]) => k !== 'status') as [typeKey, typeCfg]}
													{@const normalizedColType = col.type === 'status' ? 'dropdown' : col.type}
													{@const isActiveType = normalizedColType === typeKey}
													<button
														class="popover-item flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors {isActiveType ? 'active !text-[var(--accent-primary)] !bg-emerald-500/10 font-semibold' : ''}"
														role="menuitem"
														onclick={() => handleUpdateColumnType(col.id, typeKey as ColumnType)}
													>
														<div class="flex items-center gap-2">
															<Icon name={typeCfg.icon} size={13} aria-hidden="true" />
															<span>{typeCfg.label}</span>
														</div>
														{#if isActiveType}
															<span class="check-icon text-emerald-500 font-bold text-[12px]"><Icon name="check" size={12} aria-hidden="true" /></span>
														{/if}
													</button>
												{/each}

												<div class="popover-divider h-px bg-[var(--border)] my-1"></div>
												<button
													class="popover-item popover-delete flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-rose-500 hover:!text-rose-400 hover:!bg-rose-500/10 cursor-pointer text-left transition-colors"
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
									class="th-resize-handle absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--accent-primary)] active:bg-[var(--accent-primary)] transition-colors z-10 bg-transparent border-none"
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
						<th class="th-add-col w-32 min-w-32 bg-[var(--surface-1)] border-b-2 border-[var(--border-strong)] p-0" scope="col">
							<button
								class="add-col-btn flex items-center justify-center gap-1.5 w-full h-[42px] bg-transparent border-none text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] text-[12px] font-medium cursor-pointer transition-colors"
								onclick={handleAddColumn}
								title="Add column (Text) — change type via ···"
								aria-label="Add Column"
							>
								<Icon name="plus" size={14} aria-hidden="true" />
								<span>Add Column</span>
							</button>
						</th>
					</tr>
				</thead>

				<!-- Table Rows -->
				<tbody>
					{#if store.filteredRows.length === 0}
						<tr>
							<td colspan={store.columns.length + 2} class="td-no-results text-center py-8 text-[var(--text-3)] text-[13px]" role="gridcell">
								<span>No matching rows found for "{store.searchQuery}".</span>
							</td>
						</tr>
					{:else}
						{#each store.filteredRows as row, rowIndex (row.id)}
							<tr class="data-row table-data-row h-9 border-b border-[var(--table-grid-line)] hover:bg-[var(--table-row-hover)] transition-colors group/row odd:bg-transparent even:bg-[var(--table-row-even)]" aria-rowindex={rowIndex + 1}>
								<!-- Row Index & Hover Actions -->
								<td class="td-index w-12 min-w-12 text-center bg-[var(--surface-2)] border-r border-[var(--border)] relative font-mono text-[11px] text-[var(--text-3)] select-none p-0" role="gridcell">
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
											class="row-action-btn delete w-5 h-5 rounded flex items-center justify-center text-[var(--text-3)] hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
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
									{@const isDropdown = colType === 'dropdown' || colType === 'status'}
									{@const cellVal = row ? row[col.id] : null}
									{@const isEditing = editingCell?.rowId === row?.id && editingCell?.columnId === col.id}
									{@const isActive = activeCell?.rowId === row?.id && activeCell?.columnId === col.id}
									{@const isNumeric = colType === 'number' || colType === 'currency' || colType === 'percent'}
									{@const hasVal = cellVal !== null && cellVal !== undefined && cellVal !== ''}
									{@const dropdownStyle = isDropdown && hasVal ? getDropdownStyle(String(cellVal)) : null}

									{@const isRovingActive = isActive || (!activeCell && rowIndex === 0 && colIndex === 0)}
									<td
										class="td-cell px-2.5 border-r border-[var(--table-grid-line)] relative outline-none cursor-default truncate text-[13px] text-[var(--text-1)] select-none {isNumeric ? 'numeric-cell text-right font-mono tabular-nums' : ''} {isActive ? 'active-cell z-[2] outline outline-2 outline-[var(--border-focus)] -outline-offset-2' : ''} {isEditing ? 'editing' : ''} {isDropdown ? 'status-cell dropdown-cell' : ''} {isDropdown && hasVal ? 'dropdown-filled-cell' : ''}"
										style="width: {col.width ? col.width + 'px' : '180px'}; min-width: 70px; {isDropdown && hasVal ? `background: ${dropdownStyle!.bg};` : ''}"
										role="gridcell"
										tabindex={isRovingActive ? 0 : -1}
										use:registerCellNode={`${row.id}-${col.id}`}
										onfocus={() => {
											if (!isActive) {
												selectCell(row.id, col.id, rowIndex, colIndex);
											}
										}}
										onclick={() => {
											selectCell(row.id, col.id, rowIndex, colIndex);
											if (isDropdown && typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
												startEditing(row.id, col.id, cellVal);
											}
										}}
										ondblclick={() => startEditing(row.id, col.id, cellVal)}
									>
										{#if isEditing}
											{#if isDropdown}
												{@const cellKey = `${row.id}-${col.id}`}
												<div class="status-cell-wrap flex items-center justify-between w-full h-full gap-1">
													{#if hasVal && dropdownStyle}
														<span class="status-cell-text status-val font-medium text-[12.5px] truncate" style="color: {dropdownStyle.text};">
															<span class="truncate">{cellVal}</span>
														</span>
													{:else}
														<span class="status-cell-text empty-placeholder text-[var(--text-3)] opacity-40 text-[12px]">—</span>
													{/if}
													<span class="dropdown-cell-arrow text-[10px] shrink-0" style="color: {hasVal && dropdownStyle ? dropdownStyle.text : 'var(--text-3)'}; opacity: 0.6;" aria-hidden="true">▾</span>
												</div>
												<DropdownCellEditor
													value={editValue}
													options={getColumnUniqueValues(col.id)}
													triggerEl={cellNodes.get(cellKey)}
													onCommit={(newVal) => {
														editValue = newVal;
														commitEdit();
													}}
													onCancel={() => {
														cancelEdit();
													}}
												/>
											{:else if colType === 'date'}
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
													class="cell-input cell-input-editor w-full h-full bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] font-inherit p-0 {isNumeric ? 'numeric-input text-right font-mono tabular-nums' : ''}"
													aria-label="Edit Cell Value"
													bind:value={editValue}
													onclick={(e) => e.stopPropagation()}
													use:autoFocus
													onblur={commitEdit}
													onkeydown={(e) => handleEditorKeyDown(e, rowIndex, colIndex)}
												/>
											{/if}
										{:else if isDropdown}
											<div class="status-cell-wrap flex items-center justify-between w-full h-full gap-1">
												{#if hasVal && dropdownStyle}
													<span class="status-cell-text status-val font-medium text-[12.5px] truncate" style="color: {dropdownStyle.text};">
														<span class="truncate">{cellVal}</span>
													</span>
												{:else}
													<span class="status-cell-text empty-placeholder text-[var(--text-3)] opacity-40 text-[12px]">—</span>
												{/if}
												<button
													type="button"
													class="dropdown-cell-arrow text-[10px] cursor-pointer px-1 bg-transparent border-none shrink-0 opacity-50 group-hover/row:opacity-100 hover:opacity-100"
													style="color: {hasVal && dropdownStyle ? dropdownStyle.text : 'var(--text-3)'};"
													aria-label="Open dropdown options"
													onclick={(e) => {
														e.stopPropagation();
														selectCell(row.id, col.id, rowIndex, colIndex);
														startEditing(row.id, col.id, cellVal);
													}}
												>▾</button>
											</div>
										{:else}
											<span class="cell-text-display {cellVal === null || cellVal === undefined || cellVal === '' ? 'empty-placeholder opacity-50' : ''}">
												{formatCellValue(colType, cellVal) || '—'}
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
					{/if}
				</tbody>

				<!-- Sticky Footer Summary — pony: slightly grey, visually separate -->
				<tfoot>
					<tr class="summary-row tfoot-summary-row sticky bottom-0 z-10 bg-[var(--surface-3)] border-t border-[var(--border-strong)] h-11 shadow-[0_-2px_8px_rgba(0,0,0,0.12)]">
						<td class="tf-index w-12 min-w-12 text-center border-r border-[var(--border)] font-mono text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider p-0 align-middle" role="gridcell">
							<span class="tf-label flex items-center justify-center h-full">Summary</span>
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
											<span class="sum-tag text-[9.5px] font-mono font-bold px-1 rounded bg-emerald-500/15 text-emerald-400">SUM</span>
											<span class="sum-val font-mono font-bold text-[var(--text-1)] text-[12px]">{formatCellValue(colType, summary.sum)}</span>
										</div>
										<div class="summary-line secondary-stats text-[10.5px] text-[var(--text-3)] font-mono mt-0.5">
											<span>avg {formatCellValue(colType, summary.avg)}</span>
										</div>
									{:else if isPercent && summary?.avg !== undefined}
										<div class="summary-line primary-sum flex items-center gap-1.5" title="Avg: {formatCellValue(colType, summary.avg)} | Min: {formatCellValue(colType, summary.min)} | Max: {formatCellValue(colType, summary.max)} | {summary ? summary.countNonEmpty : 0} rows">
											<span class="sum-tag tag-avg text-[9.5px] font-mono font-bold px-1 rounded bg-sky-500/15 text-sky-400">AVG</span>
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
