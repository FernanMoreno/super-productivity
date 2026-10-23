import { escape, option, input } from './forms.mjs';
import { tr } from './i18n.mjs';
import { weekDays } from './schedule.mjs';

const columns = [
  ['inbox', 'Entrada'],
  ['ready', 'Preparada'],
  ['in_progress', 'En curso'],
  ['blocked', 'Bloqueada'],
  ['done', 'Hecha'],
];
const priorities = [
  ['low', 'Baja'],
  ['normal', 'Normal'],
  ['high', 'Alta'],
  ['urgent', 'Urgente'],
];
const label = (text) => escape(tr(text));
const action = (name, title, id = '') =>
  `<button type="button" data-wf="${name}" data-id="${escape(id)}">${label(title)}</button>`;
const options = (values, selected) =>
  values.map(([id, title]) => option(id, tr(title), id === selected)).join('');
const lines = (value) =>
  String(value || '')
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
const safeLink = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      ? `<a href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>`
      : escape(url);
  } catch {
    return escape(url);
  }
};
const json = (value) => escape(JSON.stringify(value, null, 2));
const manuallyClosable = (entry) =>
  ['pending', 'uncertain', 'not_found', 'not-found'].includes(entry?.receiptStatus);

// The host owns all task rules, revisions, receipts and native/provider effects.
export function createWorkflow({ adapter, current, refresh, reportError }) {
  const $ = (id) => document.getElementById(id);
  let mode = 'board',
    includeSubtasks = false,
    projectId = '',
    state = null,
    board = null,
    integration = null;
  let renderedState = null,
    renderedBoard = null,
    renderedIntegration = null,
    renderedProjectId = null;
  let busy = false,
    editor = null,
    dirty = false,
    selectedTasks = null;
  let ui = { pending: [] },
    raw = null,
    storageReady = false,
    loadSequence = 0;
  const root = $('workflow');
  if (!root) throw Error('Workflow container missing');
  if (!$('workflow-editor'))
    root.insertAdjacentHTML('beforeend', '<div id="workflow-editor"></div>');
  const editorPanel = $('workflow-editor');
  const layout = document.createElement('div');
  layout.className = 'workflow-layout';
  $('workflow-content').before(layout);
  layout.append($('workflow-content'), editorPanel);
  editorPanel.hidden = true;
  editorPanel.setAttribute('role', 'region');
  editorPanel.setAttribute('aria-label', tr('Detalles de la tarea'));
  editorPanel.tabIndex = -1;
  let returnFocus = null;
  function setDirty(value) {
    if (dirty === value) return;
    dirty = value;
    document.dispatchEvent(
      new CustomEvent('planner:dirty-state', { detail: { source: 'workflow', dirty } }),
    );
  }
  const attention = () =>
    document.dispatchEvent(
      new CustomEvent('planner-workflow-attention', {
        detail: { pending: ui.pending.length },
      }),
    );
  function hideEditor(discard = false) {
    editorPanel.hidden = true;
    layout.classList.remove('has-editor');
    if (discard || !dirty) {
      editor = null;
      setDirty(false);
      editorPanel.innerHTML = '';
    }
    if (returnFocus?.isConnected) returnFocus.focus();
    renderControls();
  }
  function showEditor() {
    editorPanel.hidden = false;
    layout.classList.add('has-editor');
    editorPanel.querySelector('[data-wf="close-editor"]')?.focus();
    editorPanel.scrollIntoView({ block: 'nearest' });
    renderControls();
  }
  const report = (error) => {
    $('workflow-notice').textContent = error?.message || String(error);
    reportError(error?.message || String(error));
  };
  async function run(work) {
    if (busy) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await work();
    } catch (error) {
      report(error);
    } finally {
      busy = false;
      root.setAttribute('aria-busy', 'false');
    }
  }
  async function persist() {
    if (!storageReady)
      throw Error(tr('No se pudo guardar el aviso; no se envió la operación.'));
    raw = await adapter.saveWorkflowUiState(raw, ui);
    renderPending();
  }
  function renderPending() {
    $('workflow-pending').innerHTML =
      ui.pending
        .map(
          (entry) =>
            `<article><p>${label('Operación pendiente de confirmar. Consulta su recibo.')} <code>${escape(entry.operationId)}</code> · ${escape(entry.command?.type || '')}</p>${action('receipt', 'Consultar recibo sin repetir cambios', entry.operationId)}${entry.phase === 'not-dispatched' ? action('discard', 'Descartar intento no enviado', entry.operationId) : ''}${manuallyClosable(entry) ? `<form data-wf-form="acknowledge" data-id="${escape(entry.operationId)}"><p>${label('Solo se cierra este aviso del panel. El recibo de la aplicación sigue sin confirmar y la operación no se repetirá.')}</p><label><input type="checkbox" name="confirm" required>${label('He revisado manualmente el resultado en la aplicación.')}</label><button>${label('Ya revisé el resultado; cerrar aviso sin repetir')}</button></form>` : ''}<details><summary>${label('Solicitud enviada')}</summary><pre>${json(entry.args)}</pre></details></article>`,
        )
        .join('') +
      `<details><summary>${label('Recibo del flujo de tareas')}</summary><form data-wf-form="receipt">${input(tr('Identificador de operación'), 'operationId', 'text', '', 'required pattern="[A-Za-z0-9_-]{8,80}" maxlength="80"')}<button>${label('Consultar recibo sin repetir cambios')}</button></form></details>` +
      (ui.closedNotices || [])
        .map(
          (entry) =>
            `<details><summary>${label('Aviso cerrado manualmente; resultado sin confirmar')} · ${escape(entry.operationId)}</summary><pre>${json(entry)}</pre>${action('receipt', 'Consultar recibo sin repetir cambios', entry.operationId)}</details>`,
        )
        .join('');
    attention();
  }
  async function receipt(operationId) {
    const result = await adapter.operation('workflow_query', {
      view: 'receipt',
      operationId,
    });
    $('workflow-notice').textContent = JSON.stringify(result);
    if (['applied', 'rejected', 'conflict', 'stale', 'failed'].includes(result?.status)) {
      const previous = ui.pending;
      ui.pending = previous.filter((p) => p.operationId !== operationId);
      try {
        await persist();
      } catch (error) {
        ui.pending = previous;
        renderPending();
        throw error;
      }
      await load();
    } else {
      const entry = ui.pending.find((pending) => pending.operationId === operationId);
      if (entry && manuallyClosable({ receiptStatus: result?.status })) {
        entry.receiptStatus = result.status;
        entry.receiptQueriedAt = Date.now();
        await persist();
      }
    }
  }
  async function acknowledge(operationId) {
    const entry = ui.pending.find((pending) => pending.operationId === operationId);
    if (!manuallyClosable(entry))
      throw Error(tr('Operación pendiente de confirmar. Consulta su recibo.'));
    const previous = structuredClone(ui);
    ui.pending = ui.pending.filter((pending) => pending.operationId !== operationId);
    ui.closedNotices = [
      ...(ui.closedNotices || []),
      { ...entry, closedAt: Date.now(), acknowledgement: 'manually-checked' },
    ];
    try {
      await persist();
    } catch (error) {
      ui = previous;
      renderPending();
      throw error;
    }
    await load();
    $('workflow-notice').textContent = tr(
      'Solo se cierra este aviso del panel. El recibo de la aplicación sigue sin confirmar y la operación no se repetirá.',
    );
  }
  async function command(type, payload, basis = renderedState) {
    if (ui.pending.length)
      throw Error(tr('Operación pendiente de confirmar. Consulta su recibo.'));
    if (!basis?.revision || !basis?.nativeRevision)
      throw Error(tr('Actualiza el tablero antes de guardar.'));
    const operationId = crypto.randomUUID();
    const args = {
      operationId,
      baseRevision: basis.revision,
      nativeRevision: basis.nativeRevision,
      command: { type, payload },
    };
    const entry = { operationId, command: args.command, args, phase: 'pending' };
    ui.pending.push(entry);
    try {
      await persist();
    } catch (error) {
      entry.phase = 'not-dispatched';
      renderPending();
      throw error;
    }
    let result;
    try {
      result = await adapter.operation('workflow_command', args);
    } catch {
      throw Error(
        `${tr('Operación pendiente de confirmar. Consulta su recibo.')} ${operationId}`,
      );
    }
    if (
      !['applied', 'rejected', 'conflict', 'stale', 'denied', 'invalid'].includes(
        result?.status,
      )
    )
      throw Error(
        `${tr('Operación pendiente de confirmar. Consulta su recibo.')} ${operationId}`,
      );
    const previous = ui.pending;
    ui.pending = previous.filter((p) => p.operationId !== operationId);
    try {
      await persist();
    } catch (error) {
      ui.pending = previous;
      renderPending();
      throw error;
    }
    if (result.status !== 'applied')
      throw Error(
        `${result.code || result.status}: ${result.message || tr('Actualiza el tablero antes de guardar.')}`,
      );
    editor = null;
    setDirty(false);
    $('workflow-editor').innerHTML = '';
    hideEditor(true);
    await load();
    if (returnFocus?.dataset?.id) {
      const replacement = [...root.querySelectorAll('[data-wf="edit"]')].find(
        (button) => button.dataset.id === returnFocus.dataset.id,
      );
      replacement?.focus();
    }
    await refresh();
    $('workflow-notice').textContent = tr('Configuración guardada.');
    return result;
  }
  function boardColumns() {
    return (
      state?.columns ||
      columns.map(([id, title]) => ({ id, title: tr(title), status: id }))
    ).map((c) => ({
      ...c,
      title:
        c.title === c.id
          ? tr(columns.find(([id]) => id === c.id)?.[1] || c.title)
          : c.title,
    }));
  }
  function renderControls() {
    const projects = current().data?.projects || [];
    const project = projects.find((p) => p.id === projectId);
    const titles = {
      board: 'Tablero',
      templates: 'Plantillas',
      week: 'Planificar semana',
      review: 'Revisión del trabajo',
      integrations: 'Integraciones',
    };
    $('workflow-controls').innerHTML =
      `<div class="workflow-context"><h2>${project ? escape(project.title) + ' · ' : ''}${label(titles[mode])}</h2></div><div class="workflow-toolbar"><label>${label('Proyecto')}<select data-wf-filter="project">${option('', tr('Todos los proyectos'), !projectId)}${projects.map((p) => option(p.id, p.title, p.id === projectId)).join('')}</select></label>${mode === 'board' && projectId ? `<label class="workflow-check"><input type="checkbox" data-wf-filter="subtasks" ${includeSubtasks ? 'checked' : ''}>${label('Mostrar subtareas')}</label>` : ''}<details class="workflow-options"><summary>${label('Opciones')}</summary>${action('refresh', 'Actualizar datos')}${mode === 'board' && projectId ? action('mode', 'Plantillas', 'templates') : ''}</details>${dirty && editorPanel.hidden ? `${editor ? action('resume-editor', 'Continuar edición') : ''}${action('discard-editor', 'Descartar cambios sin guardar')}` : ''}</div>`;
  }
  function card(task) {
    const id = task.taskId;
    const project = (current().data?.projects || []).find((p) => p.id === task.projectId);
    return `<article class="workflow-card" draggable="true" data-wf-card="${escape(id)}"><span class="workflow-project">${escape(project?.title || tr('Sin proyecto'))}</span><h4><button type="button" class="workflow-card-title" data-wf="edit" data-id="${escape(id)}" aria-label="${label('Editar tarea')}: ${escape(task.title)}">${escape(task.title)}</button></h4><div class="workflow-card-meta"><span>${task.timeEstimate == null || task.timeEstimate <= 0 ? label('Sin estimación') : `${escape(Math.round(task.timeEstimate / 60000))} ${label('min')}`}</span>${task.priority && task.priority !== 'normal' ? `<span>${escape(tr(priorities.find((p) => p[0] === task.priority)?.[1] || 'Normal'))}</span>` : ''}${(task.criteria || []).length ? `<span>${label('Criterios')}: ${task.criteria.filter((c) => c.isDone).length}/${task.criteria.length}</span>` : ''}</div>${(task.blockers || []).length ? `<p class="workflow-blocked">${label('Bloqueos')}: ${escape(task.blockReason || (task.blockers || []).map((b) => b.message || b.taskId || tr('Bloqueo manual')).join(', '))}</p>` : ''}${task.reviewOn ? `<p class="workflow-card-meta">${label('Revisar el')}: ${escape(task.reviewOn)}</p>` : ''}<details class="workflow-card-actions"><summary>${label('Mover tarea')}</summary><label>${label('Mover a')}<select name="column">${boardColumns()
      .map((c) => option(c.id, c.title, c.id === (task.columnId || task.column)))
      .join('')}</select></label>${action('move', 'Mover', id)}</details></article>`;
  }
  function renderBoard() {
    if (!projectId)
      return `<p>${label('Selecciona un proyecto para abrir su tablero.')}</p><div class="workflow-projects">${(
        current().data?.projects || []
      )
        .map((project) => {
          const cards = (state.cards || []).filter((c) => c.projectId === project.id);
          return `<article><h3>${escape(project.title)}</h3><p>${cards.filter((c) => !c.isDone).length} ${label('Tareas pendientes')} · ${cards.filter((c) => c.column === 'blocked').length} ${label('Bloqueos')}</p>${action('open-project', 'Abrir tablero', project.id)}</article>`;
        })
        .join('')}</div>`;
    const stages = boardColumns();
    const configured = stages.filter((c) => !c.fallback);
    return `<details class="workflow-wip"><summary>${label('En curso')}: ${escape(state.wip?.count ?? 0)} / ${escape(state.wip?.limit || 2)} · ${label('Límite de trabajo en curso')}</summary><form data-wf-form="wip">${input(tr('Límite de trabajo en curso'), 'wipLimit', 'number', state.wip?.limit || 2, 'required min="1" max="20"')}<button>${label('Guardar límite')}</button></form></details>${state.wip?.overLimit ? `<p class="workflow-blocked">${label('Se ha superado el límite de trabajo en curso.')}</p>` : ''}<div class="workflow-board-scroll" role="region" aria-label="${label('Tablero de tareas')}" tabindex="0"><div class="workflow-board" style="--workflow-columns:${stages.length}">${stages
      .map((c, index) => {
        const cards =
          c.cards || (state.cards || []).filter((t) => (t.columnId || t.column) === c.id);
        return `<section data-wf-column="${escape(c.id)}" aria-label="${escape(c.title)}"><h3>${escape(c.title)} <span class="workflow-count">${cards.length}</span></h3><details class="workflow-column-menu"><summary>${label('Opciones de columna')}</summary>${c.fallback ? label('Estado de tareas existentes') : `${action('edit-column', 'Editar columna', c.id)}${configured.indexOf(c) > 0 ? action('column-left', 'Mover a la izquierda', c.id) : ''}${configured.indexOf(c) < configured.length - 1 ? action('column-right', 'Mover a la derecha', c.id) : ''}${action('remove-column', 'Retirar columna', c.id)}`}</details>${cards.map(card).join('') || `<p>${label('Sin tareas')}</p>`}</section>`;
      })
      .join(
        '',
      )}<div class="workflow-add-column">${action('new-column', 'Añadir columna')}</div></div></div>`;
  }
  function columnEditor(id, removing = false) {
    if (!projectId) return;
    if (dirty)
      throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
    const column = boardColumns().find((c) => c.id === id);
    const occupied =
      column?.taskCount ??
      (
        column?.cards ||
        (state.cards || []).filter((c) => (c.columnId || c.column) === id)
      ).length;
    const destinations = boardColumns().filter(
      (c) => c.id !== id && c.status === column?.status,
    );
    returnFocus = document.activeElement;
    editor = {
      kind: 'column',
      id: id || crypto.randomUUID(),
      basis: renderedState,
      column,
    };
    $('workflow-editor').innerHTML =
      `<article><div class="workflow-editor-heading"><h3>${label(removing ? 'Retirar columna' : 'Editar columna')}</h3>${action('close-editor', 'Cerrar editor')}</div>${action('discard-editor', 'Descartar cambios sin guardar')}${removing ? `<form data-wf-form="remove-column"><p>${label('Las tareas se conservan. El destino debe tener el mismo estado de trabajo.')}</p>${occupied ? `<label>${label('Mover a')}<select name="targetColumnId" required>${option('', tr('Selecciona una columna'))}${destinations.map((c) => option(c.id, c.title)).join('')}</select></label>${!destinations.length ? `<p>${label('Añade antes otra columna con el mismo estado de trabajo.')}</p>` : ''}` : ''}<button ${occupied && !destinations.length ? 'disabled' : ''}>${label('Retirar columna')}</button></form>` : `<form data-wf-form="column">${input(tr('Nombre'), 'title', 'text', column?.title || '', 'required maxlength="100"')}<label>${label('Estado de trabajo')}<select name="status">${options(columns, column?.status || 'ready')}</select></label><p>${label('El nombre no cambia el estado de la tarea. Elige el estado de trabajo explícitamente.')}</p><button>${label('Guardar columna')}</button></form>`}</article>`;
    showEditor();
  }
  function renderTemplates() {
    return `<p>${label('Revisa los pasos y estimaciones antes de crear tareas nativas.')}</p>${action('new-template', 'Nueva plantilla')} ${(state.templates || []).map((template) => `<article class="workflow-template"><details><summary>${escape(template.title)}</summary><ul>${template.steps.map((s) => `<li>${escape(s.title)} · ${escape(Math.round(s.timeEstimate / 60000))} ${label('min')}</li>`).join('')}</ul><ul>${(template.criteria || []).map((c) => `<li>${escape(c.text)}</li>`).join('')}</ul>${action('edit-template', 'Editar', template.id)}${action('remove-template', 'Eliminar plantilla', template.id)}<form data-wf-form="apply-template" data-id="${escape(template.id)}">${input(tr('Nombre'), 'title', 'text', template.title, 'required maxlength="500"')}<label>${label('Proyecto')}<select name="projectId" required>${option('', tr('Selecciona un proyecto'))}${(current().data?.projects || []).map((p) => option(p.id, p.title, p.id === projectId)).join('')}</select></label><label><input type="checkbox" name="confirm" required>${label('Confirmo la creación de la tarea y sus subtareas.')}</label><button>${label('Crear tarea desde plantilla')}</button></form></details></article>`).join('')}`;
  }
  function renderWeek() {
    const proposal = state.proposal || {};
    const cards = board?.cards || state.cards || [];
    const parents = new Set(cards.map((card) => card.parentId).filter(Boolean));
    const names = new Map(
      (board?.cards || state.cards || []).map((c) => [c.taskId, c.title]),
    );
    return `<form data-wf-form="prepare-week"><p>${label('Selecciona tareas del backlog para proponer la semana.')}</p>${(
      board?.cards ||
      state.cards ||
      []
    )
      .filter((c) => !c.isDone && !parents.has(c.taskId))
      .map(
        (c) =>
          `<label><input name="taskIds" type="checkbox" value="${escape(c.taskId)}" ${selectedTasks?.includes(c.taskId) ? 'checked' : ''}>${escape(c.title)}</label>`,
      )
      .join(
        '',
      )}<button>${label('Proponer semana')}</button></form><div class="table-scroll"><table><caption>${label('Capacidad semanal')}</caption><thead><tr><th>${label('Fecha')}</th><th>${label('Trabajo: capacidad / previsto / restante')}</th><th>${label('Personal: capacidad / previsto / restante')}</th></tr></thead><tbody>${(state.days || []).map((d) => `<tr><td>${escape(d.date)} ${d.partial ? label('Disponibilidad parcial') : ''}</td>${['work', 'personal'].map((k) => `<td>${escape(d[k]?.capacityMinutes ?? '?')} / ${escape(d[k]?.plannedMinutes ?? '?')} / ${escape(d[k]?.remainingMinutes ?? '?')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><ul>${(proposal.excluded || []).map((e) => `<li>${escape(names.get(e.taskId) || e.taskId)}: ${escape(e.code)}</li>`).join('')}</ul><form data-wf-form="apply-week"><p>${label('Selecciona únicamente los cambios de fecha que quieras aplicar.')}</p>${(proposal.assignments || []).map((a, i) => `<label><input name="assignments" type="checkbox" value="${i}">${escape(names.get(a.taskId) || a.taskId)} · ${escape(a.date)}</label>`).join('')}${proposal.partial ? `<label><input type="checkbox" name="allowPartial" required>${label('Acepto la disponibilidad parcial indicada.')}</label>` : ''}<label><input type="checkbox" name="confirm" required>${label('Confirmo los cambios de fecha seleccionados.')}</label><button ${(proposal.assignments || []).length ? '' : 'disabled'}>${label('Aplicar fechas seleccionadas')}</button></form>`;
  }
  function renderReview() {
    const cards = new Map((state.cards || []).map((c) => [c.taskId, c]));
    return `<p>${label('Revisa bloqueos, fechas, estimaciones y criterios pendientes.')}</p>${
      (state.issues || [])
        .map((issue) => {
          const task = cards.get(issue.taskId);
          return `<article><h3>${escape(task?.title || issue.taskId)}</h3><p>${escape(issue.message || issue.code)}</p>${task?.reviewedOn ? `<p>${label('Revisado')}: ${escape(task.reviewedOn)}</p>` : ''}${action('edit', 'Editar tarea', issue.taskId)}${action('unblock', 'Desbloquear', issue.taskId)}${action('reviewed', 'Marcar revisado', issue.taskId)}<a href="#review">${label('Dividir o reprogramar en la revisión guiada')}</a></article>`;
        })
        .join('') || `<p>${label('Sin asuntos pendientes')}</p>`
    }`;
  }
  function trelloDestinations(link) {
    if (
      !link?.moveSupported ||
      link.linked === false ||
      link.status === 'closed' ||
      link.archived ||
      link.closed
    )
      return [];
    return (link.lists || []).filter(
      (list) => list.supported !== false && list.id !== link.listId,
    );
  }
  function renderTrelloMovement(link) {
    if (link.provider !== 'trello' || !link.boardId || !link.listId) return '';
    const destinations = trelloDestinations(link);
    const currentList = (link.lists || []).find((list) => list.id === link.listId);
    return `<form data-wf-form="integration-move"><fieldset ${destinations.length ? '' : 'disabled'}><legend>${label('Mover tarjeta entre listas de Trello')}</legend><p>${label('Lista actual de Trello')}: ${escape(currentList?.name || link.listId)}</p><label>${label('Lista de destino de Trello')}<select name="targetListId" required>${option('', tr('Selecciona una lista de destino'))}${destinations.map((list) => option(list.id, list.name || list.id)).join('')}</select></label><label><input type="checkbox" name="confirm" required>${label('Confirmo mover la tarjeta en Trello.')}</label><button>${label('Mover tarjeta en Trello')}</button></fieldset>${destinations.length ? '' : `<p>${label('El movimiento entre listas de Trello no está disponible para esta tarjeta.')}</p>`}</form>`;
  }
  function renderIntegrations() {
    const providers = state.providers || [];
    return `<p>${label('Solo se muestran proveedores nativos configurados. Las listas de Trello son independientes de las columnas del flujo de trabajo.')}</p>${!providers.length ? `<p>${label('No hay proveedores configurados. Conecta Jira o Trello en la aplicación.')}</p>` : ''}<form data-wf-form="integration-link"><label>${label('Tarea')}<select name="taskId" required>${(board?.cards || []).map((c) => option(c.taskId, c.title)).join('')}</select></label><label>${label('Proveedor')}<select name="providerId" required>${providers.map((p) => option(p.id || p.providerId, p.title || p.name || p.type || p.id)).join('')}</select></label>${input(tr('Identificador externo'), 'issueId', 'text', '', 'required maxlength="500"')}<button ${providers.length ? '' : 'disabled'}>${label('Vincular tarea existente')}</button></form><label>${label('Tarea vinculada')}<select data-wf-filter="integration-task">${option('', tr('Selecciona una tarea'))}${(board?.cards || []).map((c) => option(c.taskId, c.title, c.taskId === integration?.taskId)).join('')}</select></label>${
      integration
        ? `<article>${integration.url ? safeLink(integration.url) : ''}<dl>${[
            ['Tarea', integration.title || integration.taskId],
            [
              'Proveedor',
              integration.providerName || integration.providerId || integration.provider,
            ],
            ['Estado externo', integration.status],
          ]
            .filter(([, value]) => value)
            .map(([title, value]) => `<dt>${label(title)}</dt><dd>${escape(value)}</dd>`)
            .join(
              '',
            )}</dl><details><summary>${label('Diagnóstico avanzado')}</summary><pre>${json(integration)}</pre></details>${action('integration-refresh', 'Actualizar estado externo', integration.taskId)}${action('integration-unlink', 'Desvincular', integration.taskId)}<form data-wf-form="integration-sync" data-id="${escape(integration.taskId)}"><label>${label('Estado externo')}<select name="targetStatus" required>${(
            integration.statuses || []
          )
            .filter((t) => t.supported !== false)
            .map((t) => option(t.id, t.name || t.id))
            .join(
              '',
            )}</select></label><label><input type="checkbox" name="confirm" required>${label('Confirmo el cambio en el proveedor externo.')}</label><button>${label('Sincronizar estado externo')}</button></form>${renderTrelloMovement(integration)}</article>`
        : ''
    }`;
  }
  function render() {
    renderControls();
    if (!state) return;
    // A hook may replace the read model, never the user's form or its revision.
    if (dirty) {
      $('workflow-notice').textContent = tr(
        'Hay cambios sin guardar. El formulario conserva su revisión original.',
      );
      return;
    }
    renderPending();
    // Native hooks and window focus refresh the board while its controls are in
    // use. Preserve the user's open move menu and destination in this project.
    const moveMenus =
      mode === 'board' && renderedProjectId === projectId
        ? [...root.querySelectorAll('[data-wf-card]')].map((node) => ({
            id: node.dataset.wfCard,
            open: node.querySelector('.workflow-card-actions')?.open,
            destination: node.querySelector('[name="column"]')?.value,
          }))
        : [];
    renderedState = state;
    renderedBoard = board;
    renderedIntegration = integration;
    renderedProjectId = projectId;
    $('workflow-content').innerHTML =
      mode === 'board'
        ? renderBoard()
        : mode === 'templates'
          ? renderTemplates()
          : mode === 'week'
            ? renderWeek()
            : mode === 'review'
              ? renderReview()
              : renderIntegrations();
    for (const node of root.querySelectorAll('[data-wf-card]')) {
      const previous = moveMenus.find((menu) => menu.id === node.dataset.wfCard);
      if (!previous) continue;
      const menu = node.querySelector('.workflow-card-actions');
      if (menu) menu.open = !!previous.open;
      const select = node.querySelector('[name="column"]');
      if (
        select &&
        [...select.options].some((option) => option.value === previous.destination)
      )
        select.value = previous.destination;
    }
  }
  async function load() {
    const sequence = ++loadSequence;
    const week = weekDays(current().date, current().profile.weekStartsOn ?? 1);
    const args = {
      view: mode,
      ...(mode === 'board' && includeSubtasks ? { includeSubtasks: true } : {}),
      ...(mode === 'integrations' && integration?.taskId
        ? { taskId: integration.taskId }
        : {}),
      ...(projectId ? { projectId } : {}),
      date: current().date,
      ...(mode === 'week'
        ? {
            from: week[0],
            to: week[6],
            includeSubtasks: true,
            ...(selectedTasks ? { taskIds: selectedTasks } : {}),
          }
        : {}),
    };
    const result = await adapter.operation('workflow_query', args);
    if (sequence !== loadSequence) return;
    // Linked integrations use status for the provider's remote state.
    if (
      result?.status &&
      result.status !== 'applied' &&
      !(mode === 'integrations' && result.linked === true)
    )
      throw Error(result.message || result.code || result.status);
    state = result;
    if (mode === 'integrations' && integration?.taskId)
      integration = { ...result, taskId: integration.taskId };
    if (mode === 'board') board = result;
    else if (mode === 'week' || mode === 'integrations')
      board = await adapter.operation('workflow_query', {
        view: 'board',
        ...(mode === 'week' || (mode === 'integrations' && integration?.taskId)
          ? { includeSubtasks: true }
          : {}),
        ...(projectId ? { projectId } : {}),
      });
    render();
  }
  function move(taskId, columnId) {
    if (dirty && editor)
      throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
    const destination = boardColumns().find((c) => c.id === columnId);
    if (!destination || !projectId)
      throw Error(tr('Selecciona un proyecto para abrir su tablero.'));
    const column = destination.status;
    const task = (renderedState?.cards || []).find((c) => c.taskId === taskId);
    if (column === 'blocked' && !task?.blockReason) {
      openEditor(taskId);
      editor.destinationColumnId = columnId;
      $('workflow-editor').querySelector('[name="reason"]').focus();
      return;
    }
    return command('task.move', { taskId, column, columnId });
  }
  function openEditor(id) {
    if (dirty && editor?.kind === 'task' && editor.id === id) {
      returnFocus = document.activeElement;
      showEditor();
      return;
    }
    if (dirty)
      throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
    const task = (renderedState.cards || renderedBoard?.cards || []).find(
      (c) => c.taskId === id,
    );
    if (!task) throw Error(tr('Tarea no encontrada. Actualiza los datos.'));
    returnFocus = document.activeElement;
    editor = { kind: 'task', id, basis: renderedState, task };
    setDirty(false);
    $('workflow-editor').innerHTML =
      `<article><div class="workflow-editor-heading"><h3>${escape(task.title)}</h3>${action('close-editor', 'Cerrar editor')}</div>${action('open-native', 'Detalles nativos', id)}${action('discard-editor', 'Descartar cambios sin guardar')}${action('task-integrations', 'Vínculos e integraciones', id)}${(task.links || []).map((link) => `<p>${safeLink(link.url)}</p>`).join('')}<form data-wf-form="dependencies"><fieldset><legend>${label('Requisitos previos')}</legend>${[
        ...(renderedBoard?.cards || renderedState.cards || []),
        ...(task.dependsOn || [])
          .filter(
            (dep) =>
              !(renderedBoard?.cards || renderedState.cards || []).some(
                (c) => c.taskId === dep,
              ),
          )
          .map((taskId) => ({ taskId, title: taskId })),
      ]
        .filter((c) => c.taskId !== id)
        .map(
          (c) =>
            `<label><input type="checkbox" name="dependsOn" value="${escape(c.taskId)}" ${(task.dependsOn || []).includes(c.taskId) ? 'checked' : ''}>${escape(c.title)}</label>`,
        )
        .join(
          '',
        )}<button>${label('Guardar requisitos')}</button></fieldset></form><form data-wf-form="block"><label>${label('Motivo del bloqueo')}<textarea name="reason" required maxlength="2000">${escape(task.blockReason || '')}</textarea></label>${input(tr('Revisar el'), 'reviewOn', 'date', task.reviewOn || '')}<button>${label('Bloquear tarea')}</button></form>${action('unblock', 'Desbloquear', id)}<form data-wf-form="criteria"><fieldset><legend>${label('Criterios de finalización')}</legend>${(task.criteria || []).map((c) => `<label><input name="done" value="${escape(c.id)}" type="checkbox" ${c.isDone ? 'checked' : ''}>${escape(c.text)}</label><label>${label('Texto del criterio')}<input name="text-${escape(c.id)}" value="${escape(c.text)}" required maxlength="500"></label><label><input type="checkbox" name="removeCriterion" value="${escape(c.id)}">${label('Eliminar criterio')}</label>`).join('')}<label>${label('Nuevos criterios, uno por línea')}<textarea name="newCriteria" rows="3"></textarea></label><button>${label('Guardar criterios')}</button></fieldset></form><form data-wf-form="priority"><label>${label('Prioridad')}<select name="priority">${options(priorities, task.priority || 'normal')}</select></label><button>${label('Guardar prioridad')}</button></form></article>`;
    showEditor();
  }
  function templateEditor(id) {
    if (dirty && editor?.kind === 'template' && (!id || editor.id === id)) {
      returnFocus = document.activeElement;
      showEditor();
      return;
    }
    if (dirty)
      throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
    returnFocus = document.activeElement;
    const template = (renderedState.templates || []).find((t) => t.id === id);
    editor = {
      kind: 'template',
      id: template?.id || crypto.randomUUID(),
      basis: renderedState,
    };
    setDirty(false);
    $('workflow-editor').innerHTML =
      `<article><div class="workflow-editor-heading"><h3>${label('Plantillas')}</h3>${action('close-editor', 'Cerrar editor')}</div>${action('discard-editor', 'Descartar cambios sin guardar')}<form data-wf-form="template">${input(tr('Nombre'), 'title', 'text', template?.title || '', 'required maxlength="500"')}<label>${label('Pasos: título | minutos, uno por línea')}<textarea name="steps" required rows="5">${escape((template?.steps || []).map((s) => `${s.title} | ${s.timeEstimate / 60000}`).join('\n'))}</textarea></label><label>${label('Criterios, uno por línea')}<textarea name="criteria" rows="3">${escape((template?.criteria || []).map((c) => c.text).join('\n'))}</textarea></label><button>${label('Guardar plantilla')}</button></form></article>`;
    showEditor();
  }
  document.querySelectorAll('[data-workflow-view]').forEach((link) =>
    link.addEventListener('click', () =>
      run(async () => {
        if (dirty)
          throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
        mode = link.dataset.workflowView;
        hideEditor();
        await load();
      }),
    ),
  );
  root.addEventListener('input', (event) => {
    if (event.target.closest('form')) {
      setDirty(true);
      if (!editor) renderControls();
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !editorPanel.hidden) {
      event.preventDefault();
      hideEditor();
    }
  });
  root.addEventListener('change', (event) => {
    const filter = event.target.dataset.wfFilter;
    if (!filter) return;
    run(async () => {
      if (filter === 'project') {
        if (dirty) {
          renderControls();
          throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
        }
        hideEditor();
        const nextProjectId = event.target.value;
        renderControls();
        await requestContext({ mode, projectId: nextProjectId });
      } else if (filter === 'subtasks') {
        includeSubtasks = event.target.checked;
        await load();
      } else {
        integration = await adapter.operation('workflow_query', {
          view: 'integrations',
          taskId: event.target.value,
        });
        integration = { ...integration, taskId: event.target.value };
        setDirty(false);
        render();
      }
    });
  });
  root.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-wf-card]');
    if (card) event.dataTransfer.setData('text/plain', card.dataset.wfCard);
  });
  root.addEventListener('dragover', (event) => {
    if (event.target.closest('[data-wf-column]')) event.preventDefault();
  });
  root.addEventListener('drop', (event) => {
    const target = event.target.closest('[data-wf-column]');
    if (!target) return;
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if ((state?.cards || []).some((c) => c.taskId === taskId))
      run(() => move(taskId, target.dataset.wfColumn));
  });
  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-wf]');
    if (!target) return;
    run(async () => {
      const name = target.dataset.wf,
        id = target.dataset.id;
      if (name === 'mode') {
        if (dirty)
          throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
        await requestContext({ mode: id, projectId });
      } else if (name === 'open-project') {
        await requestContext({ mode: 'board', projectId: id });
      } else if (
        name === 'new-column' ||
        name === 'edit-column' ||
        name === 'remove-column'
      ) {
        columnEditor(id, name === 'remove-column');
      } else if (name === 'column-left' || name === 'column-right') {
        if (dirty)
          throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
        const ids = boardColumns()
            .filter((c) => !c.fallback)
            .map((c) => c.id),
          index = ids.indexOf(id),
          next = index + (name === 'column-left' ? -1 : 1);
        [ids[index], ids[next]] = [ids[next], ids[index]];
        await command('board.column.reorder', { projectId, columnIds: ids });
      } else if (name === 'refresh') await load();
      else if (name === 'move')
        await move(
          id,
          target.closest('[data-wf-card]').querySelector('[name="column"]').value,
        );
      else if (name === 'edit') openEditor(id);
      else if (name === 'open-native') await adapter.selectTask(id);
      else if (name === 'task-integrations')
        await requestContext({ mode: 'integrations', projectId, taskId: id });
      else if (name === 'close-editor') hideEditor();
      else if (name === 'resume-editor') {
        showEditor();
      } else if (name === 'discard-editor') {
        hideEditor(true);
        render();
      } else if (name === 'unblock')
        await command('task.unblock', { taskId: id }, editor?.basis || renderedState);
      else if (name === 'reviewed')
        await command('task.review', { taskId: id, date: current().date });
      else if (name === 'new-template' || name === 'edit-template') templateEditor(id);
      else if (name === 'remove-template')
        await command('template.remove', { templateId: id });
      else if (name === 'receipt') await receipt(id);
      else if (name === 'discard') {
        ui.pending = ui.pending.filter((p) => p.operationId !== id);
        await persist();
      } else if (name === 'integration-refresh' || name === 'integration-unlink') {
        await command(
          name === 'integration-refresh' ? 'integration.refresh' : 'integration.unlink',
          { taskId: id },
        );
        integration = null;
      }
    });
  });
  root.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-wf-form]');
    if (!form) return;
    event.preventDefault();
    run(async () => {
      const values = new FormData(form),
        kind = form.dataset.wfForm,
        taskId = editor?.id;
      if (kind === 'receipt') return receipt(String(values.get('operationId')).trim());
      if (kind === 'acknowledge') {
        if (!values.get('confirm')) return;
        return acknowledge(form.dataset.id);
      }
      if (kind === 'column')
        return command(
          'board.column.save',
          {
            projectId,
            column: {
              id: editor.id,
              title: String(values.get('title')).trim(),
              status: String(values.get('status')),
            },
          },
          editor.basis,
        );
      if (kind === 'remove-column')
        return command(
          'board.column.remove',
          {
            projectId,
            columnId: editor.id,
            ...(values.get('targetColumnId')
              ? { targetColumnId: String(values.get('targetColumnId')) }
              : {}),
          },
          editor.basis,
        );
      if (kind === 'wip')
        return command('board.configure', {
          projectId,
          wipLimit: Number(values.get('wipLimit')),
        });
      if (kind === 'dependencies')
        return command(
          'task.dependencies',
          { taskId, dependsOn: values.getAll('dependsOn') },
          editor.basis,
        );
      if (kind === 'block') {
        const destinationColumnId = editor.destinationColumnId;
        const result = await command(
          'task.block',
          {
            taskId,
            reason: String(values.get('reason')).trim(),
            ...(values.get('reviewOn')
              ? { reviewOn: String(values.get('reviewOn')) }
              : {}),
          },
          editor.basis,
        );
        if (destinationColumnId)
          return command(
            'task.move',
            { taskId, column: 'blocked', columnId: destinationColumnId },
            state,
          );
        return result;
      }
      if (kind === 'criteria') {
        const done = values.getAll('done');
        return command(
          'task.criteria',
          {
            taskId,
            criteria: [
              ...(editor.task.criteria || [])
                .filter((c) => !values.getAll('removeCriterion').includes(c.id))
                .map((c) => ({
                  ...c,
                  text: String(values.get('text-' + c.id) ?? c.text).trim(),
                  isDone: done.includes(c.id),
                })),
              ...lines(values.get('newCriteria')).map((text) => ({
                id: crypto.randomUUID(),
                text,
                isDone: false,
              })),
            ],
          },
          editor.basis,
        );
      }
      if (kind === 'priority')
        return command(
          'task.priority',
          { taskId, priority: values.get('priority') },
          editor.basis,
        );
      if (kind === 'template') {
        const steps = lines(values.get('steps')).map((line) => {
          const separator = line.lastIndexOf('|'),
            title = line.slice(0, separator).trim(),
            minutes = Number(line.slice(separator + 1).trim());
          if (
            separator < 1 ||
            !title ||
            !Number.isFinite(minutes) ||
            minutes < 0 ||
            minutes > 1440
          )
            throw Error(tr('Cada paso necesita un título y minutos entre 0 y 1440.'));
          return { title, timeEstimate: Math.round(minutes * 60000) };
        });
        return command(
          'template.save',
          {
            template: {
              id: editor.id,
              title: String(values.get('title')).trim(),
              steps,
              criteria: lines(values.get('criteria')).map((text) => ({
                id: crypto.randomUUID(),
                text,
                isDone: false,
              })),
            },
          },
          editor.basis,
        );
      }
      if (kind === 'apply-template')
        return command('template.apply', {
          templateId: form.dataset.id,
          title: String(values.get('title')).trim(),
          projectId: String(values.get('projectId')),
        });
      if (kind === 'prepare-week') {
        selectedTasks = values.getAll('taskIds');
        if (!selectedTasks.length) throw Error(tr('Selecciona al menos una tarea.'));
        setDirty(false);
        return load();
      }
      if (kind === 'apply-week') {
        const assignments = values
          .getAll('assignments')
          .map((index) => renderedState.proposal.assignments[Number(index)]);
        if (!assignments.length) throw Error(tr('Selecciona al menos una tarea.'));
        return command('week.apply', {
          assignments,
          weekRevision: renderedState.weekRevision,
          ...(values.get('allowPartial') ? { allowPartial: true } : {}),
        });
      }
      if (kind === 'integration-link')
        return command('integration.link', {
          taskId: String(values.get('taskId')),
          providerId: String(values.get('providerId')),
          issueId: String(values.get('issueId')).trim(),
        });
      if (kind === 'integration-move') {
        const link = renderedIntegration;
        const targetListId = String(values.get('targetListId') || '');
        if (
          !values.get('confirm') ||
          link?.provider !== 'trello' ||
          !link.boardId ||
          !link.listId ||
          !trelloDestinations(link).some((list) => list.id === targetListId)
        )
          return;
        return command('integration.move', {
          taskId: link.taskId,
          targetListId,
          expectedListId: link.listId,
          expectedBoardId: link.boardId,
        });
      }
      if (kind === 'integration-sync')
        return command('integration.sync', {
          taskId: form.dataset.id,
          targetStatus: String(values.get('targetStatus')),
          ...(renderedIntegration?.status
            ? { expectedRemoteStatus: renderedIntegration.status }
            : {}),
        });
    });
  });
  async function requestContext(context) {
    if (!canNavigate(context))
      throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
    const section = {
      board: 'workflow',
      templates: 'templates',
      week: 'workflow-week',
      review: 'workflow-review',
      integrations: 'integrations',
    }[context.mode];
    const request = new CustomEvent('planner:workspace-request', {
      cancelable: true,
      detail: {
        section,
        projectId: context.projectId || '',
        ...(context.taskId ? { taskId: context.taskId } : {}),
      },
    });
    document.dispatchEvent(request);
    // Embedded project/section changes belong to the native route and its draft guard.
    if (
      request.defaultPrevented ||
      document.body.classList.contains('workspace-embedded')
    )
      return;
    await navigate(context);
  }
  function canNavigate(context = {}) {
    return (
      !dirty ||
      ((context.mode || 'board') === mode &&
        (context.projectId ?? projectId) === projectId &&
        (!context.taskId || context.taskId === editor?.id))
    );
  }
  async function navigate(context = {}) {
    const nextMode = context.mode || 'board';
    if (!['board', 'templates', 'week', 'review', 'integrations'].includes(nextMode))
      return;
    if (!canNavigate(context)) {
      renderControls();
      throw Error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
    }
    if (
      nextMode === mode &&
      (context.projectId ?? projectId) === projectId &&
      !context.taskId &&
      state
    )
      return;
    mode = nextMode;
    if (context.taskId && mode === 'board') includeSubtasks = true;
    if (Object.hasOwn(context, 'projectId')) projectId = context.projectId || '';
    if (!dirty) hideEditor();
    if (mode === 'integrations' && context.taskId)
      integration = { taskId: context.taskId };
    await load();
    if (context.taskId && mode !== 'integrations') openEditor(context.taskId);
  }
  document.addEventListener('planner:workflow-context', (event) =>
    run(() => navigate(event.detail)),
  );
  return {
    refresh: load,
    navigate,
    canNavigate,
    discardDraft() {
      hideEditor(true);
      render();
    },
    render,
    async initialize() {
      try {
        const saved = await adapter.loadWorkflowUiState();
        ui = saved.value;
        raw = saved.raw;
        storageReady = true;
      } catch (error) {
        $('workflow-notice').textContent = error.message;
      }
      renderControls();
      renderPending();
      try {
        await load();
      } catch (error) {
        $('workflow-notice').textContent = error.message;
      }
    },
  };
}
