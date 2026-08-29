import { describe, it, expect, beforeEach } from 'vitest';
import { BUILTIN_MODULES, getModuleById } from '../../src/lib/modules/registry';
import { createModuleStore, LS_MODULES_KEY } from '../../src/lib/modules/module-store.svelte';

describe('Workspace Modules Framework', () => {
	beforeEach(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.clear();
		}
	});

	it('registers ICEGrid as a built-in module with defaultEnabled true', () => {
		expect(BUILTIN_MODULES.length).toBeGreaterThan(0);
		const icegrid = getModuleById('icegrid');
		expect(icegrid).toBeDefined();
		expect(icegrid?.name).toBe('ICEGrid Importer');
		expect(icegrid?.ribbon.icon).toBe('layers');
		expect(icegrid?.ribbon.label).toBe('ICEGrid Documents');
		expect(icegrid?.ribbon.fileInput).toEqual({
			accept: '.pdf,.xls,.xlsx',
			multiple: true
		});
		expect(icegrid?.defaultEnabled).toBe(true);
		expect(icegrid?.requirements.gemini).toBe(true);
	});

	it('registers unique stable module ids', () => {
		const ids = BUILTIN_MODULES.map((module) => module.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('hydrates module store with default enabled states', () => {
		const store = createModuleStore();
		expect(store.isEnabled('icegrid')).toBe(true);
		expect(store.enabledModules.some((m) => m.id === 'icegrid')).toBe(true);
	});

	it('toggles module enablement and persists to localStorage', () => {
		const store = createModuleStore();
		expect(store.isEnabled('icegrid')).toBe(true);

		store.setEnabled('icegrid', false);
		expect(store.isEnabled('icegrid')).toBe(false);
		expect(store.enabledModules.some((m) => m.id === 'icegrid')).toBe(false);

		// Verify localStorage
		if (typeof localStorage !== 'undefined') {
			const saved = JSON.parse(localStorage.getItem(LS_MODULES_KEY) || '{}');
			expect(saved.icegrid).toBe(false);
		}

		// Re-enable
		store.toggle('icegrid');
		expect(store.isEnabled('icegrid')).toBe(true);
	});

	it('falls back gracefully on corrupt localStorage data', () => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(LS_MODULES_KEY, 'invalid-json-structure{{{');
		}

		const store = createModuleStore();
		expect(store.isEnabled('icegrid')).toBe(true);
	});

	it('cancels active run when module is disabled during execution', async () => {
		const store = createModuleStore();

		// Mock a long-running module action
		const mockFile = new File(['test content'], 'test.xlsx', {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});

		// Trigger runModule
		const runPromise = store.runModule('icegrid', [mockFile], {
			apiKey: 'AIzaSyFakeKey1234567890',
			modelId: 'gemini-3.5-flash-lite'
		});

		// Disabling while running triggers cancelRun
		store.setEnabled('icegrid', false);
		const result = await runPromise;
		expect(result).toBeNull();
		expect(store.runningModuleId).toBeNull();
	});
});
