import type { Component } from 'svelte';
import type { TableData, IconName } from '$lib/types';
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
		ai: boolean;
	};
	ribbon: ModuleRibbonAction;
	/** Optional panel rendered inside this module's Settings card. */
	settings?: {
		label: string;
		component: Component;
	};
	run(files: File[], context: ModuleContext): Promise<ModuleResult>;
}
