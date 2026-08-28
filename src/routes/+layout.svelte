<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import ToastHost from '$lib/ui/ToastHost.svelte';
	import { bootstrapWorkspace, store, toastStore } from '$lib/workspace.svelte';

	let { children } = $props();

	onMount(() => {
		bootstrapWorkspace();

		function handleVisibilityChange() {
			if (document.visibilityState === 'hidden') store.flushSave();
		}

		window.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('beforeunload', store.flushSave);
		return () => {
			window.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('beforeunload', store.flushSave);
		};
	});
</script>

<div class="app-layout flex flex-col w-screen h-screen overflow-hidden relative select-none bg-[var(--bg)] text-[var(--text-1)]">
	{@render children()}
	<ToastHost toasts={toastStore.toasts} onDismiss={toastStore.remove} />
</div>
