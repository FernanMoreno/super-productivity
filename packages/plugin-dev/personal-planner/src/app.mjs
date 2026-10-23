import { taskDailyMinutes } from './guided-state.mjs';
import {
  html as view,
  tr,
  initializeI18n,
  displayClock,
  wallClock,
  locale,
} from './i18n.mjs';
import { remainingCapacity } from '../../../personal-planner-core/remaining-capacity.mjs';
import { createGuidedPlanner } from './guided.mjs';
import { createWorkflow } from './workflow.mjs';
import { createWorkspace } from './workspace.mjs';
import {
  createArea,
  migrateProfile,
  KINDS,
  STATES,
  orderedAreas,
  areaGoalsOn,
  areaStateOn,
  setGoalsFrom,
  setStateFrom,
  areaCompletionOn,
  setCompletionFrom,
  editCommitment,
  demoProfile,
} from './model.mjs';
import {
  localDay,
  weekDays,
  addDays,
  availability,
  scenario,
  proposeActivitiesWeek,
} from './schedule.mjs';
import {
  areaMetrics,
  goalPace,
  scheduledDay,
  effectiveArea as effectiveAreaForProfile,
} from './metrics.mjs';
import { createAdapter } from './adapter.mjs';
import { contextRevision } from '../../../personal-planner-core/operations.mjs';
import {
  escape,
  list,
  option,
  button,
  settingsHTML,
  eventForm,
  deadlineForm,
} from './forms.mjs';
const $ = (id) => document.getElementById(id);
let profile,
  data,
  adapter,
  busy = false,
  loaded = false,
  proposals = [],
  settingsDirty = false,
  profileRevision,
  settingsRevision,
  reviewedProposalContext = null,
  refreshTimer,
  externalRefreshPending = false,
  nativeRefreshPending = false;
let guided;
let workflow;
let proposalBusy = false;
const workflowMode = (section) =>
  ({
    workflow: 'board',
    templates: 'templates',
    'workflow-week': 'week',
    'workflow-review': 'review',
    integrations: 'integrations',
  })[section];
const workspace = createWorkspace({
  onNavigate: applyWorkspaceContext,
  beforeNavigate: (context) => {
    const mode = workflowMode(context.section);
    if (
      mode &&
      workflow?.canNavigate &&
      !workflow.canNavigate({
        mode,
        projectId: context.projectId || '',
        taskId: context.taskId,
      })
    ) {
      error(tr('Guarda o descarta el formulario antes de cambiar de vista.'));
      return false;
    }
    return true;
  },
});
function applyWorkspaceContext(context) {
  if (loaded && context.section === 'week') renderWeek();
  const mode = workflowMode(context.section);
  if (mode && workflow?.navigate) {
    void workflow
      .navigate({ mode, projectId: context.projectId || '', taskId: context.taskId })
      .catch((failure) => error(failure.message));
  }
}
const dirtyForms = new Map();
let workflowDirty = false,
  lastDirty,
  workflowDraftContext;
const formValue = (form) => JSON.stringify([...new FormData(form)]);
function publishDirty() {
  for (const form of dirtyForms.keys()) if (!form.isConnected) dirtyForms.delete(form);
  const dirty =
    settingsDirty ||
    workflowDirty ||
    [...dirtyForms].some(([form, value]) => formValue(form) !== value);
  const state = {
      type: 'personal-planner:state',
      dirty,
      workflowDirty,
      ...(workflowDraftContext ? { workflowContext: workflowDraftContext } : {}),
    },
    signature = JSON.stringify(state);
  if (signature !== lastDirty && window.parent !== window) {
    window.parent.postMessage(state, '*');
    lastDirty = signature;
  }
}
document.addEventListener('focusin', (event) => {
  const form = event.target.closest('form');
  if (form && !dirtyForms.has(form)) dirtyForms.set(form, formValue(form));
});
document.addEventListener('input', publishDirty);
document.addEventListener('change', publishDirty);
document.addEventListener('planner:dirty-state', (event) => {
  if (event.detail?.source === 'workflow') {
    workflowDirty = event.detail.dirty === true;
    if (workflowDirty && !workflowDraftContext) {
      const { section, projectId, taskId } = workspace.context();
      workflowDraftContext = {
        section,
        ...(projectId ? { projectId } : {}),
        ...(taskId ? { taskId } : {}),
      };
    }
    if (!workflowDirty) workflowDraftContext = undefined;
  }
  publishDirty();
});
document.addEventListener('planner:discard-draft', (event) => {
  if (event.detail?.scope === 'workflow') {
    workflow?.discardDraft?.();
    workflowDirty = false;
    workflowDraftContext = undefined;
    publishDirty();
    return;
  }
  for (const form of dirtyForms.keys()) if (form.isConnected) form.reset();
  dirtyForms.clear();
  settingsDirty = false;
  workflow?.discardDraft?.();
  workflowDirty = false;
  workflowDraftContext = undefined;
  if (profile) renderSettings();
  publishDirty();
});
new MutationObserver(publishDirty).observe($('workspace-content'), {
  childList: true,
  subtree: true,
});
const date = () => $('day').value || localDay(Date.now(), profile?.timezone);
const minutes = (n) => (n === null ? tr('No calculable') : view`${Math.round(n)} min`);
const clock = (epoch) =>
  displayClock(
    epoch,
    profile?.timezone || 'Europe/Madrid',
    profile?.preferences?.hourFormat,
  );
