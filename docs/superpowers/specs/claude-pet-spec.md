# Claude Pet — Spec

## What this is

A desktop companion pet for the **Claude Code Desktop app**, visually and behaviorally similar to the Codex Desktop app's pet feature, but distinct from it and from the user's existing Claude Code CLI install:

- The user's CLI (`claude` on PATH, `C:\Users\eklip\.local\bin\claude`) is routed through a free-tier proxy (freemodel.dev). This pet must NOT go through that path — it authenticates as the user's actual Claude account (currently a Desktop-app free trial).
- The user already has a Codex-side pet (`post-hoc-banana-baron`, a pixel-art monkey — sunglasses, banana, money bundle) built via a Codex "hatch-pet" skill run at `Z:\Downloads\Code\Arnav Vijay\.hatch-pet-runs\post-hoc-banana-baron\`. He said explicitly: reuse that sprite rather than commissioning new art.
- It should be draggable onto files (drag a file onto the pet to hand it a prompt/task about that file) and should accept prompts typed from a terminal, not just its own window.

## Non-goals (out of scope for this plan)

- No changes to the existing Claude Code CLI or its freemodel.dev routing.
- No macOS/Linux support — user is on Windows only (confirmed via `machine-specs` memory: Ryzen 5 2600 / GTX 1660 Ti / 16GB).
- No new sprite art commissioning — reuse/finish the existing hatch-pet run only.
- Nothing that violates the Terms of Service or Usage Policy of Anthropic, OpenAI, or any other provider — see "Compliance & account safety" below.

## Compliance & account safety (hard requirement)

Context: the user's real Claude account was suspended once (2026-07-13, Usage Policy cited, exact cause unconfirmed — possibly concurrent sessions on a free trial). This project must not create a second incident, and must not create copyright/IP exposure. Concretely:

- **One account, one session, one prompt at a time.** The pet talks to the real Claude account only through the official `claude` CLI's normal auth flow. It never runs concurrent sessions, never queues/batches automated prompt storms, and every prompt is user-initiated (typed or dragged) — no autonomous polling or scheduled prompting.
- **No proxies on the real account.** The real-account path must never be routed through freemodel.dev or any similar third-party endpoint, and must never touch their credentials. Those proxies are a separate, pre-existing setup on separate credentials; this project neither uses nor modifies them. (Whether those proxies are themselves ToS-compliant is outside this project's scope — but nothing here may blur the two credential sets together.)
- **No rate-limit or auth circumvention.** Config isolation (`CLAUDE_CONFIG_DIR`) exists to keep credentials *separate*, not to multiply usage or dodge limits. Never automate login/OAuth on the user's behalf.
- **IP safety.** The pet is an independent implementation *inspired by* the Codex pet feature — no OpenAI/Codex code, assets, branding, or trademarks are copied. The only art used is the user's own hatch-pet-generated sprite. Mirroring Codex's `pet.json` folder *convention* (a file layout) is fine; shipping their files is not.

## User's explicit constraint

"push Fable 5 to the best of its ability but not waste my usage and don't trigger usage violations" — every task in the plan must default to the cheapest correct approach (mirror over regenerate, one worker at a time, small reference images, no unnecessary visual PNG opens, self-contained subagent tasks that never have to re-derive context).

## Source material

- Sprite pipeline handoff: `Z:\Downloads\Code\Arnav Vijay\.hatch-pet-runs\post-hoc-banana-baron\HANDOFF_FOR_CLAUDE.md` (2 of 10 animation rows done: `base`, `idle`; 8 pending: `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`).
- Codex's pet packaging schema (to mirror, for consistency): `~/.codex/pets/<pet_id>/pet.json` + `spritesheet.webp`.
- Visual identity rules (must be preserved across any newly generated frames): pixel-art mischievous monkey, black sunglasses, banana, money bundle/bills, magenta `#FF00FF` background, no text/logos/shadows/speed-lines.
