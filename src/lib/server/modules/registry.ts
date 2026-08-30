import type { ModuleAiHandler } from './types';
import { icegridExtractAiHandler, icegridClassifyAiHandler } from '$lib/modules/icegrid/ai.server';

export const MODULE_AI_HANDLERS: readonly ModuleAiHandler[] = [
	icegridExtractAiHandler,
	icegridClassifyAiHandler
];

export function getModuleAiHandler(
	moduleId: string,
	action: string
): ModuleAiHandler | undefined {
	return MODULE_AI_HANDLERS.find(
		(handler) => handler.moduleId === moduleId && handler.action === action
	);
}
