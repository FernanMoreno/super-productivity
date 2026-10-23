# Data model

No synced entity/schema additions. Existing Task/Project/Tag/GlobalConfig services own persisted data. Device-local grants gain focused named scopes, default absent. Device-local receipt v1: operationId, tool, arguments fingerprint, pending/confirmed/rejected status and bounded result/error. Journal keys are per-operation; pending entries survive restart and never auto-run. Idle review identity is ephemeral and bound to the actual dialog instance.
