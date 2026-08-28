<script lang="ts">
	import DropdownCellEditor from './DropdownCellEditor.svelte';

	interface Props {
		value: string | null;
		options: string[];
		triggerEl?: HTMLElement | null;
		onCommit: (val: string) => void;
		onCancel: () => void;
	}

	let props: Props = $props();
</script>

<DropdownCellEditor {...props} />
