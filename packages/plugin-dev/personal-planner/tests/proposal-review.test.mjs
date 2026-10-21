import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalReviewHTML } from '../src/forms.mjs';

test('revisión muestra destino nativo y no selecciona cambios automáticamente', () => {
  const html = proposalReviewHTML(
    {
      proposalId: 'proposal-example',
      proposals: [
        {
          id: 'block-example',
          target: 'native-task',
          title: '<script>example</script>',
          interval: [1801472400000, 1801474200000],
          minutes: 30,
          reason: 'Revisar tarea',
        },
      ],
    },
    (n) => String(n),
  );
  assert.match(html, /Calendario nativo/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|\bchecked\b/);
  assert.match(html, /data-form="apply-proposal"/);
});

test('sin hueco no permite seleccionar un bloque', () => {
  const html = proposalReviewHTML(
    {
      proposals: [
        {
          id: 'none',
          target: 'native-task',
          title: 'Ejemplo',
          interval: null,
          reason: 'Sin hueco',
        },
      ],
    },
    String,
  );
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /Sin hueco/);
});
