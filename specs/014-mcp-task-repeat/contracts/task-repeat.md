# task_repeat

read: taskId. Returns taskId, repeatCfgId, schedule or null, revision or null.
set: taskId, cycle daily|weekly|monthly|yearly, every integer 1..99 (default1), weekdays nonempty distinct mon..sun (weekly only), startDay valid YYYY-MM-DD, expectedRevision from read, operationId stable8..80 safe characters.
Read grants tasks:read; set also tasks:write. Native effects may move unfinished occurrences. Unsupported advanced settings are preserved and exposed as schedule metadata; no modal is opened. Existing receipts apply unchanged.
