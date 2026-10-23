import {
  emptyProfile,
  migrateProfile,
  validateProfile,
  createArea,
  setGoalsFrom,
  setStateFrom,
  setCompletionFrom,
  editCommitment,
  areaGoalsOn,
  validDate,
} from './model.mjs';
import {
  addDays,
  scenario,
  proposeActivitiesWeek,
  localDay,
  instant,
} from './schedule.mjs';
import { areaMetrics, effectiveArea } from './metrics.mjs';
import { proposeNativeTasks } from './native-proposals.mjs';
export const PROFILE_KEY = 'profile-v1';
export class PlannerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const rejected = (code, message) => ({ status: 'rejected', code, message });
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ensure = (condition, message) => {
  if (!condition) throw new PlannerError('INVALID_ARGUMENTS', message);
};
const journalActions = new Set(['edit', 'task', 'log_time', 'apply']);
const resultStates = new Set(['applied', 'rejected', 'conflict', 'uncertain']);
const validOperationId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
const readReceipt = (raw) => {
  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch {
    throw new PlannerError(
      'DATA_CORRUPT',
      'El recibo de la operación no se puede leer. No se reejecuta.',
    );
  }
  if (
    !record(receipt) ||
    !journalActions.has(receipt.action) ||
    typeof receipt.signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.signature) ||
    (Object.hasOwn(receipt, 'result')
      ? !record(receipt.result) || !resultStates.has(receipt.result.status)
      : receipt.status !== 'pending' || !Number.isFinite(receipt.createdAt))
  )
    throw new PlannerError(
      'DATA_CORRUPT',
      'El recibo de la operación no es válido. No se reejecuta.',
    );
  return receipt;
};
// Status queries expose only stable outcome fields, never original arguments,
// error messages, profile contents or native task payloads stored in a receipt.
const receiptResult = (value) => {
  const result = { status: value.status };
  const patterns = {
    code: /^[A-Z][A-Z0-9_]{0,79}$/,
    taskId: /^[A-Za-z0-9_-]{1,200}$/,
    revision: /^[a-f0-9]{64}$/,
  };
  for (const [key, pattern] of Object.entries(patterns))
    if (typeof value[key] === 'string' && pattern.test(value[key]))
      result[key] = value[key];
  if (validDate(value.date)) result.date = value.date;
  if (Number.isSafeInteger(value.durationMs) && value.durationMs > 0)
    result.durationMs = value.durationMs;
  for (const key of ['commitmentIds', 'taskIds'])
    if (
      Array.isArray(value[key]) &&
      value[key].every(
        (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id),
      )
    )
      result[key] = [...value[key]];
  return result;
};
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function revision(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function contextRevision(profile, snapshot) {
  const fields = [
    'id',
    'title',
    'isDone',
    'archived',
    'parentId',
    'subTaskIds',
    'projectId',
    'tagIds',
    'timeEstimate',
    'timeSpent',
    'timeSpentOnDay',
    'dueDay',
    'dueWithTime',
    'remindAt',
    'deadlineDay',
    'deadlineWithTime',
  ];
  return revision({
    profile,
    civilDaysReliable: snapshot.civilDaysReliable,
    tasks: [...snapshot.byId.values()]
      .map((t) => Object.fromEntries(fields.map((k) => [k, t[k]])))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function range(from, to) {
  ensure(validDate(from) && validDate(to) && from <= to, 'Intervalo de fechas inválido.');
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    ensure(days.length <= 93, 'Máximo 93 días por consulta.');
  }
  return days;
}
const areaById = (profile, id) => {
  const area = profile.areas.find((v) => v.id === id);
  ensure(area, 'Actividad no encontrada.');
  return area;
};
const allowedUpdates = [
  'name',
  'color',
  'icon',
  'priority',
  'parentAreaId',
  'projectIds',
  'tagIds',
  'workTime',
  'estimateMinutes',
  'plannedDate',
  'dueDate',
  'startDate',
  'endDate',
  'allowedWeekdays',
  'earliest',
  'latest',
  'order',
];
export function applyCommand(profile, command) {
  ensure(
    record(command) && typeof command.type === 'string' && record(command.payload),
    'Operación inválida.',
  );
  let p = structuredClone(profile);
  const v = command.payload;
  switch (command.type) {
    case 'profile.replace':
      p = migrateProfile(v);
      break;
    case 'activity.create': {
      ensure(typeof v.name === 'string', 'Falta nombre.');
      const a = createArea(v.name, v.id || crypto.randomUUID());
      ensure(!p.areas.some((x) => x.id === a.id), 'Identificador existente.');
      Object.assign(a, { order: p.areas.length });
      p.areas.push(a);
      break;
    }
    case 'activity.update': {
      ensure(record(v.updates), 'Faltan campos.');
      ensure(
        Object.keys(v.updates).every((k) => allowedUpdates.includes(k)),
        'Campo no editable; objetivos y estados requieren fecha efectiva.',
      );
      Object.assign(areaById(p, v.id), v.updates);
      break;
    }
    case 'activity.goals':
    case 'activity.state':
    case 'activity.completion': {
      ensure(validDate(v.from), 'Falta fecha efectiva válida.');
      const a = areaById(p, v.id);
      const i = p.areas.indexOf(a);
      p.areas[i] =
        command.type === 'activity.goals'
          ? setGoalsFrom(a, v.goals, v.from)
          : command.type === 'activity.state'
            ? setStateFrom(a, v.state, v.from)
            : setCompletionFrom(a, v.status, v.from);
      break;
    }
    case 'activity.reorder': {
      ensure(
        Array.isArray(v.ids) &&
          v.ids.length === p.areas.length &&
          new Set(v.ids).size === v.ids.length,
        'Orden inválido.',
      );
      v.ids.forEach((id, i) => {
        areaById(p, id).order = i;
      });
      break;
    }
    case 'commitment.create': {
      ensure(record(v.commitment), 'Falta compromiso.');
      const c = { ...v.commitment, id: v.commitment.id || crypto.randomUUID() };
      ensure(!p.commitments.some((x) => x.id === c.id), 'Identificador existente.');
      p.commitments.push(c);
      break;
    }
    case 'commitment.edit':
      ensure(
        validDate(v.date) && ['future', 'occurrence'].includes(v.scope),
        'Indica fecha y alcance de edición.',
      );
      p = editCommitment(p, v.id, v.updates, { date: v.date, scope: v.scope });
      break;
    case 'commitment.skip': {
      const c = p.commitments.find((x) => x.id === v.id);
      ensure(c && validDate(v.date), 'Ocurrencia no válida.');
      c.excludedDates = [...new Set([...(c.excludedDates || []), v.date])];
      break;
    }
    case 'commitment.remove': {
      ensure(validDate(v.from), 'Eliminar requiere fecha efectiva.');
      const c = p.commitments.find((x) => x.id === v.id);
      ensure(c, 'Compromiso no encontrado.');
      if (c.date) {
        if (c.date >= v.from) p.commitments = p.commitments.filter((x) => x.id !== c.id);
      } else if (c.startDate && c.startDate >= v.from) {
        p.commitments = p.commitments.filter((x) => x.id !== c.id);
      } else {
        const end = addDays(v.from, -1);
        c.endDate = c.endDate && c.endDate < end ? c.endDate : end;
      }
      break;
    }
    case 'deadline.upsert': {
      ensure(
        ['deadlines', 'milestones'].includes(v.collection) && record(v.value),
        'Entrega inválida.',
      );
      p[v.collection] = p[v.collection].filter((x) => x.id !== v.value.id);
      p[v.collection].push({ ...v.value, id: v.value.id || crypto.randomUUID() });
      break;
    }
    case 'deadline.remove':
      ensure(['deadlines', 'milestones'].includes(v.collection), 'Colección inválida.');
      p[v.collection] = p[v.collection].filter((x) => x.id !== v.id);
      break;
    case 'exclusion.upsert':
      ensure(record(v.value), 'Excepción inválida.');
      p.trainingExclusions.push(v.value);
      break;
    case 'exclusion.remove':
      ensure(Number.isInteger(v.index), 'Índice inválido.');
      p.trainingExclusions.splice(v.index, 1);
      break;
    case 'preferences.update':
      ensure(
        Object.keys(v).every((k) => ['timezone', 'weekStartsOn'].includes(k)),
        'Ajuste desconocido.',
      );
      Object.assign(p, v);
      break;
    case 'completeness.update':
      ensure(
        Object.keys(v).every((k) => k in p.completeness),
        'Ajuste desconocido.',
      );
      Object.assign(p.completeness, v);
      break;
    default:
      throw new PlannerError('INVALID_ARGUMENTS', 'Operación no soportada.');
  }
  validateProfile(p);
  return p;
}
const taskView = (t) =>
  Object.fromEntries(
    [
      'id',
      'title',
      'isDone',
      'projectId',
      'tagIds',
      'parentId',
      'subTaskIds',
      'timeEstimate',
      'timeSpent',
      'timeSpentOnDay',
      'dueDay',
      'dueWithTime',
      'archived',
    ]
      .filter((k) => t[k] !== undefined)
      .map((k) => [k, t[k]]),
  );
export function createPlannerOperations(ports) {
  const proposals = new Map();
  const load = async () => {
    const raw = await ports.read(PROFILE_KEY);
    const profile = raw === null ? emptyProfile() : migrateProfile(JSON.parse(raw));
    return { raw, profile, revision: await revision(raw) };
  };
  const authorize = async (action) => {
    await ports.authorize?.(action);
  };
  const journal = async (action, args, work) => {
    const operationId = args.operationId;
    ensure(
      validOperationId(operationId),
      'operationId debe tener 8–80 caracteres alfanuméricos, guiones o guiones bajos.',
    );
    const key = 'op-' + operationId,
      signature = await revision({ action, args });
    await authorize(action);
    const raw = await ports.read(key);
    await authorize(action);
    if (raw !== null) {
      const prior = readReceipt(raw);
      if (prior.signature !== signature)
        return rejected(
          'OPERATION_ID_REUSED',
          'Este operationId ya se utilizó con otros parámetros.',
        );
      return prior.result
        ? { ...prior.result, replayed: true }
        : {
            status: 'uncertain',
            code: 'OUTCOME_UNKNOWN',
            operationId,
            message:
              'Operación pendiente de confirmación. No se reejecuta; consulta los datos en la aplicación.',
          };
    }
    await authorize(action);
    const pending = JSON.stringify({
      signature,
      action,
      status: 'pending',
      createdAt: Date.now(),
    });
    let reserved = false;
    try {
      reserved = await ports.cas(key, null, pending);
      if (!reserved) return journal(action, args, work);
      await authorize(action);
      const result = await work();
      const finished = JSON.stringify({ signature, action, result });
      if (!(await ports.cas(key, pending, finished)))
        return { status: 'uncertain', code: 'OUTCOME_UNKNOWN', operationId };
      return { ...result, operationId };
    } catch (error) {
      const result =
        error instanceof PlannerError
          ? rejected(error.code, error.message)
          : {
              status: 'uncertain',
              code: 'OUTCOME_UNKNOWN',
              message: 'No hay confirmación durable. No se reintenta automáticamente.',
            };
      if (reserved && result.status === 'rejected') {
        try {
          await ports.cas(key, pending, JSON.stringify({ signature, action, result }));
        } catch {
          /* pending prevents duplicate retries */
        }
      }
      return { ...result, operationId };
    }
  };
  const commit = async (current, candidate, action, guard) => {
    try {
      validateProfile(candidate);
    } catch (error) {
      throw new PlannerError('INVALID_ARGUMENTS', error.message);
    }
    await authorize(action);
    if (
      !(await ports.cas(
        PROFILE_KEY,
        current.raw,
        JSON.stringify(candidate),
        guard,
        action,
      ))
    )
      return {
        status: 'conflict',
        code: 'STALE_DATA',
        message: 'La configuración cambió. Actualiza antes de guardar.',
      };
    return { status: 'applied', revision: await revision(JSON.stringify(candidate)) };
  };
  const api = {
    async operationStatus({ action, operationId }) {
      ensure(
        journalActions.has(action) && validOperationId(operationId),
        'Acción u operationId inválidos.',
      );
      await authorize(action);
      const raw = await ports.read('op-' + operationId);
      // A permission revoked while storage was being read must not expose a receipt.
      await authorize(action);
      if (raw === null)
        return {
          action,
          operationId,
          status: 'not_found',
          receiptState: 'missing',
          retrySafe: false,
        };
      const receipt = readReceipt(raw);
      if (receipt.action !== action)
        return {
          action,
          operationId,
          ...rejected(
            'OPERATION_ACTION_MISMATCH',
            'Este identificador no corresponde a la acción solicitada.',
          ),
        };
      if (!Object.hasOwn(receipt, 'result'))
        return {
          action,
          operationId,
          status: 'uncertain',
          code: 'OUTCOME_UNKNOWN',
          receiptState: 'pending',
          retrySafe: false,
        };
      const result = receiptResult(receipt.result);
      return {
        action,
        operationId,
        status: result.status,
        ...(result.code ? { code: result.code } : {}),
        receiptState: 'finished',
        result,
      };
    },
    async activities() {
      const { profile, revision } = await load();
      return { profile, revision };
    },
    async edit(args) {
      return journal('edit', args, async () => {
        const current = await load();
        if (args.baseRevision !== current.revision)
          return { status: 'conflict', code: 'STALE_DATA', revision: current.revision };
        let candidate;
        try {
          candidate = applyCommand(current.profile, args.command);
        } catch (error) {
          throw new PlannerError('INVALID_ARGUMENTS', error.message);
        }
        return commit(current, candidate, 'edit');
      });
    },
    async task(args) {
      return journal('task', args, async () =>
        ports.native('task', args, (await load()).profile),
      );
    },
    async logTime(args) {
      return journal('log_time', args, async () => {
        const current = await load(),
          snapshot = await ports.snapshot(current.profile);
        if ((await ports.read(PROFILE_KEY)) !== current.raw)
          throw new PlannerError(
            'STALE_DATA',
            'La configuración cambió antes de registrar tiempo.',
          );
        ensure(
          typeof snapshot.assertCurrent === 'function',
          'El host no permite comprobar cambios antes de registrar tiempo.',
        );
        return ports.native(
          'log_time',
          { ...args, assertCurrent: snapshot.assertCurrent },
          current.profile,
        );
      });
    },
    async query({ from, to }) {
      const dates = range(from, to),
        current = await load(),
        p = current.profile,
        s = await ports.snapshot(p);
      return {
        revision: current.revision,
        timezone: p.timezone,
        weekStartsOn: p.weekStartsOn,
        warnings: s.warnings,
        days: dates.map((day) => {
          const plan = scenario(p, s, day);
          return {
            date: day,
            capacity: plan.capacity,
            workLoad: plan.workLoad,
            personalLoad: plan.personalLoad,
            workExcess: plan.workExcess,
            personalExcess: plan.personalExcess,
            affected: plan.affected.map(taskView),
            potentiallyAffected: plan.potentiallyAffected.map(taskView),
            tasks: s.leaves.filter((t) => s.plannedDay(t) === day).map(taskView),
            progress: p.areas.map((a) => {
              const area = effectiveArea(p, a),
                mapped = area.projectIds.length + area.tagIds.length > 0,
                m = areaMetrics(s, area, day);
              return {
                activityId: a.id,
                name: a.name,
                goals: areaGoalsOn(a, day),
                totalMinutes: mapped ? m.totalMinutes : null,
                dailyMinutes:
                  !mapped || s.civilDaysReliable === false ? null : m.dailyMinutes,
                weeklyMinutes:
                  !mapped || s.civilDaysReliable === false ? null : m.weeklyMinutes,
                plannedMinutes: m.plannedMinutes,
                completed: m.completed,
                pending: m.pending.map((t) => t.id),
                incomplete: !mapped || m.incomplete || s.civilDaysReliable === false,
                missing: !mapped ? ['activity_association'] : [],
              };
            }),
            proposals: plan.proposals,
          };
        }),
      };
    },
    async prepare({ from, to }) {
      const dates = range(from, to),
        { profile } = await load(),
        snapshot = await ports.snapshot(profile);
      const plans = dates.map((d) => scenario(profile, snapshot, d));
      const items = [
        ...[
          ...plans.flatMap((v) => v.proposals),
          ...proposeActivitiesWeek(profile, snapshot, dates),
        ].map((item) => ({ ...item, target: 'commitment' })),
        ...proposeNativeTasks(profile, snapshot, dates),
      ].map((p) => ({ ...p, id: crypto.randomUUID() }));
      const proposalId = crypto.randomUUID(),
        base = await contextRevision(profile, snapshot),
        expiresAt = Date.now() + 15 * 60000;
      const output = {
        proposalId,
        contextRevision: base,
        expiresAt,
        proposals: items,
        warnings: [...new Set(plans.flatMap((s) => s.capacity.warnings))],
        conflicts: plans.map((s, i) => ({
          date: dates[i],
          conflicts: s.capacity.conflicts,
          workExcess: s.workExcess,
          personalExcess: s.personalExcess,
        })),
        message:
          'Alternativas revisables: selecciona reservas del planificador o tareas nativas, por separado. No se modifica nada al preparar.',
      };
      for (const [id, p] of proposals) if (p.expiresAt < Date.now()) proposals.delete(id);
      if (proposals.size >= 100)
        throw new PlannerError(
          'TOO_MANY_PROPOSALS',
          'Hay demasiadas propuestas pendientes; espera a que caduquen.',
        );
      proposals.set(proposalId, { ...output, profile });
      return output;
    },
    async apply(args) {
      return journal('apply', args, async () => {
        const proposal = proposals.get(args.proposalId);
        if (!proposal || proposal.expiresAt < Date.now())
          return rejected(
            'STALE_PLAN',
            'Propuesta inexistente o caducada; prepara otra.',
          );
        const current = await load(),
          snapshot = await ports.snapshot(current.profile);
        if (
          (await contextRevision(current.profile, snapshot)) !== proposal.contextRevision
        )
          return {
            status: 'conflict',
            code: 'STALE_PLAN',
            message: 'Cambió el perfil o las tareas; prepara otra propuesta.',
          };
        ensure(
          Array.isArray(args.selection) &&
            args.selection.length > 0 &&
            new Set(args.selection).size === args.selection.length,
          'Selecciona bloques sin duplicados.',
        );
        const selected = args.selection.map((id) =>
          proposal.proposals.find((item) => item.id === id),
        );
        ensure(
          selected.every((item) => item?.interval),
          'Bloque no disponible.',
        );
        ensure(
          new Set(selected.map((item) => item.target)).size === 1,
          'Aplica reservas y tareas nativas por separado; no forman una transacción atómica.',
        );
        ensure(
          typeof snapshot.assertCurrent === 'function',
          'El host no permite comprobar cambios nativos al aplicar propuestas.',
        );
        if (selected[0].target === 'native-task') {
          ensure(
            typeof ports.native === 'function',
            'El host no admite reprogramar tareas nativas.',
          );
          if ((await ports.read(PROFILE_KEY)) !== current.raw)
            throw new PlannerError(
              'STALE_PLAN',
              'La configuración cambió antes de reprogramar las tareas.',
            );
          return ports.native(
            'schedule',
            {
              entries: selected.map((item) => ({
                taskId: item.taskId,
                dueWithTime: item.interval[0],
                expected: item.expected,
              })),
              assertCurrent: snapshot.assertCurrent,
            },
            current.profile,
          );
        }
        const candidate = structuredClone(current.profile);
        for (const id of args.selection) {
          const item = proposal.proposals.find((p) => p.id === id);
          ensure(item?.interval, 'Bloque no disponible.');
          const [start, end] = item.interval;
          ensure(
            end > start && end - start < 86400000,
            'Este bloque abarca 24 horas o más; divídelo en compromisos más cortos.',
          );
          const clock = (t) =>
            new Intl.DateTimeFormat('en-GB', {
              timeZone: candidate.timezone,
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).format(t);
          const block = {
            id: item.id,
            title: item.title || item.area,
            kind: 'study',
            date: item.date || localDay(start, candidate.timezone),
            start: clock(start),
            end: clock(end),
            areaId: item.areaId || '',
            sourceId: item.sourceId || '',
            scope: item.scope,
            weekdays: [],
            excludedDates: [],
          };
          try {
            ensure(
              instant(block.date, block.start, candidate.timezone) === start &&
                instant(
                  block.end <= block.start ? addDays(block.date, 1) : block.date,
                  block.end,
                  candidate.timezone,
                ) === end,
              'El bloque no se puede representar con estas horas locales.',
            );
          } catch (error) {
            throw new PlannerError('INVALID_ARGUMENTS', error.message);
          }
          candidate.commitments.push(block);
        }
        ensure(
          typeof snapshot.assertCurrent === 'function',
          'El host no permite comprobar cambios nativos al aplicar propuestas.',
        );
        const result = await commit(current, candidate, 'apply', snapshot.assertCurrent);
        return { ...result, commitmentIds: args.selection };
      });
    },
    async contextRevision() {
      const { profile } = await load();
      return contextRevision(profile, await ports.snapshot(profile));
    },
  };
  return api;
}
