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
import { areaMetrics, scheduledDay } from './metrics.mjs';
import { createAdapter } from './adapter.mjs';
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
  settingsDirty = false;
const date = () => $('day').value || localDay(Date.now(), profile?.timezone);
const minutes = (n) => (n === null ? 'No calculable' : `${Math.round(n)} min`);
const clock = (epoch) =>
  new Intl.DateTimeFormat('es-ES', {
    timeZone: profile?.timezone || 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
  }).format(epoch);
const span = (interval) => `${clock(interval[0])}–${clock(interval[1])}`;
const days = () => weekDays(date(), profile.weekStartsOn ?? 1);
$('day').value = localDay();
function error(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}
function clearError() {
  $('error').hidden = true;
}
function effectiveArea(a) {
  const included = [a],
    ids = new Set([a.id]);
  for (let i = 0; i < included.length; i++)
    for (const child of profile.areas.filter((v) => v.parentAreaId === included[i].id))
      if (!ids.has(child.id)) {
        included.push(child);
        ids.add(child.id);
      }
  return {
    ...a,
    projectIds: [...new Set(included.flatMap((v) => v.projectIds))],
    tagIds: [...new Set(included.flatMap((v) => v.tagIds))],
  };
}
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
  return `<article style="border-inline-start:4px solid ${a.color || '#3979b8'}"><h3>${escape(a.icon || '')} ${escape(a.name)}</h3><p>${minutes(logged)} registrados / ${minutes(target)} de objetivo diario</p>${logged !== null && target > 0 ? `<progress max="${target}" value="${Math.min(logged, target)}" aria-label="Progreso diario de ${escape(a.name)}"></progress>` : ''}<p>${!mapped(a) ? 'Asocia proyectos o etiquetas para atribuir registros.' : !data.civilDaysReliable ? 'El día lógico o zona del anfitrión impide certificar días civiles.' : logged === null ? 'Faltan subtareas o un desglose diario coherente.' : 'Cada fecha se evalúa por separado.'}</p></article>`;
}
function taskRows(tasks) {
  return !tasks.length
    ? '<p>No hay tareas previstas para esta fecha.</p>'
    : `<div class="scroll"><table><caption>Datos nativos: estimación, tiempo registrado y completitud separados</caption><thead><tr><th>Tarea</th><th>Estimación</th><th>Registrado total</th><th>Registrado en fecha</th><th>Estado</th></tr></thead><tbody>${tasks.map((t) => `<tr><td>${button('task', t.id, escape(t.title))}</td><td>${minutes((t.timeEstimate || 0) / 60000)}</td><td>${minutes((t.timeSpent || 0) / 60000)}</td><td>${data.civilDaysReliable ? minutes(t.timeSpentOnDay ? (t.timeSpentOnDay[date()] || 0) / 60000 : t.timeSpent ? null : 0) : 'No calculable'}</td><td>${t.isDone ? 'Completada' : 'Pendiente'}</td></tr>`).join('')}</tbody></table></div>`;
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
        `${escape(d.date)} · ${escape(d.title)}${d.native ? ' · Tarea planificada (no entrega confirmada)' : ''}${d.activity ? ' · Fecha límite de actividad' : ''}${d.provisional ? ' · Provisional' : ''}${d.date < date() ? ' · Fecha pasada; revisa sin borrar el dato' : ''}${d.hours != null ? ' · ' + d.hours + ' h de referencia, no sumadas al objetivo' : ''}`,
    ),
    'No hay entregas o hitos próximos.',
  );
}
function conflictList(c) {
  return list(
    [
      ...c.conflicts.map(
        (v) =>
          `${escape(v.a.title)} / ${escape(v.b.title)}: solapamiento ${minutes(v.minutes)}, ${span([v.from, v.to])}.`,
      ),
      ...c.transitions.map(
        (v) =>
          `${escape(v.a.title)} / ${escape(v.b.title)}: contiguos a las ${clock(v.at)}, sin solapamiento; revisa margen de transición.`,
      ),
      ...c.warnings.map(escape),
    ],
    'No se detectan conflictos en los compromisos configurados.',
  );
}
function renderToday() {
  const schedule = availability(profile, date()),
    tasks = data.leaves.filter((t) => !t.archived && scheduledDay(t, data) === date());
  const goals = orderedAreas(profile).filter(
    (a) => active(a) && areaGoalsOn(a, date()).dailyMinutes !== null,
  );
  $('today-content').innerHTML = `<h3>Compromisos de ${escape(date())}</h3>${list(
    schedule.events
      .filter((c) => !['available', 'flexible'].includes(c.kind))
      .map(
        (c) => `${span([c.from, c.to])} · ${escape(c.title)} · ${escape(KINDS[c.kind])}`,
      ),
    'No hay compromisos configurados para esta fecha.',
  )}<div class="grid">${goals.map(goalCard).join('')}</div>${!profile.areas.length ? '<p>Empieza creando una actividad en Configuración o carga una demostración ficticia.</p>' : ''}<h3>Tareas previstas</h3>${taskRows(tasks)}<h3>Entregas e hitos</h3>${deadlines()}<h3>Conflictos y transición</h3>${conflictList(schedule)}`;
}
function renderGoals() {
  $('goals-content').innerHTML =
    `<p>Objetivos según vigencia en ${escape(date())}. Las horas no acreditan cursos o exámenes superados. Las actividades pausadas/archivadas conservan registros históricos.</p><div class="grid">${orderedAreas(
      profile,
    )
      .map((a) => {
        const m = metric(a),
          g = areaGoalsOn(a, date()),
          state = areaStateOn(a, date());
        return `<article style="border-inline-start:4px solid ${a.color || '#3979b8'}"><h3>${escape(a.icon || '')} ${escape(a.name)}</h3><p>${escape(STATES[state] || 'Fuera de vigencia')} · Prioridad ${a.priority ?? 3}</p>${!mapped(a) ? '<p>Sin asociaciones: no se puede atribuir tiempo.</p>' : `<p>Registrado histórico devuelto: ${(m.totalMinutes / 60).toFixed(2)} h${m.incomplete ? ' (parcial)' : ''}.</p><p>Registrado esta semana: ${data.civilDaysReliable ? minutes(m.weeklyMinutes) : 'No calculable por día civil'} · Previsto esta semana: ${minutes(m.plannedMinutes)}.</p><p>${m.pending.length} tareas pendientes · ${m.completed} tareas completadas.</p>`}${g.targetHours !== null ? `<p>Objetivo ${g.targetHours} h · Pendiente según datos devueltos: ${mapped(a) ? Math.max(0, g.targetHours - m.totalMinutes / 60).toFixed(2) + ' h' : 'sin calcular'}.</p>` : ''}<p>${g.weeklyMinutes !== null ? 'Objetivo semanal editable: ' + minutes(g.weeklyMinutes) : 'Sin obligación semanal configurada.'}</p><p>Progreso manual: ${escape({ pending: 'Pendiente', 'in-progress': 'En curso', completed: 'Completado' }[areaCompletionOn(a, date())])}</p>${
          g.dailyMinutes !== null
            ? `<div class="scroll"><table><caption>Objetivo diario vigente: ${minutes(g.dailyMinutes)}</caption><thead><tr><th>Fecha</th><th>Registrado / objetivo vigente</th></tr></thead><tbody>${days()
                .map(
                  (d) =>
                    `<tr><td>${d}</td><td>${minutes(daily(a, d))} / ${minutes(areaGoalsOn(a, d).dailyMinutes)}</td></tr>`,
                )
                .join('')}</tbody></table></div>`
            : ''
        }<details><summary>Próximas tareas</summary>${list(
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
                `${escape(t.title)} · ${escape(scheduledDay(t, data) || 'sin fecha')} · estimación ${minutes((t.timeEstimate || 0) / 60000)}`,
            ),
          'No hay tareas pendientes asociadas.',
        )}</details></article>`;
      })
      .join(
        '',
      )}</div>${!profile.areas.length ? '<p>Sin actividades u objetivos configurados.</p>' : ''}`;
}
function proposalHTML(p, index) {
  return `${escape(p.title || p.area)}: ${p.interval ? span(p.interval) : 'sin hueco continuo suficiente'} (${minutes(p.minutes)}). ${escape(p.reason || 'Propuesta revisable; no cambia el calendario.')}${p.interval ? button('review-proposal', index, 'Revisar bloque propuesto') : ''}`;
}
function renderWeek() {
  const snapshot = { ...data, dailyForArea: (a, d) => daily(a, d) },
    rows = days().map((d) => ({ date: d, s: scenario(profile, snapshot, d) }));
  proposals = [];
  const detail = rows.map(({ date: d, s }) => {
    const html = s.proposals.map((p) => {
      const i = proposals.push({ ...p, date: p.date || d }) - 1;
      return proposalHTML(p, i);
    });
    return `<details ${d === date() ? 'open' : ''}><summary>${d}: conflictos, carga y propuestas</summary>${conflictList(s.capacity)}<p>Tareas con hora que coinciden con compromisos:</p>${list(
      s.affected.map((t) => escape(t.title)),
      'No se identifican coincidencias horarias.',
    )}<p>Tareas sin hora a revisar por trabajo extra:</p>${list(
      (s.potentiallyAffected || []).map((t) => escape(t.title)),
      'Sin tareas sin hora afectadas por trabajo extra.',
    )}<p>Propuestas revisables para objetivos y bloques flexibles:</p>${list(html, 'Sin propuestas diarias pendientes configuradas.')}</details>`;
  });
  const weekly = proposeActivitiesWeek(profile, snapshot, days());
  const weeklyHTML = weekly.map((p) => {
    const i = proposals.push(p) - 1;
    return `${escape(p.date || 'Esta semana')} · ${proposalHTML(p, i)}`;
  });
  $('week-content').innerHTML =
    `<p>Unión de intervalos ocupados; capacidad laboral y personal separadas. Las franjas disponibles delimitan huecos, las ausencias tienen ámbito y las actividades flexibles no ocupan hasta que guardes un bloque.</p><p class="notice warning">${Object.values(profile.completeness).some((v) => !v) ? 'Estimación parcial: faltan categorías de descanso, desplazamientos, comidas o márgenes por confirmar.' : 'Márgenes declarados configurados; revisa cobertura.'} Las propuestas usan solo datos conocidos y pueden incluir descanso aún no definido. Las tareas sin hora se comparan como carga diaria.</p><div class="scroll"><table><thead><tr><th>Fecha</th><th>Libre laboral</th><th>Libre personal</th><th>Carga adicional laboral / personal</th><th>Exceso laboral / personal</th></tr></thead><tbody>${rows.map(({ date: d, s }) => `<tr><th>${d}</th><td>${minutes(s.capacity.workMinutes)}</td><td>${minutes(s.capacity.personalMinutes)}${s.capacity.partial ? ' (parcial)' : ''}</td><td>${minutes(s.workLoad)} / ${minutes(s.personalLoad)}</td><td>${minutes(s.workExcess)} / ${minutes(s.personalExcess)}</td></tr>`).join('')}</tbody></table></div><h3>Actividades flexibles sin fecha prevista</h3>${list(weeklyHTML, 'Sin estimaciones flexibles pendientes. Crea una actividad con estimación y restricciones para buscarle hueco.')}<p>Revisar abre un formulario; solo Guardar reserva un bloque dentro de este plugin. No modifica automáticamente tareas ni calendario nativo.</p>${detail.join('')}`;
}
function renderWarnings() {
  const warnings = [...data.warnings];
  for (const a of profile.areas) {
    if (
      a.projectIds.some((id) => !data.projects.some((p) => p.id === id)) ||
      a.tagIds.some((id) => !data.tags.some((p) => p.id === id))
    )
      warnings.push(
        `${a.name}: asociación no disponible o borrada. Revisa Configuración.`,
      );
    if (
      active(a) &&
      a.workTime &&
      !profile.commitments.some((c) => c.kind === 'study' && c.areaId === a.id)
    )
      warnings.push(
        `${a.name}: distribución de formación o actividad laboral pendiente de configurar.`,
      );
  }
  const missing = Object.entries(profile.completeness)
    .filter(([, v]) => !v)
    .map(([k]) => KINDS[k]);
  if (missing.length)
    warnings.push(
      `Disponibilidad parcial. Falta configurar o confirmar: ${missing.join(', ')}.`,
    );
  const ambiguous = data.leaves.filter(
    (t) =>
      profile.areas.filter(
        (a) => !a.parentAreaId && mapped(a) && data.matches(t, effectiveArea(a)),
      ).length > 1,
  );
  if (ambiguous.length)
    warnings.push(
      `${ambiguous.length} tareas pertenecen a varias actividades. Sus métricas no se deben sumar entre sí.`,
    );
  $('warnings').innerHTML =
    `<details><summary>Avisos y datos pendientes (${warnings.length})</summary>${list(warnings.map(escape), 'Sin avisos.')}</details>`;
}
function renderData() {
  if (!profile || !data) return;
  $('context').textContent =
    `${profile.timezone} · Semana desde ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][profile.weekStartsOn ?? 1]} · Datos nativos de Super Productivity`;
  renderWarnings();
  renderToday();
  renderGoals();
  renderWeek();
}
function renderSettings() {
  $('settings-content').innerHTML = settingsHTML(profile, data, date());
  settingsDirty = false;
}
function refreshAssociations() {
  for (const [name, items] of [
    ['projectIds', data.projects],
    ['tagIds', data.tags],
  ])
    for (const select of document.querySelectorAll(
      `form[data-form="area"] select[name="${name}"]`,
    )) {
      const selected = [...select.selectedOptions].map((v) => v.value);
      select.innerHTML =
        items
          .map((item) => option(item.id, item.title, selected.includes(item.id)))
          .join('') +
        selected
          .filter((id) => !items.some((item) => item.id === id))
          .map((id) => option(id, `No disponible (${id})`, true))
          .join('');
    }
}
async function save(candidate, form) {
  if (busy) throw Error('Hay una operación en curso. Reintenta cuando termine.');
  busy = true;
  clearError();
  $('status').textContent = 'Guardando configuración…';
  const buttons = [...(form?.querySelectorAll('button') || [])];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const changed =
      profile?.timezone !== candidate.timezone ||
      profile?.weekStartsOn !== candidate.weekStartsOn;
    await adapter.save(candidate);
    profile = candidate;
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
    renderSettings();
    $('status').textContent = 'Configuración guardada.';
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  clearError();
  $('refresh').disabled = true;
  $('status').textContent = 'Cargando datos…';
  try {
    adapter ??= createAdapter(window.PluginAPI);
    if (!loaded) {
      profile = await adapter.load();
      $('day').value = localDay(Date.now(), profile.timezone);
    }
    data = await adapter.snapshot(profile.timezone, profile.weekStartsOn);
    renderData();
    if (!loaded) {
      renderSettings();
      loaded = true;
    } else refreshAssociations();
    $('status').textContent =
      `Datos actualizados a las ${clock(Date.now())}. ${data.leaves.length} tareas sin doble suma de padres.`;
  } catch (e) {
    error(e.message);
    $('status').textContent =
      'No se pudo actualizar. Reintenta; no se ha reemplazado el perfil.';
  } finally {
    busy = false;
    $('refresh').disabled = false;
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  try {
    const f = new FormData(form);
    let p = structuredClone(profile);
    const get = (k) => String(f.get(k) || '').trim(),
      num = (k) => (get(k) === '' ? null : Number(get(k)));
    switch (form.dataset.form) {
      case 'preferences':
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
              'Para mover una ocurrencia a una fecha puntual elige «Solo una ocurrencia».',
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
    error(e.message);
  }
});
document.addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-action]');
  if (!b) return;
  try {
    const { action, id } = b.dataset;
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
      $('event-editor').innerHTML = eventForm(
        profile,
        date(),
        action === 'edit-event' ? profile.commitments.find((c) => c.id === id) : {},
      );
      $('event-editor').querySelector('input:not([type=hidden])').focus();
      return;
    }
    if (action === 'review-proposal') {
      const p = proposals[Number(id)];
      if (!p?.interval) return;
      const c = {
        title: p.title || p.area,
        kind: 'study',
        scope: p.scope || 'all',
        sourceId: p.sourceId || '',
        areaId: p.areaId || '',
        date: p.date || date(),
        start: clock(p.interval[0]),
        end: clock(p.interval[1]),
        weekdays: [],
        excludedDates: [],
      };
      $('event-editor').innerHTML = eventForm(profile, date(), c);
      $('event-editor').closest('details').open = true;
      $('event-editor').querySelector('input:not([type=hidden])').focus();
      return;
    }
    if (action === 'edit-deadline') {
      const [type, key] = id.split(':');
      $('deadline-editor').innerHTML = deadlineForm(
        profile,
        profile[type === 'deadline' ? 'deadlines' : 'milestones'].find(
          (v) => v.id === key,
        ),
        type,
      );
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
    if (action === 'remove-event')
      p.commitments = p.commitments.filter((v) => v.id !== id);
    if (action === 'remove-exclusion') p.trainingExclusions.splice(Number(id), 1);
    if (action === 'remove-deadline') {
      const [type, key] = id.split(':');
      p[type === 'deadline' ? 'deadlines' : 'milestones'] = p[
        type === 'deadline' ? 'deadlines' : 'milestones'
      ].filter((v) => v.id !== key);
    }
    if (action.startsWith('remove-')) await save(p);
  } catch (e) {
    error(e.message);
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
    if (file.size > 500000) throw Error('Perfil demasiado grande (máximo 500 kB).');
    await save(migrateProfile(JSON.parse(await file.text())));
  } catch (e) {
    error(`No se ha importado el perfil: ${e.message}`);
  }
});
document.addEventListener('input', (event) => {
  if (event.target.closest('form')) settingsDirty = true;
});
$('refresh').addEventListener('click', refresh);
$('day').addEventListener('change', () => {
  clearError();
  try {
    renderData();
    if (!settingsDirty) renderSettings();
    else
      $('status').textContent =
        'Fecha de consulta cambiada. Los formularios conservan su fecha de aplicación y cambios sin guardar.';
  } catch (e) {
    error(e.message);
  }
});
window.addEventListener('focus', () => {
  if (loaded) refresh();
});
refresh();
