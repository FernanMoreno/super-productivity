import { tr } from './i18n.mjs';

const pages = {
  today: {
    title: 'Hoy',
    description: 'Un día, paso a paso.',
    sections: ['now', 'today'],
  },
  workflow: {
    title: 'Tus tareas',
    description: 'Cada cosa en su sitio. Lo importante, a la vista.',
    sections: ['workflow'],
  },
  week: {
    title: 'Tu semana',
    description: 'Tus compromisos y tus tareas, con espacio para imprevistos.',
    sections: ['week', 'proposal-adjust'],
  },
  goals: {
    title: 'Objetivos',
    description: 'Tu progreso y el siguiente paso.',
    sections: ['goals'],
  },
  review: {
    title: 'Revisión',
    description: 'Lo que necesita tu atención antes de seguir.',
    sections: ['review'],
  },
  settings: {
    title: 'Ajustes',
    description: 'Organiza tu planificación a tu manera.',
    sections: ['settings'],
  },
  templates: {
    title: 'Plantillas',
    description: 'Reutiliza tus pasos de trabajo.',
    sections: ['workflow'],
  },
  integrations: {
    title: 'Integraciones',
    description: 'Conexiones y tareas vinculadas.',
    sections: ['workflow'],
  },
  'workflow-week': {
    title: 'Planificar semana',
    description: 'Selecciona, revisa y aplica las fechas.',
    sections: ['workflow'],
  },
  'workflow-review': {
    title: 'Pendientes',
    description: 'Bloqueos, estimaciones y próximos pasos.',
    sections: ['workflow'],
  },
  history: {
    title: 'Cambios de planificación',
    description: 'Consulta las operaciones y sus resultados.',
    sections: ['history'],
  },
  diagnostics: {
    title: 'Diagnóstico',
    description: 'Consultar una operación sin repetirla.',
    sections: ['diagnostics'],
  },
};
const destinations = Object.fromEntries(
  Object.entries(pages).flatMap(([page, { sections }]) =>
    sections.map((section) => [section, page]),
  ),
);
const symbols = {
  today:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  workflow:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h1m3 0h1m3 0h1"/>',
  goals:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  review:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zm-1 11 3 3 5-6"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
};

