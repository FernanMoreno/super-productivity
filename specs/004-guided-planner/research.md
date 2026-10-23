# Investigación y alternativas

Demanda explícita del usuario; incorporación acotada al plugin existente. Revisado octubre 2026, documentación de proveedores y fuente local.

| Referente                                                                           | Revisión/decisiones               | Tiempo y contexto                                                                                   | Se toma / se evita                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Taskwarrior [review](https://taskwarrior.org/docs/review/)                          | revisado con fecha, retomable     | [context](https://taskwarrior.org/docs/context/) y [urgency](https://taskwarrior.org/docs/urgency/) | decisiones y razones locales; sin copiar todo el DSL o coeficientes |
| Kimai [weekly hours](https://www.kimai.org/documentation/weekly-times.html)         | tabla por semana editable         | duración por día                                                                                    | comparación prevista/real; no inventar hora de inicio               |
| Super Productivity, fuente local TaskService/TimeTrackingService/planner/plugin/MCP | tareas, op-log y acciones nativas | archivo, calendario, temporizador                                                                   | servicios y persistencia únicos; sin backend ni modelos duplicados  |

Se descarta reescritura del núcleo y servidor MCP separado: el fork ya ofrece operaciones compartidas y transporte local. La versión publicada con número 19.2.0 no prueba la presencia de estas extensiones. Datos auxiliares usan namespace del plugin y migración/defaults compatibles.
