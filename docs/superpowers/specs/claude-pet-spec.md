# Claude Pet — Provider-Neutral Spec

## What this is

Claude Pet is a Windows Electron desktop companion built around the existing Post-Hoc Banana Baron sprite. It is a transparent, always-on-top pet that accepts user-initiated prompts from a loopback terminal endpoint or file drop, shows replies in a nearby speech-bubble UI, and can use whichever supported AI connection the user chooses.

The product is complete and useful before any AI provider is configured. A user can launch, animate, move, and share the app without buying Claude, ChatGPT, API credits, or another subscription. When a prompt needs AI and no connection is active, the pet explains that an AI provider is required and opens a friendly setup flow.

This is a redesign of the unfinished Claude-only brain from plan Task 6 onward. Completed Tasks 1-5 remain valid.

## User-visible goals

- Reuse the existing Banana Baron art; do not commission replacement art.
- Accept prompts through POST /prompt on 127.0.0.1:47611 and through deliberate file-drop interaction.
- Show a normal-sized Settings window for connections, model selection, reasoning effort, diagnostics, and advanced options.
- Make connection, model, and supported effort easy to switch from Settings and the tray menu.
- Show concise thinking, response, setup-required, busy, stopped, and error states beside the pet.
- Package a Windows x64 build that launches with no configured provider and contains no user secrets.
- Let future provider adapters be added without changing the transparent pet renderer.

## Initial connection methods

The UI presents connection methods rather than only provider logos because API access and consumer subscription login have different authentication and billing behavior.

1. OpenAI API — a user-supplied OpenAI Platform API key and direct Responses API requests.
2. Anthropic API — a user-supplied Anthropic API key and direct Messages API requests.
3. Codex CLI — an installed official Codex CLI using its own ChatGPT or API-key sign-in.
4. Claude Code CLI — an installed official Claude Code CLI using its own sign-in.
5. Custom OpenAI-compatible endpoint — a user-supplied endpoint, optional API key, and discovered or manually entered model.

## Authentication invariant

The app never authenticates directly to a provider consumer account.

- The app never asks for or receives a consumer-account email, password, MFA code, session cookie, access token, or refresh token.
- The app never embeds a provider login page, implements provider OAuth, intercepts an OAuth callback, exchanges an authorization code, or refreshes consumer tokens.
- A CLI-login button only launches the installed provider's official CLI authentication command.
- The official CLI exclusively owns, stores, reads, and refreshes its consumer credentials. The pet treats CLI profile directories as opaque and checks status only through official CLI commands.
- Direct API connections accept only user-supplied API keys. Keys are encrypted locally with Electron safeStorage and never copied into a CLI profile.
- The transparent pet renderer never receives a credential. The separate Settings renderer holds a newly typed API key only until it submits it once to the main process and clears the field; stored secrets can never be read back into either renderer.
- freemodel.dev credentials, real-provider credentials, custom-endpoint credentials, and CLI profiles never mix.

The app may open an official provider authentication flow; it does not become the authenticating client.

Anthropic's Agent SDK guidance says third-party developers generally may not offer Claude.ai login or subscription rate limits without approval. The Claude Code adapter is therefore a local official-CLI integration, not an embedded Claude.ai integration. Distribution retains a provider-terms review gate and makes no claim of provider partnership.

## Compliance and account safety

- One user action starts at most one prompt.
- There is no queue, background prompt loop, scheduled prompting, account pooling, or concurrent provider session.
- The app never silently retries a generation, changes providers, changes models, or invokes a fallback.
- Authentication, billing, rate-limit, timeout, and generation retries require another user action.
- Hooks may trigger free local animations in a future phase but may never send prompts.
- The app does not modify the user's existing freemodel.dev setup.
- No OpenAI, Anthropic, Codex, or Claude code, assets, branding, or trademarks are copied. Public sources may inform architecture only.
- Custom endpoints are visibly identified as third-party services with their own privacy, billing, and model behavior.

## Architecture

The Electron main process owns every privileged operation:

~~~text
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
                  - anthropicApi
                  - codexCli
                  - claudeCodeCli
                  - openAiCompatible
          |
          v
 selected provider API or installed official CLI
~~~

The transparent pet renderer remains vanilla JavaScript with contextIsolation enabled and nodeIntegration disabled. It draws the pet and sends user actions through a narrow preload bridge. A separate Settings renderer has a separate preload and may submit a new API key once, but cannot retrieve stored secrets or make network calls.

A separate response-bubble window is positioned beside the pet. This preserves the proven 192x208 pet window instead of enlarging its transparent click-blocking region. The response window shows setup, progress, replies, errors, and actions such as Connect AI, Stop, Retry, or Open Settings.

## Main-process components

### providerManager

providerManager owns the adapter registry, active connection, selected model and options, one-prompt busy guard, immutable execution snapshot, cancellation signal, normalized errors, and response attribution. It never contains provider-specific authentication or request code.

### providerStore

providerStore persists versioned non-secret connection metadata and safeStorage ciphertext. Encryption occurs only after Electron is ready and encryption is available. There is no plaintext fallback. Decryption failure leaves the connection unusable until the key is re-entered.

Removing an API connection deletes its ciphertext. Disconnecting a CLI connection only removes it from the pet; it does not globally log the user out of the official CLI.

### Provider adapters

Every adapter provides the same conceptual operations:

- getStatus(connection)
- beginSetup(input)
- testConnection(connection)
- listModels(connection)
- getCapabilities(connection, model)
- runPrompt(request, abortSignal)

Provider-specific model and effort values are normalized by the adapter. Unsupported controls are hidden rather than ignored.

### CLI isolation

