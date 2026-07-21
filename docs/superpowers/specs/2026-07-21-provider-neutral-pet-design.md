# Provider-Neutral Claude Pet Design

**Date:** 2026-07-21
**Status:** Approved in brainstorming; awaiting written-spec review
**Scope:** Replace the Claude-only "brain" planned for Tasks 6-7 with a provider-neutral, user-configurable AI layer. Tasks 1-5 remain unchanged.

## Goal

The completed Windows Electron pet must be fully usable and shareable before its owner chooses or purchases an AI subscription. With no AI connection configured, the pet still launches, animates, accepts interaction, and explains how to connect a provider when prompted.

When a connection is configured, the user can easily select a provider connection, model, reasoning effort, and supported advanced options. The architecture must allow later provider adapters without changing the transparent pet renderer.

## Product principles

1. **Offline-first shell.** The pet itself does not require an AI account or API key to launch and operate.
2. **User choice.** No provider, model, login method, or subscription is assumed.
3. **Visible routing.** The active connection and model are always visible before a prompt is sent.
4. **No silent spending or disclosure.** The app never silently retries, changes providers, changes models, or sends a prompt to a fallback.
5. **Main-process ownership.** Apart from the Settings form's transient API-key entry buffer, credentials, network calls, provider CLIs, configuration, and prompt execution live in the Electron main process.
6. **One prompt at a time.** The app has no queue, autonomous loop, scheduled prompting, or concurrent account sessions.
7. **Extensible adapters.** Provider-specific behavior is hidden behind one capability-aware contract.

## Non-goals

- Autonomous prompts, scheduled prompts, background agent loops, or multi-agent execution.
- Multiple simultaneous prompts or automatic provider failover.
- An embedded browser login, custom OAuth client, or intercepted OAuth callback.
- Importing credentials from freemodel.dev or from unrelated provider tools.
- A universal list of model or reasoning settings applied to every provider.
- Cloud synchronization of settings, secrets, or prompt history.
- Replacing official provider account-management or billing interfaces.
- Adding non-Electron runtime dependencies solely for the provider layer.

## Authentication invariant

The app **never authenticates directly to a provider consumer account**.

This is an exception-free security boundary:

- The app never asks for or receives a consumer-account email, password, MFA code, session cookie, access token, or refresh token.
- The app never embeds a provider sign-in page, implements provider OAuth, intercepts an OAuth redirect, exchanges an authorization code, or refreshes consumer tokens.
- A CLI-login connection may only launch the provider's installed official CLI authentication command and check non-secret status such as installed, signed in, or unavailable.
- The official CLI exclusively owns, stores, reads, and refreshes its consumer-account credentials. CLI profile directories are opaque to the pet.
- A direct API connection may accept a user-supplied API key and store it locally using Electron `safeStorage`.
- API keys are never copied into CLI credential stores. CLI credentials are never imported into the app's API-key store.
- The transparent pet renderer never receives credentials. The separate Settings renderer handles an API key only while the user types it, submits it once to the main process, clears the field, and can never read the stored value back.
- Prompt text, logs, diagnostics, and main-to-renderer IPC responses never expose credentials.

The app may open an official provider authentication flow for the user; it does not become the authenticating client.

## Connection types

The UI presents **connection methods**, not only provider logos, because consumer login and API access have different billing, authentication, and capability behavior.

The initial design supports:

1. **OpenAI API** — user-supplied OpenAI Platform API key; direct API requests.
2. **Codex CLI** — installed official Codex CLI using its own ChatGPT or API-key sign-in state.
3. **Anthropic API** — user-supplied Anthropic API key; direct Messages API requests.
4. **Claude Code CLI** — installed official Claude Code CLI using its own sign-in state.
5. **Custom OpenAI-compatible endpoint** — user-supplied base URL, optional API key, model, and compatibility settings.

