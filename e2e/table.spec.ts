import { test, expect, type Page } from '@playwright/test';

// There are no sample datasets any more — a fresh workspace is a blank file. Tests that
// need data seed a file straight into the workspace's own storage before first paint.
const FIXTURE = {
	version: 2,
	title: 'SaaS Revenue',
	columns: [
		{ id: 'c1', name: 'Product Plan', type: 'text', width: 220 },
		{ id: 'c2', name: 'Tier', type: 'dropdown', width: 130 },
		{ id: 'c3', name: 'Monthly Price', type: 'currency', width: 150 },
		{ id: 'c4', name: 'Active Accounts', type: 'number', width: 160 },
		{ id: 'c5', name: 'Conversion', type: 'percent', width: 130 },
		{ id: 'c6', name: 'Renewal Date', type: 'date', width: 150 }
	],
	rows: Array.from({ length: 25 }, (_, i) => ({
		id: `r${i + 1}`,
		c1: i === 0 ? 'Starter Cloud' : i === 1 ? 'Developer Sandbox' : `Plan ${i + 1}`,
		c2: i % 3 === 0 ? 'Active' : i % 3 === 1 ? 'Trial' : 'Pending',
		c3: i === 1 ? 19 : 100 + i * 37,
		c4: 1000 - i * 11,
		c5: 0.05 + i / 1000,
		c6: `2026-09-${String((i % 25) + 1).padStart(2, '0')}`
	}))
};

const DEPENDENT_DROPDOWN_FIXTURE = {
	version: 2,
	title: 'Dependent Dropdowns',
	columns: [
		{
			id: 'state',
			name: 'State',
			type: 'dropdown',
			width: 150,
			dropdown: {
				options: [{ value: '08' }, { value: '09' }],
				allowCustom: false
			}
		},
		{
			id: 'district',
			name: 'District',
			type: 'dropdown',
			width: 180,
			dropdown: {
				options: [
					{ value: '102', label: 'JAIPUR', parentValue: '8' },
					{ value: '171', label: 'GHAZIABAD', parentValue: '9' }
				],
				allowCustom: false,
				dependsOnColumnId: 'state'
			}
		}
	],
	rows: [
		{ id: 'r1', state: '08', district: '102' },
		{ id: 'r2', state: '09', district: '171' }
	]
};

async function seedWorkspace(page: Page) {
	// Runs on every navigation, so seed once — a reload must observe what the app persisted.
	await page.addInitScript((doc) => {
		if (localStorage.getItem('xlsx-ai:docs:v1')) return;
		const id = 'd_fixture';
		localStorage.setItem(`xlsx-ai:doc:${id}`, JSON.stringify(doc));
		localStorage.setItem(
			'xlsx-ai:docs:v1',
			JSON.stringify({
				docs: [{ id, title: doc.title, updatedAt: new Date().toISOString() }],
				activeId: id
			})
		);
	}, FIXTURE);
}

