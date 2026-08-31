<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icons.svelte';
	import { normalizeStateKey } from './catalogs';
	import type { IcegridCatalogId, IcegridCatalogOption } from './catalogs/types';
	import { rateFor, requestExchangeRates, type ExchangeRate } from './exchange-rate';
	import { requestTariffSearch, tariffLeaf, type TariffCandidate } from './tariff';
	import { requestDutyLookups } from './duty-lookup.client';
	import { selectDrawbackSerial } from './duty-lookup';
	import type { DropdownOption } from '$lib/types';
	import {
		clearCodeDerived,
		defaultAnswers,
		type IcegridAnswers,
		type IcegridConfirmInput,
		type IcegridInvoiceAnswer,
		type IcegridRitcAnswer
	} from './confirm';

	let {
		input,
		onDone
	}: { input: IcegridConfirmInput; onDone: (answers: IcegridAnswers | null) => void } = $props();

	// `input` is fixed for the life of the dialog - it is mounted once, imperatively,
	// with one run's proposals - so seeding editable state from it is not a missed
	// dependency.
	let answers = $state<IcegridAnswers>(untrack(() => defaultAnswers(input)));
	let rates = $state<ExchangeRate[]>(untrack(() => [...input.rates]));
	let refreshing = $state<boolean>(false);
	let rateEdited = $state<boolean>(false);

	const catalog = (id: IcegridCatalogId): readonly IcegridCatalogOption[] => input.catalogs[id];

	// Districts are state-scoped, so the list follows whichever state is selected.
	const districtOptions = $derived(
		input.catalogs.district.filter(
			(o) => normalizeStateKey(o.parentValue) === normalizeStateKey(answers.invoice.StateOrigin)
		)
	);

	const optionLabel = (o: { value: string; label?: string }) =>
		o.label ? `${o.value} — ${o.label}` : o.value;

	function setInvoice<K extends keyof IcegridInvoiceAnswer>(key: K, value: string) {
		// A district belongs to one state, so changing the state drops a stale district.
		if (key === 'StateOrigin' && value !== answers.invoice.StateOrigin) {
			answers.invoice.DistrictOrigin = null;
		}
		answers.invoice[key] = (value || null) as IcegridInvoiceAnswer[K];
	}

	function setRitc(key: string, field: keyof IcegridRitcAnswer, raw: string) {
		const group = answers.perRitc[key];
		if (!group) return;
		if (field === 'IGST_Rate') {
			const n = Number(raw);
			group.IGST_Rate = raw.trim() !== '' && Number.isFinite(n) ? n : null;
		} else {
			group[field] = raw || null;
		}
	}

	// Picking a currency takes the board's rate for it, unless a rate was typed by
	// hand - that is a deliberate override and must survive a currency correction.
	function onCurrency(code: string) {
		answers.currency = code || null;
		if (!rateEdited) answers.exchangeRate = rateFor(rates, answers.currency);
	}

	function onRate(raw: string) {
		const n = Number(raw);
		rateEdited = true;
		answers.exchangeRate = raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
	}

	async function refreshRates() {
		if (refreshing) return;
		refreshing = true;
		const wasEdited = rateEdited;
		const startingCurrency = answers.currency;
		const batch = await requestExchangeRates();
		if (batch.rates.length > 0) {
			rates = batch.rates;
			if (wasEdited && answers.currency === startingCurrency) {
				rateEdited = true;
			} else {
				rateEdited = false;
				answers.exchangeRate = rateFor(rates, answers.currency) ?? answers.exchangeRate;
			}
		}
		refreshing = false;
	}

	// Per-item state for the tariff pickers. Kept beside `answers` rather than inside
	// it because none of it is an answer - it is the evidence the user reads to give
	// one, and it must not travel back to the pipeline.
	let itemSearch = $state<Record<string, string>>({});
	let itemFound = $state<Record<string, TariffCandidate[]>>({});
	let itemSearching = $state<Record<string, boolean>>({});
	/**
	 * Duty structure per tariff CODE, never per item.
	 *
	 * Keyed by item, a second choice short-circuited on the cache from the first and
	 * left the previous code's serials in the dropdown - so a row could be filed
	 * under one tariff code carrying another's drawback claim.
	 */
	let dutyByCode = $state<Record<string, { options: DropdownOption[]; suggested: string | null; rodtep: string }>>({});

	/**
	 * The headings a tariff item hangs under, for the muted half of its label.
	 *
	 * DGFT returns the whole path and a heading's children all share it: every one of
	 * `4421`'s twenty-three reads "Spools, cops, bobbins, sewing thread reels and the
	 * like of turned wood: ..." and only the tail says which is which. Leading with the
	 * path made six options look like one option repeated six times.
	 */
	function pathAbove(description: string): string {
		return description.slice(0, -tariffLeaf(description).length).replace(/[\s:]+$/, '');
	}

	/** The classifier's suggestions plus anything the user searched up, deduped. */
	function candidatesFor(item: { key: string; candidates: TariffCandidate[] }): TariffCandidate[] {
		const byCode = new Map<string, TariffCandidate>();
		for (const c of [...item.candidates, ...(itemFound[item.key] ?? [])]) {
			if (!byCode.has(c.code)) byCode.set(c.code, c);
		}
		return [...byCode.values()];
	}

	async function searchTariff(key: string) {
		const query = (itemSearch[key] ?? '').trim();
		if (query.length < 2 || itemSearching[key]) return;
		itemSearching[key] = true;
		const matches = await requestTariffSearch(query);
		itemFound[key] = [
			...(itemFound[key] ?? []),
			// Only an eight-digit row can be filed; the master answers at every level.
			...matches
				.filter((m) => m.code.length === 8)
				.map((m) => ({ ...m, basis: 'search' as const, via: query }))
		];
		itemSearching[key] = false;
	}

	let pendingLookups = $state<number>(0);

	/**
	 * Taking a code pulls its duty structure straight away.
	 *
	 * Without this the drawback serial for a code chosen here would be picked by the
	 * derivation afterwards with nobody looking at it - which is exactly the silent
	 * classification the per-tariff section exists to prevent. Prefilled the way
	 * `deriveRows` would, so confirming without touching it changes nothing.
	 */
	async function chooseRitc(key: string, code: string) {
		const next = code || null;
		if (answers.assignedRitc[key] === next) return;
		answers.assignedRitc[key] = next;

		if (answers.perItem[key]) {
			answers.perItem[key] = clearCodeDerived(answers.perItem[key]);
		}
		const item = answers.perItem[key];
		if (!next || !item) return;

		if (!dutyByCode[next]) {
			pendingLookups++;
			try {
				const { entries } = await requestDutyLookups([next]);
				const entry = entries[0];
				if (entry) {
					dutyByCode[next] = {
						options: entry.drawback.map((c) => ({
							value: c.serial,
							...(c.description ? { label: c.description } : {})
						})),
						suggested: selectDrawbackSerial(entry.drawback, null).serial,
						rodtep: entry.rodtep ? 'Yes' : 'N/A'
					};
				}
			} finally {
				pendingLookups--;
			}
		}

		// The user may have moved on while the lookup was in flight.
		if (answers.assignedRitc[key] !== next) return;
		const duty = dutyByCode[next];
		if (duty) {
			item.drawback_schno ??= duty.suggested;
			item.RODTEP ??= duty.rodtep;
		}
	}

	const unassignedCount = $derived(
		input.unclassified.filter((i) => !answers.assignedRitc[i.key]).length
	);

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onDone(null);
		}
	}

	// Worth pointing out, not worth blocking on: the exporter's own printed rate and
	// the notified board rate legitimately differ, and only the filer knows which
	// applies. A tenth of a rupee is rounding, not a disagreement.
	const rateConflict = $derived(
		input.documentExchangeRate !== null &&
			answers.exchangeRate !== null &&
			Math.abs(input.documentExchangeRate - answers.exchangeRate) > 0.1
	);

	// Every row in the import, not just the ones that arrived with a tariff code -
	// counting only the settled groups made the header undercount the shipment.
	const rowCount = $derived(
		[...input.groups, ...input.unclassified].reduce((sum, g) => sum + g.rowCount, 0)
	);
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="icegrid-confirm fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
	role="dialog"
	aria-modal="true"
	aria-labelledby="icegrid-confirm-title"
