<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import type { Column, Row } from '$lib/types';
	import {
		distinctValuesForColumn,
		conditionOpsForType,
		type ColumnFilter,
		type ConditionOp
	} from './filters';

	let {
		column,
		resolvedRows,
		style,
		existingFilter,
		hasActiveFilters,
		activeFilterCount,
		onApplyValueFilter,
		onApplyConditionFilter,
		onClearFilter,
		onClearAllFilters,
		onClose
	}: {
		column: Column;
		resolvedRows: Row[];
		style: string;
		existingFilter?: ColumnFilter;
		hasActiveFilters: boolean;
		activeFilterCount: number;
		onApplyValueFilter: (values: string[]) => void;
		onApplyConditionFilter: (op: ConditionOp, value: string, value2?: string) => void;
		onClearFilter: () => void;
		onClearAllFilters: () => void;
		onClose: () => void;
	} = $props();

	let filterTab = $state<'values' | 'condition'>('values');
	let draftValues = $state<Set<string>>(new Set());
	let draftConditionOp = $state<ConditionOp>('contains');
	let draftConditionValue = $state<string>('');
	let draftConditionValue2 = $state<string>('');
	let valueSearchQuery = $state<string>('');

	const colDistinct = $derived(distinctValuesForColumn(resolvedRows, column.id));
	const filteredDistinct = $derived(
		valueSearchQuery
			? colDistinct.filter((v) => v.toLowerCase().includes(valueSearchQuery.toLowerCase()))
			: colDistinct
	);
	const ops = $derived(conditionOpsForType(column.type));

	$effect(() => {
		if (existingFilter) {
			if (existingFilter.kind === 'values') {
				filterTab = 'values';
				draftValues = new Set(existingFilter.values);
			} else {
				filterTab = 'condition';
				draftConditionOp = existingFilter.op;
				draftConditionValue = existingFilter.value ?? '';
				draftConditionValue2 = existingFilter.value2 ?? '';
			}
		} else {
			filterTab = 'values';
			draftValues = new Set(colDistinct);
			draftConditionOp = ops[0]?.op ?? 'contains';
			draftConditionValue = '';
			draftConditionValue2 = '';
		}
	});
</script>

<div
	class="filter-popover bezel-card fixed z-50 w-80 p-0 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-left animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)] flex flex-col max-h-[min(70vh,420px)] overflow-hidden"
	{style}
	role="dialog"
	tabindex="-1"
	aria-label="Filter {column.name}"