/** Local presentation only. Hidden views remain mounted, including dirty forms/receipts. */
export function createWorkspace({ onNavigate, beforeNavigate } = {}) {
  let selected = 'today';
  let context = {};
  const links = [...document.querySelectorAll('a[data-workspace-view]')];
  const content = document.getElementById('workspace-content');
  const resolve = (section) =>
    pages[section] ? section : destinations[section] || 'today';
  const fromHash = () => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return 'today';
    }
  };
  function render({ focus = false } = {}) {
    const page = pages[selected];
    const owner =
      {
        templates: 'workflow',
        integrations: 'settings',
        'workflow-week': 'week',
        'workflow-review': 'review',
        history: 'review',
        diagnostics: 'settings',
      }[selected] || selected;
    for (const section of content.querySelectorAll(':scope > section'))
      section.hidden = !page.sections.includes(section.id);
    for (const link of links) {
      if (link.dataset.workspaceView === owner) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      const icon = link.querySelector('[data-workspace-icon]');
      if (icon && !icon.firstChild)
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[link.dataset.workspaceView]}</svg>`;
    }
    const heading = document.getElementById('workspace-heading');
    heading.textContent = tr(page.title);
    document.getElementById('workspace-description').textContent = tr(page.description);
    document.body.classList.add('workspace-ready');
    document.body.dataset.workspaceView = selected;
    const tools = document.getElementById('workspace-tools');
    if (tools) {
      const groups = {
        workflow: [
          ['workflow', 'Proyectos'],
          ['templates', 'Plantillas'],
        ],
        week: [
          ['week', 'Disponibilidad'],
          ['workflow-week', 'Planificar semana'],
        ],
        review: [
          ['review', 'Revisión guiada'],
          ['workflow-review', 'Pendientes'],
          ['history', 'Cambios'],
        ],
        settings: [
          ['settings', 'Preferencias'],
          ['integrations', 'Integraciones'],
          ['diagnostics', 'Diagnóstico'],
        ],
      };
      tools.innerHTML = (groups[owner] || [])
        .map(
          ([section, title]) =>
            `<a href="#${section}" ${section === selected ? 'aria-current="page"' : ''}>${tr(title)}</a>`,
        )
        .join('');
      tools.hidden = !tools.childElementCount;
    }
    if (focus) heading.focus({ preventScroll: true });
  }
  function activate(section, { focus = false } = {}) {
    const next = resolve(section);
    if (beforeNavigate?.({ ...context, section: next }) === false) return false;
    selected = next;
    render({ focus });
    // Fragment navigation scrolls to the section below the shared heading.
    // Reset after that browser step so each view opens with its title in sight.
    requestAnimationFrame(() =>
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' }),
    );
    onNavigate?.({ ...context, section: selected });
    return true;
  }
  function navigate(section, { focus = true } = {}) {
    if (beforeNavigate?.({ ...context, section: resolve(section) }) === false) return;
    if (context.embedded && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'personal-planner:request-navigation',
          section: resolve(section),
          ...(context.projectId ? { projectId: context.projectId } : {}),
        },
        '*',
      );
      return;
    }
    if (location.hash.slice(1) !== section) location.hash = section;
    activate(section, { focus });
  }
  const click = (event) => {
    const anchor = event.target.closest('a[href^="#"]');
    if (
      !anchor ||
      event.defaultPrevented ||
      event.button > 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const section = anchor.getAttribute('href').slice(1);
    if (!destinations[section] && !pages[section]) return;
    event.preventDefault();
    navigate(section);
  };
  const hash = () => activate(fromHash());
  const requested = (event) => {
    if (typeof event.detail?.section === 'string')
      navigate(event.detail.section, { focus: false });
  };
  const attention = (event) => {
    const banner = document.getElementById('workspace-attention');
    if (!banner) return;
    banner.hidden = !(event.detail?.pending > 0);
  };
  const parentMessage = (event) => {
    const message = event.data;
    if (window.parent === window || event.source !== window.parent) return;
    if (message?.type === 'personal-planner:discard-draft') {
      document.dispatchEvent(
        new CustomEvent('planner:discard-draft', {
          detail: { scope: message.scope === 'workflow' ? 'workflow' : 'all' },
        }),
      );
      return;
    }
    if (message?.type !== 'personal-planner:navigate' || !pages[message.section]) return;
    if (
      message.projectId !== undefined &&
      (typeof message.projectId !== 'string' ||
        !message.projectId ||
        message.projectId.length > 200)
    )
      return;
    if (
      message.taskId !== undefined &&
      (typeof message.taskId !== 'string' ||
        !message.taskId ||
        message.taskId.length > 200)
    )
      return;
    const prior = context;
    context = {
      ...(message.projectId ? { projectId: message.projectId } : {}),
      ...(message.taskId ? { taskId: message.taskId } : {}),
      embedded: message.embedded === true,
    };
    document.body.classList.toggle('workspace-embedded', context.embedded);
    if (!activate(message.section)) context = prior;
  };
  const workspaceRequest = (event) => {
    const next = event.detail;
    if (!next || !pages[next.section]) return;
    if (
      next.projectId !== undefined &&
      (typeof next.projectId !== 'string' || next.projectId.length > 200)
    )
      return;
    if (
      next.taskId !== undefined &&
      (typeof next.taskId !== 'string' || !next.taskId || next.taskId.length > 200)
    )
      return;
    event.preventDefault();
    if (context.embedded && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'personal-planner:request-navigation',
          section: next.section,
          ...(next.projectId ? { projectId: next.projectId } : {}),
          ...(next.taskId ? { taskId: next.taskId } : {}),
        },
        '*',
      );
      return;
    }
    context = { ...context, projectId: next.projectId || '' };
    if (next.taskId) context.taskId = next.taskId;
    else delete context.taskId;
    navigate(next.section);
  };
  document.addEventListener('click', click);
  window.addEventListener('hashchange', hash);
  window.addEventListener('message', parentMessage);
  document.addEventListener('planner:workspace-request', workspaceRequest);
  document.addEventListener('planner:navigate', requested);
  document.addEventListener('planner-workflow-attention', attention);
  // Place the next-action assistant before the daily agenda without rebuilding either.
  const now = document.getElementById('now'),
    today = document.getElementById('today');
  const pending = document.getElementById('guided-pending');
  if (pending) content.before(pending);
  if (now && today) content.insertBefore(now, today);
  activate(fromHash());
  return {
    navigate,
    context: () => ({ ...context, section: selected }),
    render: () => render(),
    destroy() {
      document.removeEventListener('click', click);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('message', parentMessage);
      document.removeEventListener('planner:workspace-request', workspaceRequest);
      document.removeEventListener('planner:navigate', requested);
      document.removeEventListener('planner-workflow-attention', attention);
    },
  };
}
