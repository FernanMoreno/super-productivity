import {
  scenario,
  proposeActivitiesWeek,
  localDay,
  instant,
  addDays,
  availability,
  restricted,
} from './schedule.mjs';
import { proposeNativeTasks } from './native-proposals.mjs';
import { validDate } from './model.mjs';

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const plan = (task) =>
  Object.fromEntries(
    ['dueDay', 'dueWithTime', 'remindAt'].map((key) => [key, task[key] ?? null]),
  );
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];
const pageKey = (page) => 'history-page-' + page;
const eventKey = (id) => 'history-event-' + id;
const historyId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
const validPlan = (value) =>
  object(value) &&
  Object.keys(value).length === 3 &&
  ['dueDay', 'dueWithTime', 'remindAt'].every((key) => Object.hasOwn(value, key)) &&
  (value.dueDay === null || validDate(value.dueDay)) &&
  ['dueWithTime', 'remindAt'].every(
    (key) => value[key] === null || Number.isSafeInteger(value[key]),
  );
const clock = (epoch, zone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(epoch);

/** Reversible planning differences live in user storage, never in task copies.
 * Index pages stay bounded; journal receipts remain the retry authority.
 * A pending event is an intention, not proof that its changes were applied.
 */
export function createReorganizationOperations({
  ports,
  load,
  authorize,
  journal,
  commit,
  range,
  contextRevision,
  PlannerError,
  captureBaseline,
}) {
  const proposals = new Map();
  const ensure = (ok, message, code = 'INVALID_ARGUMENTS') => {
    if (!ok) throw new PlannerError(code, message);
  };
  const decode = (raw) => {
    try {
      const value = JSON.parse(raw);
      ensure(object(value), 'Datos de historial no válidos.', 'DATA_CORRUPT');
      return value;
    } catch (error) {
      if (error instanceof PlannerError) throw error;
      throw new PlannerError(
        'DATA_CORRUPT',
        'No se puede leer el historial de planificación.',
      );
    }
  };
  const read = async (key) => {
    const raw = await ports.read(key);
    return { raw, value: raw === null ? null : decode(raw) };
  };
  const indexHead = (value) => {
    ensure(
      value === null ||
        (value.version === 1 &&
          value.action === 'apply' &&
          Number.isSafeInteger(value.page) &&
          value.page >= 0),
      'Índice de historial no válido.',
      'DATA_CORRUPT',
    );
    return value?.page ?? 0;
  };
  const indexPage = (value) => {
    ensure(
      value === null ||
        (value.version === 1 &&
          value.action === 'apply' &&
          Array.isArray(value.ids) &&
          value.ids.length > 0 &&
          value.ids.length <= 200 &&
          value.ids.every(historyId)),
      'Página de historial no válida.',
      'DATA_CORRUPT',
    );
    return value?.ids ?? [];
  };
  const update = async (key, transform) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await read(key),
        value = transform(current.value);
      await authorize('apply');
      if (
        await ports.cas(
          key,
          current.raw,
          JSON.stringify({ ...value, action: 'apply' }),
          undefined,
          'apply',
        )
      )
        return { ...value, action: 'apply' };
    }
    throw new PlannerError(
      'STALE_DATA',
      'El historial cambió mientras se guardaba. Reintenta con una propuesta actualizada.',
    );
  };
  const storeProposal = (proposal) => {
    for (const [id, value] of proposals)
      if (value.expiresAt < Date.now()) proposals.delete(id);
    ensure(
      proposals.size < 100,
      'Hay demasiadas propuestas pendientes.',
      'TOO_MANY_PROPOSALS',
    );
    const value = {
      ...proposal,
      proposalId: crypto.randomUUID(),
      expiresAt: Date.now() + 15 * 60000,
    };
    proposals.set(value.proposalId, value);
    return structuredClone(value);
  };
  const getProposal = (id) => {
    const value = proposals.get(id);
    ensure(
      value && value.expiresAt >= Date.now(),
      'Propuesta inexistente o caducada.',
      'STALE_PLAN',
    );
    return value;
  };
  const block = (item, profile) => {
    const [start, end] = item.interval,
      date = item.date || localDay(start, profile.timezone);
    ensure(
      end > start && end - start < 86400000,
      'Divide los bloques de 24 horas o más.',
    );
    const value = {
      id: item.id,
      title: item.title || item.area,
      kind: 'study',
      date,
      start: clock(start, profile.timezone),
      end: clock(end, profile.timezone),
      areaId: item.areaId || '',
      sourceId: item.sourceId || '',
      scope: item.scope,
      weekdays: [],
      excludedDates: [],
    };
    try {
      ensure(
        instant(date, value.start, profile.timezone) === start &&
          instant(
            value.end <= value.start ? addDays(date, 1) : date,
            value.end,
            profile.timezone,
          ) === end,
        'El bloque no se puede representar con estas horas locales.',
      );
    } catch (error) {
      throw new PlannerError('INVALID_ARGUMENTS', error.message);
    }
    return value;
  };
  const blockInterval = (value, profile) =>
    value
      ? [
          instant(value.date, value.start, profile.timezone),
          instant(
            value.end <= value.start ? addDays(value.date, 1) : value.date,
            value.end,
            profile.timezone,
          ),
        ]
      : null;
  const timed = (snapshot) =>
    snapshot.leaves
      .filter((task) => !task.archived && !task.isDone)
      .flatMap((task) => {
        let start;
        for (const current of snapshot.chain(task)) {
          if (current.dueWithTime) {
            start = current.dueWithTime;
            break;
          }
          if (current.dueDay) break;
        }
        const duration = Math.max(0, (task.timeEstimate || 0) - (task.timeSpent || 0));
        return start && duration
          ? [{ taskId: task.id, interval: [start, start + duration] }]
          : [];
      });
  const validateSlots = (profile, snapshot, items, { undo = false } = {}) => {
    const native = timed(snapshot),
      selectedTasks = new Set(undo ? items.map((item) => item.taskId) : []);
    for (const item of items) {
      if (!item.interval) continue;
      const [start, end] = item.interval;
      ensure(
        Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start,
        'Intervalo no válido.',
      );
      const day = localDay(start, profile.timezone),
        capacity = availability(profile, day, snapshot);
      let free = capacity[item.scope === 'work' ? 'workFree' : 'personalFree'];
      const area = profile.areas.find((area) => area.id === item.areaId);
      try {
        if (area) free = restricted(free, area, day, profile.timezone);
      } catch (error) {
        throw new PlannerError('INVALID_ARGUMENTS', error.message);
      }
      ensure(
        !area ||
          !profile.trainingExclusions.some(
            (exclusion) =>
              exclusion.areaId === area.id &&
              day >= exclusion.start &&
              day <= exclusion.end,
          ),
        'El intervalo coincide con una excepción de formación.',
      );
      ensure(
        free.some(([s, e]) => s <= start && end <= e),
        'La franja coincide con un compromiso o queda fuera de las restricciones.',
      );
      ensure(
        !native.some(
          (other) =>
            !selectedTasks.has(other.taskId) && overlaps(other.interval, item.interval),
        ),
        'La franja coincide con una tarea nativa actual.',
      );
      if (item.target === 'native-task') {
        const task = snapshot.byId.get(item.taskId);
        ensure(task && !task.archived, 'Tarea no disponible.');
        ensure(
          !task.deadlineDay || day <= task.deadlineDay,
          'La franja supera la fecha límite de la tarea.',
        );
        ensure(
          !task.deadlineWithTime || end <= task.deadlineWithTime,
          'La franja supera la hora límite de la tarea.',
        );
      }
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        ensure(
          items[i].target !== items[j].target ||
            !items[i].interval ||
            !items[j].interval ||
            !overlaps(items[i].interval, items[j].interval),
          'Dos cambios seleccionados se solapan.',
        );
  };
  const checkAfter = (change, current, snapshot) =>
    change.target === 'native-task'
      ? !!snapshot.byId.get(change.taskId) &&
        !snapshot.byId.get(change.taskId).archived &&
        same(plan(snapshot.byId.get(change.taskId)), change.before)
      : same(
          current.profile.commitments.find((value) => value.id === change.commitmentId) ??
            null,
          change.before,
        );
  const getEvent = async (id) => {
    ensure(
      typeof id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(id),
      'Identificador de historial inválido.',
    );
    const entry = (await read(eventKey(id))).value;
    if (entry)
      ensure(
        entry.id === id &&
          entry.version === 1 &&
          entry.action === 'apply' &&
          ['forward', 'undo'].includes(entry.direction) &&
          Number.isFinite(entry.createdAt) &&
          Array.isArray(entry.changes) &&
          entry.changes.length > 0 &&
          entry.changes.every(
            (change) =>
              object(change) &&
              typeof change.id === 'string' &&
              ['native-task', 'commitment'].includes(change.target) &&
              (change.target === 'native-task'
                ? typeof change.taskId === 'string' &&
                  validPlan(change.before) &&
                  validPlan(change.after)
                : typeof change.commitmentId === 'string' &&
                  (change.before === null || object(change.before)) &&
                  (change.after === null || object(change.after)) &&
                  (change.before !== null || change.after !== null)),
          ) &&
          ['pending', 'confirmed', 'uncertain', 'rejected'].includes(entry.status),
        'Datos de historial no válidos.',
        'DATA_CORRUPT',
      );
    return entry;
  };
  const indexEvent = async (id) => {
    for (;;) {
      const head = await read('history-index-v1');
      const page = indexHead(head.value);
      ensure(
        Number.isSafeInteger(page) && page >= 0,
        'Índice de historial no válido.',
        'DATA_CORRUPT',
      );
      const part = await read(pageKey(page)),
        ids = indexPage(part.value);
      ensure(
        Array.isArray(ids) && ids.every((value) => typeof value === 'string'),
        'Página de historial no válida.',
        'DATA_CORRUPT',
      );
      if (ids.includes(id)) return;
      if (ids.length >= 200) {
        await update('history-index-v1', (current) => ({
          version: 1,
          page: Math.max(page + 1, current?.page ?? 0),
        }));
        continue;
      }
      await authorize('apply');
      if (
        await ports.cas(
          pageKey(page),
          part.raw,
          JSON.stringify({ version: 1, action: 'apply', ids: [...ids, id] }),
          undefined,
          'apply',
        )
      )
        return;
    }
  };
  const api = {
    async prepare({ from, to }) {
      await authorize('prepare');
      const dates = range(from, to),
        current = await load(),
        snapshot = await ports.snapshot(current.profile),
        profile = current.profile;
      const plans = dates.map((day) => scenario(profile, snapshot, day));
      const items = [
        ...[
          ...plans.flatMap((value) => value.proposals),
          ...proposeActivitiesWeek(profile, snapshot, dates),
        ].map((item) => ({ ...item, target: 'commitment' })),
        ...proposeNativeTasks(profile, snapshot, dates),
      ].map((item) => ({ ...item, id: crypto.randomUUID() }));
      const context = await contextRevision(profile, snapshot);
      await authorize('prepare');
      return storeProposal({
        from,
        to,
        direction: 'forward',
        contextRevision: context,
        proposals: items,
        warnings: [...new Set(plans.flatMap((value) => value.capacity.warnings))],
        conflicts: plans.map((value, index) => ({
          date: dates[index],
          conflicts: value.capacity.conflicts,
          workExcess: value.workExcess,
          personalExcess: value.personalExcess,
        })),
        message:
          'Alternativas revisables; reservas y tareas nativas se aplican por separado.',
      });
    },
    async adjustProposal({ proposalId, changes }) {
      await authorize('proposal_adjust');
      const original = getProposal(proposalId);
      ensure(
        original.direction === 'forward',
        'Una propuesta inversa no admite cambios de horario.',
      );
      ensure(
        Array.isArray(changes) &&
          changes.length > 0 &&
          new Set(changes.map((value) => value.itemId)).size === changes.length,
        'Indica ajustes sin identificadores duplicados.',
      );
      const current = await load(),
        snapshot = await ports.snapshot(current.profile);
      ensure(
        (await contextRevision(current.profile, snapshot)) === original.contextRevision,
        'Cambió el perfil o las tareas. Prepara otra propuesta.',
        'STALE_PLAN',
      );
      const items = structuredClone(original.proposals);
      for (const change of changes) {
        ensure(
          object(change) &&
            Object.keys(change).every((key) => ['itemId', 'start', 'end'].includes(key)),
          'Ajuste inválido.',
        );
        const item = items.find((value) => value.id === change.itemId);
        ensure(item?.interval, 'No existe un bloque ajustable.');
        const duration = item.interval[1] - item.interval[0],
          end = change.end ?? change.start + duration;
        ensure(
          Number.isSafeInteger(change.start) &&
            Number.isSafeInteger(end) &&
            end > change.start,
          'Horas de ajuste inválidas.',
        );
        ensure(
          item.target !== 'native-task' || end - change.start === duration,
          'La duración de una tarea depende de su estimación restante.',
        );
        item.interval = [change.start, end];
        item.date = localDay(change.start, current.profile.timezone);
        ensure(
          item.date >= original.from && item.date <= original.to,
          'El ajuste queda fuera del intervalo revisado.',
        );
        item.minutes = (end - change.start) / 60000;
        if (item.target === 'commitment') block(item, current.profile);
      }
      validateSlots(
        current.profile,
        snapshot,
        items.filter(
          (item) => changes.some((change) => change.itemId === item.id) && item.interval,
        ),
      );
      await authorize('proposal_adjust');
      return storeProposal({ ...original, proposals: items });
    },
    async history({ historyId, limit = 20 } = {}) {
      await authorize('history');
      if (historyId) {
        const entry = await getEvent(historyId);
        await authorize('history');
        return { entry };
      }
      ensure(
        Number.isInteger(limit) && limit >= 1 && limit <= 100,
        'El límite debe estar entre 1 y 100.',
      );
      const head = await read('history-index-v1');
      let page = indexHead(head.value);
      const firstPage = page;
      ensure(
        Number.isSafeInteger(page) && page >= 0,
        'Índice de historial no válido.',
        'DATA_CORRUPT',
      );
      const entries = [],
        seen = new Set();
      while (page >= 0 && entries.length < limit) {
        const part = (await read(pageKey(page))).value;
        ensure(
          part !== null || page === firstPage,
          'Falta una página del historial guardado.',
          'DATA_CORRUPT',
        );
        ensure(
          !part || Array.isArray(part.ids),
          'Página de historial no válida.',
          'DATA_CORRUPT',
        );
        for (const id of [...indexPage(part)].reverse())
          if (!seen.has(id) && entries.length < limit) {
            seen.add(id);
            const entry = await getEvent(id);
            ensure(
              entry,
              'Falta una reorganización referenciada en el historial.',
              'DATA_CORRUPT',
            );
            entries.push(entry);
          }
        page--;
      }
      await authorize('history');
      return { entries };
    },
    async prepareUndo({ historyId, selection }) {
      await authorize('prepare_undo');
      const entry = await getEvent(historyId);
      ensure(entry, 'No existe esa reorganización.');
      ensure(
        entry.status === 'confirmed',
        'El historial no confirma que se aplicaran los cambios. No se puede deshacer automáticamente.',
        'OUTCOME_UNKNOWN',
      );
      if (selection !== undefined)
        ensure(
          Array.isArray(selection) &&
            selection.length > 0 &&
            new Set(selection).size === selection.length &&
            selection.every((id) => entry.changes.some((change) => change.id === id)),
          'Selección de cambios inválida.',
        );
      const current = await load(),
        snapshot = await ports.snapshot(current.profile),
        conflicts = [];
      const items = entry.changes
        .filter((change) => !selection || selection.includes(change.id))
        .map((change) => {
          const inverse = {
            ...structuredClone(change),
            before: structuredClone(change.after),
            after: structuredClone(change.before),
          };
          let applicable = checkAfter(inverse, current, snapshot);
          const id = crypto.randomUUID();
          if (!applicable)
            conflicts.push({
              changeId: change.id,
              code: 'PLANNING_CHANGED',
              message:
                'Los campos de planificación ya no coinciden; se conserva la edición posterior.',
            });
          let interval = null;
          if (inverse.target === 'commitment')
            interval = blockInterval(inverse.after ?? inverse.before, current.profile);
          else if (
            inverse.after.dueWithTime &&
            !snapshot.byId.get(change.taskId)?.isDone
          ) {
            const duration = Math.max(
              0,
              (snapshot.byId.get(change.taskId)?.timeEstimate || 0) -
                (snapshot.byId.get(change.taskId)?.timeSpent || 0),
            );
            if (duration)
              interval = [
                inverse.after.dueWithTime,
                inverse.after.dueWithTime + duration,
              ];
          }
          const item = {
            id,
            target: change.target,
            taskId: change.taskId,
            commitmentId: change.commitmentId,
            areaId: change.areaId,
            scope: change.scope,
            change: inverse,
            before: inverse.before,
            after: inverse.after,
            interval,
            selectable: applicable,
            reason: applicable
              ? 'Restaurar únicamente los campos de planificación indicados; conservar tiempo, estado y demás ediciones.'
              : 'Campos de planificación modificados después; cambio no seleccionable.',
          };
          if (applicable && inverse.after !== null && interval)
            try {
              validateSlots(current.profile, snapshot, [item], { undo: true });
            } catch (error) {
              applicable = false;
              item.selectable = false;
              item.reason =
                'La planificación anterior ya no cabe en la disponibilidad actual.';
              conflicts.push({
                changeId: change.id,
                code: 'CAPACITY_CONFLICT',
                message: error.message,
              });
            }
          return item;
        });
      await authorize('prepare_undo');
      return storeProposal({
        from: entry.from,
        to: entry.to,
        direction: 'undo',
        undoOf: historyId,
        proposals: items,
        conflicts,
        warnings: [],
        message:
          'Propuesta inversa por cambios seleccionados. No restaura copias completas de tareas.',
      });
    },
    async apply(args) {
      return journal('apply', args, async () => {
        const proposal = getProposal(args.proposalId),
          undo = proposal.direction === 'undo';
        ensure(
          Array.isArray(args.selection) &&
            args.selection.length > 0 &&
            new Set(args.selection).size === args.selection.length,
          'Selecciona cambios sin duplicados.',
        );
        const selected = args.selection.map((id) =>
          proposal.proposals.find((item) => item.id === id),
        );
        ensure(
          selected.every(
            (item) =>
              item &&
              item.selectable !== false &&
              (item.interval || (undo && item.selectable === true)),
          ),
          'Cambio no disponible o en conflicto.',
        );
        ensure(
          new Set(selected.map((item) => item.target)).size === 1,
          'Aplica reservas y tareas nativas por separado; no forman una transacción atómica.',
        );
        let current = await load(),
          snapshot = await ports.snapshot(current.profile);
        if (!undo)
          ensure(
            (await contextRevision(current.profile, snapshot)) ===
              proposal.contextRevision,
            'Cambió el perfil o las tareas; prepara otra propuesta.',
            'STALE_PLAN',
          );
        const changes = selected.map((item) =>
          undo
            ? structuredClone(item.change)
            : item.target === 'commitment'
              ? {
                  id: item.id,
                  target: item.target,
                  areaId: item.areaId,
                  scope: item.scope,
                  commitmentId: item.id,
                  before: null,
                  after: block(item, current.profile),
                }
              : {
                  id: item.id,
                  target: item.target,
                  areaId: item.areaId,
                  scope: item.scope,
                  taskId: item.taskId,
                  before: plan(snapshot.byId.get(item.taskId)),
                  after: {
                    dueDay: null,
                    dueWithTime: item.interval[0],
                    remindAt:
                      typeof snapshot.byId.get(item.taskId).remindAt === 'number' &&
                      typeof snapshot.byId.get(item.taskId).dueWithTime === 'number'
                        ? item.interval[0] -
                          (snapshot.byId.get(item.taskId).dueWithTime -
                            snapshot.byId.get(item.taskId).remindAt)
                        : null,
                  },
                },
        );
        if (undo)
          ensure(
            changes.every((change) => checkAfter(change, current, snapshot)),
            'Cambió un campo de planificación después de preparar el deshacer.',
            'STALE_PLAN',
          );
        validateSlots(
          current.profile,
          snapshot,
          selected.filter((item) => !undo || item.change.after !== null),
          { undo },
        );
        if (captureBaseline && proposal.from && proposal.to) {
          const baseline = await captureBaseline({
            from: proposal.from,
            to: proposal.to,
          });
          ensure(
            !baseline || baseline.status === 'applied',
            'Cambió la revisión mientras se capturaba el plan previo.',
            'STALE_DATA',
          );
        }
        const record = {
          version: 1,
          id: args.operationId,
          createdAt: Date.now(),
          direction: proposal.direction,
          undoOf: proposal.undoOf ?? null,
          from: proposal.from,
          to: proposal.to,
          status: 'pending',
          changes,
        };
        await update(eventKey(record.id), (prior) => {
          ensure(
            !prior,
            'Ya existe una reorganización con este identificador.',
            'OPERATION_ID_REUSED',
          );
          return record;
        });
        await indexEvent(record.id);
        let result;
        try {
          current = await load();
          snapshot = await ports.snapshot(current.profile);
          if (undo)
            ensure(
              changes.every((change) => checkAfter(change, current, snapshot)),
              'Cambió un campo de planificación antes de deshacer.',
              'STALE_PLAN',
            );
          else
            ensure(
              (await contextRevision(current.profile, snapshot)) ===
                proposal.contextRevision,
              'Cambió el perfil o las tareas antes de aplicar.',
              'STALE_PLAN',
            );
          validateSlots(
            current.profile,
            snapshot,
            selected.filter((item) => !undo || item.change.after !== null),
            { undo },
          );
          ensure(
            typeof snapshot.assertCurrent === 'function',
            'El anfitrión no puede comprobar cambios concurrentes.',
            'DATA_UNAVAILABLE',
          );
          ensure(
            (await ports.read('profile-v1')) === current.raw,
            'Cambió la configuración antes de aplicar.',
            'STALE_PLAN',
          );
          if (selected[0].target === 'native-task') {
            ensure(
              typeof ports.native === 'function',
              'El anfitrión no admite cambios de calendario.',
              'UNSUPPORTED_OPERATION',
            );
            const entries = undo
              ? changes.map((change) => ({
                  taskId: change.taskId,
                  before: change.after,
                  expectedAfter: change.before,
                }))
              : selected.map((item) => ({
                  taskId: item.taskId,
                  dueWithTime: item.interval[0],
                  expected: item.expected,
                }));
            result = await ports.native(
              undo ? 'restore_schedule' : 'schedule',
              { entries, assertCurrent: snapshot.assertCurrent },
              current.profile,
            );
          } else {
            const candidate = structuredClone(current.profile);
            for (const change of changes) {
              candidate.commitments = candidate.commitments.filter(
                (item) => item.id !== change.commitmentId,
              );
              if (change.after) candidate.commitments.push(structuredClone(change.after));
            }
            result = {
              ...(await commit(current, candidate, 'apply', snapshot.assertCurrent)),
              commitmentIds: changes.map((change) => change.commitmentId),
            };
          }
        } catch (error) {
          try {
            await update(eventKey(record.id), (prior) => ({
              ...prior,
              status: error instanceof PlannerError ? 'rejected' : 'uncertain',
            }));
          } catch {
            /* Retain the original outcome classification if history cannot be updated. */
          }
          throw error;
        }
        try {
          await update(eventKey(record.id), (prior) => ({
            ...prior,
            status:
              result.status === 'applied'
                ? 'confirmed'
                : result.status === 'uncertain'
                  ? 'uncertain'
                  : 'rejected',
            result,
          }));
        } catch (error) {
          if (result.status === 'applied' || result.status === 'uncertain')
            throw new Error(
              'The change may have been applied, but its history could not be confirmed',
            );
          throw error;
        }
        return { ...result, historyId: record.id };
      });
    },
  };
  return api;
}
