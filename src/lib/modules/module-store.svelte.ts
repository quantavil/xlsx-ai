import { BUILTIN_MODULES, getModuleById } from './registry';
import type { WorkspaceModule, ModuleResult } from './types';
import { createAiApi } from '$lib/ai/client';
import type { AiProvider } from '$lib/ai/providers';

export const LS_MODULES_KEY = 'xlsx-ai:modules:v1';

export function createModuleStore() {
	let enabledState = $state<Record<string, boolean>>({});
	let runningModuleId = $state<string | null>(null);
	let progressMessage = $state<string>('');
	let activeController = $state<AbortController | null>(null);

	// Initialize default states from manifests
	function initDefaults(): Record<string, boolean> {
		const initial: Record<string, boolean> = {};
		for (const mod of BUILTIN_MODULES) {
			initial[mod.id] = mod.defaultEnabled;
		}
		return initial;
	}

	function hydrate(): void {
		if (typeof localStorage === 'undefined') {
			enabledState = initDefaults();
			return;
		}

		try {
			const saved = localStorage.getItem(LS_MODULES_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				if (typeof parsed === 'object' && parsed !== null) {
					const merged: Record<string, boolean> = initDefaults();
					for (const mod of BUILTIN_MODULES) {
						if (typeof parsed[mod.id] === 'boolean') {
							merged[mod.id] = parsed[mod.id];
						}
					}
					enabledState = merged;
					return;
				}
			}
		} catch {
			// Fall back to defaults on corrupt storage
		}
		enabledState = initDefaults();
	}

	function persist(): void {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(LS_MODULES_KEY, JSON.stringify(enabledState));
		} catch {
			// Ignore localStorage write failures
		}
	}

	// Initialize upon creation
	hydrate();

	const enabledModules = $derived(
		BUILTIN_MODULES.filter((mod) => enabledState[mod.id] ?? mod.defaultEnabled)
	);

	function isEnabled(id: string): boolean {
		return enabledState[id] ?? getModuleById(id)?.defaultEnabled ?? false;
	}

	function setEnabled(id: string, enabled: boolean): void {
		enabledState[id] = enabled;
		if (!enabled && runningModuleId === id) {
			cancelRun();
		}
		persist();
	}

	function toggle(id: string): void {
		setEnabled(id, !isEnabled(id));
	}

	function cancelRun(): void {
		if (activeController) {
			activeController.abort();
			activeController = null;
		}
		runningModuleId = null;
		progressMessage = '';
	}

	async function runModule(
		id: string,
		files: File[],
		context: { provider: AiProvider; apiKey: string; modelId: string }
	): Promise<ModuleResult | null> {
		const mod = getModuleById(id);
		if (!mod || !isEnabled(id)) {
			throw new Error(`Module "${id}" is not available or disabled.`);
		}

		if (runningModuleId) {
			throw new Error('A module action is already running.');
		}

		const controller = new AbortController();
		activeController = controller;
		runningModuleId = id;
		progressMessage = 'Preparing documents...';

		try {
			const ai = createAiApi({
				provider: context.provider,
				apiKey: context.apiKey,
				modelId: context.modelId,
				signal: controller.signal
			});
			const result = await mod.run(files, {
				ai,
				signal: controller.signal,
				onProgress: (msg: string) => {
					progressMessage = msg;
				}
			});

			if (controller.signal.aborted) {
				return null;
			}

			return result;
		} catch (err: unknown) {
			if (controller.signal.aborted) {
				return null;
			}
			throw err;
		} finally {
			if (activeController === controller) {
				activeController = null;
				runningModuleId = null;
				progressMessage = '';
			}
		}
	}

	return {
		get enabledModules() {
			return enabledModules;
		},
		get runningModuleId() {
			return runningModuleId;
		},
		get progressMessage() {
			return progressMessage;
		},
		isEnabled,
		setEnabled,
		toggle,
		runModule,
		cancelRun,
		hydrate,
		persist
	};
}