The Claude Code CLI connection is a local CLI integration, not an embedded Claude.ai integration. Anthropic's Agent SDK documentation states that third-party developers generally may not offer Claude.ai login or subscription rate limits without prior approval. Therefore, distribution must retain a provider-terms review gate. The adapter may invoke an already installed official CLI and its official login command, but it must not claim official partnership, redistribute consumer authentication, or access Claude credentials.

## Architecture

```text
promptServer / pet IPC
          |
          v
  providerManager  <---- Settings IPC
          |
          +---- providerStore
          |       - non-secret connection metadata
          |       - safeStorage-encrypted API keys
          |
          +---- adapter registry
                  - openaiApi
                  - codexCli
                  - anthropicApi
                  - claudeCodeCli
                  - openAiCompatible
          |
          v
 selected provider API or official CLI
```

### `providerManager`

The Electron main-process `providerManager` is the only component that selects connections and executes prompts. It:

- Owns the active connection and selected model.
- Rejects a second prompt while one is running.
- Resolves model-specific capabilities before applying options.
- Sends only supported options to an adapter.
- Supports stopping the active request or CLI child process.
- Converts provider-specific failures into stable, sanitized app error categories.
- Never silently retries a prompt or selects a fallback.

### `providerStore`

The main-process `providerStore` persists:

- Connection ID, user-visible label, adapter type, endpoint, active state, selected model, and non-secret options.
- Encrypted API-key ciphertext for direct API connections.
- Opaque CLI profile location and non-secret last-known status for CLI connections.
- Cached model metadata, clearly marked with its retrieval time.

API keys are encrypted only after Electron is ready and `safeStorage` reports encryption availability. Ciphertext may be encoded for JSON storage, but plaintext is never written to disk. If encryption, decryption, or key availability fails, the app does not save or use the key and asks the user to re-enter it. There is no plaintext fallback.

Removing an API connection deletes its stored ciphertext. Disconnecting a CLI connection only removes it from the pet; it does not sign the user out of the provider's CLI or affect other applications.

### Adapter contract

Each adapter implements the same conceptual operations:

- `getStatus(connection)` — report prerequisites and non-secret authentication state.
- `beginSetup(input)` — validate/store a user-supplied API key or launch an official CLI login command.
- `testConnection(connection)` — perform a non-billable validation when the provider offers one.
- `listModels(connection)` — return live or adapter-defined models with human-readable names.
- `getCapabilities(connection, model)` — return supported effort values and other controls.
- `runPrompt(request, signal)` — run one user-initiated prompt and return one text response.

The renderers consume normalized status, model, capability, and error data. The Settings renderer has one narrowly scoped IPC action for submitting a newly typed API key, but neither renderer can retrieve a stored secret. They never branch on provider-specific credential or network behavior. Adding an adapter must not require changing the pet renderer.

## Provider behavior

### Direct API adapters

- OpenAI API uses a user-supplied Platform API key and the Responses API for prompting.
- Anthropic API uses a user-supplied API key and the Messages API.
- Model-list endpoints are used for connection testing and discovery where available.
- Provider-returned capabilities are preferred over hard-coded assumptions.
- If a provider does not expose complete capability metadata, the adapter maintains a conservative model registry that can be updated independently.

### Official CLI adapters

- The app first detects the official executable and its version.
- **Open official login** launches the CLI's documented authentication command in an interactive terminal or provider-controlled browser flow.
- The app observes only process completion and documented, non-secret authentication status.
- Claude Code prompts run in non-interactive print mode with all tools removed from the model context.
- Codex prompts run ephemerally with read-only permissions and no implementation authority.
- CLI child environments contain only necessary variables and strip freemodel.dev and unrelated provider overrides.
- Dedicated CLI profiles may be used for isolation, but their contents remain opaque and are never parsed by the pet.

### Custom OpenAI-compatible endpoints

The setup form accepts a label, base URL, optional user-supplied API key, and model. HTTPS is required for remote hosts. Plain HTTP is allowed only for an explicitly confirmed loopback address such as `127.0.0.1` or `localhost`, enabling local gateways without permitting cleartext remote credentials. The adapter attempts the compatible model-list endpoint first. If model listing is unsupported, the user may enter a model ID manually and run an explicitly labeled compatibility test.

