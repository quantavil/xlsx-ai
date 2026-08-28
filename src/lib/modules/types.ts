import type { TableData } from '$lib/types';
import type { IconName } from '$lib/components/Icons.svelte';
import type { AiApi } from '$lib/ai/client';

export interface ModuleContext {
	ai: AiApi;
	signal: AbortSignal;
	onProgress(message: string): void;
}

export interface ModuleResult {
	table: TableData;
	warnings: string[];
}

export interface ModuleRibbonAction {
	label: string;
	icon: IconName;
	fileInput: {
		accept: string;
		multiple: boolean;
	};
}

export interface WorkspaceModule {
	id: string;
	name: string;
	description: string;
	version: string;
	defaultEnabled: boolean;
	requirements: {
		gemini: boolean;
	};
	ribbon: ModuleRibbonAction;
	run(files: File[], context: ModuleContext): Promise<ModuleResult>;
}