>
	<div class="filter-popover-header flex items-center justify-between px-3 pt-3 pb-2 border-b border-[var(--border)]">
		<span class="text-[12.5px] font-bold text-[var(--text-1)] truncate">Filter {column.name}</span>
		<button
			class="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
			onclick={onClose}
			aria-label="Close filter"
		>
			<Icon name="x" size={12} aria-hidden="true" />
		</button>
	</div>
	<div class="filter-tabs flex gap-1 px-2 pt-2">
		<button
			class="flex-1 py-1.5 text-[11.5px] font-semibold rounded-lg border cursor-pointer transition-colors {filterTab === 'values' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary-border)]' : 'bg-transparent text-[var(--text-3)] border-transparent hover:bg-[var(--surface-2)]'}"
			onclick={() => (filterTab = 'values')}
		>
			Values
		</button>
		<button
			class="flex-1 py-1.5 text-[11.5px] font-semibold rounded-lg border cursor-pointer transition-colors {filterTab === 'condition' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary-border)]' : 'bg-transparent text-[var(--text-3)] border-transparent hover:bg-[var(--surface-2)]'}"
			onclick={() => (filterTab = 'condition')}
		>
			Condition
		</button>
	</div>
	{#if filterTab === 'values'}
		<div class="filter-values-pane flex flex-col flex-1 min-h-0 p-3 gap-2">
			{#if colDistinct.length > 8}
				<input
					type="text"
					placeholder="Search values…"
					class="filter-value-search w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-focus)]"
					bind:value={valueSearchQuery}
					aria-label="Search filter values"
				/>
			{/if}
			<div class="flex items-center gap-1.5">
				<button
					class="text-[11px] font-medium px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
					onclick={() => { draftValues = new Set(colDistinct); }}
				>
					Select all
				</button>
				<button
					class="text-[11px] font-medium px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
					onclick={() => { draftValues = new Set(); }}
				>
					Clear
				</button>
				<span class="ml-auto text-[11px] text-[var(--text-3)]">{draftValues.size}/{colDistinct.length} selected</span>
			</div>
			<div class="filter-values-list flex-1 overflow-y-auto border border-[var(--border)] rounded-lg bg-[var(--surface-2)] max-h-[180px] p-1 flex flex-col gap-0.5">
				{#each filteredDistinct as v (v)}
					{@const label = v === '' ? '(Empty)' : v}
					{@const id = `filter-${column.id}-${v === '' ? '__empty__' : v}`}
					<label for={id} class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-1)] cursor-pointer text-[12px] text-[var(--text-1)]">
						<input
							{id}
							type="checkbox"
							class="w-3.5 h-3.5 rounded border-[var(--border)] accent-[var(--accent-primary)]"
							checked={draftValues.has(v)}
							onchange={(e) => {
								const c = e.currentTarget as HTMLInputElement;
								const next = new Set(draftValues);
								if (c.checked) next.add(v);
								else next.delete(v);
								draftValues = next;
							}}
						/>
						<span class="truncate">{label}</span>
					</label>
				{/each}
				{#if filteredDistinct.length === 0}
					<span class="text-[11px] text-[var(--text-3)] px-2 py-2">No values match.</span>
				{/if}
			</div>
			<div class="flex items-center gap-2 pt-1">
				<button
					class="flex-1 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] text-[12px] font-semibold cursor-pointer"
					onclick={() => onApplyValueFilter(Array.from(draftValues))}
				>
					Apply
				</button>
				<button
					class="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] text-[12px] font-medium hover:text-[var(--text-1)] cursor-pointer"
					onclick={onClearFilter}
				>
					Clear filter
				</button>
			</div>
		</div>
	{:else}
		<div class="filter-condition-pane flex flex-col gap-2 p-3">
			<label class="text-[11px] font-semibold text-[var(--text-2)]" for="filter-op-{column.id}">Condition</label>
			<select
				id="filter-op-{column.id}"
				class="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--border-focus)]"
				bind:value={draftConditionOp}
			>
				{#each ops as o (o.op)}
					<option value={o.op}>{o.label}</option>
				{/each}
			</select>
			{#if draftConditionOp !== 'isEmpty' && draftConditionOp !== 'isNotEmpty'}
				<label class="text-[11px] font-semibold text-[var(--text-2)]" for="filter-val-{column.id}">
					{draftConditionOp === 'between' ? 'From' : 'Value'}
				</label>
				<input
					id="filter-val-{column.id}"
					type="text"
					placeholder={column.type === 'date' ? 'YYYY-MM-DD' : column.type === 'number' || column.type === 'currency' || column.type === 'percent' ? 'Number' : 'Text'}
					class="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-focus)]"
					bind:value={draftConditionValue}
				/>
				{#if draftConditionOp === 'between'}
					<label class="text-[11px] font-semibold text-[var(--text-2)]" for="filter-val2-{column.id}">To</label>
					<input
						id="filter-val2-{column.id}"
						type="text"
						placeholder={column.type === 'date' ? 'YYYY-MM-DD' : 'Number'}
						class="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-focus)]"
						bind:value={draftConditionValue2}
					/>
				{/if}
			{/if}
			<div class="flex items-center gap-2 pt-2">
				<button
					class="flex-1 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] text-[12px] font-semibold cursor-pointer"
					onclick={() => onApplyConditionFilter(draftConditionOp, draftConditionValue, draftConditionOp === 'between' ? draftConditionValue2 : undefined)}
				>
					Apply
				</button>
				<button
					class="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] text-[12px] font-medium hover:text-[var(--text-1)] cursor-pointer"
					onclick={onClearFilter}
				>
					Clear filter
				</button>
			</div>
		</div>
	{/if}
	{#if hasActiveFilters}
		<div class="filter-global-actions px-3 pb-3 pt-1 border-t border-[var(--border)] flex justify-between items-center">
			<span class="text-[11px] text-[var(--text-3)]">{activeFilterCount} filtered</span>
			<button
				class="text-[11px] font-semibold text-[var(--accent-rose)] hover:underline cursor-pointer bg-transparent border-none p-0"
				onclick={onClearAllFilters}
			>
				Clear all filters
			</button>
		</div>
	{/if}
</div>