>
	<div
		class="flex flex-col w-[min(96vw,960px)] max-h-[90vh] rounded-2xl bg-[var(--surface-1)] border border-[var(--border-strong)] shadow-2xl overflow-hidden"
	>
		<header class="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)]">
			<div class="min-w-0">
				<h2 id="icegrid-confirm-title" class="text-[15px] font-semibold text-[var(--text-1)] m-0">
					Confirm shipment values
				</h2>
				<p class="text-[11.5px] text-[var(--text-3)] m-0 mt-1 leading-relaxed max-w-[70ch]">
					Every field below is already filled from your documents, the customs schedules and the
					live duty lookup. Change anything that is wrong — these are declarations no document
					can confirm for you.
				</p>
			</div>
			<span
				class="shrink-0 text-[11px] px-2 py-1 rounded-full bg-[var(--surface-3)] text-[var(--text-2)] font-semibold"
			>{rowCount} row{rowCount === 1 ? '' : 's'}</span>
		</header>

		<div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
			<section class="flex flex-col gap-2.5">
				<h3 class="text-[12px] font-semibold text-[var(--text-2)] m-0 uppercase tracking-wide">
					For the whole invoice
				</h3>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
					<label class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">End use</span>
						<!-- svelte-ignore a11y_autofocus -->
						<select
							autofocus
							value={answers.invoice.EndUse ?? ''}
							onchange={(e) => setInvoice('EndUse', e.currentTarget.value)}
							class="icegrid-field"
						>
							<option value="">— not set —</option>
							{#each catalog('endUse') as opt (opt.value)}
								<option value={opt.value}>{optionLabel(opt)}</option>
							{/each}
						</select>
					</label>

					<label class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">Reward item</span>
						<select
							value={answers.invoice.RewardItem ?? ''}
							onchange={(e) => setInvoice('RewardItem', e.currentTarget.value)}
							class="icegrid-field"
						>
							<option value="">— not set —</option>
							{#each catalog('rewardItem') as opt (opt.value)}
								<option value={opt.value}>{optionLabel(opt)}</option>
							{/each}
						</select>
					</label>

					<label class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">State of origin</span>
						<select
							value={answers.invoice.StateOrigin ?? ''}
							onchange={(e) => setInvoice('StateOrigin', e.currentTarget.value)}
							class="icegrid-field"
						>
							<option value="">— not set —</option>
							{#each catalog('state') as opt (opt.value)}
								<option value={opt.value}>{optionLabel(opt)}</option>
							{/each}
						</select>
					</label>

					<label class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">District of origin</span>
						<select
							value={answers.invoice.DistrictOrigin ?? ''}
							onchange={(e) => setInvoice('DistrictOrigin', e.currentTarget.value)}
							disabled={districtOptions.length === 0}
							class="icegrid-field"
						>
							<option value="">
								{districtOptions.length === 0 ? '— pick a state first —' : '— not set —'}
							</option>
							{#each districtOptions as opt (opt.value)}
								<option value={opt.value}>{optionLabel(opt)}</option>
							{/each}
						</select>
					</label>

					<label class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">Invoice currency</span>
						<select
							value={answers.currency ?? ''}
							onchange={(e) => onCurrency(e.currentTarget.value)}
							disabled={rates.length === 0}
							class="icegrid-field"
						>
							<option value="">
								{rates.length === 0 ? '— rate board unavailable —' : '— not set —'}
							</option>
							{#each rates as rate (rate.code)}
								<option value={rate.code}>{rate.code} — {rate.name}</option>
							{/each}
						</select>
					</label>

					<label class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold text-[var(--text-2)]">Exchange rate (INR)</span>
						<span class="flex items-center gap-1.5">
							<input
								type="number"
								step="0.0001"
								min="0"
								value={answers.exchangeRate ?? ''}
								oninput={(e) => onRate(e.currentTarget.value)}
								placeholder="e.g. 88.50"
								class="icegrid-field flex-1 min-w-0"
							/>
							<button
								type="button"
								class="icegrid-refresh shrink-0 grid place-items-center w-[30px] h-[30px] rounded border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary-border)] disabled:opacity-50 transition-colors"
								onclick={refreshRates}
								disabled={refreshing}
								aria-label="Refresh the customs exchange rate board"
							>
								<span class:animate-spin={refreshing} class="grid place-items-center">
									<Icon name="rotate-ccw" size={14} />
								</span>
							</button>
						</span>
						<span class="text-[10.5px] text-[var(--text-3)] leading-snug">
							Taxable value is the product amount times this rate.
							{#if rateConflict}
								<span class="text-[var(--accent-amber)]"
									>The invoice prints {input.documentExchangeRate}.</span
								>
							{/if}
						</span>
					</label>
				</div>
			</section>

			{#if input.unclassified.length > 0}
				<section class="flex flex-col gap-2.5">
					<div class="flex items-baseline justify-between gap-3 flex-wrap">
						<h3 class="text-[12px] font-semibold text-[var(--text-2)] m-0 uppercase tracking-wide">
							Items needing a tariff code
						</h3>
						{#if unassignedCount > 0}
							<span class="text-[10.5px] text-[var(--text-3)]">
								{unassignedCount} still unset — they import blank with a review note.
							</span>
						{/if}
					</div>
					<p class="text-[10.5px] text-[var(--text-3)] m-0 leading-relaxed max-w-[80ch]">
						Every code below came back from the DGFT ITC-HS master, with the schedule's own
						wording. Nothing is preselected, and classifying the goods is your call.
					</p>
					{#if input.classifyWarning}
						<p
							class="text-[11px] leading-snug m-0 text-[var(--accent-amber)] bg-[var(--accent-amber-bg)] border border-[var(--accent-amber-border)] rounded px-2.5 py-1.5"
						>{input.classifyWarning}</p>
					{/if}

					<div class="flex flex-col gap-2.5">
						{#each input.unclassified as item (item.key)}
							{@const options = candidatesFor(item)}
							{@const chosen = answers.assignedRitc[item.key]}
							<div class="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 flex flex-col gap-2">
								<div class="flex items-baseline justify-between gap-3 flex-wrap">
									<span class="text-[12.5px] font-semibold text-[var(--text-1)]">{item.description}</span>
									<span class="text-[10.5px] text-[var(--text-3)]">
										{item.rowCount} row{item.rowCount === 1 ? '' : 's'}
										{#if item.printed}
											· invoice printed <span class="font-mono text-[var(--accent-primary)]">{item.printed}</span>
										{:else}
											· no code printed
										{/if}
									</span>
								</div>

								<span class="flex items-center gap-1.5">
									<input
										type="search"
										value={itemSearch[item.key] ?? ''}
										oninput={(e) => (itemSearch[item.key] = e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												searchTariff(item.key);
											}
										}}
										placeholder="Search the tariff in its own words, e.g. wooden furniture"
										class="icegrid-field flex-1 min-w-0"
									/>
									<button
										type="button"
										class="shrink-0 px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-1)] text-[11.5px] font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)] disabled:opacity-50 transition-colors"
										onclick={() => searchTariff(item.key)}
										disabled={itemSearching[item.key]}
									>{itemSearching[item.key] ? 'Searching…' : 'Search'}</button>
								</span>
								{#if item.terms.length > 0}
									<span class="text-[10.5px] text-[var(--text-3)]">
										Suggestions searched: {item.terms.join(', ')}
									</span>
								{/if}
								{#if item.note}
									<span
										class="text-[10.5px] leading-snug text-[var(--accent-amber)] bg-[var(--accent-amber-bg)] border border-[var(--accent-amber-border)] rounded px-2 py-1"
									>None of these look right: {item.note}</span>
								{/if}

								{#if options.length === 0}
									<span class="text-[11px] text-[var(--text-3)]">
										{input.classifyWarning
											? 'No suggestions were fetched for this item.'
											: 'No suggestion matched.'} Search above in the tariff's own wording — it
										matches literally, so "bed linen" finds entries where "cotton bed sheet"
										finds none.
									</span>
								{:else}
									<div class="flex flex-col gap-0.5">
										{#each options as option (option.code)}
											<label class="flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--surface-3)]">
												<input
													type="radio"
													name={`ritc-${item.key}`}
													value={option.code}
													checked={chosen === option.code}
													onchange={() => chooseRitc(item.key, option.code)}
													class="mt-[3px] shrink-0 accent-[var(--accent-primary)]"
												/>
												<span class="min-w-0">
													<span class="font-mono text-[12px] text-[var(--text-1)]">{option.code}</span>
													<span
														class="ml-2 text-[10px] px-1.5 py-px rounded-full align-middle {option.basis === 'prefix'
															? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
															: 'bg-[var(--surface-3)] text-[var(--text-3)]'}"
													>{option.basis === 'prefix'
															? `under ${option.via}`
															: option.basis === 'broad'
																? `broader: ${option.via}`
																: `“${option.via}”`}</span>
													<span class="block text-[11px] text-[var(--text-2)] leading-snug"
														>{tariffLeaf(option.description)}{#if pathAbove(option.description)}<span
																class="text-[var(--text-3)]"
															> · {pathAbove(option.description)}</span
															>{/if}</span
													>
												</span>
											</label>
										{/each}
									</div>
								{/if}

								{#if chosen}
									{@const values = answers.perItem[item.key]}
									<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--border)]">
										<label class="flex flex-col gap-1">
											<span class="text-[10.5px] font-semibold text-[var(--text-2)]">Drawback serial</span>
											<select
												value={values.drawback_schno ?? ''}
												onchange={(e) => (values.drawback_schno = e.currentTarget.value || null)}
												class="icegrid-field"
											>
												<option value="">— not set —</option>
												{#each dutyByCode[chosen]?.options ?? [] as opt (opt.value)}
													<option value={opt.value}>{optionLabel(opt)}</option>
												{/each}
											</select>
										</label>
										<label class="flex flex-col gap-1">
											<span class="text-[10.5px] font-semibold text-[var(--text-2)]">RoDTEP</span>
											<select
												value={values.RODTEP ?? ''}
												onchange={(e) => (values.RODTEP = e.currentTarget.value || null)}
												class="icegrid-field"
											>
												<option value="">— not set —</option>
												{#each catalog('rodtep') as opt (opt.value)}
													<option value={opt.value}>{optionLabel(opt)}</option>
												{/each}
											</select>
										</label>
										<label class="flex flex-col gap-1">
											<span class="text-[10.5px] font-semibold text-[var(--text-2)]">IGST status</span>
											<select
												value={values.IGST_PaymentStatus ?? ''}
												onchange={(e) => (values.IGST_PaymentStatus = e.currentTarget.value || null)}
												class="icegrid-field"
											>
												<option value="">— not set —</option>
												{#each catalog('igstPaymentStatus') as opt (opt.value)}
													<option value={opt.value}>{optionLabel(opt)}</option>
												{/each}
											</select>
										</label>
										<label class="flex flex-col gap-1">
											<span class="text-[10.5px] font-semibold text-[var(--text-2)]">IGST rate</span>
											<input
												type="number"
												step="0.01"
												min="0"
												value={values.IGST_Rate ?? ''}
												oninput={(e) => {
													const n = Number(e.currentTarget.value);
													values.IGST_Rate =
														e.currentTarget.value.trim() !== '' && Number.isFinite(n) ? n : null;
												}}
												class="icegrid-field"
											/>
										</label>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if input.groups.length > 0}
			<section class="flex flex-col gap-2.5">
				<h3 class="text-[12px] font-semibold text-[var(--text-2)] m-0 uppercase tracking-wide">
					Per tariff code
				</h3>
				<div class="overflow-x-auto rounded-lg border border-[var(--border)]">
					<table class="w-full border-collapse text-[12px]">
						<thead>
							<tr class="bg-[var(--surface-2)] text-left text-[11px] text-[var(--text-2)]">
								<th class="px-3 py-2 font-semibold">RITC</th>
								<th class="px-3 py-2 font-semibold">Drawback serial</th>
								<th class="px-3 py-2 font-semibold">RoDTEP</th>
								<th class="px-3 py-2 font-semibold">IGST status</th>
								<th class="px-3 py-2 font-semibold">IGST rate</th>
							</tr>
						</thead>
						<tbody>
							{#each input.groups as group (group.key)}
								{@const values = answers.perRitc[group.key]}
								<tr class="border-t border-[var(--border)] align-top">
									<td class="px-3 py-2">
										<span class="font-mono text-[var(--text-1)]"
											>{group.ritc || '— no code —'}</span
										>
										<span class="block text-[10.5px] text-[var(--text-3)] max-w-[22ch] truncate"
											>{group.sample}</span
										>
										<span class="block text-[10.5px] text-[var(--text-3)]"
											>{group.rowCount} row{group.rowCount === 1 ? '' : 's'}</span
										>
									</td>
									<td class="px-3 py-2">
										<select
											value={values.drawback_schno ?? ''}
											onchange={(e) => setRitc(group.key, 'drawback_schno', e.currentTarget.value)}
											class="icegrid-field w-full max-w-[280px]"
										>
											<option value="">— not set —</option>
											{#each group.drawbackOptions as opt (opt.value)}
												<option value={opt.value}>{optionLabel(opt)}</option>
											{/each}
										</select>
									</td>
									<td class="px-3 py-2">
										<select
											value={values.RODTEP ?? ''}
											onchange={(e) => setRitc(group.key, 'RODTEP', e.currentTarget.value)}
											class="icegrid-field"
										>
											<option value="">— not set —</option>
											{#each catalog('rodtep') as opt (opt.value)}
												<option value={opt.value}>{optionLabel(opt)}</option>
											{/each}
										</select>
									</td>
									<td class="px-3 py-2">
										<select
											value={values.IGST_PaymentStatus ?? ''}
											onchange={(e) =>
												setRitc(group.key, 'IGST_PaymentStatus', e.currentTarget.value)}
											class="icegrid-field"
										>
											<option value="">— not set —</option>
											{#each catalog('igstPaymentStatus') as opt (opt.value)}
												<option value={opt.value}>{optionLabel(opt)}</option>
											{/each}
										</select>
									</td>
									<td class="px-3 py-2">
										<input
											type="number"
											step="0.01"
											min="0"
											value={values.IGST_Rate ?? ''}
											oninput={(e) => setRitc(group.key, 'IGST_Rate', e.currentTarget.value)}
											class="icegrid-field w-[80px]"
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
			{/if}
		</div>

		<footer
			class="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]"
		>
			<button
				type="button"
				class="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition-colors"
				onclick={() => onDone(null)}
			>Cancel import</button>
			<button
				type="button"
				disabled={pendingLookups > 0}
				class="px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] text-[12px] font-semibold text-[var(--text-inverse)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={() => onDone($state.snapshot(answers) as IcegridAnswers)}
			>Confirm and import</button>
		</footer>
	</div>
</div>

<style>
	/* One field style for a dialog that is almost entirely fields. */
	:global(.icegrid-confirm .icegrid-field) {
		font-size: 12px;
		padding: 0.35rem 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		color: var(--text-1);
	}
	:global(.icegrid-confirm .icegrid-field:disabled) {
		opacity: 0.5;
	}
	:global(.icegrid-confirm .icegrid-field:focus-visible) {
		outline: 2px solid var(--accent-primary);
		outline-offset: 1px;
	}
</style>
