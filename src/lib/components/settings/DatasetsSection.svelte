<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';

	let {
		store,
		onLoadSample
	}: {
		store: ReturnType<typeof createTableStore>;
		onLoadSample: (key: 'saas' | 'sales' | 'inventory') => void;
	} = $props();

	const samples = [
		{
			key: 'saas' as const,
			title: 'SaaS Revenue & Retention',
			desc: '25 rows featuring Monthly Recurring Revenue, Churn rates, Plan tiers, and renewal dates.',
			badge: 'SaaS Metrics'
		},
		{
			key: 'sales' as const,
			title: 'Global Sales Pipeline',
			desc: '25 sales opportunities across EMEA, APAC, and Americas with deal probabilities and stages.',
			badge: 'B2B Sales'
		},
		{
			key: 'inventory' as const,
			title: 'Hardware Inventory',
			desc: '25 electronic and hardware SKUs with real-time stock levels, unit costs, and reorder alerts.',
			badge: 'Supply Chain'
		}
	];
</script>

<div class="settings-section datasets-section flex flex-col gap-5">
	<div class="section-header">
		<h3 class="text-base font-bold text-[var(--text-1)] m-0 mb-1">Sample Datasets</h3>
		<p class="section-subtitle text-[13px] text-[var(--text-3)] m-0">
			Reset or test the workspace with pre-configured rich sample spreadsheets.
		</p>
	</div>

	<div class="dataset-grid flex flex-col gap-3">
		{#each samples as sample (sample.key)}
			<div class="dataset-card bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-2">
				<div class="dataset-card-top flex justify-between items-center gap-3">
					<div class="dataset-title-group flex items-center gap-2">
						<span class="dataset-title text-[14px] font-semibold text-[var(--text-1)]">{sample.title}</span>
						<span class="badge badge-neutral text-[11px] font-semibold px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-2)]">{sample.badge}</span>
					</div>
					<button
						type="button"
						class="btn-tactile btn-primary-cta btn-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white cursor-pointer transition-colors shadow-sm"
						onclick={() => onLoadSample(sample.key)}
					>
						<Icon name="database" size={13} />
						<span>Load Dataset</span>
					</button>
				</div>
				<p class="dataset-desc text-[12.5px] text-[var(--text-2)] m-0 leading-relaxed">{sample.desc}</p>
			</div>
		{/each}
	</div>
</div>
