# W13 — raw package, official CLI, browser model vertical

Status: executable qualification (Linux CI). Base: PR #281,
commit 63782993cf23cb877bdd9b83921cf32c5f73dbf2.

## What is exercised

Run W13_NATIVE_CLI=1 node --test scripts/w13-native-cli-browser.mjs on Linux
with Node 22, Playwright Chromium shell, dependencies installed and the
**unmodified** @opencode/cli@2.0.32. The dedicated workflow installs each
dependency. The script uses npm pack with the repository's real prepack,
installs that exact tarball under a temporary profile, and starts the official
opencode serve and opencode run --model webbridge-chatgpt/chatgpt-web.
No compiled test root or changed OpenCode binary is substituted.

The browser is an isolated persistent Chromium launched by Playwright. A
Playwright route intercepts https://chatgpt.com/c/w13-synthetic and serves
**local synthetic HTML**. No credentials, provider login or provider response
are used. The selected CDP tab, its origin and the private journal directory
are explicitly declared for the real WebBridge native model.

Assertions span the official model inventory, no-tab consent refusal,
nonexistent target refusal, zero preapproval clicks, exactly one approved
browser UI click, persisted progressive candidate, absence of old/private
page text, UNCERTAIN/error terminal (never provider completion), and
exact-prompt retry after stopping and restarting the official server with
the same persisted journal. The restart must cause **zero further clicks**.
All profile, journal, tarball, CDP port and browser resources are disposable.

## Interpretation and limits

Successful CI proves the unmodified official CLI calls the **installed real
WebBridge root** and reaches one explicitly authorized synthetic HTTPS
Chromium page. It proves browser DOM **observation**, not authenticated
ChatGPT inference, delivery acceptance or provider finality. A DOM candidate
therefore ends as UNCERTAIN and cannot be promoted to an authoritative native
completion. The public language hook lacks a trusted per-turn Desktop/OS
session identity and a verified provider completion acknowledgement.
This release gate stays **NO-GO for claimed end-to-end commercial operation**.

The script does not establish native support for DeepSeek, Gemini, Mistral
or Qwen send, packaged Desktop/Electron, or a user's browser profile.
Per-send approval is represented by the explicit tab declaration; it is
not an interactive confirmation dialog inside the native model hook.
Any upstream-facing proposal remains separate from this work.