Custom endpoints are clearly identified in the UI because their privacy, billing, model names, and feature support are controlled by the endpoint operator rather than OpenAI. The adapter never sends OpenAI or Anthropic consumer credentials to a custom endpoint.

## Setup experience

When no connection is active and a prompt arrives, the pet displays:

> I need an AI provider before I can answer.

The bubble offers **Connect AI** and **Not now**. Choosing **Not now** dismisses the message without degrading the rest of the pet.

**Connect AI** opens a normal-sized Settings window. The setup flow is:

1. Choose a connection method.
2. Enter an API key, launch the official CLI login, or configure a custom endpoint.
3. Test the connection.
4. Select a model from discovered or adapter-provided options.
5. Select reasoning effort and other options supported by that model.
6. Save and activate the connection.

No consumer-account username or password field exists anywhere in the app.

Connection tests avoid billable generation when possible. API adapters use authentication/model endpoints; CLI adapters use documented local status. If a custom endpoint requires generation to validate compatibility, the UI offers a separate **Send test prompt** action and warns that it may be billable.

## Settings and quick switching

The Settings window has a persistent **Current AI** section showing:

- Active connection label and method.
- Connection health.
- Active model.
- Reasoning effort when supported.
- **Change**, **Test**, and **Manage connections** actions.

The Connections section lists saved connections with masked identifiers, last test result, edit, activate, and remove actions. It never displays a complete key or CLI token.

The tray or pet context menu provides quick selectors for connection, model, and supported reasoning effort. The complete Settings window remains available for credentials, endpoint editing, diagnostics, and advanced controls.

Changing connection, model, or effort while a prompt is running affects only the next prompt. The current request retains an immutable execution snapshot so the response is attributed to the connection that actually handled it.

## Capability-aware controls

Every model picker entry is associated with normalized capabilities. Controls are shown only when supported:

- Reasoning effort values come from the selected adapter/model and are not universal.
- Unsupported options are hidden rather than silently ignored.
- A provider may expose additional options under a collapsed **Advanced** section.
- Cached model lists are marked stale when refresh fails; the app does not represent stale data as current.
- If a selected model disappears, the app asks the user to choose another model. It does not select one automatically.

## Prompt lifecycle

1. A user initiates a prompt through the local prompt server or pet interaction.
2. Main process captures the active connection, model, and supported options.
3. If no connection is active, it returns `PROVIDER_REQUIRED` and opens the setup path.
4. If another prompt is running, it returns `PROVIDER_BUSY`.
5. The selected adapter executes exactly one request.
6. The renderer receives a normalized thinking, response, stopped, or error event.
7. The busy state clears regardless of success or failure.

While busy, the pet disables new submission and offers **Stop**. Stopping aborts a network request or terminates the CLI child. No stopped request is automatically retried.

## Error handling

Provider-specific errors map to user-facing categories:

- `PROVIDER_REQUIRED`
- `CLI_NOT_INSTALLED`
- `AUTH_REQUIRED`
- `INVALID_CREDENTIALS`
- `CONNECTION_FAILED`
- `RATE_LIMITED`
- `QUOTA_OR_BILLING`
- `MODEL_UNAVAILABLE`
- `UNSUPPORTED_OPTION`
- `PROVIDER_BUSY`
- `REQUEST_TIMEOUT`
- `REQUEST_STOPPED`
- `PROVIDER_OUTPUT_INVALID`
- `SECRET_STORE_FAILED`

The pet bubble shows a short explanation and one useful action, such as **Connect AI**, **Open official login**, **Edit connection**, **Choose model**, or **Retry**. Settings may show sanitized technical details and a provider request ID when safe.

The app does not automatically retry authentication, quota, billing, timeout, or generation failures. A retry always requires a user action because it could create a second charge or duplicate disclosure.

## Logging and privacy

