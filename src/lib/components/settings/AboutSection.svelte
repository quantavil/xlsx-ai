<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
</script>

<div class="settings-section about-section flex flex-col gap-5">
	<div class="section-header">
		<h3 class="text-base font-bold text-[var(--text-1)] m-0 mb-1">About xlsx-ai</h3>
		<p class="section-subtitle text-[13px] text-[var(--text-3)] m-0">
			Professional AI-powered tabular workspace built for rapid spreadsheet intelligence.
		</p>
	</div>

	<div class="about-card bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-4">
		<div class="about-hero flex items-center gap-3.5">
			<div class="about-logo w-11 h-11 rounded-lg bg-[var(--accent-primary)] text-white flex items-center justify-center shadow-sm">
				<Icon name="sparkles" size={22} />
			</div>
			<div>
				<h4 class="about-title text-base font-bold text-[var(--text-1)] m-0 mb-0.5">xlsx-ai Workspace</h4>
				<span class="about-version text-[12px] text-[var(--text-3)]">Version 2.0 (Gemini 2.5 / 3.5 Ready)</span>
			</div>
		</div>

		<p class="about-text text-[13px] text-[var(--text-2)] leading-relaxed m-0">
			xlsx-ai pairs full client-side Excel (.xlsx) and CSV spreadsheet processing with Google Gemini generative models.
			Your data remains in your browser unless you explicitly query the AI assistant.
		</p>

		<div class="privacy-bullet-list flex flex-col gap-2 border-t border-[var(--border)] pt-3.5">
			<div class="privacy-bullet flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
				<span class="text-emerald-400 shrink-0"><Icon name="check" size={14} /></span>
				<span>API keys are stored strictly in client-side localStorage.</span>
			</div>
			<div class="privacy-bullet flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
				<span class="text-emerald-400 shrink-0"><Icon name="check" size={14} /></span>
				<span>Zero analytics tracking or third-party telemetry.</span>
			</div>
			<div class="privacy-bullet flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
				<span class="text-emerald-400 shrink-0"><Icon name="check" size={14} /></span>
				<span>CSV formula injection safeguards enabled by default.</span>
			</div>
		</div>
	</div>
</div>
