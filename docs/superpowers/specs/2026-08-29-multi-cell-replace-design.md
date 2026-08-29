# Multi-Cell Replace Design

## Goal

Let a user Shift-select multiple cells in one column and replace every selected value through the column's existing editor. The feature must work for dropdown, text, date, number, currency, and percent columns. A replacement is immediate and recoverable through the existing Undo action.

## Scope

- Reuse the existing contiguous rectangular selection created by Shift-click or Shift-arrow.
- Enable bulk replacement only when the selection contains at least two cells and spans one column.
- Keep single-cell editing unchanged.
- Do not add a toolbar action, context menu, confirmation dialog, disjoint selection, paste support, or fill handle.

## Interaction

1. The user selects two or more cells in one column with Shift-click or Shift-arrow.
2. The user starts editing through the same affordances used for one cell:
   - Dropdown: open the dropdown and choose an option.
   - Other types: type directly or press Enter/F2, enter the replacement, and commit with Enter, Tab, or blur.
3. The editor appears on the active cell, while the full range remains visibly selected.
4. Commit replaces every selected cell with the entered or chosen value immediately.
5. Escape cancels the edit without changing any selected cell.
6. The selection remains after commit so the user can replace it again or use Undo.

The replacement creates one history entry. Undo restores all prior values in the range, and Redo reapplies the replacement.

## Editing and Selection Rules

`DataTable.svelte` currently resets selection when `startEditing` calls `store.setSelection`. Bulk editing must preserve the existing selection when all of these conditions hold:

- the active cell belongs to the current range;
- the range contains at least two cells; and
- `selectionRect.c0 === selectionRect.c1`.

Starting an edit outside that case follows the existing single-cell behavior and selects only the target cell.

The active cell determines where the editor is rendered. The selected row IDs are resolved from `store.filteredRows`, so replacement targets exactly the visible range the user selected, including when the table is sorted or filtered.

## Commit Data Flow

`DataTable.svelte` builds one patch for each selected row using the selected column ID and the committed value. It submits the whole patch list to the existing `store.applyCellPatches` method.

That store method remains the mutation boundary because it already:

- validates row and column IDs;
- normalizes each value according to the column type;
- skips unchanged values;
- applies all valid changes together;
- records one history snapshot; and
- triggers persistence once.

If every selected cell already has the replacement value, no history entry is created.

## Dropdown Behavior

Dropdown selection is a first-class bulk-replacement path. Choosing an option commits it to every selected dropdown cell immediately.

For an ordinary dropdown, the editor uses the column's existing configured and discovered options.

For a dropdown whose closed catalog depends on another column, the bulk editor must offer only options valid for every selected row. This is the intersection of the option values returned for each selected row, retaining the active row's display order and labels. The selected rows' existing values may differ; no option is shown as selected unless all selected cells currently share it.

If no common option exists, the editor remains cancellable and communicates that there are no options valid for the whole selection. It must not apply a value that violates a selected row's dependency.

Custom dropdown behavior continues to follow the column's `allowCustom` setting. A custom value, when allowed, applies to the full selected range.

## Other Column Types

Text, date, number, currency, and percent columns use their existing inline input. The committed string is sent to every selected cell and normalized independently through the existing cell normalization rules. This keeps bulk edits consistent with single-cell edits, including empty values clearing cells.

## Focus and Keyboard Behavior

- Enter and F2 open the active cell's editor without collapsing a qualifying range.
- Direct typing opens the editor with the typed character as the replacement draft.
- Enter commits and keeps the range selected. Existing post-commit movement should occur only for single-cell edits; bulk commit must not collapse or move the range.
- Tab commits. For a bulk range, it keeps the range intact rather than moving to another cell.
- Escape cancels and restores focus to the active grid cell without mutation.
- Opening a dropdown with its chevron also preserves a qualifying range when the chevron belongs to the active selected cell.

## Error Handling

- Invalid or stale row/column references are ignored by the existing patch validation.
- A commit with zero effective changes is a no-op and creates no Undo entry.
- Dropdown values prohibited by a closed dependent catalog are never presented for bulk selection.
- Persistence failures continue through the store's existing save-error notification.
- No partial-success confirmation or modal is introduced.

## Testing

Store-level tests verify that a set of patches for one column normalizes values, skips unchanged cells, applies atomically, and produces one Undo/Redo step.

Browser tests verify:

- Shift-selected dropdown cells all receive one chosen option;
- Shift-selected text, date, number, currency, and percent cells receive one replacement;
- the range remains selected while editing and after commit;
- Escape changes nothing;
- Undo and Redo operate on the full replacement in one step;
- direct typing and Enter/F2 preserve a qualifying range;
- a multi-column rectangular selection retains existing single-cell edit behavior rather than bulk-replacing mixed types; and
- dependent closed dropdowns expose only options common to all selected rows.

Existing single-cell editing, range clearing, range alignment, copying, sorting, filtering, and dropdown tests must continue to pass.

## Success Criteria

The feature is complete when a user can Shift-select multiple cells in one column, use the familiar editor to replace the entire selection for every supported column type, and reverse or reapply the replacement through one Undo or Redo action without any confirmation dialog.