- Logs omit prompt contents by default.
- Keys, tokens, authorization headers, cookies, and secret-bearing URLs are redacted.
- Child-process stderr is sanitized before display or persistence.
- The pet renderer receives no environment dump, raw provider response, or credential object. The Settings renderer receives only masked secret metadata after its transient submission buffer is cleared.
- A prompt is sent only to the connection visibly selected for that request.
- freemodel.dev credentials and real-provider credentials never share a store, environment, or request.
- The app has no telemetry requirement in this scope.

## Verification strategy

Automated tests use injected mocks for network and child processes; the canonical suite must not require a paid provider.

Required coverage:

1. Adapter contract compliance for every initial adapter.
2. Active connection, model, and capability resolution.
3. One-prompt busy guard and stop behavior.
4. No silent retry or fallback.
5. API-key encryption, decryption, deletion, corruption, and unavailable-storage handling.
6. Negative IPC tests proving stored secrets cannot return from the main process or enter the pet renderer, plus a Settings test proving its one-time key field is cleared after submission.
7. Log redaction and sanitized error mapping.
8. CLI missing, signed-out, expired, timeout, malformed-output, and nonzero-exit cases.
9. Environment isolation using sentinel freemodel.dev variables.
10. Model refresh, stale cache, disappeared model, and capability-aware effort controls.
11. Custom endpoint model-list and manual-model paths.
12. No-provider behavior and recovery after a connection is activated.

Visual verification is required for the Settings window and pet states: no provider, setup, connected, busy, error, stopped, switched, and recovered.

Optional manual smoke tests may run against whichever real providers the tester already has. Lack of a subscription or API key must not block building, packaging, or verifying the application itself.

## Acceptance criteria

The design is satisfied when:

- A clean installation launches and remains useful with zero provider configuration.
- Prompting without a provider gives a friendly setup path.
- All five initial connection types have functional setup and diagnostic paths.
- Direct API keys are user-supplied and locally encrypted; only the Settings renderer's transient entry field ever holds plaintext, and stored keys are never returned to either renderer.
- Consumer-account authentication occurs only inside official provider CLI flows.
- Users can switch connection, model, and supported effort without editing files or restarting.
- Adding a new adapter does not require modifying the pet renderer.
- Only one user-initiated prompt runs at a time, with no autonomous behavior or silent fallback.
- Tests and visual evidence cover safe failure and recovery without requiring paid credentials.

## Effect on the existing plan

Tasks 1-5 remain complete and unchanged. The existing Claude-specific Task 6 and its Claude-specific Task 7 wiring are obsolete once the implementation plan is rewritten.

After this written specification is reviewed and approved, the next planning pass must replace those sections with provider-neutral tasks covering the store, adapter contract, initial adapters, Settings UI, IPC, prompt lifecycle, error handling, tests, and end-to-end integration. That planning pass is documentation work only; implementation begins later under the project's one-task-per-session contract.

## Research basis

- Electron [`safeStorage`](https://electronjs.org/docs/latest/api/safe-storage)
- OpenAI [API key safety](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys)
- OpenAI [Codex authentication](https://developers.openai.com/codex/auth)
- OpenAI [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- OpenAI [Codex models](https://developers.openai.com/codex/models)
- OpenAI [model and reasoning parameters](https://developers.openai.com/api/docs/guides/latest-model#update-api-and-model-parameters)
- Anthropic [Messages API](https://docs.anthropic.com/en/api/messages)
- Anthropic [Models API](https://docs.anthropic.com/en/api/models-list)
- Anthropic [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference)
- Anthropic [Agent SDK authentication guidance](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Cherry Studio provider registry](https://github.com/CherryHQ/cherry-studio/blob/b8485805/src/renderer/src/config/providers.ts) as an open-source provider-registry comparison
- [LibreChat custom endpoints](https://github.com/LibreChat-AI/librechat.ai/blob/main/content/docs/configuration/librechat_yaml/object_structure/custom_endpoint.mdx) as an open-source custom-endpoint comparison
