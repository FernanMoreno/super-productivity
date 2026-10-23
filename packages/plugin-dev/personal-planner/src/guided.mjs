import { escape, input, option, button, list, proposalReviewHTML } from './forms.mjs';
import { html as view, tr, displayClock, wallClock, locale } from './i18n.mjs';
import { weekDays } from './schedule.mjs';
import {
  confirmed,
  pendingOperation,
  proposalChanges,
  operationError,
} from './guided-state.mjs';

export function createGuidedPlanner({ adapter, current, refresh, reportError }) {
  let ui = { pending: [] },
    raw = null,
    review = null,
    next = null,
    proposal = null,
    busy = false,
    correctingItem = null;
  let renderedLanguage = locale();
  const $ = (id) => document.getElementById(id);
  const clock = (v) =>
    displayClock(
      v,
      current().profile.timezone,
      current().profile.preferences?.hourFormat,
    );
  const mins = (ms) =>
    ms == null ? tr('Sin datos fiables') : String(Math.round(ms / 60000));
  const persist = async () => {
    raw = await adapter.saveUiState(raw, ui);
    renderPending();
  };
  function renderPending() {
    $('guided-pending').innerHTML = ui.pending.length
      ? view`<h3>Operaciones pendientes</h3>
          <p>No se repiten cambios automáticamente al abrir el panel.</p>
          ${list(
            ui.pending.map(
              (p) =>
                `${escape(p.action)} · <code>${escape(p.operationId)}</code> ${p.phase === 'not-dispatched' ? tr('No se envió a la aplicación.') + button('guided-close-unsent', p.operationId, tr('Descartar intento no enviado')) : button('guided-receipt', p.operationId, tr('Consultar recibo sin repetir cambios')) + button('guided-acknowledge', p.operationId, tr('He comprobado manualmente el resultado; cerrar este aviso'))}`,
            ),
            '',
          )}`
      : '';
    if (ui.closedNotices?.length)
      $('guided-pending').insertAdjacentHTML(
        'beforeend',
        `<details><summary>${tr('Avisos cerrados; no equivalen a confirmación de la aplicación')}</summary>${list(
          ui.closedNotices.map(
            (entry) =>
              `<code>${escape(entry.operationId)}</code> · ${escape(entry.action)} · ${escape(entry.acknowledgement)} · ${escape(new Date(entry.closedAt).toLocaleString(locale()))}`,
          ),
          '',
        )}</details>`,
      );
  }
  async function mutate(action, params) {
    if (ui.pending.length)
      throw Error(tr('Operación pendiente de confirmar. Consulta su recibo.'));
    const operationId = crypto.randomUUID(),
      record = pendingOperation(action, params, operationId);
    ui.pending.push(record);
    // A failed UI receipt write always stops BEFORE invoking the native port.
    try {
      await persist();
    } catch {
      record.phase = 'not-dispatched';
      renderPending();
      throw Error(
        `${tr('No se envió a la aplicación. Descarta el intento no enviado o recupera el almacenamiento antes de intentarlo otra vez.')} ${operationId}`,
      );
    }
    let result;
    try {
      result = await adapter.operation(action, { ...params, operationId });
    } catch {
      throw Error(
        `${tr('Operación pendiente de confirmar. Consulta su recibo.')} ${operationId}`,
      );
    }
    if (confirmed(result)) {
      const prior = ui.pending;
      ui.pending = ui.pending.filter((p) => p.operationId !== operationId);
      try {
        await persist();
      } catch {
        ui.pending = prior;
        record.phase = 'confirmed';
        record.confirmedStatus = result.status;
        renderPending();
        throw Error(
          `${tr('La aplicación confirmó el resultado, pero no se pudo cerrar el aviso. Consulta el recibo; no repitas la modificación.')} ${operationId}`,
        );
      }
    }
    if (result?.status !== 'applied')
      throw Error(`${operationError(result)} ${operationId}`);
    return result;
  }
  async function closeNotice(id, acknowledgement) {
    const local = ui.pending.find((entry) => entry.operationId === id);
    const latest = await adapter.loadUiState();
    ui = latest.value;
    raw = latest.raw;
    const entry =
      local?.phase === 'not-dispatched'
        ? local
        : ui.pending.find((value) => value.operationId === id) || local;
    if (!entry) return;
    const prior = structuredClone(ui);
    prior.pending = [
      ...prior.pending.filter((value) => value.operationId !== id),
      structuredClone(entry),
    ];
    ui.pending = ui.pending.filter((value) => value.operationId !== id);
    ui.closedNotices = [
      ...(ui.closedNotices || []).filter((value) => value.operationId !== id),
      { operationId: id, action: entry.action, closedAt: Date.now(), acknowledgement },
    ];
    try {
      await persist();
    } catch (error) {
      ui = prior;
      renderPending();
      throw error;
    }
  }
  const range = () => {
    const week = weekDays(current().date, current().profile.weekStartsOn ?? 1);
    return { from: ui.from || week[0], to: ui.to || week[6] };
  };
  function renderShell() {
    // Hidden workspace views lose focus, but their edited date range is still a draft.
    const rangeDraft = [...$('review-range').querySelectorAll('input[name]')]
      .filter((field) => field.value !== field.defaultValue)
      .map((field) => [field.name, field.value]);
    const languageChanged = renderedLanguage !== locale();
    if (languageChanged) {
      renderedLanguage = locale();
      const form = $('now-options').querySelector('form');
      const saved = form ? [...new FormData(form)] : [];
      $('now-options').textContent = '';
      if (
        review &&
        !document.activeElement?.closest(
          '[data-guided="review-decision"], [data-guided="correct-time"]',
        )
      )
        renderReview();
      if (next) renderNext();
      ui.contextDraft = saved;
    }
    const { from, to } = range();
    if (!$('review-range').contains(document.activeElement))
      $('review-range').innerHTML = view`<form data-guided="review-load">
        <div class="grid">
          ${input(tr('Inicio de semana'), 'from', 'date', from, 'required')}${input(
            tr('Fin de semana'),
            'to',
            'date',
            to,
            'required',
          )}
        </div>
        <button>Consultar revisión</button>
      </form>`;
    for (const [name, value] of rangeDraft) {
      const field = $('review-range').querySelector('form')?.elements.namedItem(name);
      if (field) field.value = value;
    }
    $('now-options').innerHTML ||= view`<form data-guided="next">
      <div class="grid">
        ${input(
          tr('Tiempo disponible (minutos)'),
          'availableMinutes',
          'number',
          current().profile.preferences?.sessionMinutes || 25,
          'min="1" max="1440" required',
        )}<label
          >Contexto de actividad<select name="contextAreaId">
            ${option('', tr('Cualquier actividad'))}${current()
              .profile.areas.map((a) => option(a.id, a.name))
              .join('')}
          </select></label
        >
      </div>
      <button>Buscar opciones</button>
    </form>`;
    if (languageChanged && ui.contextDraft) {
      for (const [name, value] of ui.contextDraft) {
        const field = $('now-options').querySelector('form')?.elements.namedItem(name);
        if (field) field.value = value;
      }
      delete ui.contextDraft;
    }
    renderPending();
  }
  function correctionRowIndex(item) {
    if (!item?.taskId) return -1;
    const eligible = (row) =>
      row.taskId === item.taskId &&
      (!item.date || row.date === item.date) &&
      !row.aggregate &&
      !row.archived &&
      row.actualMs !== null &&
      row.activityIds?.length;
    const todayIndex = review.rows.findIndex(
      (row) => eligible(row) && row.date === current().date,
    );
    return todayIndex >= 0 ? todayIndex : review.rows.findIndex(eligible);
  }
  function renderCorrectionIntent() {
    const node = $('review-correction-intent');
    if (node)
      node.innerHTML = correctingItem
        ? `<p>${tr('Corrección pendiente de revisión')}: ${escape(correctingItem.taskId)} · ${escape(correctingItem.date)} ${button('guided-cancel-correction', '', tr('Cancelar corrección de revisión'))}</p>`
        : '';
  }
  async function loadReview(from, to, reviewId = ui.reviewId) {
    if (ui.from !== from || ui.to !== to) {
      reviewId = undefined;
      correctingItem = null;
    }
    review = await adapter.operation('review', {
      from,
      to,
      ...(reviewId ? { reviewId } : {}),
    });
    if (review.status === 'rejected') throw Error(operationError(review));
    if (
      correctingItem &&
      (correctingItem.reviewId !== review.session?.id || review.session?.reviewedAt)
    )
      correctingItem = null;
    ui.from = from;
    ui.to = to;
    if (review.session) ui.reviewId = review.session.id;
    else delete ui.reviewId;
    await persist();
    renderReview();
  }
  async function reviewCommand(params) {
    await mutate('review_advance', { expectedRevision: review.revision, ...params });
    await loadReview(
      review.baseline?.from || ui.from,
      review.baseline?.to || ui.to,
      params.reviewId || ui.reviewId,
    );
  }
  function renderReview() {
    if (!review) return;
    const session = review.session;
    const items = session?.items || review.issues || [];
    $('review-content').innerHTML = view`<p>
        ${escape(review.baseline?.from || ui.from)} –
        ${escape(review.baseline?.to || ui.to)}
      </p>
      <p>${escape((review.warnings || []).join(' '))}</p>
      ${
        session
          ? `<p>${session.reviewedAt ? tr('Revisado') : tr('Sin revisar')} · ${escape(new Date(session.startedAt).toLocaleString(locale()))}</p>`
          : button('guided-start-review', '', tr('Iniciar o retomar revisión'))
      }
      <div id="review-correction-intent" role="status"></div>
      <div class="scroll">
        <table>
          <caption>
            ${tr('Previsto al inicio')} / ${tr('Registrado')}
          </caption>
          <thead>
            <tr>
              <th>${tr('Tarea')}</th>
              <th>${tr('Fecha')}</th>
              <th>${tr('Previsto al inicio')}</th>
              <th>${tr('Registrado')}</th>
              <th>${tr('Corregir tiempo')}</th>
            </tr>
          </thead>
          <tbody>
            ${(review.rows || [])
              .map(
                (row, index) =>
                  `<tr><td>${escape(row.title || row.taskId)}</td><td>${escape(row.date)}</td><td>${mins(row.plannedMs)} ${row.aggregate ? tr('Previsión original de tarea dividida; registrado sólo en subtareas') : button('guided-plan-task', index, tr('Reprogramar'))}</td><td>${row.aggregate ? tr('Registrado sólo en subtareas') : mins(row.actualMs)}</td><td>${row.aggregate ? tr('Previsión original de tarea dividida; registrado sólo en subtareas') : row.archived ? tr('Archivo: corrección no disponible mediante esta API') : row.actualMs == null ? tr('Sin datos fiables') : `<details class="review-time-editor"><summary>${tr('Corregir tiempo')}</summary><form data-guided="correct-time" data-row="${index}">${input(tr('Tiempo registrado absoluto (minutos)'), 'minutes', 'number', row.actualMs / 60000, 'min="0" max="1440" step="0.01" required')}<label>${tr('Actividad')}<select name="activityId" required>${option('', tr('Selecciona actividad'))}${(row.activityIds || []).map((id) => option(id, current().profile.areas.find((a) => a.id === id)?.name || id, row.activityIds.length === 1)).join('')}</select></label><button>${tr('Guardar tiempo real')}</button></form></details>`}</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${list(
        items.map((item) => {
          const d = session?.decisions?.[item.id];
          const canCorrect = correctionRowIndex(item) >= 0;
          return `<article><p>${escape(item.message || item.title || item.kind || item.id)} · ${d ? `${tr('Revisado')} ${escape(new Date(d.reviewedAt).toLocaleString(locale()))}` : tr('Sin revisar')}</p>${
            item.projectId && !item.taskId && session
              ? `<form data-guided="create-next-task" data-project="${escape(item.projectId)}">${input(tr('Nombre'), 'title', 'text', '', 'required maxlength="500"')}${input(tr('Estimación (minutos)'), 'estimate', 'number', current().profile.preferences?.sessionMinutes || 25, 'min="0" max="525600" required')}<button>${tr('Crear próxima tarea')}</button></form><form data-guided="select-existing-task"><select name="taskId" required>${current()
                  .data.leaves.filter(
                    (t) => !t.archived && t.projectId === item.projectId,
                  )
                  .map((t) => option(t.id, t.title))
                  .join('')}</select><button>${tr('Abrir tarea')}</button></form>`
              : ''
          }${item.activityId && !item.taskId ? `<a href="#goals">${tr('Editar objetivo')}</a>` : ''}${
            session && !session.reviewedAt
              ? `<form data-guided="review-decision" data-item="${escape(item.id)}" data-task="${escape(item.taskId || '')}"><label>${tr('Decisión')}<select name="decision">${[
                  ['keep', 'Mantener'],
                  ['reschedule', 'Reprogramar'],
                  ['split', 'Dividir'],
                  ['pause', 'Pausar'],
                  ['archive', 'Completar y archivar'],
                  ['correct_time', 'Corregir tiempo'],
                ]
                  .filter(
                    ([key]) =>
                      (item.taskId || key === 'keep') &&
                      (key !== 'correct_time' || canCorrect),
                  )
                  .map(([key, label]) => option(key, tr(label)))
                  .join(
                    '',
                  )}</select></label>${input(tr('Nueva fecha'), 'date', 'date', current().date)}<label>${tr('Nombres de subtareas, uno por línea')}<textarea name="children" rows="3"></textarea></label><button>${tr('Marcar revisado')}</button><p>${tr('Marcar revisado es independiente de completar o registrar tiempo. Las acciones seleccionadas se ejecutan antes de marcar.')}</p></form>`
              : ''
          }</article>`;
        }),
        tr('No hay elementos pendientes de revisión.'),
      )}
      ${
        session && !session.reviewedAt
          ? button('guided-finish-review', session.id, tr('Terminar revisión'))
          : ''
      }`;
    for (const form of $('review-content').querySelectorAll(
      '[data-guided="review-decision"]',
    ))
      updateDecisionFields(form);
    renderCorrectionIntent();
  }
  function updateDecisionFields(form) {
    const decision = form.elements.decision.value;
    form.elements.date.closest('label').hidden = decision !== 'reschedule';
    form.elements.children.closest('label').hidden = decision !== 'split';
  }
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-guided="review-decision"] select[name="decision"]'))
      updateDecisionFields(event.target.form);
  });
  function renderNext() {
    const candidates = (next.candidates || []).slice(0, 3);
    const card = (candidate) =>
      `<article><h3>${escape(candidate.title || candidate.taskId)}</h3>${candidate.slot ? `<p>${escape(clock(candidate.slot.start))}–${escape(clock(candidate.slot.end))} · ${escape(String(candidate.remainingMinutes))} min</p>` : ''}${list(
        (candidate.reasons || []).slice(0, 3).map((r) => escape(tr(r))),
        '',
      )}${button('guided-select-task', candidate.taskId, tr('Abrir tarea'))}${button('guided-block-task', candidate.taskId, tr('Bloquear manualmente'))}${button('guided-unblock-task', candidate.taskId, tr('Reactivar'))}</article>`;
    $('now-content').innerHTML =
      `<p>${escape(next.emptyReason || '')}</p>${list((next.warnings || []).map(escape), '')}<div class="grid">${candidates.map(card).join('')}</div>${!candidates.length ? `<p>${tr('Sin opciones viables con estos datos.')}</p>` : ''}<details><summary>${tr('Alternativas')}</summary>${(next.alternatives || []).map(card).join('')}</details>`;
  }
  function showProposal(value) {
    proposal = value;
    const editable = (value.proposals || []).filter((p) => p.interval);
    $('guided-proposal').innerHTML =
      view`<h3>Ajustar propuesta</h3><p id="guided-adjust-status" role="status"></p>
      ${
        editable.length
          ? `<form data-guided="adjust-proposal">${editable.map((p) => `<fieldset><legend>${escape(p.title || p.area || p.id)}</legend>${input(tr('Fecha'), 'date:' + p.id, 'date', p.date || current().date, 'required')}${input(tr('Inicio'), 'start:' + p.id, 'time', wallClock(p.interval[0], current().profile.timezone), 'required')}${input(tr('Fin'), 'end:' + p.id, 'time', wallClock(p.interval[1], current().profile.timezone), 'required')}</fieldset>`).join('')}<button>${tr('Validar ajustes de propuesta')}</button></form>`
          : ''
      }${list(
        (value.conflicts || []).map((c) => escape(c.message || JSON.stringify(c))),
        '',
      )}
      <div>
        ${proposalReviewHTML(value, clock)
          .replace('data-form="apply-proposal"', 'data-guided="apply-proposal"')
          .replace(
            '<button>',
            (value.conflicts || []).length
              ? '<label><input type="checkbox" name="acceptConflicts" required>' +
                  tr('Confirmar conflictos y aplicar selección válida') +
                  '</label><button>'
              : '<button>',
          )}
      </div>`;
    document.dispatchEvent(
      new CustomEvent('planner:navigate', { detail: { section: 'proposal-adjust' } }),
    );
  }
  async function renderHistory() {
    const result = await adapter.operation('history', { limit: 50 });
    $('history-content').innerHTML = list(
      (result.entries || []).map(
        (entry) =>
          `<article><h3>${escape(new Date(entry.createdAt).toLocaleString(locale()))} · ${escape(entry.status)}</h3><code>${escape(entry.id)}</code><p>${escape(entry.direction || '')}${entry.undoOf ? ' · ' + escape(entry.undoOf) : ''}</p>${list(
            (entry.changes || []).map(
              (c) =>
                `<details><summary>${escape(c.taskId || c.commitmentId || c.id)}</summary><p>${tr('Antes')}</p><pre>${escape(JSON.stringify(c.before, null, 2))}</pre><p>${tr('Después')}</p><pre>${escape(JSON.stringify(c.after, null, 2))}</pre></details>`,
            ),
            '',
          )}${entry.status === 'confirmed' ? button('guided-undo', entry.id, tr('Preparar deshacer')) : ''}</article>`,
      ),
      tr('Sin reorganizaciones registradas.'),
    );
  }
  const run = async (fn) => {
    if (busy) return;
    busy = true;
    document
      .querySelectorAll(
        'form[data-guided] input, form[data-guided] select, form[data-guided] textarea, form[data-guided] button',
      )
      .forEach((node) => {
        node.disabled = true;
      });
    try {
      await fn();
    } catch (error) {
      reportError(error.message);
    } finally {
      busy = false;
      document
        .querySelectorAll(
          'form[data-guided] input, form[data-guided] select, form[data-guided] textarea, form[data-guided] button',
        )
        .forEach((node) => {
          node.disabled =
            !!ui.pending.length &&
            node.closest('form').dataset.guided === 'apply-proposal';
        });
    }
  };
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form.dataset.guided) return;
    event.preventDefault();
    const f = new FormData(form);
    void run(async () => {
      const action = form.dataset.guided;
      if (action === 'review-load')
        return loadReview(String(f.get('from')), String(f.get('to')));
      if (action === 'next') {
        next = await adapter.operation('next', {
          date: current().date,
          availableMinutes: Number(f.get('availableMinutes')),
          ...(f.get('contextAreaId')
            ? { contextAreaId: String(f.get('contextAreaId')) }
            : {}),
          limit: 3,
        });
        renderNext();
        return;
      }
      if (action === 'plan-task') {
        await mutate('task', {
          taskId: form.dataset.task,
          fields: {
            dueDay: String(f.get('date')),
            timeEstimate: Math.round(Number(f.get('estimate')) * 60000),
          },
        });
        $('guided-task-editor').textContent = tr('Operación confirmada.');
        await refresh();
        return loadReview(ui.from, ui.to);
      }
      if (action === 'create-next-task') {
        await mutate('task', {
          fields: {
            title: String(f.get('title')).trim(),
            projectId: form.dataset.project,
            timeEstimate: Math.round(Number(f.get('estimate')) * 60000),
            dueDay: current().date,
          },
        });
        await refresh();
        return loadReview(ui.from, ui.to);
      }
      if (action === 'select-existing-task')
        return adapter.selectTask(String(f.get('taskId')));
      if (action === 'correct-time') {
        const row = review.rows[Number(form.dataset.row)],
          activityId = String(f.get('activityId'));
        if (!activityId)
          throw Error(tr('Selección de actividad necesaria para registrar tiempo.'));
        await mutate('correct_time', {
          activityId,
          taskId: row.taskId,
          date: row.date,
          expectedDurationMs: row.actualMs,
          durationMs: Math.round(Number(f.get('minutes')) * 60000),
        });
        await refresh();
        if (
          correctingItem &&
          review.session?.id === correctingItem.reviewId &&
          row.taskId === correctingItem.taskId &&
          row.date === correctingItem.date &&
          ui.from === correctingItem.from &&
          ui.to === correctingItem.to
        ) {
          const item = correctingItem;
          correctingItem = null;
          return reviewCommand({
            command: 'decide',
            reviewId: item.reviewId,
            itemId: item.itemId,
            decision: 'correct_time',
          });
        }
        return loadReview(ui.from, ui.to);
      }
      if (action === 'review-decision') {
        const taskId = form.dataset.task,
          decision = String(f.get('decision'));
        if (decision === 'reschedule')
          await mutate('task', { taskId, fields: { dueDay: String(f.get('date')) } });
        if (decision === 'split') {
          const titles = String(f.get('children'))
            .split('\n')
            .map((v) => v.trim())
            .filter(Boolean);
          if (titles.length < 2) throw Error(tr('Escribe al menos dos subtareas.'));
          await mutate('task', {
            taskId,
            command: 'split',
            children: titles.map((title) => ({ title })),
          });
        }
        if (decision === 'archive') await mutate('task', { taskId, command: 'archive' });
        if (decision === 'pause') {
          await reviewCommand({ command: 'task_state', taskId, taskState: 'paused' });
        }
        if (decision === 'correct_time') {
          const item = review.session?.items.find(
            (entry) => entry.id === form.dataset.item,
          );
          const index = correctionRowIndex(item);
          if (index < 0)
            throw Error(tr('No hay una fila editable para corregir este asunto.'));
          const row = review.rows[index];
          correctingItem = {
            reviewId: review.session.id,
            itemId: item.id,
            taskId: row.taskId,
            date: row.date,
            from: ui.from,
            to: ui.to,
          };
          renderCorrectionIntent();
          const correctionForm = $('review-content').querySelector(
            `form[data-row="${index}"]`,
          );
          correctionForm?.closest('details')?.setAttribute('open', '');
          correctionForm?.querySelector('input')?.focus();
          return;
        }
        correctingItem = null;
        renderCorrectionIntent();
        await reviewCommand({
          command: 'decide',
          reviewId: review.session.id,
          itemId: form.dataset.item,
          decision,
        });
        await refresh();
        return;
      }
      if (action === 'adjust-proposal') {
        const changes = proposalChanges(f, proposal, current().profile.timezone);
        if (!changes.length) {
          $('guided-adjust-status').textContent = tr(
            'Sin ajustes; la propuesta original sigue disponible.',
          );
          return;
        }
        showProposal(
          await adapter.operation('proposal_adjust', {
            proposalId: proposal.proposalId,
            changes,
          }),
        );
        return;
      }
      if (action === 'apply-proposal') {
        const selection = f.getAll('selection').map(String);
        if (!selection.length) throw Error(tr('Selecciona los cambios revisados.'));
        if ((proposal.conflicts || []).length && !f.has('acceptConflicts'))
          throw Error(tr('Confirma los conflictos pendientes.'));
        await mutate('apply', { proposalId: proposal.proposalId, selection });
        proposal = null;
        $('guided-proposal').textContent = tr('Operación confirmada.');
        await refresh();
        return renderHistory();
      }
    });
  });
  document.addEventListener('click', (event) => {
    const b = event.target.closest('[data-action^="guided-"]');
    if (!b) return;
    void run(async () => {
      const id = b.dataset.id,
        action = b.dataset.action;
      if (action === 'guided-cancel-correction') {
        correctingItem = null;
        renderCorrectionIntent();
        return;
      }
      if (action === 'guided-close-unsent') return closeNotice(id, 'not-dispatched');
      if (action === 'guided-acknowledge')
        return closeNotice(id, 'manual-result-checked');
      if (action === 'guided-receipt') {
        const p = ui.pending.find((entry) => entry.operationId === id);
        const result = await adapter.operation('operation_status', {
          action: p.action,
          operationId: id,
        });
        if (confirmed(result)) {
          await closeNotice(id, 'receipt-confirmed:' + result.status);
        } else throw Error(`${operationError(result)} ${id}`);
        await refresh();
        return;
      }
      if (action === 'guided-start-review') {
        const result = await mutate('review_advance', {
          command: 'start',
          expectedRevision: review.revision,
          from: ui.from,
          to: ui.to,
        });
        ui.reviewId = result.reviewId;
        await persist();
        return loadReview(ui.from, ui.to);
      }
      if (action === 'guided-finish-review')
        return reviewCommand({ command: 'finish', reviewId: id });
      if (action === 'guided-select-task') return adapter.selectTask(id);
      if (action === 'guided-plan-task') {
        const row = review.rows[Number(id)];
        $('guided-task-editor').innerHTML =
          `<form data-guided="plan-task" data-task="${escape(row.taskId)}">${input(tr('Nueva fecha'), 'date', 'date', row.date, 'required')}${input(tr('Estimación (minutos)'), 'estimate', 'number', (current().data.byId.get(row.taskId)?.timeEstimate || 0) / 60000, 'min="0" max="525600" required')}<button>${tr('Guardar')}</button></form>`;
        return;
      }
      if (action === 'guided-block-task' || action === 'guided-unblock-task') {
        const result = await adapter.operation('review', { ...range() });
        await mutate('review_advance', {
          command: 'task_state',
          expectedRevision: result.revision,
          taskId: id,
          taskState: action === 'guided-block-task' ? 'blocked' : 'active',
        });
        $('now-content').textContent = tr('Configuración guardada.');
        return;
      }
      if (action === 'guided-history') return renderHistory();
      if (action === 'guided-undo')
        return showProposal(await adapter.operation('prepare_undo', { historyId: id }));
    });
  });
  return {
    render: renderShell,
    hasPending: () => ui.pending.length > 0,
    async receiptResolved(operationId, result) {
      if (
        confirmed(result) &&
        ui.pending.some((entry) => entry.operationId === operationId)
      ) {
        await closeNotice(operationId, 'receipt-confirmed:' + result.status);
      }
    },
    showProposal,
    async initialize() {
      try {
        const state = await adapter.loadUiState();
        raw = state.raw;
        ui = state.value;
      } catch (error) {
        reportError(error.message);
      }
      renderShell();
      // Loading a saved draft is read-only; pending mutations are never replayed.
      if (ui.reviewId && ui.from && ui.to) await loadReview(ui.from, ui.to);
    },
  };
}
