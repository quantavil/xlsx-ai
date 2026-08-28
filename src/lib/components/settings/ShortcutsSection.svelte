<script lang="ts">
	// Data-driven so a new shortcut is one line, not eighteen of duplicated kbd markup.
	const GROUPS: Array<{ title: string; items: Array<[string, string[]]> }> = [
		{
			title: 'Navigate',
			items: [
				['Move active cell', ['↑', '↓', '←', '→']],
				['Extend selection', ['Shift', '↑ ↓ ← →']],
				['Extend selection to a cell', ['Shift', 'Click']],
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
				['Rename column', ['Double-click header']],
				['Add row', ['Ctrl', 'N']],
				['Undo / Redo', ['Ctrl', 'Z']],
				['Close panel or menu', ['Esc']]
			]
		}
	];
</script>

<section class="settings-section shortcuts-section flex flex-col gap-4">
	<div class="section-header">
		<h3 class="text-[15px] font-bold text-[var(--text-1)] m-0 mb-1">Keyboard shortcuts</h3>
		<p class="section-subtitle text-[12.5px] text-[var(--text-3)] m-0">
			The grid follows Excel conventions.
		</p>
	</div>

	<div class="shortcuts-grid grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
		{#each GROUPS as group (group.title)}
			<div class="shortcut-group flex flex-col gap-1.5">
				<h4 class="text-[10.5px] font-bold text-[var(--text-3)] m-0 uppercase tracking-wider">
					{group.title}
				</h4>
				{#each group.items as [label, keys] (label)}
					<div class="shortcut-row flex justify-between items-center gap-3 py-1 text-[12.5px]">
						<span class="text-[var(--text-2)]">{label}</span>
						<span class="flex gap-1 items-center shrink-0">
							{#each keys as key (key)}
								<kbd
									class="bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--text-2)]"
									>{key}</kbd
								>
							{/each}
						</span>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</section>
