import type { AiChatMessage } from './client';
import { sendAiQuery } from './client';
import type { TableData } from '$lib/types';
import type { PatchProposal } from './patches';
import { validatePatchProposals } from './patches';

export function createChatSession() {
	let messages = $state<AiChatMessage[]>([
		{
			id: 'welcome-msg',
			role: 'assistant',
			content: 'Hello! I can help you analyze this table, generate formulas, fill missing values, or clean data. How can I assist you?',
			timestamp: Date.now()
		}
	]);
	let isLoading = $state(false);
	let currentAbortController: AbortController | null = null;
	let lastError = $state<string | null>(null);

	async function sendMessage(
		prompt: string,
		context: {
			apiKey: string;
			model: string;
			table: TableData;
		}
	) {
		const cleanPrompt = prompt.trim();
		if (!cleanPrompt || isLoading) return;

		lastError = null;

		const userMsg: AiChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			content: cleanPrompt,
			timestamp: Date.now()
		};

		messages = [...messages, userMsg];
		isLoading = true;

		currentAbortController = new AbortController();

		try {
			const historyForUpstream = messages
				.slice(-8)
				.map((m) => ({ role: m.role, content: m.content }));

			const res = await sendAiQuery({
				prompt: cleanPrompt,
				apiKey: context.apiKey,
				model: context.model,
				table: context.table,
				history: historyForUpstream,
				signal: currentAbortController.signal
			});

			const assistantMsg: AiChatMessage = {
				id: `assistant-${Date.now()}`,
				role: 'assistant',
				content: res.message,
				patches: res.patches,
				formula: res.formula,
				insights: res.insights,
				timestamp: Date.now()
			};

			messages = [...messages, assistantMsg];
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				// Aborted by user
				return;
			}
			const errorMsg = err instanceof Error ? err.message : 'Unknown AI error';
			lastError = errorMsg;
			messages = [
				...messages,
				{
					id: `err-${Date.now()}`,
					role: 'assistant',
					content: `⚠️ ${errorMsg}`,
					timestamp: Date.now()
				}
			];
		} finally {
			isLoading = false;
			currentAbortController = null;
		}
	}

	function cancelRequest() {
		if (currentAbortController) {
			currentAbortController.abort();
			currentAbortController = null;
		}
		isLoading = false;
	}

	function clearHistory() {
		cancelRequest();
		messages = [
			{
				id: `welcome-${Date.now()}`,
				role: 'assistant',
				content: 'Chat cleared. How can I help you with your table today?',
				timestamp: Date.now()
			}
		];
		lastError = null;
	}

	return {
		get messages() {
			return messages;
		},
		get isLoading() {
			return isLoading;
		},
		get lastError() {
			return lastError;
		},
		sendMessage,
		cancelRequest,
		clearHistory
	};
}
