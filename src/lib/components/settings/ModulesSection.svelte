<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import { BUILTIN_MODULES } from '$lib/modules/registry';
	import type { createModuleStore } from '$lib/modules/module-store.svelte';

	let {
		moduleStore
	}: {
		moduleStore: ReturnType<typeof createModuleStore>;
	} = $props();
</script>

<div class="settings-section modules-section flex flex-col gap-5">
	<div class="section-header">
		<h3 class="text-base font-bold text-[var(--text-1)] m-0 mb-1">Workspace Modules</h3>
		<p class="section-subtitle text-[13px] text-[var(--text-3)] m-0">
			Enable or disable specialized workflow tools and domain-specific document processors.
		</p>
	</div>

	<div class="modules-list flex flex-col gap-3">
		{#each BUILTIN_MODULES as mod (mod.id)}
			{@const isEnabled = moduleStore.isEnabled(mod.id)}
			<div class="module-card bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3 transition-colors {isEnabled ? 'border-[var(--border-strong)]' : 'opacity-85'}">
				<div class="module-card-top flex items-start justify-between gap-4">
					<div class="module-info-group flex items-start gap-3">
						<div class="module-icon-box w-9 h-9 rounded-lg flex items-center justify-center shrink-0 {isEnabled ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'bg-[var(--surface-3)] text-[var(--text-3)]'}">
							<Icon name={mod.ribbon.icon} size={18} />
						</div>
						<div class="module-title-group flex flex-col gap-1">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="module-name text-[14px] font-semibold text-[var(--text-1)]">{mod.name}</span>
								<span class="badge badge-version text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-3)]">v{mod.version}</span>
								{#if mod.requirements.gemini}
									<span class="badge badge-gemini text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Gemini AI</span>
								{/if}
							</div>
							<p class="module-desc text-[12.5px] text-[var(--text-2)] m-0 leading-relaxed">{mod.description}</p>
						</div>
					</div>

					<!-- Toggle Switch -->
					<button
						type="button"
						role="switch"
						aria-checked={isEnabled}
						aria-label="Toggle {mod.name}"
						class="toggle-switch relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] {isEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--surface-3)]'}"
						onclick={() => moduleStore.toggle(mod.id)}
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out {isEnabled ? 'translate-x-5' : 'translate-x-0'}"
						></span>
					</button>
				</div>

				<div class="module-meta-footer pt-2 border-t border-[var(--border)] flex items-center justify-between text-[11.5px] text-[var(--text-3)]">
					<div class="flex items-center gap-1.5">
						<span>Accepted Files:</span>
						<code class="font-mono px-1.5 py-0.5 rounded bg-[var(--surface-1)] text-[var(--text-2)] border border-[var(--border)]">{mod.ribbon.fileInput.accept}</code>
					</div>
					<div class="status-indicator flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full {isEnabled ? 'bg-emerald-500' : 'bg-[var(--text-3)]'}"></span>
						<span>{isEnabled ? 'Enabled in Ribbon' : 'Disabled'}</span>
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>
