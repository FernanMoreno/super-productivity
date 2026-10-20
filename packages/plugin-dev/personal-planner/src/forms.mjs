import {
  KINDS,
  STATES,
  SCOPES,
  orderedAreas,
  areaGoalsOn,
  areaStateOn,
  areaCompletionOn,
} from './model.mjs';
export const escape = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const list = (items, empty) =>
  items.length
    ? `<ul>${items.map((s) => `<li>${s}</li>`).join('')}</ul>`
    : `<p>${empty}</p>`;
export const option = (value, label, selected = false) =>
  `<option value="${escape(value)}" ${selected ? 'selected' : ''}>${escape(label)}</option>`;
export const input = (label, name, type, value, attrs = '') =>
  `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${attrs}></label>`;
export const button = (action, id, label) =>
  `<button type="button" data-action="${action}" data-id="${escape(id)}">${label}</button>`;
const areaOptions = (p, current = '', exclude = '') =>
  option('', 'Sin actividad', !current) +
  orderedAreas(p)
    .filter((a) => a.id !== exclude)
    .map((a) => option(a.id, a.name, current === a.id))
    .join('');
const weekdayNames = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];
const weekdays = (name, selected) =>
  `<div class="row">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="${name}" value="${d}" ${selected?.includes(d) ? 'checked' : ''}> ${weekdayNames[d]}</label>`).join('')}</div>`;
export function areaForm(a, profile, data, date) {
  const select = (name, label, items, ids) =>
    `<label>${label}<select multiple name="${name}">${items.map((p) => option(p.id, p.title, ids.includes(p.id))).join('')}${ids
      .filter((id) => !items.some((p) => p.id === id))
      .map((id) => option(id, `No disponible (${id})`, true))
      .join('')}</select></label>`;
  const goals = areaGoalsOn(a, date),
    state = areaStateOn(a, date);
  return `<form data-form="area" data-id="${escape(a.id)}"><fieldset style="border-inline-start:4px solid ${a.color || '#3979b8'}"><legend>${escape(a.icon || '')} ${escape(a.name)}</legend>${input('Nombre', 'name', 'text', a.name, 'required maxlength="150"')}<div class="row">${button('area-up', a.id, 'Subir')}${button('area-down', a.id, 'Bajar')}</div><div class="grid">${input('Color de presentación', 'color', 'color', a.color || '#3979b8')}${input('Icono o texto corto', 'icon', 'text', a.icon, 'maxlength="16"')}${input('Prioridad (1 alta, 5 baja)', 'priority', 'number', a.priority ?? 3, 'min="1" max="5" step="1" required')}<label>Actividad superior<select name="parentAreaId">${areaOptions(profile, a.parentAreaId, a.id)}</select></label><label>Estado<select name="state">${Object.entries(
    STATES,
  )
    .map(([v, n]) => option(v, n, (state === 'inactive' ? a.state : state) === v))
    .join('')}</select></label><label>Progreso manual<select name="status">${[
    ['pending', 'Pendiente'],
    ['in-progress', 'En curso'],
    ['completed', 'Completado'],
  ]
    .map(([v, n]) => option(v, n, areaCompletionOn(a, date) === v))
    .join(
      '',
    )}</select></label></div><p>Los estados pausado/archivado conservan el historial y dejan de generar nueva demanda. El progreso completado también detiene nuevas propuestas.</p>${select('projectIds', 'Proyectos existentes', data.projects, a.projectIds)}${select('tagIds', 'Etiquetas existentes', data.tags, a.tagIds)}<div class="grid">${input('Objetivo diario (minutos)', 'dailyMinutes', 'number', goals.dailyMinutes, 'min="0" max="1440" step="1"')}${input('Objetivo total (horas)', 'targetHours', 'number', goals.targetHours, 'min="0" max="100000" step="0.25"')}${input('Objetivo semanal (minutos)', 'weeklyMinutes', 'number', goals.weeklyMinutes, 'min="0" max="10080" step="1"')}${input('Aplicar objetivos y estado desde', 'applyFrom', 'date', date, 'required')}</div><p>Una nueva vigencia conserva los objetivos y estados anteriores. Deja un objetivo vacío para no fijar obligación.</p><label><input type="checkbox" name="workTime" ${a.workTime ? 'checked' : ''}> Usa capacidad laboral</label><div class="grid">${input('Estimación para una próxima reserva flexible (minutos)', 'estimateMinutes', 'number', a.estimateMinutes, 'min="0" max="10080" step="1"')}${input('Fecha prevista para esa reserva (opcional)', 'plannedDate', 'date', a.plannedDate)}${input('Fecha límite de la actividad (opcional)', 'dueDate', 'date', a.dueDate)}${input('Inicio de actividad (opcional)', 'startDate', 'date', a.startDate)}${input('Final de actividad incluido (opcional)', 'endDate', 'date', a.endDate)}</div><fieldset><legend>Días permitidos para propuestas</legend>${weekdays('allowedWeekdays', a.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6])}</fieldset><div class="grid">${input('No proponer antes de (opcional)', 'earliest', 'time', a.earliest)}${input('No proponer después de (opcional)', 'latest', 'time', a.latest)}</div><p>La estimación flexible no crea tareas ni registros duplicados. Si ya hay tareas pendientes asociadas, se usa su planificación nativa.</p><button>Guardar ${escape(a.name)}</button></fieldset></form>`;
}
export function eventForm(profile, date, c = {}) {
  return `<form data-form="event" data-id="${escape(c.id || '')}"><input type="hidden" name="sourceId" value="${escape(c.sourceId || '')}"><h3>${c.id ? 'Editar bloque' : 'Añadir compromiso, disponibilidad o actividad flexible'}</h3>${input('Título', 'title', 'text', c.title, 'required maxlength="150"')}<div class="grid"><label>Tipo<select name="kind">${Object.entries(
    KINDS,
  )
    .map(([v, n]) => option(v, n, c.kind === v))
    .join(
      '',
    )}</select></label><label>Actividad<select name="areaId">${areaOptions(profile, c.areaId)}</select></label><label>Ámbito<select name="scope">${Object.entries(
    SCOPES,
  )
    .map(([v, n]) => option(v, n, (c.scope || 'all') === v))
    .join(
      '',
    )}</select></label>${input('Fecha puntual (vacía para recurrencia)', 'date', 'date', c.date)}${input('Inicio de vigencia incluido (opcional)', 'startDate', 'date', c.startDate)}${input('Final de vigencia incluido (opcional)', 'endDate', 'date', c.endDate)}</div><label><input type="checkbox" name="allDay" ${c.allDay ? 'checked' : ''}> Día completo (para vacaciones o ausencias sin horario)</label><div class="grid">${input('Hora de inicio / principio de ventana flexible', 'start', 'time', c.start, c.allDay ? '' : 'required')}${input('Hora de fin / final de ventana flexible', 'end', 'time', c.end, c.allDay ? '' : 'required')}${input('Duración necesaria, solo tipo flexible (minutos)', 'durationMinutes', 'number', c.durationMinutes, 'min="1" max="1440" step="1"')}</div><fieldset><legend>Días de recurrencia</legend>${weekdays('weekdays', c.weekdays)}</fieldset><p>Los bloques nocturnos terminan al día siguiente. Una ausencia laboral suspende la jornada; una ausencia en ambos ámbitos bloquea también tiempo personal. Una franja disponible delimita capacidad y no ocupa tiempo.</p><label>Excepciones: fechas excluidas, separadas por coma<input name="excludedDates" value="${escape(c.excludedDates?.join(', ') || '')}" placeholder="AAAA-MM-DD, AAAA-MM-DD"></label>${c.id && !c.date ? `<fieldset><legend>Alcance de la edición</legend><label>Qué cambiar<select name="editScope">${option('future', 'Esta y futuras desde una fecha', true)}${option('occurrence', 'Solo una ocurrencia')}</select></label>${input('Fecha original de ocurrencia o corte de futuras', 'editDate', 'date', date, 'required')}<p>Una ocurrencia se excluye de su serie y se crea un reemplazo puntual. Cambiar futuras cierra la serie anterior el día previo; no cambia el pasado.</p>${button('skip-occurrence', c.id, 'Omitir solo esta ocurrencia')}</fieldset>` : ''}<button>Guardar bloque</button>${c.id ? button('cancel-event', '', 'Cancelar edición') : ''}</form>`;
}
export function deadlineForm(profile, d = {}, type = 'deadline') {
  return `<form data-form="deadline" data-id="${escape(d.id || '')}"><h3>${d.id ? 'Editar' : 'Añadir'} entrega o hito</h3><label>Tipo<select name="type">${option('deadline', 'Entrega', type === 'deadline')}${option('milestone', 'Hito / examen / preparación', type === 'milestone')}</select></label>${input('Título', 'title', 'text', d.title, 'required maxlength="150"')}${input('Fecha', 'date', 'date', d.date, 'required')}<label>Actividad<select name="areaId">${areaOptions(profile, d.areaId)}</select></label>${input('Horas de referencia (no se suman al objetivo)', 'hours', 'number', d.hours, 'min="0" max="100000" step="0.25"')}<label><input name="provisional" type="checkbox" ${d.provisional ? 'checked' : ''}> Fecha provisional</label><label><input name="completed" type="checkbox" ${d.completed ? 'checked' : ''}> Completada manualmente</label><button>Guardar entrega o hito</button></form>`;
}
export function settingsHTML(profile, data, date) {
  return `<p>Configuración del usuario, separada del código. Guardarla puede incluirla en sincronización y copias de la aplicación. Importar reemplaza este perfil, no las tareas nativas; exporta antes una copia.</p><div class="row"><label>Importar perfil JSON <input id="profile-file" type="file" accept="application/json,.json"></label>${button('export', '', 'Exportar perfil privado')}${!profile.areas.length && !profile.commitments.length ? button('demo', '', 'Cargar demostración ficticia') : ''}</div><form data-form="preferences"><fieldset><legend>Calendario</legend>${input('Zona horaria IANA', 'timezone', 'text', profile.timezone, 'required placeholder="Europe/Madrid"')}<label>Primer día de semana<select name="weekStartsOn">${weekdayNames.map((n, i) => option(i, n, (profile.weekStartsOn ?? 1) === i)).join('')}</select></label><button>Guardar calendario</button></fieldset></form><form data-form="new-area"><h3>Crear actividad o área</h3>${input('Nombre de la nueva actividad', 'name', 'text', '', 'required maxlength="150"')}<button>Crear actividad</button></form><details><summary>Actividades, objetivos y organización</summary><p>Los nombres son libres; los identificadores permanecen estables. Ctrl/Cmd permite seleccionar varias asociaciones.</p><div class="grid">${orderedAreas(
    profile,
  )
    .map((a) => areaForm(a, profile, data, date))
    .join(
      '',
    )}</div>${!profile.areas.length ? '<p>Sin actividades. Crea la primera o carga la demostración opcional.</p>' : ''}</details><details><summary>Compromisos, disponibilidad y recurrencias</summary><div id="event-editor">${eventForm(profile, date)}</div>${list(
    profile.commitments.map(
      (c) =>
        `${escape(c.title)} · ${escape(c.date || c.weekdays.map((v) => weekdayNames[v]).join(', '))} · ${c.allDay ? 'Día completo' : escape(c.start) + '–' + escape(c.end)} · ${escape(KINDS[c.kind])}${c.startDate ? ' · Desde ' + c.startDate : ''}${c.endDate ? ' · Hasta ' + c.endDate : ''} ${button('edit-event', c.id, 'Editar')} ${button('remove-event', c.id, 'Quitar bloque o serie completa')}`,
    ),
    'Sin compromisos configurados.',
  )}</details><details><summary>Entregas e hitos</summary><div id="deadline-editor">${deadlineForm(profile)}</div>${list(
    [
      ...profile.deadlines.map((d) => ({ ...d, type: 'deadline' })),
      ...profile.milestones.map((d) => ({ ...d, type: 'milestone' })),
    ].map(
      (d) =>
        `${escape(d.title)} · ${d.date}${d.provisional ? ' · Provisional' : ''}${d.completed ? ' · Completada' : ''} ${button('edit-deadline', d.type + ':' + d.id, 'Editar')} ${button('remove-deadline', d.type + ':' + d.id, 'Quitar')}`,
    ),
    'Sin entregas ni hitos configurados.',
  )}</details><details><summary>Fechas sin bloques de una actividad</summary><form data-form="exclusion"><label>Actividad<select name="areaId" required>${areaOptions(profile)}</select></label>${input('Desde', 'start', 'date', '', 'required')}${input('Hasta incluido', 'end', 'date', '', 'required')}<button>Añadir exclusión</button></form>${list(
    profile.trainingExclusions.map(
      (e, i) =>
        `${escape(profile.areas.find((a) => a.id === e.areaId)?.name)} · ${e.start} a ${e.end} ${button('remove-exclusion', i, 'Quitar')}`,
    ),
    'Sin exclusiones.',
  )}</details><form data-form="completeness"><fieldset><legend>Confirmación de márgenes</legend><p>Añade bloques para cubrir cada categoría o declara que no aplica. Mientras falten categorías, la estimación de disponibilidad es parcial.</p>${Object.entries(
    profile.completeness,
  )
    .map(
      ([key, value]) =>
        `<label><input type="checkbox" name="${key}" ${value ? 'checked' : ''}> ${escape(KINDS[key])} configurado o no aplicable</label>`,
    )
    .join('')}<button>Guardar confirmación</button></fieldset></form>`;
}
