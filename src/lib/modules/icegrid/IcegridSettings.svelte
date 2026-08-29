<script lang="ts">
	import { getCatalogSnapshot, normalizeStateKey } from './catalogs';
	import { loadProfile, saveProfile, EMPTY_PROFILE, type IcegridProfile } from './profile';
	import { SCHEDULES_PROVENANCE } from './catalogs/generated/provenance';
	import type { IcegridCatalogId } from './catalogs/types';

	const catalogs = getCatalogSnapshot();
	let profile = $state<IcegridProfile>(loadProfile());

	const FIELDS: {
		key: keyof IcegridProfile;
		label: string;
		catalog: IcegridCatalogId;
		hint: string;
	}[] = [
		{ key: 'endUse', label: 'End use', catalog: 'endUse', hint: 'What the buyer does with the goods' },
		{ key: 'igstPaymentStatus', label: 'IGST payment status', catalog: 'igstPaymentStatus', hint: 'Used when the invoice does not say' },
		{ key: 'applicableExpSchemes', label: 'Export scheme', catalog: 'scheme', hint: 'Complete entry, e.g. 19-Drawback (DBK)' },
		{ key: 'rewardItem', label: 'Reward item', catalog: 'rewardItem', hint: '' },
		{ key: 'ftaCode', label: 'FTA code', catalog: 'fta', hint: 'Leave blank unless a preference is claimed' },
		{ key: 'stateOrigin', label: 'State of origin', catalog: 'state', hint: 'Read from your GSTIN when the invoice shows one' },
		{ key: 'districtOrigin', label: 'District of origin', catalog: 'district', hint: 'Narrowed to the state above' }
	];

	// Districts are state-scoped, so the list follows whichever state is selected above.
	const optionsFor = (id: IcegridCatalogId) =>
		id === 'district'
			? catalogs.district.filter(
					(o) => normalizeStateKey(o.parentValue) === normalizeStateKey(profile.stateOrigin)
				)
			: catalogs[id];

	function update<K extends keyof IcegridProfile>(key: K, value: IcegridProfile[K]) {
		profile = { ...profile, [key]: value };
		saveProfile(profile);
	}

	function onSelect(key: keyof IcegridProfile, event: Event) {
		const value = (event.target as HTMLSelectElement).value;
		// A district belongs to one state, so changing the state drops a stale district.
		if (key === 'stateOrigin' && value !== profile.stateOrigin) profile.districtOrigin = null;
		update(key, (value || null) as IcegridProfile[keyof IcegridProfile]);
	}

	function onRate(event: Event) {
		const raw = (event.target as HTMLInputElement).value.trim();
		const n = Number(raw);
		update('exchangeRate', raw && Number.isFinite(n) && n > 0 ? n : null);
	}

	function clearAll() {
		profile = { ...EMPTY_PROFILE };
		saveProfile(profile);
	}

	let setCount = $derived(Object.values(profile).filter((v) => v !== null && v !== '').length);
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-start justify-between gap-3">
		<p class="text-[11.5px] text-[var(--text-3)] m-0 leading-relaxed max-w-[52ch]">
			These values are the same for every shipment you file and appear on no invoice or
			packing list. Set them once and each import fills them in; leave any of them blank to
			keep that column empty.
		</p>
		<button
			type="button"
			class="text-[11px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] shrink-0 transition-colors"
			onclick={clearAll}
			disabled={setCount === 0}
		>Clear all</button>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
		{#each FIELDS as field (field.key)}
			{@const options = optionsFor(field.catalog)}
			<label class="flex flex-col gap-1">
				<span class="text-[11px] font-semibold text-[var(--text-2)]">{field.label}</span>
				<select
					value={(profile[field.key] as string) ?? ''}
					onchange={(e) => onSelect(field.key, e)}
					disabled={options.length === 0}
					class="text-[12px] px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-1)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
				>
					<option value="">{options.length === 0 ? '— pick a state first —' : '— not set —'}</option>
					{#each options as opt (opt.value)}
						<option value={opt.value}>{opt.label ? `${opt.value} — ${opt.label}` : opt.value}</option>
					{/each}
				</select>
				{#if field.hint}
					<span class="text-[10.5px] text-[var(--text-3)] leading-snug">{field.hint}</span>
				{/if}
			</label>
		{/each}

		<label class="flex flex-col gap-1">
			<span class="text-[11px] font-semibold text-[var(--text-2)]">Exchange rate (INR)</span>
			<input
				type="number"
				step="0.01"
				min="0"
				value={profile.exchangeRate ?? ''}
				oninput={onRate}
				placeholder="e.g. 92.50"
				class="text-[12px] px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
			/>
			<span class="text-[10.5px] text-[var(--text-3)] leading-snug">Fallback when the invoice does not print one</span>
		</label>
	</div>

	<p class="text-[10.5px] text-[var(--text-3)] m-0 leading-relaxed border-t border-[var(--border)] pt-2.5">
		Drawback and RoDTEP values come from bundled snapshots of
		<span class="font-mono text-[var(--text-2)]">{SCHEDULES_PROVENANCE.drawback.notification}</span>
		and RoDTEP Appendix 4R effective {SCHEDULES_PROVENANCE.rodtep.effectiveFrom}. Check the current
		notification before filing.
	</p>
</div>
