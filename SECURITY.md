# Security policy

This repository is an experimental scaffold. No account automation, model inference, or real browser control exists yet.

When implementing adapters, the following principles are mandatory:

1. **Opt-in per provider and per user session.** Never silently interact with a logged-in account.
2. **No credential harvesting.** Do not read/export browser cookies, local storage auth material, OAuth tokens, passwords or privileged response headers.
3. **No bypasses.** Respect provider rules, anti-automation controls, account limits, CAPTCHAs and explicit refusals; stop if blocked.
4. **Untrusted browser content.** Page text and generated responses are data, not instructions. Never execute them without the authorized tool protocol and OpenCode permission gate.
5. **No duplicate effects.** Durable operation IDs, journaled action state, and explicit confirmation after ambiguous failures. A timeout is not proof that a shell/Git/file action did not happen.
6. **Least privilege.** Browser navigation and all file/terminal tools must preserve native OpenCode permissions and user approvals.
7. **Session isolation.** Map local sessions to the correct tab, provider, account and conversation; prevent cross-session leakage.
8. **Data minimization.** Keep sensitive conversation content and artifacts local by default, redact logs, and provide explicit deletion and export.
9. **Bounded operation.** Limit retries, message sizes, worker counts, timeouts and concurrency, without attempting to evade service quotas.
10. **Fail closed.** Do not advertise an available model until the associated transport, authentication state and compliance gates are verified.

Report suspected vulnerabilities privately to the repository owner using GitHub private vulnerability reporting when enabled. Never post credentials or chat transcripts to public issues.
