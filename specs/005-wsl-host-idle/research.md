# Research: host idle detection

- Reproduced false global loginctl timestamp and prior fallback to none. Source trace confirms none always returns zero, so the feature was not restored.
- Win32 GetLastInputInfo reads last input for the calling interactive session; GetTickCount returns unsigned milliseconds, wrapping at 49.7 days. Use unchecked uint subtraction. References: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo and https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-gettickcount . Context7 /websites/learn_microsoft_en-us_windows_win32_api returned unrelated session-management snippets, so exact official pages were fetched.
- Native Windows probe returned a plausible 110375 ms, not VM uptime. Verify the same path via WSL before accepting implementation.
- Chosen: constant encoded script through execFile, no shell and no install. Rejected: arbitrary caps on the Linux duration, disabling the feature, moving/copying the user's profile to a different platform, and a permanent background helper with additional lifecycle/state.
- Durable knowledge vault verified against .ai/ecc-prompt-workflow.json; initial wiki has no relevant entries. Do not copy generated graph output into the vault.
