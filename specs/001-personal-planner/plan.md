# Implementation Plan: Mi planificación

**Branch**: `feat/personal-planner` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

## Summary

Plugin iframe independiente en packages/plugin-dev/personal-planner. Sin backend ni cambios de modelos/API del núcleo. Lectores soportados; persistencia versionada mediante persistDataSynced/loadSyncedData. JavaScript modular, HTML/CSS inline generado con esbuild, ZIP con biblioteca estándar de Python. Pruebas node:test y navegador Playwright.

## Technical Context

- Host: Super Productivity 19.2.0, Angular/Electron/Capacitor; MIT.
- Plugin: JavaScript ESM, API inyectada y estilos de tema del anfitrión; sin dependencias de ejecución.
- Módulos: model (validación), metrics (agregación), schedule (intervalos), adapter (API/errores), app (DOM/formularios).
- Riesgos: tiempo ya agregado por día lógico; no se puede reconstruir sesión; archivos pueden faltar; padres agregan subtareas. Métricas con incertidumbre nunca se convierten en cero silenciosamente.
- Rendimiento: snapshot bajo demanda, refresco manual y periódico sin solicitudes simultáneas. No consultas por tarea.

## Constitution Check

La constitución instalada es una plantilla sin principios ratificados. Se aplican AGENTS.md, privacidad/offline del proyecto y requisitos explícitos del usuario. Ninguna modificación de contratos públicos ni núcleo prevista.

## Project Structure

Código en super-productivity/packages/plugin-dev/personal-planner/{src,tests,scripts}; documentación del proceso en specs/001-personal-planner. Perfil personal fuera de repositorio. Paquete en dist excluido de Git.

## Phases

1. Confirmar fuentes, Graphify y contratos reales. Pruebas primero para intervalos, fechas y agregación.
2. Implementar cálculo puro y adaptador API con errores explícitos.
3. Panel español y formularios: asociaciones, objetivos, asignaturas, entregas, horarios, escenarios, importación/exportación.
4. Pruebas de contrato/composición, importación en app si disponible, revisión independiente, privacidad del ZIP, documentación y PR borrador solo al fork personal.

## Validation

Pruebas unitarias con datos ficticios; persistencia y errores con dobles de API; navegador integrado con anfitrión real y datos ficticios. Revisar contrato API y paquete ZIP. Ejecutar checks del proyecto y reportar cualquier bloqueo. No existe DB/backend externo propio que necesite Testcontainers o Pact; contrato se valida contra fuente real y host en navegador.

## Revisión de diseño general (ECC, octubre de 2026)

Modelo v2 mantiene entidad areas y sus ids, pero elimina listas personales obligatorias. Actividades tienen ciclo de vida versionado separado de completitud manual; objetivos se resuelven por vigencia. Campos opcionales de prioridad, color, estimación, fecha límite y restricciones tienen valores por defecto.

Bloques propios usan startDate/endDate inclusivos, seriesId y excludedDates. Una ocurrencia se reemplaza sin cambiar serie; futuras dividen la serie. Available delimita capacidad elegible, absence declara ámbito laboral/personal/ambos, flexible aporta demanda y propuestas sin ocupar tiempo. Las tareas recurrentes nativas ya generadas se siguen leyendo de la única fuente de verdad; no se recrean series nativas a partir de un snapshot incompleto.

La API no necesita cambios. La zona horaria pasa a configuración explícita. Migración pura desde v1 al leer, misma clave de almacenamiento; escribir requiere acción de usuario. Nueva versión de paquete 0.2.0.

## Ajuste verificado en integración real

La API pública de persistencia confirmaba escrituras pendientes en memoria. El plugin no dispone de API pública para forzar durabilidad. Corrección esencial limitada a PluginUserPersistenceService y PluginBridgeService: promesa por lote coalescido, cancelación explícita, espera del flush existente y rechazo ante marcador de fallo durable. Sin nuevos efectos, acciones, entidades ni migraciones. Regresión: dos guardados rápidos confirmados y recarga inmediata de IndexedDB real. Graphify del subsistema de plugins y revisión ECC contrastados con el código de captura y flush del op-log.
