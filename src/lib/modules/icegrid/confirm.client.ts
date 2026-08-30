import { mount, unmount } from 'svelte';
import IcegridConfirmDialog from './IcegridConfirmDialog.svelte';
import { defaultAnswers, type IcegridAnswers, type IcegridConfirmInput } from './confirm';

/**
 * Put the proposed values in front of a human and wait.
 *
 * The dialog is mounted onto the document rather than rendered by a parent because
 * the pipeline is plain TypeScript with no component around it, and a module is not
 * allowed to reach into the workspace's own UI state. `null` means the import was
 * cancelled.
 *
 * With no document - the unit test runner - there is nobody to ask, so the
 * pipeline's own proposals stand unchanged and the run completes headlessly.
 */
export function confirmIcegridChoices(
	input: IcegridConfirmInput,
	signal?: AbortSignal
): Promise<IcegridAnswers | null> {
	if (typeof document === 'undefined') return Promise.resolve(defaultAnswers(input));

	return new Promise((resolve) => {
		const host = document.createElement('div');
		document.body.appendChild(host);

		let done = false;
		const close = (answers: IcegridAnswers | null) => {
			if (done) return;
			done = true;
			signal?.removeEventListener('abort', onAbort);
			void unmount(app);
			host.remove();
			resolve(answers);
		};
		// Cancelling the run from the progress banner has to take the dialog with it,
		// or the question outlives the thing that asked it.
		const onAbort = () => close(null);

		const app = mount(IcegridConfirmDialog, { target: host, props: { input, onDone: close } });

		if (signal?.aborted) close(null);
		else signal?.addEventListener('abort', onAbort);
	});
}
