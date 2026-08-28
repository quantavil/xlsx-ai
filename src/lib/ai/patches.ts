import type { CellValue, TableData } from '$lib/types';
import type { CellPatch } from '$lib/table/commands';

export interface PatchProposal {
	rowId: string;
	columnId: string;
	oldValue?: CellValue;
	newValue: CellValue;
	explanation?: string;
}

export interface PatchValidationResult {
	validPatches: CellPatch[];
	conflicts: Array<{
		patch: PatchProposal;
		reason: 'missing_row' | 'missing_column' | 'value_conflict' | 'no_change';
		currentValue?: CellValue;
	}>;
}

export function validatePatchProposals(
	table: TableData,
	proposals: PatchProposal[]
): PatchValidationResult {
	const colMap = new Map(table.columns.map((c) => [c.id, c]));
	const rowMap = new Map(table.rows.map((r) => [r.id, r]));

	const validPatches: CellPatch[] = [];
	const conflicts: PatchValidationResult['conflicts'] = [];

	for (const proposal of proposals) {
		const row = rowMap.get(proposal.rowId);
		if (!row) {
			conflicts.push({ patch: proposal, reason: 'missing_row' });
			continue;
		}

		const col = colMap.get(proposal.columnId);
		if (!col) {
			conflicts.push({ patch: proposal, reason: 'missing_column' });
			continue;
		}

		const currentVal = row[proposal.columnId] ?? null;

		// Stale patch conflict check: if oldValue was specified and differs from current live table cell
		if (
			proposal.oldValue !== undefined &&
			proposal.oldValue !== null &&
			!Object.is(proposal.oldValue, currentVal)
		) {
			conflicts.push({
				patch: proposal,
				reason: 'value_conflict',
				currentValue: currentVal
			});
			continue;
		}

		if (Object.is(currentVal, proposal.newValue)) {
			conflicts.push({
				patch: proposal,
				reason: 'no_change',
				currentValue: currentVal
			});
			continue;
		}

		validPatches.push({
			rowId: proposal.rowId,
			columnId: proposal.columnId,
			oldValue: currentVal,
			newValue: proposal.newValue
		});
	}

	return { validPatches, conflicts };
}
