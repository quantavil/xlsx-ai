<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="app-layout flex flex-col w-screen h-screen overflow-hidden relative select-none bg-[var(--bg)] text-[var(--text-1)]">
	{@render children()}
</div>
