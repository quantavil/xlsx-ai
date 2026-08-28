<script lang="ts">
	let {
		theme,
		onToggleTheme
	}: {
		theme: 'dark' | 'light';
		onToggleTheme: () => void;
	} = $props();
</script>

<div class="settings-section appearance-section flex flex-col gap-5">
	<div class="section-header">
		<h3 class="text-base font-bold text-[var(--text-1)] m-0 mb-1">Appearance & Theme</h3>
		<p class="section-subtitle text-[13px] text-[var(--text-3)] m-0">
			Customize the workspace color palette and contrast mode.
		</p>
	</div>

	<div class="card-setting bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3.5">
		<div class="card-setting-header flex items-start justify-between">
			<div class="setting-title-group flex flex-col gap-0.5">
				<span class="setting-label text-[14px] font-semibold text-[var(--text-1)]">Interface Theme</span>
				<span class="setting-hint text-[12px] text-[var(--text-3)]">Toggle between dark obsidian mode and crisp light mode</span>
			</div>
		</div>

		<div class="theme-picker-grid grid grid-cols-1 sm:grid-cols-2 gap-3.5">
			<button
				type="button"
				class="theme-card bg-[var(--surface-1)] border-2 rounded-xl p-3 cursor-pointer text-left flex flex-col gap-2.5 transition-all {theme === 'dark' ? 'active border-[var(--accent-primary)] bg-emerald-500/5 ring-1 ring-emerald-500/20' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}"
				onclick={() => {
					if (theme !== 'dark') onToggleTheme();
				}}
				role="radio"
				aria-checked={theme === 'dark'}
			>
				<div class="theme-preview theme-dark-preview h-20 rounded-lg overflow-hidden flex flex-col p-1.5 gap-1 bg-[#0f1117] border border-[#232736]">
					<div class="preview-header h-3.5 bg-[#1b1f2e] rounded-sm"></div>
					<div class="preview-grid flex gap-1 flex-1">
						<div class="preview-cell flex-1 bg-[#151824] rounded-sm"></div>
						<div class="preview-cell flex-1 bg-[#151824] rounded-sm"></div>
						<div class="preview-cell flex-1 bg-[#151824] rounded-sm"></div>
					</div>
				</div>
				<div class="theme-card-info flex flex-col gap-0.5">
					<span class="theme-name text-[13px] font-semibold text-[var(--text-1)]">Dark Mode</span>
					<span class="theme-desc text-[11.5px] text-[var(--text-3)]">Obsidian dark, high-contrast</span>
				</div>
			</button>

			<button
				type="button"
				class="theme-card bg-[var(--surface-1)] border-2 rounded-xl p-3 cursor-pointer text-left flex flex-col gap-2.5 transition-all {theme === 'light' ? 'active border-[var(--accent-primary)] bg-emerald-500/5 ring-1 ring-emerald-500/20' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}"
				onclick={() => {
					if (theme !== 'light') onToggleTheme();
				}}
				role="radio"
				aria-checked={theme === 'light'}
			>
				<div class="theme-preview theme-light-preview h-20 rounded-lg overflow-hidden flex flex-col p-1.5 gap-1 bg-[#f8fafc] border border-[#e2e8f0]">
					<div class="preview-header h-3.5 bg-[#e2e8f0] rounded-sm"></div>
					<div class="preview-grid flex gap-1 flex-1">
						<div class="preview-cell flex-1 bg-white border border-[#e2e8f0] rounded-sm"></div>
						<div class="preview-cell flex-1 bg-white border border-[#e2e8f0] rounded-sm"></div>
						<div class="preview-cell flex-1 bg-white border border-[#e2e8f0] rounded-sm"></div>
					</div>
				</div>
				<div class="theme-card-info flex flex-col gap-0.5">
					<span class="theme-name text-[13px] font-semibold text-[var(--text-1)]">Light Mode</span>
					<span class="theme-desc text-[11.5px] text-[var(--text-3)]">Paper-white spreadsheet look</span>
				</div>
			</button>
		</div>
	</div>
</div>