Codex uses a dedicated CODEX_HOME and Claude Code uses a dedicated CLAUDE_CONFIG_DIR. The app invokes the official login and status commands inside those profiles but never reads profile files. Prompt processes use fixed command shapes, prompt text over stdin, no persistence, and the least available permissions:

- Codex: ephemeral, read-only, no project rules, no Git-repository requirement.
- Claude Code: print mode, safe mode, no session persistence, no Chrome, no slash commands, and an empty tool list.

Child environments strip freemodel.dev and unrelated provider overrides.

## Connection setup and switching

When a prompt arrives without an active connection, the response bubble says:

> I need an AI provider before I can answer.

It offers Connect AI and Not now. Connect AI opens Settings.

The setup flow is:

1. Choose a connection method.
2. Enter an API key, launch an official CLI login, or configure a custom endpoint.
3. Test the connection without billable generation when possible.
4. Choose a discovered or adapter-provided model.
5. Choose reasoning effort and other options supported by that model.
6. Save and activate the connection.

Settings always shows the active connection, health, model, supported effort, Test, Change, and Manage connections. The tray menu exposes quick connection, model, and effort choices. Changes made during a prompt apply only to the next prompt.

Remote custom endpoints require HTTPS. Plain HTTP is allowed only for an explicitly confirmed loopback host such as 127.0.0.1 or localhost. If model listing is unavailable, the user can enter a model ID manually. Any generation-based compatibility test is a separate, clearly labeled, potentially billable action.

## Prompt lifecycle

1. A user submits a terminal prompt or deliberately drops a file.
2. Main captures the active connection, model, effort, and supported options.
3. No active connection returns PROVIDER_REQUIRED and opens the setup path.
4. An active prompt returns PROVIDER_BUSY; nothing is queued.
5. The selected adapter runs exactly one request.
6. The response window receives a normalized thinking, response, stopped, or error event.
7. Busy state clears in a finally path.

Stop aborts a network request or terminates the CLI child. A stopped request is never retried automatically.

Initial file drop supports regular UTF-8 text files up to 262144 bytes. Main reads the file only after the deliberate drop, includes its basename and text inside an explicit untrusted-data boundary, and never sends the full local path. Directories, binary files, invalid UTF-8, oversized files, and read failures produce FILE_UNSUPPORTED. Rich binary/image attachments remain outside the provider-neutral MVP because their support and request shape differ by provider.

## Error and privacy requirements

Stable error categories include PROVIDER_REQUIRED, CLI_NOT_INSTALLED, AUTH_REQUIRED, INVALID_CREDENTIALS, CONNECTION_FAILED, RATE_LIMITED, QUOTA_OR_BILLING, MODEL_UNAVAILABLE, UNSUPPORTED_OPTION, PROVIDER_BUSY, REQUEST_TIMEOUT, REQUEST_STOPPED, PROVIDER_OUTPUT_INVALID, and SECRET_STORE_FAILED.

The response bubble shows a short explanation and one useful action. Settings may show sanitized technical details and a safe provider request ID.

Logs omit prompt contents by default and redact keys, tokens, authorization headers, cookies, secret-bearing URLs, raw provider responses, environment dumps, and untrusted child-process stderr. Main-to-renderer IPC returns masked secret metadata only.

## Offline verification and packaging

The canonical automated suite uses mocked fetch and child-process boundaries; it never requires a paid key or subscription. A local mock OpenAI-compatible server provides a real offline end-to-end prompt path for final verification.

Required coverage includes:

- Adapter contract and error normalization.
- Encrypted store save, load, remove, corruption, and unavailable-encryption cases.
- One-prompt busy guard, immutable selection, cancellation, and no fallback.
- API model discovery and capability-aware effort controls.
- CLI installed, missing, signed-out, timeout, malformed-output, and nonzero-exit behavior.
- freemodel.dev sentinel isolation.
- Stored secrets never returning over IPC or entering the pet renderer.
- No-provider setup, connected, busy, response, error, stop, switch, and recovery UI states.
- Windows x64 packaged build launch with an empty provider store and no embedded credentials.

Real-provider smoke tests are optional and run only when the tester already has a suitable account or key. Lack of a provider must not block implementation, testing, visual QA, or packaging.

## Non-goals

- macOS or Linux packaging.
- Autonomous prompts, tool-using pet agents, account pooling, or prompt queues.
- Cloud sync, telemetry, or stored prompt history.
- Automatic OAuth, credential import, or provider-token inspection.
- Automatic provider/model fallback.
- Universal model names or universal effort values.
- Full Shimeji movement physics or new sprite generation in the provider redesign.

## Research method

Research means broad investigation, not official-documentation lookup alone. Planning may use primary docs and API schemas, source code, open-source apps, issue trackers, maintainer discussions, engineering articles, comparisons, demos, and community reports.

Primary sources or directly verified behavior anchor authentication, security, API contracts, provider restrictions, and current CLI commands. Open-source and community evidence informs patterns and failure cases. Conflicting, stale, or uncertain findings are labeled rather than converted into confident requirements. Research can change the spec or plan after review; it is not permission to implement.

## Source material

- docs/RESEARCH.md — durable research findings and architectural rationale.
- docs/project-context.md — per-session framework and execution contract.
- docs/superpowers/plans/2026-07-13-claude-pet.md — canonical task sequence.
- Existing sprite source: Z:\Downloads\Code\Arnav Vijay\.hatch-pet-runs\post-hoc-banana-baron\
- Electron safeStorage documentation.
- OpenAI API key, Responses API, Codex authentication, non-interactive, and model documentation.
- Anthropic Messages API, Models API, Claude Code CLI, and Agent SDK authentication guidance.
- Cherry Studio and LibreChat provider registries as comparative open-source patterns.
