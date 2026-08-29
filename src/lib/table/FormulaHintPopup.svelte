<script lang="ts">
	import type { FormulaFunction } from './formula-hints';

	let {
		matches,
		highlight,
		anchor,
		onpick
	}: {
		matches: FormulaFunction[];
		highlight: number;
		/** Viewport rect of the cell being edited; the list hangs below it. */
		anchor: { left: number; bottom: number; maxHeight: number } | null;
		onpick: (fn: FormulaFunction) => void;
	} = $props();
</script>

{#if matches.length > 0 && anchor}
	<ul
		class="formula-hints fixed z-50 m-0 min-w-56 list-none overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] p-1 shadow-lg"
		style="left: {anchor.left}px; top: {anchor.bottom}px; max-height: {Math.min(anchor.maxHeight, 224)}px;"
		role="listbox"
		aria-label="Formula suggestions"
	>
		{#each matches as fn, i (fn.name)}
			<li role="presentation">
				<!-- mousedown, not click: the editor input must not lose focus first. -->
				<button
					type="button"
					class="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-[12.5px] cursor-pointer border-none {i ===
					highlight
						? 'bg-[var(--accent-primary-bg)] text-[var(--text-1)]'
						: 'bg-transparent text-[var(--text-2)] hover:bg-[var(--surface-3)]'}"
					role="option"
					aria-selected={i === highlight}
					onmousedown={(e) => {
						e.preventDefault();
						onpick(fn);
					}}
				>
					<span class="font-mono font-semibold text-[var(--accent-primary)]">{fn.name}</span>
					<span class="truncate font-mono text-[11px] text-[var(--text-3)]">{fn.signature}</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}
