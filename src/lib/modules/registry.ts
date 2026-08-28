import type { WorkspaceModule } from './types';
import { icegridModule } from './icegrid/index';

export const BUILTIN_MODULES: readonly WorkspaceModule[] = [icegridModule];

export function getModuleById(id: string): WorkspaceModule | undefined {
	return BUILTIN_MODULES.find((m) => m.id === id);
}