const span = (interval) => view`${clock(interval[0])}–${clock(interval[1])}`;
const days = () => weekDays(date(), profile.weekStartsOn ?? 1);
$('day').value = localDay();
function error(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}
function clearError() {
  $('error').hidden = true;
}
const effectiveArea = (a) => effectiveAreaForProfile(profile, a);
const metric = (a, day = date()) => areaMetrics(data, effectiveArea(a), day);
const mapped = (a) => {
  const e = effectiveArea(a);
  return e.projectIds.length + e.tagIds.length > 0;
};
const daily = (a, day = date()) =>
  !mapped(a) || !data.civilDaysReliable ? null : metric(a, day).dailyMinutes;
const active = (a) =>
  areaStateOn(a, date()) === 'active' && areaCompletionOn(a, date()) !== 'completed';
function goalCard(a) {
  const logged = daily(a),
    target = areaGoalsOn(a, date()).dailyMinutes;
  return view`<article style="border-inline-start:4px solid ${a.color || '#3979b8'}">
    <h3>${escape(a.icon || '')} ${escape(a.name)}</h3>
    <p>${minutes(logged)} registrados / ${minutes(target)} de objetivo diario</p>
    ${
      logged !== null && target > 0
        ? view`<progress
          max="${target}"
          value="${Math.min(logged, target)}"
          aria-label="Progreso diario de ${escape(a.name)}"
        ></progress>`
        : ''
    }
    <p>
      ${
        !mapped(a)
          ? tr('Asocia proyectos o etiquetas para atribuir registros.')
          : !data.civilDaysReliable
            ? tr('El día lógico o zona del anfitrión impide certificar días civiles.')
            : logged === null
              ? tr('Faltan subtareas o un desglose diario coherente.')
              : tr('Cada fecha se evalúa por separado.')
      }
    </p>
  </article>`;
}
function taskRows(tasks) {
  return !tasks.length
    ? tr('<p>No hay tareas previstas para esta fecha.</p>')
    : view`<div class="scroll">
        <table>
          <caption>
            Datos nativos: estimación, tiempo registrado y completitud separados
          </caption>
          <thead>
            <tr>
              <th>Tarea</th>
              <th>Estimación</th>
              <th>Registrado total</th>
              <th>Registrado en fecha</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${tasks
              .map(
                (t) =>
                  view`<tr>
                    <td>${button('task', t.id, escape(t.title))}</td>
                    <td>${minutes((t.timeEstimate || 0) / 60000)}</td>
                    <td>${minutes((t.timeSpent || 0) / 60000)}</td>
                    <td>
                      ${
                        data.civilDaysReliable
                          ? minutes(taskDailyMinutes(data, t, date()))
                          : tr('No calculable')
                      }
                    </td>
                    <td>${t.isDone ? 'Completada' : 'Pendiente'}</td>
                  </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
}
function deadlines() {
  const native = data.leaves
    .filter((t) => !t.archived && !t.isDone && scheduledDay(t, data))
    .map((t) => ({ title: t.title, date: scheduledDay(t, data), native: true }));
  const areas = profile.areas
    .filter((a) => a.dueDate)
    .map((a) => ({ title: a.name, date: a.dueDate, activity: true }));
  const entries = [
    ...profile.deadlines.filter((d) => !d.completed),
    ...profile.milestones,
    ...native,
    ...areas,
  ]
    .filter((d) => d.date <= addDays(date(), 14))
    .sort((a, b) => a.date.localeCompare(b.date));
  return list(
    entries.map(
      (d) =>
        view`${escape(d.date)} ·
        ${escape(d.title)}${
          d.native ? tr(' · Tarea planificada (no entrega confirmada)') : ''
        }${d.activity ? tr(' · Fecha límite de actividad') : ''}${
          d.provisional ? ' · Provisional' : ''
        }${d.date < date() ? tr(' · Fecha pasada; revisa sin borrar el dato') : ''}${
          d.hours != null
            ? ' · ' + d.hours + ' h de referencia, no sumadas al objetivo'
            : ''
        }`,
    ),
    tr('No hay entregas o hitos próximos.'),
  );
}
function conflictList(c) {
  return list(
    [
      ...c.conflicts.map(
        (v) =>
          view`${escape(v.a.title)} / ${escape(v.b.title)}: solapamiento
          ${minutes(v.minutes)}, ${span([v.from, v.to])}.`,
      ),
      ...(c.transitionConflicts || []).map(
        (v) =>
          view`${escape(v.a.title)} / ${escape(v.b.title)}: ${tr('Margen insuficiente')}
          ${minutes(v.missingMinutes)} (${tr('necesario')}:
          ${minutes(v.requiredMinutes)}).`,
      ),
      ...c.transitions.map(
        (v) =>
          view`${escape(v.a.title)} / ${escape(v.b.title)}: contiguos a las
          ${clock(v.at)}, sin solapamiento; revisa margen de transición.`,
      ),
      ...c.warnings.map(escape),
    ],
    tr('No se detectan conflictos en los compromisos configurados.'),
  );
}
function renderToday() {
  const schedule = availability(profile, date(), data),
    remaining = remainingCapacity(profile, data, date()),
    tasks = data.leaves.filter((t) => !t.archived && scheduledDay(t, data) === date());
  const goals = orderedAreas(profile).filter(
    (a) => active(a) && areaGoalsOn(a, date()).dailyMinutes !== null,
  );
  const today = localDay(Date.now(), profile.timezone);
  const capacityLabel =
    date() === today
      ? tr('Disponibilidad restante hoy')
      : date() < today
        ? tr('Fecha pasada: disponibilidad restante cero')
        : tr('Capacidad de la fecha consultada');
  $('today-content').innerHTML =
    view`<div class="workspace-overview"><article class="workspace-availability"><h3>${capacityLabel}</h3><p>${tr('Libre laboral')}: <strong>${minutes(remaining.workMinutes)}</strong> · ${tr('Libre personal')}: <strong>${minutes(remaining.personalMinutes)}</strong> ${remaining.partial ? tr('(parcial)') : ''}</p><p>${tr('Carga pendiente sin horario; necesita asignar hueco')}: ${minutes(remaining.unslottedTaskMinutes)}</p>${list(
      (remaining.warnings || []).map((v) => escape(tr(v))),
      '',
    )}</article><article class="workspace-agenda"><h3>Compromisos de ${escape(date())}</h3>
    ${list(
      schedule.events
        .filter((c) => !['available', 'flexible'].includes(c.kind))
        .map(
          (c) =>
            view`${span([c.from, c.to])} · ${escape(c.title)} ·
            ${escape(tr(KINDS[c.kind] || 'Calendario nativo'))}`,
        ),
      tr('No hay compromisos configurados para esta fecha.'),
    )}
    </article></div>
    <article class="workspace-task-list"><h3>Tareas previstas</h3>${taskRows(tasks)}</article>
    <div class="grid">${goals.map(goalCard).join('')}</div>
    ${
      !profile.areas.length
        ? tr(
            '<p>Empieza creando una actividad en Configuración o carga una demostración ficticia.</p>',
          )
        : ''
    }
    <details><summary>Entregas e hitos</summary>
    ${deadlines()}
    </details><details><summary>Conflictos y transición</summary>
    ${conflictList(schedule)}</details>`;
}
function renderGoals() {
  $('goals-content').innerHTML = view`<p>
      Objetivos según vigencia en ${escape(date())}. Las horas no acreditan cursos o
      exámenes superados. Las actividades pausadas/archivadas conservan registros
      históricos.
    </p>
    <div class="grid">
      ${orderedAreas(profile)
        .map((a) => {
          const m = metric(a),
            g = areaGoalsOn(a, date()),
            state = areaStateOn(a, date()),
            pace = goalPace(profile, data, effectiveArea(a), date());
          return view`<article
            style="border-inline-start:4px solid ${a.color || '#3979b8'}"
          >
            <h3>${escape(a.icon || '')} ${escape(a.name)}</h3>
            <p>
              ${escape(tr(STATES[state] || 'Fuera de vigencia'))} · Prioridad
              ${a.priority ?? 3}
            </p>
            <details><summary>Progreso y planificación</summary>
            ${
              !mapped(a)
                ? tr('<p>Sin asociaciones: no se puede atribuir tiempo.</p>')
                : view`<p>
                    Registrado histórico devuelto: ${(m.totalMinutes / 60).toFixed(2)}
                    h${m.incomplete ? ' (parcial)' : ''}.
                  </p>
                  <p>
                    Registrado esta semana:
                    ${
                      data.civilDaysReliable
                        ? minutes(m.weeklyMinutes)
                        : tr('No calculable por día civil')
                    }
                    · Previsto esta semana: ${minutes(m.plannedMinutes)}.
                  </p>
                  <p>
                    ${m.pending.length} tareas pendientes · ${m.completed} tareas
                    completadas.
                  </p>`
            }${
              g.targetHours !== null
                ? view`<p>
                  Objetivo ${g.targetHours} h · Pendiente según datos devueltos:
                  ${
                    mapped(a)
                      ? Math.max(0, g.targetHours - m.totalMinutes / 60).toFixed(2) + ' h'
                      : 'sin calcular'
                  }.
                </p>`
                : ''
            }
            <p>
              ${
                g.weeklyMinutes !== null
                  ? tr('Objetivo semanal editable: ') + minutes(g.weeklyMinutes)
                  : tr('Sin obligación semanal configurada.')
              }
            </p>
            <p>
              ${tr('Ritmo hasta fecha límite')}:
              ${escape(pace.dueDate || tr('Sin fecha'))} ·
              ${
                pace.requiredMinutesPerDay == null
                  ? tr('No calculable')
                  : minutes(pace.requiredMinutesPerDay)
              }
              / ${tr('día')} ·
              ${
                pace.availableMinutes == null
                  ? tr('No calculable')
                  : minutes(pace.availableMinutes)
              }
              ${pace.partial ? tr('(parcial)') : ''}
            </p>
            <p>
              Progreso manual:
              ${escape(
                tr(
                  {
                    pending: 'Pendiente',
                    'in-progress': tr('En curso'),
                    completed: 'Completado',
                  }[areaCompletionOn(a, date())],
                ),
              )}
            </p>
            ${
              g.dailyMinutes !== null
                ? view`<div class="scroll">
                  <table>
                    <caption>
                      Objetivo diario vigente: ${minutes(g.dailyMinutes)}
                    </caption>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Registrado / objetivo vigente</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${days()
                        .map(
                          (d) =>
                            view`<tr>
                              <td>${d}</td>
                              <td>
                                ${minutes(daily(a, d))} /
                                ${minutes(areaGoalsOn(a, d).dailyMinutes)}
                              </td>
                            </tr>`,
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
                : ''
            }
            <details>
              <summary>Próximas tareas</summary>
              ${list(
                m.pending
                  .slice()
                  .sort((x, y) =>
                    (scheduledDay(x, data) || '9999').localeCompare(
                      scheduledDay(y, data) || '9999',
                    ),
                  )
                  .slice(0, 10)
                  .map(
                    (t) =>
                      view`${escape(t.title)} ·
                      ${escape(scheduledDay(t, data) || 'sin fecha')} · estimación
                      ${minutes((t.timeEstimate || 0) / 60000)}`,
                  ),
                tr('No hay tareas pendientes asociadas.'),
              )}
            </details>
            </details>
          </article>`;
        })
        .join('')}
    </div>
    ${!profile.areas.length ? tr('<p>Sin actividades u objetivos configurados.</p>') : ''}`;
}
function proposalHTML(p, index) {
  return view`${escape(p.title || p.area)}:
  ${p.interval ? span(p.interval) : 'sin hueco continuo suficiente'}
  (${minutes(p.minutes)}).
  ${escape(p.reason || tr('Propuesta revisable; no cambia el calendario.'))}${
    p.interval ? button('review-proposal', index, tr('Revisar bloque propuesto')) : ''
  }`;
}
// Read-only refreshes must not close explanations while the user reads them.
function keepTextPanels(container) {
  const panels = () => {
    const occurrences = new Map();
    // Workflow controls restore state by task/column identity in their owner.
    return [...container.querySelectorAll('details')]
      .filter((node) => !node.closest('#workflow'))
      .map((node) => {
        const title = node.querySelector(':scope > summary')?.textContent.trim() || '';
        const identity = `${node.closest('[id]')?.id || ''}:${title}`;
        const count = occurrences.get(identity) || 0;
        occurrences.set(identity, count + 1);
        return { node, key: `${identity}:${count}` };
      });
  };
  const previous = new Map(panels().map(({ node, key }) => [key, node.open]));
  return () => {
    for (const { node, key } of panels())
      if (previous.has(key)) node.open = previous.get(key);
  };
}
function renderWeek() {
  const restorePanels = keepTextPanels($('week-content'));
  const projectId = workspace.context().projectId;
  const project = data.projects.find((item) => item.id === projectId);
  const belongs = (proposal) => {
    if (!project) return true;
    if (proposal.taskId) return data.byId.get(proposal.taskId)?.projectId === projectId;
    const area = profile.areas.find((item) => item.id === proposal.areaId);
    return !!area && effectiveArea(area).projectIds.includes(projectId);
  };
  document
    .querySelector('[data-action="prepare-shared"]')
    .closest('.shared-week-proposal').hidden = !!project;
  for (const section of $('calendar-management').querySelectorAll(
    '[data-profile-section]',
  ))
    section.setAttribute('aria-label', tr('Compromisos personales compartidos'));
  const snapshot = { ...data, dailyForArea: (a, d) => daily(a, d) },
    rows = days().map((d) => ({ date: d, s: scenario(profile, snapshot, d) }));
  proposals = [];
  const detail = rows.map(({ date: d, s }) => {
    const html = s.proposals.filter(belongs).map((p) => {
      const i = proposals.push({ ...p, date: p.date || d }) - 1;
      return proposalHTML(p, i);
    });
    return view`<details class="text-panel calendar-day" ${d === date() ? 'open' : ''}>
      <summary><time datetime="${d}">${escape(new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d}T12:00:00`)))}</time><span class="text-panel-subtitle">Conflictos y propuestas</span></summary>
      <div class="text-panel-grid">
      <section class="text-result"><h4>Conflictos entre compromisos</h4>${conflictList(s.capacity)}</section>
      <section class="text-result"><h4>Tareas que coinciden con compromisos</h4>
      ${list(
        s.affected
          .filter((task) => !project || task.projectId === projectId)
          .map((t) => escape(t.title)),
        tr('No se identifican coincidencias horarias.'),
      )}
      </section><section class="text-result"><h4>Tareas sin hora que necesitan revisión</h4>
      ${list(
        (s.potentiallyAffected || [])
          .filter((task) => !project || task.projectId === projectId)
          .map((t) => escape(t.title)),
        tr('No hay tareas que revisar por trabajo extra.'),
      )}
      </section><section class="text-result"><h4>Bloques propuestos para tus objetivos</h4>
      ${list(html, tr('No hay propuestas para este día.'))}
      </section></div>
    </details>`;
  });
  const weekly = proposeActivitiesWeek(profile, snapshot, days()).filter(belongs);
  const weeklyHTML = weekly.map((p) => {
    const i = proposals.push(p) - 1;
    return view`${escape(p.date || tr('Esta semana'))} · ${proposalHTML(p, i)}`;
  });
  $('week-content').innerHTML = view`${
    project
      ? `<article><h3>${escape(project.title)}</h3><p>${tr('Disponibilidad personal compartida entre todos los proyectos.')}</p>${list(
          data.leaves
            .filter(
              (task) =>
                !task.archived &&
                task.projectId === projectId &&
                days().includes(scheduledDay(task, data)),
            )
            .map(
              (task) =>
                `${escape(scheduledDay(task, data))} · ${button('task', task.id, escape(task.title))}`,
            ),
          tr('No hay tareas previstas para esta semana en este proyecto.'),
        )}</article>`
      : ''
  }<details class="workspace-context"><summary>${tr('Cómo se calcula la disponibilidad')}</summary><p>
      Unión de intervalos ocupados; capacidad laboral y personal separadas. Las franjas
      disponibles delimitan huecos, las ausencias tienen ámbito y las actividades
      flexibles no ocupan hasta que guardes un bloque.
    </p></details>
    <p class="notice warning">
      ${
        Object.values(profile.completeness).some((v) => !v)
          ? tr(
              'Estimación parcial: faltan categorías de descanso, desplazamientos, comidas o márgenes por confirmar.',
            )
          : tr('Márgenes declarados configurados; revisa cobertura.')
      }
      Las propuestas usan solo datos conocidos y pueden incluir descanso aún no definido.
      Las tareas sin hora se comparan como carga diaria.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Libre laboral</th>
            <th>Libre personal</th>
            <th>Carga adicional laboral / personal</th>
            <th>Exceso laboral / personal</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              ({ date: d, s }) =>
                view`<tr>
                  <th>${d}</th>
                  <td>${minutes(s.capacity.workMinutes)}</td>
                  <td>
                    ${minutes(s.capacity.personalMinutes)}${
                      s.capacity.partial ? ' (parcial)' : ''
                    }
                  </td>
                  <td>${minutes(s.workLoad)} / ${minutes(s.personalLoad)}</td>
                  <td>${minutes(s.workExcess)} / ${minutes(s.personalExcess)}</td>
                </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <article class="text-panel flexible-activities"><h3>Actividades flexibles sin fecha prevista</h3>
    ${list(
      weeklyHTML,
      tr(
        'Sin estimaciones flexibles pendientes. Crea una actividad con estimación y restricciones para buscarle hueco.',
      ),
    )}
    <p class="text-help">
      Revisa una propuesta para elegir su horario. El bloque se reserva al guardar y no cambia tus tareas ni el calendario nativo.
    </p></article>
    ${detail.join('')}`;
  restorePanels();
}
function renderWarnings() {
  const warnings = [...data.warnings];
  for (const a of profile.areas) {
    if (
      a.projectIds.some((id) => !data.projects.some((p) => p.id === id)) ||
      a.tagIds.some((id) => !data.tags.some((p) => p.id === id))
    )
      warnings.push(
        view`${a.name}: asociación no disponible o borrada. Revisa Configuración.`,
      );
    if (
      active(a) &&
      a.workTime &&
      !profile.commitments.some((c) => c.kind === 'study' && c.areaId === a.id)
    )
      warnings.push(
        view`${a.name}: distribución de formación o actividad laboral pendiente de
        configurar.`,
      );
  }
  const missing = Object.entries(profile.completeness)
    .filter(([, v]) => !v)
    .map(([k]) => KINDS[k]);
  if (missing.length)
    warnings.push(
      view`Disponibilidad parcial. Falta configurar o confirmar: ${missing.join(', ')}.`,
    );
  const ambiguous = data.leaves.filter(
    (t) =>
      profile.areas.filter(
        (a) => !a.parentAreaId && mapped(a) && data.matches(t, effectiveArea(a)),
      ).length > 1,
  );
  if (ambiguous.length)
    warnings.push(
      view`${ambiguous.length} tareas pertenecen a varias actividades. Sus métricas no se
      deben sumar entre sí.`,
    );
  $('warnings').innerHTML =
    (!profile.areas.length
      ? view`<aside class="notice">
          <h3>Configura tu planificación</h3>
          <p>Puedes empezar vacío, importar tu perfil o cargar datos ficticios.</p>
          <a href="#goals">${tr('Crear actividad')}</a>
        </aside>`
      : '') +
    view`<details>
      <summary>Avisos y datos pendientes (${warnings.length})</summary>
      ${list(warnings.map(escape), tr('Sin avisos.'))}
    </details>`;
}
function renderData() {
  if (!profile || !data) return;
  const restorePanels = keepTextPanels($('workspace-main'));
  $('context').textContent = view`${profile.timezone} · Semana desde
  ${
    ['domingo', 'lunes', 'martes', tr('miércoles'), 'jueves', 'viernes', tr('sábado')][
      profile.weekStartsOn ?? 1
    ]
  }
  · Datos nativos de Super Productivity`;
  renderWarnings();
  renderToday();
  renderGoals();
  renderWeek();
  guided?.render();
  workflow?.render();
  restorePanels();
}
function renderSettings({ savedForm, preserveDrafts = false } = {}) {
  const preserved = preserveDrafts
    ? [...dirtyForms]
        .filter(
          ([form, value]) =>
            form.isConnected &&
            form !== savedForm &&
            form.matches('[data-form]') &&
            (form.dataset.profileDraft === 'true' || formValue(form) !== value),
        )
        .map(([form]) => form)
    : [];
  const opened = new Set(preserved.filter((form) => form.closest('details')?.open));
  const retainedProposal = preserved.some((form) => form.dataset.form === 'event')
    ? reviewedProposalContext
    : null;
  for (const id of ['goals-management', 'calendar-management']) $(id).replaceChildren();
  $('settings-content').innerHTML = settingsHTML(profile, data, date());
  for (const group of $('settings-content').querySelectorAll('[data-profile-section]')) {
    $(
      group.dataset.profileSection === 'goals'
        ? 'goals-management'
        : 'calendar-management',
    ).append(group);
  }
  const sharedTitle = document.createElement('h3');
  sharedTitle.textContent = tr('Compromisos personales compartidos');
  $('calendar-management').prepend(sharedTitle);
  for (const form of preserved) {
    const replacement = [
      ...document.querySelectorAll(
        '#settings-content form, #goals-management form, #calendar-management form',
      ),
    ].find(
      (candidate) =>
        candidate.dataset.form === form.dataset.form &&
        (candidate.dataset.id === form.dataset.id ||
          ['event', 'deadline'].includes(form.dataset.form)),
    );
    replacement?.replaceWith(form);
    if (opened.has(form) && form.closest('details')) form.closest('details').open = true;
  }
  settingsDirty = preserved.some((form) => form.isConnected);
  settingsRevision = profileRevision;
  reviewedProposalContext = retainedProposal;
  publishDirty();
}
function rememberProfileEditor(container) {
  const form = container.querySelector('form');
  form.dataset.profileDraft = 'true';
  dirtyForms.set(form, formValue(form));
}
function showExternalConflict() {
  error(
    tr(
      'La configuración cambió desde otra ventana o asistente. Tus campos siguen intactos; no se sobrescribirán los cambios externos. Copia lo que quieras conservar antes de descartar el borrador.',
    ),
  );
  $('error').insertAdjacentHTML(
    'beforeend',
    button('reload-settings', '', tr('Descartar borrador y cargar configuración actual')),
  );
}
function scheduleExternalRefresh(native = false) {
  nativeRefreshPending ||= native === true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const nativeChanged = nativeRefreshPending;
    nativeRefreshPending = false;
    if (loaded) void refresh({ externalOnly: true, nativeChanged });
  }, 250);
}
function refreshAssociations() {
  for (const [name, items] of [
    ['projectIds', data.projects],
    ['tagIds', data.tags],
  ])
    for (const select of document.querySelectorAll(
      view`form[data-form="area"] select[name="${name}"]`,
    )) {
      const selected = [...select.selectedOptions].map((v) => v.value);
      select.innerHTML =
        items
          .map((item) => option(item.id, item.title, selected.includes(item.id)))
          .join('') +
        selected
          .filter((id) => !items.some((item) => item.id === id))
          .map((id) => option(id, view`No disponible (${id})`, true))
          .join('');
    }
}
async function save(candidate, form) {
  if (busy) throw Error(tr('Hay una operación en curso. Reintenta cuando termine.'));
  busy = true;
  clearError();
  $('status').textContent = tr('Guardando configuración…');
  const buttons = [...(form?.querySelectorAll('button') || [])];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const changed =
      profile?.timezone !== candidate.timezone ||
      profile?.weekStartsOn !== candidate.weekStartsOn;
    if (form?.dataset.form === 'event' && reviewedProposalContext) {
      const currentData = await adapter.snapshot(profile.timezone, profile.weekStartsOn);
      if ((await contextRevision(profile, currentData)) !== reviewedProposalContext)
        throw Object.assign(
          Error(
            tr(
              'Propuesta obsoleta: cambiaron el perfil o las tareas. Conserva tus campos y prepara otra propuesta antes de reservar.',
            ),
          ),
          { code: 'STALE_PLAN' },
        );
    }
    const result = await adapter.save(candidate, {
      baseRevision: settingsDirty ? settingsRevision : profileRevision,
      operationId: crypto.randomUUID(),
    });
    profile = candidate;
    profileRevision = result.revision;
    if (changed) {
      try {
        data = await adapter.snapshot(profile.timezone, profile.weekStartsOn);
      } catch (e) {
        data = {
          ...data,
          civilDaysReliable: false,
          warnings: [...data.warnings, e.message],
        };
      }
    }
    renderData();
    renderSettings({ savedForm: form, preserveDrafts: true });
    $('status').textContent = tr('Configuración guardada.');
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
    if (externalRefreshPending) {
      externalRefreshPending = false;
      scheduleExternalRefresh();
    }
  }
}
async function refresh({ externalOnly = false, nativeChanged = false } = {}) {
  if (busy) {
    if (externalOnly) externalRefreshPending = true;
    nativeRefreshPending ||= nativeChanged;
    return;
  }
  busy = true;
  try {
    if (!adapter) {
      adapter = createAdapter(window.PluginAPI);
      adapter.watch(scheduleExternalRefresh);
    }
    const state = await adapter.loadState();
    const changed = state.revision !== profileRevision;
    if (externalOnly && loaded && !changed && !nativeChanged) {
      await workflow?.refresh().catch((failure) => {
        $('workflow-notice').textContent = failure.message;
      });
      return;
    }
    clearError();
    $('refresh').disabled = true;
    $('status').textContent = tr('Cargando datos…');
    const nextData = await adapter.snapshot(
      state.profile.timezone,
      state.profile.weekStartsOn,
    );
    profile = state.profile;
    profileRevision = state.revision;
    data = nextData;
    if (!guided) {
      guided = createGuidedPlanner({
        adapter,
        current: () => ({ profile, data, date: date() }),
        refresh,
        reportError: error,
      });
      await guided.initialize();
    }
    if (!workflow) {
      workflow = createWorkflow({
        adapter,
        current: () => ({ profile, data, date: date() }),
        refresh,
        reportError: error,
      });
      await workflow.initialize();
      applyWorkspaceContext(workspace.context());
    } else {
      await workflow.refresh().catch((failure) => {
        $('workflow-notice').textContent = failure.message;
      });
    }
    if (!loaded) $('day').value = localDay(Date.now(), profile.timezone);
    renderData();
    if (!loaded || (changed && !settingsDirty)) renderSettings();
    else refreshAssociations();
    if (loaded && settingsDirty && settingsRevision !== profileRevision)
      showExternalConflict();
    loaded = true;
    $('status').textContent = view`Datos actualizados a las ${clock(Date.now())}.
    ${data.leaves.length} tareas sin doble suma de padres.`;
  } catch (e) {
    error(e.message);
    $('status').textContent = tr(
      'No se pudo actualizar. Reintenta; no se ha reemplazado el perfil.',
    );
  } finally {
    busy = false;
    $('refresh').disabled = false;
    if (externalRefreshPending) {
      externalRefreshPending = false;
      scheduleExternalRefresh();
    }
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  try {
    const f = new FormData(form);
    if (form.dataset.form === 'operation-status') {
      const result = await adapter.operationStatus({
        action: String(f.get('action')),
        operationId: String(f.get('operationId')).trim(),
      });
      await guided?.receiptResolved(String(f.get('operationId')).trim(), result);
      const labels = {
        applied: tr('Cambio confirmado por la aplicación.'),
        rejected: tr('Operación rechazada.'),
        conflict: tr('Operación rechazada por cambios posteriores.'),
        uncertain: tr(
          'Resultado incierto: el recibo no confirma el cambio. No repitas con otro identificador.',
        ),
        not_found: tr(
          'No existe recibo. Su ausencia no demuestra que sea seguro repetir el cambio.',
        ),
      };
      $('operation-result').textContent = view`${
        labels[result.status] || tr('No se pudo confirmar el estado.')
      }
      ${result.code || ''}`;
      return;
    }
    let p = structuredClone(profile);
    const get = (k) => String(f.get(k) || '').trim(),
      num = (k) => (get(k) === '' ? null : Number(get(k)));
    switch (form.dataset.form) {
      case 'preferences':
        p.preferences = {
          hourFormat: get('hourFormat'),
          sessionMinutes: Number(get('sessionMinutes')),
          transitionMinutes: Number(get('transitionMinutes')),
        };
        p.timezone = get('timezone');
        p.weekStartsOn = Number(get('weekStartsOn'));
        break;
      case 'new-area': {
        const a = createArea(get('name'));
        a.order = p.areas.length ? Math.max(...p.areas.map((v) => v.order || 0)) + 1 : 0;
        p.areas.push(a);
        break;
      }
      case 'area': {
        const index = p.areas.findIndex((a) => a.id === form.dataset.id);
        let a = p.areas[index];
        Object.assign(a, {
          name: get('name'),
          color: get('color'),
          icon: get('icon'),
          priority: Number(get('priority')),
          parentAreaId: get('parentAreaId') || null,
          projectIds: f.getAll('projectIds'),
          tagIds: f.getAll('tagIds'),
          workTime: f.has('workTime'),
          estimateMinutes: num('estimateMinutes'),
          plannedDate: get('plannedDate') || null,
          dueDate: get('dueDate') || null,
          startDate: get('startDate') || null,
          endDate: get('endDate') || null,
          allowedWeekdays: f.getAll('allowedWeekdays').map(Number),
          earliest: get('earliest') || null,
          latest: get('latest') || null,
        });
        a = setGoalsFrom(
          a,
          {
            dailyMinutes: num('dailyMinutes'),
            weeklyMinutes: num('weeklyMinutes'),
            targetHours: num('targetHours'),
          },
          get('applyFrom'),
        );
        a = setStateFrom(a, get('state'), get('applyFrom'));
        a = setCompletionFrom(a, get('status'), get('applyFrom'));
        p.areas[index] = a;
        break;
      }
      case 'event': {
        const c = {
          id: form.dataset.id || crypto.randomUUID(),
          title: get('title'),
          kind: get('kind'),
          areaId: get('areaId'),
          scope: get('scope'),
          sourceId: get('sourceId'),
          date: get('date'),
          startDate: get('startDate') || null,
          endDate: get('endDate') || null,
          start: get('start'),
          end: get('end'),
          allDay: f.has('allDay'),
          durationMinutes: num('durationMinutes'),
          weekdays: f.getAll('weekdays').map(Number),
          excludedDates: get('excludedDates')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        };
        const existing = p.commitments.find((v) => v.id === c.id);
        if (existing) {
          if (!existing.date && c.date && get('editScope') === 'future')
            throw Error(
              tr(
                'Para mover una ocurrencia a una fecha puntual elige «Solo una ocurrencia».',
              ),
            );
          p = editCommitment(p, c.id, c, {
            scope: get('editScope') || 'future',
            date: get('editDate'),
          });
        } else p.commitments.push(c);
        break;
      }
      case 'deadline': {
        const d = {
          id: form.dataset.id || crypto.randomUUID(),
          title: get('title'),
          date: get('date'),
          areaId: get('areaId'),
          hours: num('hours'),
          provisional: f.has('provisional'),
          completed: f.has('completed'),
        };
        p.deadlines = p.deadlines.filter((v) => v.id !== d.id);
        p.milestones = p.milestones.filter((v) => v.id !== d.id);
        p[get('type') === 'deadline' ? 'deadlines' : 'milestones'].push(d);
        break;
      }
      case 'exclusion':
        p.trainingExclusions.push({
          areaId: get('areaId'),
          start: get('start'),
          end: get('end'),
        });
        break;
      case 'completeness':
        for (const key of Object.keys(p.completeness)) p.completeness[key] = f.has(key);
        break;
    }
    await save(p, form);
  } catch (e) {
    if (e.code === 'STALE_DATA') showExternalConflict();
    else error(e.message);
  }
});
document.addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-action]');
  if (!b) return;
  try {
    const { action, id } = b.dataset;
    if (action === 'prepare-shared') {
      if (proposalBusy) return;
      if (guided.hasPending())
        throw Error(tr('Operación pendiente de confirmar. Consulta su recibo.'));
      proposalBusy = true;
      try {
        const week = days();
        const sharedProposal = await adapter.prepare({
          from: week[0],
          to: week[week.length - 1],
        });
        $('proposal-review').innerHTML = view`<a href="#proposal-adjust"
          >${tr('Revisar bloque propuesto')}</a
        >`;
        guided.showProposal(sharedProposal);
        $('proposal-review').querySelector('input,button')?.focus();
        return;
      } finally {
        proposalBusy = false;
      }
    }
    if (action === 'reload-settings') {
      await refresh();
      renderSettings();
      clearError();
      return;
    }
    if (action === 'task') {
      await adapter.selectTask(id);
      return;
    }
    if (action === 'demo') {
      await save(demoProfile());
      return;
    }
    if (action === 'export') {
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download = 'mi-planificacion-privado.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (action === 'edit-event' || action === 'cancel-event') {
      workspace.navigate('week', { focus: false });
      reviewedProposalContext = null;
      settingsDirty = true;
      $('event-editor').innerHTML = eventForm(
        profile,
        date(),
        action === 'edit-event' ? profile.commitments.find((c) => c.id === id) : {},
      );
      $('event-editor').closest('details').open = true;
      if (action === 'edit-event') rememberProfileEditor($('event-editor'));
      $('event-editor').querySelector('input:not([type=hidden])').focus();
      return;
    }
    if (action === 'review-proposal') {
      const p = proposals[Number(id)];
      if (!p?.interval) return;
      workspace.navigate('week', { focus: false });
      reviewedProposalContext = await contextRevision(profile, data);
      settingsDirty = true;
      const c = {
        title: p.title || p.area,
        kind: 'study',
        scope: p.scope || 'all',
        sourceId: p.sourceId || '',
        areaId: p.areaId || '',
        date: p.date || date(),
        start: wallClock(p.interval[0], profile.timezone),
        end: wallClock(p.interval[1], profile.timezone),
        weekdays: [],
        excludedDates: [],
      };
      $('event-editor').innerHTML = eventForm(profile, date(), c);
      rememberProfileEditor($('event-editor'));
      $('event-editor').closest('details').open = true;
      $('event-editor').querySelector('input:not([type=hidden])').focus();
      return;
    }
    if (action === 'edit-deadline') {
      workspace.navigate('week', { focus: false });
      const [type, key] = id.split(':');
      settingsDirty = true;
      $('deadline-editor').innerHTML = deadlineForm(
        profile,
        profile[type === 'deadline' ? 'deadlines' : 'milestones'].find(
          (v) => v.id === key,
        ),
        type,
      );
      $('deadline-editor').closest('details').open = true;
      rememberProfileEditor($('deadline-editor'));
      return;
    }
    let p = structuredClone(profile);
    if (action === 'skip-occurrence') {
      const form = b.closest('form');
      p = editCommitment(p, id, null, {
        scope: 'occurrence',
        date: form.elements.editDate.value,
      });
      await save(p);
      return;
    }
    if (action === 'area-up' || action === 'area-down') {
      const sorted = orderedAreas(p),
        index = sorted.findIndex((a) => a.id === id),
        other = index + (action === 'area-up' ? -1 : 1);
      if (other < 0 || other >= sorted.length) return;
      [sorted[index], sorted[other]] = [sorted[other], sorted[index]];
      sorted.forEach((a, i) => (a.order = i));
      await save(p);
      return;
    }
    if (action === 'remove-event') {
      const c = p.commitments.find((v) => v.id === id);
      if (c.date) {
        if (c.date >= date()) p.commitments = p.commitments.filter((v) => v.id !== id);
      } else if (c.startDate && c.startDate >= date())
        p.commitments = p.commitments.filter((v) => v.id !== id);
      else if (!c.endDate || c.endDate >= date()) c.endDate = addDays(date(), -1);
    }
    if (action === 'remove-exclusion') p.trainingExclusions.splice(Number(id), 1);
    if (action === 'remove-deadline') {
      const [type, key] = id.split(':');
      p[type === 'deadline' ? 'deadlines' : 'milestones'] = p[
        type === 'deadline' ? 'deadlines' : 'milestones'
      ].filter((v) => v.id !== key);
    }
    if (action.startsWith('remove-')) await save(p);
  } catch (e) {
    if (e.code === 'STALE_DATA') showExternalConflict();
    else error(e.message);
  }
});
document.addEventListener('change', async (event) => {
  if (event.target.name === 'allDay') {
    const form = event.target.form;
    form.elements.start.required = !event.target.checked;
    form.elements.end.required = !event.target.checked;
  }
  if (event.target.id !== 'profile-file') return;
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 500000) throw Error(tr('Perfil demasiado grande (máximo 500 kB).'));
    await save(migrateProfile(JSON.parse(await file.text())));
  } catch (e) {
    error(view`No se ha importado el perfil: ${e.message}`);
  }
});
document.addEventListener('input', (event) => {
  if (
    event.target.closest(
      '#settings-content form, #goals-management form, #calendar-management form',
    )
  )
    settingsDirty = true;
});
$('refresh').addEventListener('click', refresh);
$('day').addEventListener('change', () => {
  void workflow?.refresh().catch((failure) => {
    $('workflow-notice').textContent = failure.message;
  });
  clearError();
  try {
    renderData();
    if (!settingsDirty) renderSettings();
    else
      $('status').textContent = tr(
        'Fecha de consulta cambiada. Los formularios conservan su fecha de aplicación y cambios sin guardar.',
      );
  } catch (e) {
    if (e.code === 'STALE_DATA') showExternalConflict();
    else error(e.message);
  }
});
window.addEventListener('focus', () => {
  if (loaded) refresh();
});
function localizeStatic() {
  for (const node of document.querySelectorAll('[data-i18n]'))
    node.textContent = tr(node.dataset.i18n);
  document.title = tr('Mi planificación');
  workspace.render();
}
initializeI18n(window.PluginAPI, () => {
  localizeStatic();
  renderData();
  if (!settingsDirty) renderSettings();
})
  .then(() => {
    localizeStatic();
    return refresh();
  })
  .catch((e) => error(e.message));
// Reload profile changes even when the host cannot deliver plugin hooks.
setInterval(() => {
  if (loaded) void refresh({ externalOnly: true, nativeChanged: true });
}, 10000);
