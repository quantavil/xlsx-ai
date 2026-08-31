<script lang="ts">
	const GROUPS: Array<{ title: string; items: Array<[string, string[]]> }> = [
		{
			title: 'Navigate',
			items: [
				['Move active cell', ['↑', '↓', '←', '→']],
				['Extend selection', ['Shift', '↑ ↓ ← →']],
				['Extend selection to cell', ['Shift', 'Click']],
				['Move and edit next cell', ['Tab']],
				['Search rows', ['Ctrl', 'K']],
				['Toggle AI assistant', ['Ctrl', '/']],
				['Settings', ['Ctrl', ',']]
			]
		},
		{
			title: 'Edit',
			items: [
				['Edit cell', ['Enter']],
				['Copy selection', ['Ctrl', 'C']],
				['Clear selection', ['Del']],
				['Align left / center / right', ['Ctrl', 'Shift', 'L / E / R']],
				['Rename column', ['Double-click']],
				['Add row', ['Ctrl', 'N']],
				['Undo / Redo', ['Ctrl', 'Z']],
				['Close panel / menu', ['Esc']]
			]
		},
		{
			title: 'Cursor Mode',
			items: [
				['Add / remove cursor', ['Ctrl', 'Click']],
				['Add cursor above / below', ['Ctrl', 'Alt', '↑ / ↓']],
				['Back to one cursor', ['Esc']]
			]
		}
	];
</script>

<div class="settings-section shortcuts-section flex flex-col gap-4">
	<div class="section-header">
		<h2 class="text-sm font-bold text-[var(--text-1)] m-0">Keyboard shortcuts</h2>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
		{#each GROUPS as group (group.title)}
			<div class="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3.5 flex flex-col gap-2">
				<h3 class="text-[11px] font-bold text-[var(--text-3)] m-0 uppercase tracking-wider">
					{group.title}
				</h3>
				<div class="flex flex-col divide-y divide-[var(--border)]">
					{#each group.items as [label, keys] (label)}
						<div class="flex justify-between items-center gap-2 py-1.5 text-[12.5px]">
							<span class="text-[var(--text-2)]">{label}</span>
							<span class="flex gap-1 items-center shrink-0">
								{#each keys as key (key)}
									<kbd class="bg-[var(--surface-1)] border border-[var(--border)] rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--text-1)]">
										{key}
									</kbd>
								{/each}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
