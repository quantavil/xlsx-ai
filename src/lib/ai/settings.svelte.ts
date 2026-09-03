import {
	DEFAULT_AI_MODEL,
	DEFAULT_AI_PROVIDER,
	RETIRED_AI_MODELS,
	LS_AI_SETTINGS,
	LS_API_KEY,
	LS_API_KEYS,
	LS_AI_MODEL,
	LS_FAV_MODELS
} from '$lib/constants';
import type {
	AiProvider,
	AiProviderProfile
} from './providers';

function clampKeyIndex(keys: string[], index: number): number {
	return keys.length === 0 ? 0 : Math.min(Math.max(0, Math.trunc(index)), keys.length - 1);
}

function normalizeProfile(value: unknown, defaultModel: string): AiProviderProfile {
	if (!value || typeof value !== 'object') {
		return { keys: [], activeKeyIndex: 0, modelId: defaultModel, favoriteModels: [] };
	}
	const raw = value as Record<string, unknown>;
	const keys = Array.isArray(raw.keys)
		? raw.keys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
		: [];
	const active = typeof raw.activeKeyIndex === 'number' ? raw.activeKeyIndex : 0;
	return {
		keys,
		activeKeyIndex: clampKeyIndex(keys, active),
		modelId: typeof raw.modelId === 'string' ? raw.modelId.trim() : defaultModel,
		favoriteModels: Array.isArray(raw.favoriteModels)
			? raw.favoriteModels.filter((id): id is string => typeof id === 'string')
			: []
	};
}

