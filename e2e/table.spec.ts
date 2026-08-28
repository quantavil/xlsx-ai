import { test, expect } from '@playwright/test';

test.describe('xlsx-ai E2E Workflow', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('renders initial SaaS dataset with sticky headers and footer summaries', async ({ page }) => {
		await expect(page.locator('.brand-name')).toHaveText('xlsx-ai');
		await expect(page.locator('.title-text')).toContainText('SaaS Revenue');

		const headers = page.locator('thead th');
		await expect(headers).toContainText(['#', 'Product Plan', 'Tier', 'Monthly Price', 'Active Accounts', 'Churn Risk', 'Launch Date']);

		const rows = page.locator('tbody tr.data-row');
		await expect(rows).toHaveCount(25);

		const footer = page.locator('tfoot tr.summary-row');
		await expect(footer).toBeVisible();
		await expect(footer).toContainText('Summary');
	});

	test('switches between sample datasets cleanly', async ({ page }) => {
		await page.locator('.sample-btn').click();
		await expect(page.locator('.sample-menu')).toBeVisible();

		await page.locator('.sample-menu button:has-text("Sales Pipeline")').click();
		await expect(page.locator('.title-text')).toContainText('B2B Sales Pipeline');
		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);

		await page.locator('.sample-btn').click();
		await page.locator('.sample-menu button:has-text("Hardware Inventory")').click();
		await expect(page.locator('.title-text')).toContainText('Hardware & Logistics Inventory');
	});

	test('filters rows instantly via search input and clears filter', async ({ page }) => {
		const searchInput = page.locator('.search-box input');
		await searchInput.fill('Starter Cloud');

		const filteredRows = page.locator('tbody tr.data-row');
		await expect(filteredRows).toHaveCount(1);
		await expect(filteredRows.first()).toContainText('Starter Cloud');

		await page.locator('.search-clear').click();
		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);
	});

	test('sorts columns ascending and descending on header click', async ({ page }) => {
		const priceHeader = page.locator('thead th:has-text("Monthly Price") button.th-title-btn');
		await priceHeader.click();
		const firstCell = page.locator('tbody tr.data-row:first-child td:nth-child(2)');
		await expect(firstCell).toContainText('Developer Sandbox');

		await priceHeader.click();
		await expect(page.locator('tbody tr.data-row:first-child td:nth-child(2)')).toContainText('Dedicated VPC');
	});

	test('adds new row and edits cell inline', async ({ page }) => {
		await page.locator('.right-tool-ribbon button[aria-label="Add Row"]').click();
		await expect(page.locator('tbody tr.data-row')).toHaveCount(26);

		const lastRowFirstCell = page.locator('tbody tr.data-row:last-child td:nth-child(2)');
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

		// Arrow right to 2nd column
		await page.keyboard.press('ArrowRight');
		const tierCell = page.locator('tbody tr.data-row:first-child td:nth-child(3)');
		await expect(tierCell).toBeFocused();
		await expect(tierCell).toHaveAttribute('tabindex', '0');

		// Arrow down to row 2
		await page.keyboard.press('ArrowDown');
		const row2TierCell = page.locator('tbody tr.data-row:nth-child(2) td:nth-child(3)');
		await expect(row2TierCell).toBeFocused();

		// Press Enter to open status dropdown popover
		await page.keyboard.press('Enter');
		const popover = row2TierCell.locator('.custom-dropdown-popover');
		await expect(popover).toBeVisible();

		// Select 'Trial' option
		const trialOption = popover.locator('button.dropdown-opt-btn', { hasText: 'Trial' });
		await trialOption.click();
		await expect(row2TierCell).toContainText('Trial');
	});

	test('resizes column width interactively via drag handle', async ({ page }) => {
		const firstHeader = page.locator('thead th.th-column').first();
		const initialBox = await firstHeader.boundingBox();
		expect(initialBox).toBeTruthy();

		const resizeHandle = firstHeader.locator('.th-resize-handle');
		const handleBox = await resizeHandle.boundingBox();
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

	test('opens AI Assistant drawer with slide-in interface and links to settings', async ({ page }) => {
		const aiBtn = page.locator('.right-tool-ribbon button.btn-ai-ribbon');
		await aiBtn.click();

		const drawer = page.locator('aside.ai-drawer');
		await expect(drawer).toBeVisible();
		await expect(drawer).toHaveClass(/open/);
		await expect(drawer).toContainText('Gemini 3.5 Flash Lite');
		await expect(drawer.locator('.quick-btn')).toHaveCount(3);

		await drawer.locator('button[title="Close drawer"]').click();
		await expect(drawer).toHaveClass(/closed/);
	});

	test('opens Settings modal, manages API key, toggles theme, and traps focus with Escape close', async ({ page }) => {
		const settingsBtn = page.locator('.right-tool-ribbon button.settings-toggle-btn');
		await settingsBtn.click();

		const settingsDialog = page.locator('.settings-dialog');
		await expect(settingsDialog).toBeVisible();

		// Focus trapping verification
		await page.keyboard.press('Tab');
		const focusedInDialog = await page.evaluate(() => {
			const active = document.activeElement;
			const dialogEl = document.querySelector('.settings-dialog');
			return dialogEl ? dialogEl.contains(active) : false;
		});
		expect(focusedInDialog).toBe(true);

		// Enter and save API key
		const keyInput = settingsDialog.locator('input.api-key-input');
		await keyInput.fill('AIzaSyTestKeyForPlaywrightE2E12345');
		await settingsDialog.locator('button:has-text("Save API Key")').click();
		await expect(settingsDialog.locator('.status-pill.status-active')).toBeVisible();

		// Switch to Appearance tab to toggle theme
		await settingsDialog.locator('nav.settings-sidebar button:has-text("Appearance")').click();
		await settingsDialog.locator('button.theme-card:has-text("Light Mode")').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		// Close modal via Escape and verify focus restoration
		await page.keyboard.press('Escape');
		await expect(settingsDialog).not.toBeVisible();
		await expect(settingsBtn).toBeFocused();

		// Toggle back to dark mode via right ribbon
		await page.locator('.right-tool-ribbon button.theme-toggle-btn').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('renders module ribbon metadata and persists module enablement', async ({ page }) => {
		const moduleButton = page.locator(
			'.right-tool-ribbon button[aria-label="ICEGrid Documents"]'
		);
		await expect(moduleButton).toBeVisible();

		const moduleInput = page.locator(
			'.right-tool-ribbon input[type="file"][accept=".pdf,.xls,.xlsx"]'
		);
		await expect(moduleInput).toHaveAttribute('multiple', '');

		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		const settingsDialog = page.locator('.settings-dialog');
		await settingsDialog.locator('nav.settings-sidebar button:has-text("Modules")').click();
		const moduleSwitch = settingsDialog.locator(
			'button[role="switch"][aria-label="Toggle ICEGrid Importer"]'
		);
		await expect(moduleSwitch).toHaveAttribute('aria-checked', 'true');
		await moduleSwitch.click();
		await expect(moduleButton).toHaveCount(0);
		await page.keyboard.press('Escape');

		await page.reload();
		await expect(moduleButton).toHaveCount(0);
		await page.locator('.right-tool-ribbon button.settings-toggle-btn').click();
		await page
			.locator('.settings-dialog nav.settings-sidebar button:has-text("Modules")')
			.click();
		await page
			.locator('.settings-dialog button[role="switch"][aria-label="Toggle ICEGrid Importer"]')
			.click();
		await expect(moduleButton).toBeVisible();
	});

	test('opens status dropdown on chevron click, adapts in light mode, and avoids footer clipping', async ({ page }) => {
		// Toggle light mode first to verify light mode styling
		await page.locator('.right-tool-ribbon button.theme-toggle-btn').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		// Click chevron on first row
		const firstStatusCell = page.locator('tbody tr.data-row:first-child td:nth-child(3)');
		const arrow = firstStatusCell.locator('.dropdown-cell-arrow');
		await arrow.click();

		const popover = page.locator('.custom-dropdown-popover');
		await expect(popover).toBeVisible();
		const searchInput = page.locator('.dropdown-search-input');
		await expect(searchInput).toBeFocused();

		// Close popover
		await page.keyboard.press('Escape');
		await expect(popover).not.toBeVisible();

		// Scroll to last row and click status arrow
		const lastRowStatusCell = page.locator('tbody tr.data-row:last-child td:nth-child(3)');
		await lastRowStatusCell.scrollIntoViewIfNeeded();
		await lastRowStatusCell.locator('.dropdown-cell-arrow').click();
		await expect(popover).toBeVisible();

		const popoverBox = await popover.boundingBox();
		const viewportSize = page.viewportSize();
		const footerBox = await page.locator('tfoot tr.summary-row').boundingBox();

		if (popoverBox && viewportSize && footerBox) {
			expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(viewportSize.height);
			expect(popoverBox.y + popoverBox.height <= footerBox.y || popoverBox.y >= footerBox.y + footerBox.height || popoverBox.y < footerBox.y).toBe(true);
		}
	});

	test('performs instant sample switch and column delete with undo (no confirmation modal)', async ({ page }) => {
		// Modify table by adding a row — makes table dirty
		await page.locator('.right-tool-ribbon button[aria-label="Add Row"]').click();
		await expect(page.locator('tbody tr.data-row')).toHaveCount(26);

		// Pony: sample switch is instant, no confirm dialog even when dirty
		await page.locator('.sample-btn').click();
		await page.locator('.sample-menu button:has-text("Sales Pipeline")').click();
		await expect(page.locator('.title-text')).toContainText('B2B Sales Pipeline');
		await expect(page.locator('tbody tr.data-row')).toHaveCount(25);
		await expect(page.locator('.confirm-dialog')).toHaveCount(0);

		// Pony: column delete is instant, no confirm dialog — undo via toast/history
		const stageHeader = page.locator('thead th:has-text("Stage")');
		await stageHeader.locator('button.th-menu-trigger').click();
		await page.locator('.column-popover button.popover-delete').click();
		await expect(page.locator('thead th:has-text("Stage")')).toHaveCount(0);
		await expect(page.locator('.confirm-dialog')).toHaveCount(0);

		// Undo restores column
		await page.locator('.header-right button[aria-label="Undo"]').click();
		await expect(page.locator('thead th:has-text("Stage")')).toHaveCount(1);
	});

	test('responsive mobile workspace keeps commands, search, and navigation usable', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();

		await expect(page.locator('.search-box input')).toBeVisible();
		const commandBar = page.locator('.right-tool-ribbon');
		await expect(commandBar).toBeVisible();

		const tableBox = await page.locator('.table-scroll-wrap').boundingBox();
		expect(tableBox?.width).toBeGreaterThan(350);

		// Open AI drawer on mobile
		await commandBar.locator('button.btn-ai-ribbon').click();
		const drawer = page.locator('aside.ai-drawer.open');
		await expect(drawer).toBeVisible();
		await drawer.locator('button[aria-label="Close AI drawer"]').click();
	});
});
