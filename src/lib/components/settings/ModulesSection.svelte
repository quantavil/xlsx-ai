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

<div class="settings-section modules-section flex flex-col gap-4">
	<div class="section-header">
		<h2 class="text-sm font-bold text-[var(--text-1)] m-0">Workspace Modules</h2>
	</div>

	<div class="modules-list flex flex-col gap-3">
		{#each BUILTIN_MODULES as mod (mod.id)}
			{@const isEnabled = moduleStore.isEnabled(mod.id)}
			<div class="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3 transition-colors {isEnabled ? 'border-[var(--border-strong)]' : 'opacity-75'}">
				<div class="flex items-start justify-between gap-3">
					<div class="flex items-start gap-3 min-w-0">
						<div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 {isEnabled ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'bg-[var(--surface-3)] text-[var(--text-3)]'}">
							<Icon name={mod.ribbon.icon} size={16} />
						</div>
						<div class="flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-1.5 flex-wrap">
								<span class="text-[13px] font-semibold text-[var(--text-1)]">{mod.name}</span>
								<span class="text-[10.5px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-3)] text-[var(--text-3)]">v{mod.version}</span>
								{#if mod.requirements.gemini}
									<span class="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">Gemini</span>
								{/if}
							</div>
							<p class="text-[12px] text-[var(--text-2)] m-0 leading-relaxed">{mod.description}</p>
						</div>
					</div>

					<!-- Toggle Switch -->
					<button
						type="button"
						role="switch"
						aria-checked={isEnabled}
						aria-label="Toggle {mod.name}"
						class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] {isEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--surface-3)]'}"
						onclick={() => moduleStore.toggle(mod.id)}
					>
						<span
							class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out {isEnabled ? 'translate-x-4' : 'translate-x-0'}"
						></span>
					</button>
				</div>

				{#if mod.settings && isEnabled}
					{@const SettingsPanel = mod.settings.component}
					<div class="pt-3 border-t border-[var(--border)] flex flex-col gap-2.5">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">{mod.settings.label}</span>
						<SettingsPanel />
					</div>
				{/if}

				<div class="pt-2.5 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--text-3)]">
					<div class="flex items-center gap-1 font-mono">
						<span>Files:</span>
						<span class="px-1.5 py-0.5 rounded bg-[var(--surface-1)] text-[var(--text-2)] border border-[var(--border)]">{mod.ribbon.fileInput.accept}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 rounded-full {isEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-3)]'}"></span>
						<span>{isEnabled ? 'Enabled in Ribbon' : 'Disabled'}</span>
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>
