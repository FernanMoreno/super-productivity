import assert from 'node:assert/strict';

const owners = {
  templates: 'workflow',
  integrations: 'settings',
  'workflow-week': 'week',
  'workflow-review': 'review',
  history: 'review',
  diagnostics: 'settings',
};
const panels = {
  templates: 'workflow',
  integrations: 'workflow',
  'workflow-week': 'workflow',
  'workflow-review': 'workflow',
};

// Follow visible sidebar links and secondary tools, exactly as a user does.
// Never expose a hidden panel or invoke production navigation from evaluation.
export async function navigate(page, sectionId) {
  const owner = owners[sectionId] || sectionId;
  const link = page.locator(`a[data-workspace-view][href="#${owner}"]`);
  await link.click();
  if (owner !== sectionId) {
    await page.locator(`#workspace-tools a[href="#${sectionId}"]`).click();
  }
  await page.locator(`body[data-workspace-view="${sectionId}"]`).waitFor();
  await page.locator(`#${panels[sectionId] || sectionId}`).waitFor({ state: 'visible' });
  assert.equal(await link.getAttribute('aria-current'), 'page');
  if (owner !== sectionId) {
    assert.equal(
      await page
        .locator(`#workspace-tools a[href="#${sectionId}"]`)
        .getAttribute('aria-current'),
      'page',
    );
  }
}

async function openPanel(page, sectionId, containerId, text) {
  await navigate(page, sectionId);
  const summary = page.locator(`#${containerId} summary`).filter({ hasText: text });
  if (!(await summary.evaluate((element) => element.parentElement.open))) {
    await summary.click();
  }
  await summary.waitFor({ state: 'visible' });
}

export const openSettings = (page, text) => openPanel(page, 'settings', 'settings', text);
export const openGoals = (page, text = 'Actividades, objetivos y organización') =>
  openPanel(page, 'goals', 'goals-management', text);
export const openCalendar = (page, text = 'Compromisos, disponibilidad y recurrencias') =>
  openPanel(page, 'week', 'calendar-management', text);
export const openDiagnostics = (
  page,
  text = 'Consultar una operación tras perder conexión',
) => openPanel(page, 'diagnostics', 'diagnostics', text);