export function createAiSettingsStore() {
	let aiProvider = $state<AiProvider>(DEFAULT_AI_PROVIDER);
	let aiProfiles = $state<Record<AiProvider, AiProviderProfile>>({
		gemini: { keys: [], activeKeyIndex: 0, modelId: DEFAULT_AI_MODEL, favoriteModels: [] },
		openrouter: { keys: [], activeKeyIndex: 0, modelId: '', favoriteModels: [] }
	});

	const activeAiProfile = $derived(aiProfiles[aiProvider]);
	const apiKeys = $derived(activeAiProfile.keys);
	const activeKeyIndex = $derived(activeAiProfile.activeKeyIndex);
	const apiKey = $derived(apiKeys[activeKeyIndex] ?? '');
	const aiModel = $derived(activeAiProfile.modelId);
	const favoriteModels = $derived(activeAiProfile.favoriteModels);

	function persistAiSettings() {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(LS_AI_SETTINGS, JSON.stringify({ provider: aiProvider, profiles: aiProfiles }));
	}

	function replaceActiveProfile(profile: AiProviderProfile) {
		aiProfiles = { ...aiProfiles, [aiProvider]: profile };
		persistAiSettings();
	}

	function hydrateAiSettings() {
		if (typeof localStorage === 'undefined') return;
		const saved = localStorage.getItem(LS_AI_SETTINGS);
		if (saved) {
			try {
				const parsed: unknown = JSON.parse(saved);
				if (parsed && typeof parsed === 'object') {
					const raw = parsed as Record<string, unknown>;
					const profiles = raw.profiles as Record<string, unknown> | undefined;
					aiProfiles = {
						gemini: normalizeProfile(profiles?.gemini, DEFAULT_AI_MODEL),
						openrouter: normalizeProfile(profiles?.openrouter, '')
					};
					aiProvider = raw.provider === 'openrouter' ? 'openrouter' : 'gemini';
				}
			} catch {
				// Corrupted settings ignored
			}
		}

		let gemini = aiProfiles.gemini;
		const savedKeys = localStorage.getItem(LS_API_KEYS);
		if (savedKeys) {
			try {
				const parsed: unknown = JSON.parse(savedKeys);
				if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { keys?: unknown }).keys)) {
					const { keys, active } = parsed as { keys: unknown[]; active?: unknown };
					const migratedKeys = keys.filter(
						(key): key is string => typeof key === 'string' && key.trim().length > 0
					);
					if (migratedKeys.length > 0 && gemini.keys.length === 0) {
						gemini = {
							...gemini,
							keys: migratedKeys,
							activeKeyIndex: clampKeyIndex(migratedKeys, typeof active === 'number' ? active : 0)
						};
					}
				}
			} catch {
				// Corrupted keys ignored
			}
		}

		const legacyKey = localStorage.getItem(LS_API_KEY);
		if (legacyKey && !gemini.keys.includes(legacyKey)) {
			gemini = { ...gemini, keys: [legacyKey, ...gemini.keys], activeKeyIndex: 0 };
		}

		const savedFavorites = localStorage.getItem(LS_FAV_MODELS);
		if (savedFavorites && gemini.favoriteModels.length === 0) {
			try {
				const parsed: unknown = JSON.parse(savedFavorites);
				if (Array.isArray(parsed)) {
					gemini = {
						...gemini,
						favoriteModels: parsed.filter((id): id is string => typeof id === 'string')
					};
				}
			} catch {
				// Corrupted favorites ignored
			}
		}

		const savedModel = localStorage.getItem(LS_AI_MODEL);
		if (savedModel) gemini = { ...gemini, modelId: savedModel };
		const retired =
			!gemini.modelId ||
			gemini.modelId.includes('gemini-2.0') ||
			gemini.modelId.includes('undefined') ||
			RETIRED_AI_MODELS.includes(gemini.modelId);
		if (retired) gemini = { ...gemini, modelId: DEFAULT_AI_MODEL };

		aiProfiles = { ...aiProfiles, gemini };
		persistAiSettings();
		localStorage.removeItem(LS_API_KEY);
		localStorage.removeItem(LS_API_KEYS);
		localStorage.removeItem(LS_AI_MODEL);
		localStorage.removeItem(LS_FAV_MODELS);
	}

	function addApiKey(newKey: string) {
		const clean = newKey.trim();
		if (!clean) return;
		const existing = apiKeys.indexOf(clean);
		if (existing >= 0) {
			replaceActiveProfile({ ...activeAiProfile, activeKeyIndex: existing });
		} else {
			const keys = [...apiKeys, clean];
			replaceActiveProfile({ ...activeAiProfile, keys, activeKeyIndex: keys.length - 1 });
		}
	}

	function removeApiKey(index: number) {
		if (index < 0 || index >= apiKeys.length) return;
		const keys = apiKeys.filter((_, i) => i !== index);
		const nextIndex = clampKeyIndex(
			keys,
			index < activeKeyIndex ? activeKeyIndex - 1 : activeKeyIndex
		);
		replaceActiveProfile({ ...activeAiProfile, keys, activeKeyIndex: nextIndex });
	}

	function useApiKey(index: number) {
		if (index < 0 || index >= apiKeys.length) return;
		replaceActiveProfile({ ...activeAiProfile, activeKeyIndex: index });
	}

	function toggleFavoriteModel(modelId: string) {
		const next = favoriteModels.includes(modelId)
			? favoriteModels.filter((id) => id !== modelId)
			: [...favoriteModels, modelId];
		replaceActiveProfile({ ...activeAiProfile, favoriteModels: next });
	}

	function setAiModel(newModel: string) {
		replaceActiveProfile({ ...activeAiProfile, modelId: newModel.trim() });
	}

	function setAiProvider(provider: AiProvider) {
		if (provider === aiProvider) return;
		aiProvider = provider;
		persistAiSettings();
	}

	return {
		get aiProvider() {
			return aiProvider;
		},
		get aiProfiles() {
			return aiProfiles;
		},
		get activeAiProfile() {
			return activeAiProfile;
		},
		get apiKeys() {
			return apiKeys;
		},
		get activeKeyIndex() {
			return activeKeyIndex;
		},
		get apiKey() {
			return apiKey;
		},
		get aiModel() {
			return aiModel;
		},
		get favoriteModels() {
			return favoriteModels;
		},
		hydrateAiSettings,
		addApiKey,
		removeApiKey,
		useApiKey,
		toggleFavoriteModel,
		setAiModel,
		setAiProvider
	};
}

export type AiSettingsStore = ReturnType<typeof createAiSettingsStore>;