test.describe('xlsx-ai E2E Workflow', () => {
	test.beforeEach(async ({ page }) => {
		await seedWorkspace(page);
		await page.goto('/');
	});

	test('restores the active file with sticky headers and footer summaries', async ({ page }) => {
		await expect(page.locator('.title-text')).toContainText('SaaS Revenue');

		const headers = page.locator('thead th');
		await expect(headers).toContainText([
			'#',
			'Product Plan',
			'Tier',
			'Monthly Price',
			'Active Accounts',
			'Conversion',
			'Renewal Date'
		]);

		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);
		await expect(page.locator('tfoot tr.summary-row')).toBeVisible();
	});

	test('filters rows instantly via search input and clears filter', async ({ page }) => {
		await page.locator('.search-box input').fill('Starter Cloud');

		const filteredRows = page.locator('tbody tr.data-row');
		await expect(filteredRows).toHaveCount(1);
		await expect(filteredRows.first()).toContainText('Starter Cloud');

		await page.locator('.search-clear').click();
		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);
	});

	test('sorts columns ascending and descending on header click', async ({ page }) => {
		const priceHeader = page.locator('thead th:has-text("Monthly Price") button.th-title-btn');
		await priceHeader.click();
		await expect(page.locator('tbody tr.data-row:first-child td:nth-child(2)')).toContainText(
			'Developer Sandbox'
		);

		await priceHeader.click();
		await expect(page.locator('tbody tr.data-row:first-child td:nth-child(2)')).toContainText('Plan 25');
	});

	test('adds new row and edits cell inline', async ({ page }) => {
		await page.locator('.right-tool-ribbon button[aria-label="Add Row"]').click();
		await expect(page.locator('tbody tr.data-row')).toHaveCount(26);

		const lastRowFirstCell = page.locator('tbody tr.data-row').last().locator('td:nth-child(2)');
		await lastRowFirstCell.dblclick();

		const cellInput = lastRowFirstCell.locator('input.cell-input');
		await expect(cellInput).toBeVisible();
		await cellInput.fill('Custom AI Agent Plan');
		await cellInput.press('Enter');

		await expect(lastRowFirstCell).toContainText('Custom AI Agent Plan');
	});

	test('supports Excel-style roving tabindex arrow navigation and in-place editing', async ({ page }) => {
		const firstCell = page.locator('tbody tr.data-row:first-child td.td-cell').first();
		await expect(firstCell).toHaveAttribute('tabindex', '0');
		await firstCell.focus();

		await page.keyboard.press('ArrowRight');
		const tierCell = page.locator('tbody tr.data-row:first-child td:nth-child(3)');
		await expect(tierCell).toBeFocused();

		await page.keyboard.press('ArrowDown');
		const row2TierCell = page.locator('tbody tr.data-row:nth-child(2) td:nth-child(3)');
		await expect(row2TierCell).toBeFocused();

		await page.keyboard.press('Enter');
		const popover = row2TierCell.locator('.custom-dropdown-popover');
		await expect(popover).toBeVisible();

		await popover.locator('button.dropdown-opt-btn', { hasText: 'Active' }).first().click();
		await expect(row2TierCell).toContainText('Active');
	});

	test('replaces a Shift-selected text range and undoes it in one step', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').nth(0);
		const third = rows.nth(2).locator('td.td-cell').nth(0);

		await first.click();
		await third.click({ modifiers: ['Shift'] });
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

		await page.keyboard.press('U');
		const input = third.locator('input.cell-input');
		await input.fill('Unified plan');
		await input.press('Enter');

		for (let index = 0; index < 3; index++) {
			await expect(rows.nth(index).locator('td.td-cell').nth(0)).toContainText('Unified plan');
		}
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

		await page.locator('button[aria-label="Undo"]').click();
		await expect(rows.nth(0).locator('td.td-cell').nth(0)).toContainText('Starter Cloud');
		await expect(rows.nth(1).locator('td.td-cell').nth(0)).toContainText('Developer Sandbox');
		await expect(rows.nth(2).locator('td.td-cell').nth(0)).toContainText('Plan 3');

		await page.locator('button[aria-label="Redo"]').click();
		for (let index = 0; index < 3; index++) {
			await expect(rows.nth(index).locator('td.td-cell').nth(0)).toContainText('Unified plan');
		}
	});

	test('choosing one dropdown option replaces the selected dropdown range', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').nth(1);
		const third = rows.nth(2).locator('td.td-cell').nth(1);

		await first.click();
		await third.click({ modifiers: ['Shift'] });
		await third.locator('button[aria-label="Open dropdown options"]').click();
		const popover = third.locator('.custom-dropdown-popover');
		await expect(popover.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
		await popover.locator('button.dropdown-opt-btn', { hasText: 'Trial' }).click();

		for (let index = 0; index < 3; index++) {
			await expect(rows.nth(index).locator('td.td-cell').nth(1)).toContainText('Trial');
		}
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

		await page.locator('button[aria-label="Undo"]').click();
		await expect(rows.nth(0).locator('td.td-cell').nth(1)).toContainText('Active');
		await expect(rows.nth(1).locator('td.td-cell').nth(1)).toContainText('Trial');
		await expect(rows.nth(2).locator('td.td-cell').nth(1)).toContainText('Pending');
	});

	test('a custom dropdown value replaces the selected dropdown range', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').nth(1);
		const second = rows.nth(1).locator('td.td-cell').nth(1);

		await first.click();
		await second.click({ modifiers: ['Shift'] });
		await page.keyboard.press('Enter');
		const search = second.locator('input.dropdown-search-input');
		await search.fill('Archived');
		await search.press('Enter');

		await expect(first).toContainText('Archived');
		await expect(second).toContainText('Archived');
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(2);
	});

	test('replaces currency, number, percent and date ranges through typed editors', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const cases = [
			{ colIndex: 2, input: '321', rendered: '$321.00', commit: 'tab' },
			{ colIndex: 3, input: '42', rendered: '42', commit: 'tab' },
			{ colIndex: 4, input: '12.5%', rendered: '12.5%', commit: 'tab' },
			{ colIndex: 5, input: '2026-12-31', rendered: '2026-12-31', commit: 'blur' }
		];

		for (const item of cases) {
			const first = rows.nth(0).locator('td.td-cell').nth(item.colIndex);
			const third = rows.nth(2).locator('td.td-cell').nth(item.colIndex);
			await first.click();
			await third.click({ modifiers: ['Shift'] });
			await page.keyboard.press('Enter');
			const input = third.locator('input.cell-input');
			await input.fill(item.input);
			if (item.commit === 'tab') await input.press('Tab');
			else await page.locator('.search-box input').click();

			for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
				await expect(rows.nth(rowIndex).locator('td.td-cell').nth(item.colIndex)).toContainText(
					item.rendered
				);
			}
			await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);
		}
	});

	test('Escape cancels a range edit without changing or collapsing the selection', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').nth(0);
		const third = rows.nth(2).locator('td.td-cell').nth(0);

		await first.click();
		await third.click({ modifiers: ['Shift'] });
		await page.keyboard.press('F2');
		const input = third.locator('input.cell-input');
		await input.fill('Cancelled value');
		await input.press('Escape');

		await expect(rows.nth(0).locator('td.td-cell').nth(0)).toContainText('Starter Cloud');
		await expect(rows.nth(1).locator('td.td-cell').nth(0)).toContainText('Developer Sandbox');
		await expect(rows.nth(2).locator('td.td-cell').nth(0)).toContainText('Plan 3');
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);
	});

	test('editing a mixed-column rectangle changes only its active cell', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const topLeft = rows.nth(0).locator('td.td-cell').nth(0);
		const bottomRight = rows.nth(1).locator('td.td-cell').nth(1);

		await topLeft.click();
		await bottomRight.click({ modifiers: ['Shift'] });
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(4);
		await page.keyboard.press('Enter');
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(1);

		const popover = bottomRight.locator('.custom-dropdown-popover');
		await popover.locator('button.dropdown-opt-btn', { hasText: 'Pending' }).click();
		await expect(rows.nth(1).locator('td.td-cell').nth(1)).toContainText('Pending');
		await expect(rows.nth(0).locator('td.td-cell').nth(1)).toContainText('Active');
	});

	test('renames a column by double-clicking its header, not via a menu item', async ({ page }) => {
		const firstHeader = page.locator('thead th.th-column').first();
		await firstHeader.locator('button.th-title-btn').dblclick();

		const renameInput = firstHeader.locator('input.th-rename-input');
		await expect(renameInput).toBeFocused();
		await renameInput.fill('Plan Name');
		await renameInput.press('Enter');
		await expect(firstHeader).toContainText('Plan Name');

		// Rename was removed from the overflow menu; it only carries type/fit/delete now.
		await firstHeader.locator('button.th-menu-trigger').click();
		const popover = page.locator('.column-popover');
		await expect(popover).toBeVisible();
		await expect(popover).not.toContainText('Rename');
		await expect(popover).toContainText('Fit to content');
	});

	test('hides the sort chevron until a column is hovered or actually sorted', async ({ page }) => {
		const priceHeader = page.locator('thead th:has-text("Monthly Price")');
		const chevron = priceHeader.locator('.th-sort-icon');

		await expect(chevron).toHaveCSS('opacity', '0');
		await priceHeader.hover();
		await expect(chevron).not.toHaveCSS('opacity', '0');

		await priceHeader.locator('button.th-title-btn').click();
		await page.locator('.search-box input').hover();
		await expect(chevron).toHaveCSS('opacity', '1');
	});

	test('resizes column width interactively via drag handle', async ({ page }) => {
		const firstHeader = page.locator('thead th.th-column').first();
		const initialBox = await firstHeader.boundingBox();
		const handleBox = await firstHeader.locator('.th-resize-handle').boundingBox();
		expect(initialBox).toBeTruthy();
		expect(handleBox).toBeTruthy();

		if (handleBox && initialBox) {
			await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
			await page.mouse.down();
			await page.mouse.move(handleBox.x + 60, handleBox.y + handleBox.height / 2);
			await page.mouse.up();

			const newBox = await firstHeader.boundingBox();
			expect(newBox?.width).toBeGreaterThan(initialBox.width + 30);
		}
	});

	test('AI drawer closes via the ribbon toggle and Escape, with no redundant close button', async ({
		page
	}) => {
		const aiBtn = page.locator('.right-tool-ribbon button.btn-ai-ribbon');
		await aiBtn.click();

		const drawer = page.locator('aside.ai-drawer');
		await expect(drawer).toHaveClass(/open/);
		// The model now lives only in the composer's switcher, not in the header too.
		await expect(drawer.locator('select.model-switcher-select')).toHaveValue('gemini-3.5-flash-lite');
		await expect(drawer.locator('.quick-btn')).toHaveCount(3);
		await expect(drawer.locator('.drawer-close-btn')).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(drawer).toHaveClass(/closed/);

		await aiBtn.click();
		await expect(drawer).toHaveClass(/open/);
		await aiBtn.click();
		await expect(drawer).toHaveClass(/closed/);
	});

	test('settings is a route with only AI, Modules and Shortcuts', async ({ page }) => {
		// Opening Settings must never trigger a file chooser: the ribbon used to register the
		// import picker from an $effect whose return value Svelte ran as teardown on navigation.
		let fileChooserOpened = false;
		page.on('filechooser', () => (fileChooserOpened = true));

		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		await expect(page).toHaveURL(/\/settings/);

		const settingsPage = page.locator('.settings-page');
		await expect(settingsPage).toBeVisible();
		expect(fileChooserOpened).toBe(false);

		const navItems = settingsPage.locator('nav.settings-sidebar .settings-nav-item');
		await expect(navItems).toHaveCount(3);
		// The section names itself in the topbar; the card headings carry the detail.
		await expect(settingsPage.locator('.settings-topbar h1')).toHaveText('AI & Models');
		await expect(settingsPage).toContainText('API Key');
		await expect(settingsPage).toContainText('Models');

		await navItems.filter({ hasText: 'Shortcuts' }).click();
		await expect(settingsPage).toContainText('Keyboard shortcuts');
		await expect(settingsPage).not.toContainText('Appearance');
		await expect(settingsPage).not.toContainText('Sample Datasets');

		await navItems.filter({ hasText: 'AI & Models' }).click();

		const keyInput = settingsPage.locator('input.api-key-input');
		await keyInput.fill('AIzaSyTestKeyForPlaywrightE2E12345');
		await settingsPage.locator('button[aria-label="Save API key"]').click();
		await expect(settingsPage.locator('.status-pill.status-active')).toBeVisible();

		await settingsPage.locator('.settings-close-btn').click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('.title-text')).toContainText('SaaS Revenue');
	});

	test('file creation and import live only in the Files menu, not the ribbon', async ({ page }) => {
		const ribbon = page.locator('.right-tool-ribbon');
		await expect(ribbon.locator('button.btn-new-sheet')).toHaveCount(0);
		await expect(ribbon.locator('button[aria-label="Import Spreadsheet"]')).toHaveCount(0);

		await page.locator('.files-btn').click();
		await expect(page.locator('.files-menu .files-new')).toBeVisible();
		await expect(page.locator('.files-menu .files-import')).toBeVisible();
	});

	test('long cell text is clipped inside its own column, never bleeding into the next', async ({
		page
	}) => {
		const cell = page.locator('tbody tr.data-row').first().locator('td.td-cell').first();
		await cell.dblclick();
		const input = cell.locator('input.cell-input');
		await input.fill('X'.repeat(220));
		await input.press('Enter');

		const cellBox = await cell.boundingBox();
		const textBox = await cell.locator('.cell-text-display').boundingBox();
		expect(cellBox).not.toBeNull();
		expect(textBox).not.toBeNull();
		expect(textBox!.width).toBeLessThanOrEqual(cellBox!.width);
	});

	test('aligns a selected range left, center and right like Excel', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').first();
		const second = rows.nth(1).locator('td.td-cell').nth(1);

		await first.click();
		await expect(page.locator('.align-group button[aria-pressed="true"]')).toHaveCount(1);

		// Shift-click extends the rectangle; both corners plus the cells between highlight.
		await second.click({ modifiers: ['Shift'] });
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(4);

		await page.locator('.align-group button[aria-label^="Align center"]').click();
		await expect(first).toHaveClass(/text-center/);
		await expect(second).toHaveClass(/text-center/);

		// Undo/redo treat it as a document edit, because it is one.
		await page.locator('.icon-btn[aria-label="Undo"]').click();
		await expect(first).toHaveClass(/text-left/);
		await page.locator('.icon-btn[aria-label="Redo"]').click();
		await expect(first).toHaveClass(/text-center/);

		// Alignment is document state, so it survives a reload (history does not).
		await page.reload();
		await expect(rows.nth(0).locator('td.td-cell').first()).toHaveClass(/text-center/);
	});

	test('theme toggles from the ribbon and survives a reload', async ({ page }) => {
		await page.locator('.right-tool-ribbon button.theme-toggle-btn').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		await page.locator('.right-tool-ribbon button.theme-toggle-btn').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('creates files, switches between them, and keeps each one intact', async ({ page }) => {
		const filesBtn = page.locator('.files-btn');
		await expect(filesBtn.locator('.files-count')).toHaveText('1');

		await filesBtn.click();
		await page.locator('.files-menu .files-new').click();
		await expect(page.locator('.title-text')).toContainText('Untitled Table');
		await expect(page.locator('thead th.th-column')).toHaveCount(5);
		await expect(filesBtn.locator('.files-count')).toHaveText('2');

		// Type into the new file, then switch away and back.
		const cell = page.locator('tbody tr.data-row:first-child td.td-cell').first();
		await cell.dblclick();
		await cell.locator('input.cell-input').fill('scratch');
		await cell.locator('input.cell-input').press('Enter');

		await filesBtn.click();
		await page.locator('.files-menu .file-open:has-text("SaaS Revenue")').click();
		await expect(page.locator('.title-text')).toContainText('SaaS Revenue');
		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);

		await filesBtn.click();
		await page.locator('.files-menu .file-open:has-text("Untitled Table")').click();
		await expect(page.locator('tbody tr.data-row:first-child')).toContainText('scratch');
	});

	test('renaming the file updates the Files list, and files survive a reload', async ({ page }) => {
		await page.locator('button.title-button').click();
		const titleInput = page.locator('input.title-input');
		await titleInput.fill('Q3 Invoices');
		await titleInput.press('Enter');

		await page.locator('.files-btn').click();
		await expect(page.locator('.files-menu')).toContainText('Q3 Invoices');
		await page.keyboard.press('Escape');

		await page.reload();
		await expect(page.locator('.title-text')).toContainText('Q3 Invoices');
		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);
	});

	test('deleting the last file leaves a usable blank file rather than an empty screen', async ({
		page
	}) => {
		const filesBtn = page.locator('.files-btn');
		await filesBtn.click();
		await page.locator('.files-menu .file-row').first().hover();
		await page.locator('.files-menu .file-delete').first().click();

		await expect(page.locator('.title-text')).toContainText('Untitled Table');
		await expect(page.locator('thead th.th-column')).toHaveCount(5);
		await expect(filesBtn.locator('.files-count')).toHaveText('1');
	});

	test('renders module ribbon metadata and persists module enablement', async ({ page }) => {
		const moduleButton = page.locator('.right-tool-ribbon button[aria-label="ICEGrid Documents"]');
		await expect(moduleButton).toBeVisible();

		const moduleInput = page.locator(
			'.right-tool-ribbon input[type="file"][accept=".pdf,.xls,.xlsx"]'
		);
		await expect(moduleInput).toHaveAttribute('multiple', '');

		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		await page.locator('.settings-nav-item', { hasText: 'Modules' }).click();
		const moduleSwitch = page.locator(
			'.settings-page button[role="switch"][aria-label="Toggle ICEGrid Importer"]'
		);
		await expect(moduleSwitch).toHaveAttribute('aria-checked', 'true');
		await moduleSwitch.click();
		await page.keyboard.press('Escape');
		await expect(page).toHaveURL(/\/$/);
		await expect(moduleButton).toHaveCount(0);

		await page.reload();
		await expect(page.locator('.right-tool-ribbon')).toBeVisible();
		await expect(moduleButton).toHaveCount(0);

		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		await page.locator('.settings-nav-item', { hasText: 'Modules' }).click();
		await page
			.locator('.settings-page button[role="switch"][aria-label="Toggle ICEGrid Importer"]')
			.click();
		await page.keyboard.press('Escape');
		await expect(page).toHaveURL(/\/$/);
		await expect(moduleButton).toBeVisible();
	});

	test('dismissing a dropdown by clicking away leaves the cell unchanged', async ({ page }) => {
		// Row 2 is `Trial`, deliberately not the first option — a revert would show `Active`.
		const cell = page.locator('tbody tr.data-row').nth(1).locator('td').nth(2);
		await expect(cell).toContainText('Trial');

		await cell.hover();
		await cell.locator('.dropdown-cell-arrow').click();
		await expect(page.locator('.custom-dropdown-popover')).toBeVisible();

		// Click outside the popover without choosing anything.
		await page.locator('input[placeholder="Search rows"]').click();
		await expect(page.locator('.custom-dropdown-popover')).not.toBeVisible();
		await expect(cell).toContainText('Trial');
	});

	test('lays the grid out at the summed column width, not an intrinsic one', async ({ page }) => {
		// Firefox blew `min-width: max-content` up to millions of px on a fixed-layout
		// table, which pushed every column off-screen and rendered the grid blank. The
		// suite is chromium-only, so this asserts the shape both engines agree on.
		const wrap = page.locator('.table-scroll-wrap');
		const { scrollWidth, clientWidth } = await wrap.evaluate((el) => ({
			scrollWidth: el.scrollWidth,
			clientWidth: el.clientWidth
		}));
		// 40 index + 220 + 130 + 150 + 160 + 80 add-column = 780, so a wide viewport wins
		// and there is nothing to scroll sideways. The bug made this 17.9M.
		expect(scrollWidth).toBe(clientWidth);

		// Firefox hands a fixed table's leftover height to any row that declares none, so
		// the header swelled to 190px there. Both header rows declare their own height —
		// the 20px column-letter strip and the 32px named row — so the thead stays put.
		const headerH = await page
			.locator('thead')
			.evaluate((el) => el.getBoundingClientRect().height);
		expect(headerH).toBeLessThan(60);

		// The letter strip must span exactly the columns the named row does, or every
		// column below it drifts out of alignment.
		const [letterCells, nameCells] = await Promise.all([
			page.locator('thead tr').nth(0).locator('th').count(),
			page.locator('thead tr').nth(1).locator('th').count()
		]);
		expect(letterCells).toBe(nameCells);
	});

	test('opens status dropdown on chevron click and avoids footer clipping in light mode', async ({
		page
	}) => {
		await page.locator('.right-tool-ribbon button.theme-toggle-btn').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		const firstStatusCell = page.locator('tbody tr.data-row:first-child td:nth-child(3)');
		await firstStatusCell.hover();
		await firstStatusCell.locator('.dropdown-cell-arrow').click();

		const popover = page.locator('.custom-dropdown-popover');
		await expect(popover).toBeVisible();
		await expect(page.locator('.dropdown-search-input')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(popover).not.toBeVisible();

		const lastRowStatusCell = page.locator('tbody tr.data-row').last().locator('td:nth-child(3)');
		await lastRowStatusCell.scrollIntoViewIfNeeded();
		await lastRowStatusCell.hover();
		await lastRowStatusCell.locator('.dropdown-cell-arrow').click();
		await expect(popover).toBeVisible();

		const popoverBox = await popover.boundingBox();
		const footerBox = await page.locator('tfoot tr.summary-row').boundingBox();
		if (popoverBox && footerBox) {
			expect(
				popoverBox.y + popoverBox.height <= footerBox.y ||
					popoverBox.y >= footerBox.y + footerBox.height ||
					popoverBox.y < footerBox.y
			).toBe(true);
		}
	});

	test('deletes a column instantly with undo, no confirmation modal', async ({ page }) => {
		const tierHeader = page.locator('thead th:has-text("Tier")');
		await tierHeader.hover();
		await tierHeader.locator('button.th-menu-trigger').click();
		await page.locator('.column-popover button.popover-delete').click();

		await expect(page.locator('thead th:has-text("Tier")')).toHaveCount(0);
		await expect(page.locator('.confirm-dialog')).toHaveCount(0);

		await page.locator('.header-right button[aria-label="Undo"]').click();
		await expect(page.locator('thead th:has-text("Tier")')).toHaveCount(1);
	});

	test('shows when no dependent dropdown option is valid for the whole selection', async ({ page }) => {
		await page.evaluate((doc) => {
			const id = 'd_dependent';
			localStorage.setItem(`xlsx-ai:doc:${id}`, JSON.stringify(doc));
			localStorage.setItem(
				'xlsx-ai:docs:v1',
				JSON.stringify({
					docs: [{ id, title: doc.title, updatedAt: new Date().toISOString() }],
					activeId: id
				})
			);
		}, DEPENDENT_DROPDOWN_FIXTURE);
		await page.reload();

		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').nth(1);
		const second = rows.nth(1).locator('td.td-cell').nth(1);
		await first.click();
		await second.click({ modifiers: ['Shift'] });
		await page.keyboard.press('Enter');

		const popover = second.locator('.custom-dropdown-popover');
		await expect(popover.locator('.dropdown-empty-state')).toHaveText(
			'No options are valid for all selected cells.'
		);
		await expect(popover.locator('button.dropdown-opt-btn:not(.clear-opt-btn)')).toHaveCount(0);
		await popover.locator('input.dropdown-search-input').press('Escape');
		await expect(first).toContainText('102');
		await expect(second).toContainText('171');
	});

	test('responsive mobile workspace keeps commands, search, and navigation usable', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();

		await expect(page.locator('.search-box input')).toBeVisible();
		const commandBar = page.locator('.right-tool-ribbon');
		await expect(commandBar).toBeVisible();

		const tableBox = await page.locator('.table-scroll-wrap').boundingBox();
		expect(tableBox?.width).toBeGreaterThan(350);

		await commandBar.locator('button.btn-ai-ribbon').click();
		await expect(page.locator('aside.ai-drawer.open')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.locator('aside.ai-drawer')).toHaveClass(/closed/);
	});

	test('replaces a Shift-selected range opened by double-click', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const first = rows.nth(0).locator('td.td-cell').nth(0);
		const third = rows.nth(2).locator('td.td-cell').nth(0);

		await first.click();
		await third.click({ modifiers: ['Shift'] });
		// The mouse path: a double-click's first click must not collapse the range.
		await third.dblclick();
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

		const input = third.locator('input.cell-input');
		await input.fill('Range By Mouse');
		await input.press('Enter');

		for (let index = 0; index < 3; index++) {
			await expect(rows.nth(index).locator('td.td-cell').nth(0)).toContainText('Range By Mouse');
		}
	});

	test('stores several API keys and switches between them', async ({ page }) => {
		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		const settingsPage = page.locator('.settings-page');
		const keyInput = settingsPage.locator('input.api-key-input');
		const save = settingsPage.locator('button[aria-label="Save API key"]');

		await keyInput.fill('AIzaSyPlaywrightKeyAAAA1111');
		await save.click();
		await keyInput.fill('AIzaSyPlaywrightKeyBBBB2222');
		await save.click();

		const keyRows = settingsPage.locator('.api-key-list li');
		await expect(keyRows).toHaveCount(2);
		await expect(settingsPage.locator('.status-pill.status-active')).toContainText('2 keys');
		// The most recently saved key is the one in use.
		await expect(keyRows.nth(1)).toContainText('••••2222');
		await expect(keyRows.nth(1)).toContainText('In use');

		await keyRows.nth(0).locator('button[aria-pressed]').click();
		await expect(keyRows.nth(0)).toContainText('In use');
		await expect(keyRows.nth(1)).not.toContainText('In use');

		// Removing the inactive key leaves the active one selected.
		await keyRows.nth(1).locator('.remove-key-btn').click();
		await expect(settingsPage.locator('.api-key-list li')).toHaveCount(1);
		await expect(settingsPage.locator('.api-key-list li').first()).toContainText('••••1111');
	});

	test('the chat composer grows with its text and switches model in place', async ({ page }) => {
		await page.locator('.right-tool-ribbon button[aria-label="Toggle AI Assistant"]').click();
		const drawer = page.locator('aside.ai-drawer.open');
		await expect(drawer).toBeVisible();

		const composer = drawer.locator('textarea');
		const startHeight = (await composer.boundingBox())!.height;
		await composer.fill('one\ntwo\nthree\nfour\nfive');
		expect((await composer.boundingBox())!.height).toBeGreaterThan(startHeight);

		// Nothing starred yet, so the switcher offers only the model actually in use.
		const switcher = drawer.locator('select.model-switcher-select');
		await expect(switcher.locator('option')).toHaveCount(1);
		await expect(switcher).toHaveValue('gemini-3.5-flash-lite');
	});

	test('the chat switcher offers exactly the models starred in Settings', async ({ page }) => {
		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		const settingsPage = page.locator('.settings-page');

		// Every model card carries a star, and it is visible without hovering it first -
		// a control nobody can see is a control nobody uses.
		const stars = settingsPage.locator('.favorite-model-btn');
		// `.count()` does not auto-wait, so read it only once a card has actually
		// rendered - otherwise the expected count races to 0 and the assertion inverts.
		const modelCards = settingsPage.locator('[role="radio"]');
		await expect(modelCards.first()).toBeVisible();
		await expect(stars).toHaveCount(await modelCards.count());
		for (const star of await stars.all()) await expect(star).toBeVisible();
		await expect(stars.first()).toHaveCSS('opacity', '1');

		await settingsPage.locator('button[aria-label="Favorite Gemini 3.6 Flash"]').click();
		await settingsPage.locator('button[aria-label="Favorite Gemini 3.1 Pro"]').click();
		await settingsPage.locator('.settings-close-btn').click();

		await page.locator('.right-tool-ribbon button[aria-label="Toggle AI Assistant"]').click();
		const switcher = page.locator('aside.ai-drawer.open select.model-switcher-select');
		// The active model is not starred, so it leads; ids only, one writing style.
		await expect(switcher.locator('option')).toHaveText([
			'gemini-3.5-flash-lite',
			'gemini-3.6-flash',
			'gemini-3.1-pro-preview'
		]);

		await switcher.selectOption('gemini-3.6-flash');
		await expect(switcher).toHaveValue('gemini-3.6-flash');
	});

	test('a filled dropdown cell shows the range highlight like every other column', async ({
		page
	}) => {
		const rows = page.locator('tbody tr.data-row');
		const textCell = rows.nth(1).locator('td.td-cell').nth(0);
		const dropdownCell = rows.nth(0).locator('td.td-cell').nth(1);

		await rows.nth(0).locator('td.td-cell').nth(0).click();
		await rows.nth(1).locator('td.td-cell').nth(1).click({ modifiers: ['Shift'] });

		// The dropdown paints its own colour inline; the selection tint has to survive it.
		await expect(textCell).toHaveClass(/in-range/);
		await expect(dropdownCell).toHaveClass(/in-range/);
		await expect(dropdownCell).toHaveAttribute('style', /linear-gradient/);
	});

	test('a selected range is outlined on its perimeter, not boxed cell by cell', async ({
		page
	}) => {
		const rows = page.locator('tbody tr.data-row');
		// A 2x2 rectangle: rows 0-1 across the first two columns.
		await rows.nth(0).locator('td.td-cell').nth(0).click();
		await rows.nth(1).locator('td.td-cell').nth(1).click({ modifiers: ['Shift'] });

		const topLeft = rows.nth(0).locator('td.td-cell').nth(0);
		const topRight = rows.nth(0).locator('td.td-cell').nth(1);
		const bottomLeft = rows.nth(1).locator('td.td-cell').nth(0);

		// Top-left owns the top and left edges, and neither of the other two.
		await expect(topLeft).toHaveAttribute('style', /inset 0 2px 0 0/);
		await expect(topLeft).toHaveAttribute('style', /inset 2px 0 0 0/);
		await expect(topLeft).not.toHaveAttribute('style', /inset -2px 0 0 0/);
		await expect(topLeft).not.toHaveAttribute('style', /inset 0 -2px 0 0/);

		// Top-right closes the right edge; bottom-left closes the bottom.
		await expect(topRight).toHaveAttribute('style', /inset -2px 0 0 0/);
		await expect(bottomLeft).toHaveAttribute('style', /inset 0 -2px 0 0/);

		// A single cell gets the active ring only, never a range outline.
		await rows.nth(2).locator('td.td-cell').nth(0).click();
		const single = rows.nth(2).locator('td.td-cell').nth(0);
		await expect(single).toHaveAttribute('style', /inset 0 0 0 2px/);
		await expect(single).not.toHaveAttribute('style', /inset 2px 0 0 0/);
	});

	test('typing on a dropdown cell keeps the keystroke as the search query', async ({ page }) => {
		const tierCell = page.locator('tbody tr.data-row').nth(0).locator('td.td-cell').nth(1);
		await tierCell.click();
		await page.keyboard.press('t');

		const search = tierCell.locator('input.dropdown-search-input');
		await expect(search).toHaveValue('t');
		// Filtered down by that character, so Enter picks the match rather than option one.
		await page.keyboard.press('Enter');
		await expect(tierCell).toContainText('Trial');
	});

	test('opening a dropdown highlights its current value so Enter is not a silent edit', async ({
		page
	}) => {
		const tierCell = page.locator('tbody tr.data-row').nth(0).locator('td.td-cell').nth(1);
		await expect(tierCell).toContainText('Active');

		await tierCell.click();
		await page.keyboard.press('Enter');
		await expect(tierCell.locator('.custom-dropdown-popover')).toBeVisible();
		await page.keyboard.press('Enter');

		await expect(tierCell).toContainText('Active');
	});

	test('shift-clicking a dropdown cell extends the selection, caret included', async ({
		page
	}) => {
		const rows = page.locator('tbody tr.data-row');
		const selected = page.locator('td.td-cell[aria-selected="true"]');

		await rows.nth(0).locator('td.td-cell').nth(0).click();
		await rows.nth(2).hover();
		// The caret covers the right edge of every dropdown cell, so a shift-click on the
		// cell lands on it often. It must select, not open an editor and drop the range.
		await rows.nth(2).locator('.dropdown-cell-arrow').click({ modifiers: ['Shift'], force: true });

		await expect(selected).toHaveCount(6);
		await expect(page.locator('.custom-dropdown-popover')).toHaveCount(0);

		// Without shift it still opens the editor, as the only way in with the mouse.
		await rows.nth(2).locator('.dropdown-cell-arrow').click();
		await expect(page.locator('.custom-dropdown-popover')).toHaveCount(1);
	});

	test('column letters sit above the names and the gutter counts from Excel row 2', async ({
		page
	}) => {
		const letters = page.locator('thead th.th-letter');
		await expect(letters).toHaveCount(6);
		await expect(letters.nth(0)).toHaveText('A');
		await expect(letters.nth(3)).toHaveText('D');

		// The gutter is the number a formula addresses the row by: row 1 is the header.
		const gutter = page.locator('tbody tr.data-row .row-num');
		await expect(gutter.nth(0)).toHaveText('2');
		await expect(gutter.nth(1)).toHaveText('3');

		// The letter of the active cell's column lights up, like Excel's header.
		await page.locator('tbody tr.data-row').nth(0).locator('td.td-cell').nth(2).click();
		await expect(letters.nth(2)).toHaveClass(/text-\[var\(--accent-primary\)\]/);
	});

	test('typing = SU offers matching functions and Enter completes to SUM(', async ({ page }) => {
		const cell = page.locator('tbody tr.data-row').nth(0).locator('td.td-cell').nth(3);
		await cell.dblclick();
		const editor = page.locator('input.cell-input-editor');
		await editor.fill('=SU');

		const hints = page.locator('.formula-hints [role="option"]');
		await expect(hints).toHaveCount(4);
		await expect(hints.nth(0)).toContainText('SUBSTITUTE');

		await editor.press('ArrowDown');
		await editor.press('Enter');
		await expect(editor).toHaveValue('=SUM(');
		// Enter completed the name; it must not have committed the cell.
		await expect(editor).toBeVisible();
	});

	test('clicking a cell mid-formula writes its address, and outlines what it reads', async ({
		page
	}) => {
		const rows = page.locator('tbody tr.data-row');
		await rows.nth(0).locator('td.td-cell').nth(3).dblclick();
		const editor = page.locator('input.cell-input-editor');
		await editor.fill('=');

		// Point mode: the click lands in the formula instead of moving the selection.
		await rows.nth(2).locator('td.td-cell').nth(2).click();
		await expect(editor).toHaveValue('=C4');
		await expect(editor).toBeVisible();

		// The referenced cell is outlined while the formula is open.
		await expect(page.locator('td.formula-ref')).toHaveCount(1);

		await editor.press('Enter');
		await expect(rows.nth(0).locator('td.td-cell').nth(3)).toContainText('174');
	});

	test('dragging the fill handle copies a formula down, stepping its references', async ({
		page
	}) => {
		const rows = page.locator('tbody tr.data-row');
		// Twice Monthly Price (column C), written into Active Accounts (column D).
		const source = rows.nth(0).locator('td.td-cell').nth(3);
		await source.dblclick();
		await page.locator('input.cell-input-editor').fill('=C2*2');
		await page.locator('input.cell-input-editor').press('Enter');

		await source.click();
		const handle = source.locator('.active-cell-handle');
		const box = await handle.boundingBox();
		const target = await rows.nth(3).locator('td.td-cell').nth(3).boundingBox();
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
			steps: 6
		});
		// The dashed preview covers the source plus the three cells dragged over.
		await expect(page.locator('td.in-fill')).toHaveCount(4);
		await page.mouse.up();

		// Row 2 is C2*2 = 200; each filled row steps its reference one row down.
		for (const [i, expected] of [['0', '200'], ['1', '38'], ['2', '348'], ['3', '422']]) {
			await expect(rows.nth(Number(i)).locator('td.td-cell').nth(3)).toContainText(expected);
		}

		// The formula was rewritten, not merely copied.
		await rows.nth(2).locator('td.td-cell').nth(3).dblclick();
		await expect(page.locator('input.cell-input-editor')).toHaveValue('=C4*2');
	});

	test('filling under a filter steps by sheet rows, not by visible ones', async ({ page }) => {
		// Tier cycles Active/Trial/Pending, so the Trial rows are r2, r5, r8 - sheet rows
		// 3, 6, 9. Two rows apart on screen, three apart in the sheet a formula addresses.
		await page.locator('.search-box input').fill('Trial');
		const rows = page.locator('tbody tr.data-row');
		await expect(rows).toHaveCount(8);

		const source = rows.nth(0).locator('td.td-cell').nth(3);
		await source.click();
		await source.dblclick();
		await page.locator('input.cell-input-editor').fill('=C3*2');
		await page.locator('input.cell-input-editor').press('Enter');

		await source.click();
		const box = await source.locator('.active-cell-handle').boundingBox();
		const target = await rows.nth(1).locator('td.td-cell').nth(3).boundingBox();
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
			steps: 6
		});
		await page.mouse.up();

		// The next Trial row is r5, whose price is on sheet row 6 - not row 4, which is
		// simply the next row down and belongs to a row the filter is hiding.
		await rows.nth(1).locator('td.td-cell').nth(3).dblclick();
		await expect(page.locator('input.cell-input-editor')).toHaveValue('=C6*2');
		await page.locator('input.cell-input-editor').press('Escape');

		await page.locator('.search-clear').click();
		await expect(rows.nth(4).locator('td.td-cell').nth(3)).toContainText('496');
	});

	test('deleting a row re-aims the formulas that pointed past it', async ({ page }) => {
		const rows = page.locator('tbody tr.data-row');
		const totals = rows.nth(0).locator('td.td-cell').nth(3);

		// Active Accounts starts 1000, 989, 978 — a total over the first three rows.
		await totals.dblclick();
		await page.locator('input.cell-input-editor').fill('=SUM(D3:D5)');
		await page.locator('input.cell-input-editor').press('Enter');
		await expect(totals).toContainText('2,934');

		// Drop the middle row of that range. Excel shrinks the range; leaving it alone
		// would silently make it sum a different three rows.
		await rows.nth(2).hover();
		await rows.nth(2).locator('button[aria-label^="Delete row"]').click();
		await expect(totals).toContainText('1,956'); // 989 + 967, the two rows left in the range

		await totals.dblclick();
		await expect(page.locator('input.cell-input-editor')).toHaveValue('=SUM(D3:D4)');
	});
});
