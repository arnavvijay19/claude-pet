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

## User's explicit constraint

"push Fable 5 to the best of its ability but not waste my usage" — every task in the plan must default to the cheapest correct approach (mirror over regenerate, one worker at a time, small reference images, no unnecessary visual PNG opens, self-contained subagent tasks that never have to re-derive context).

## Source material

- Sprite pipeline handoff: `Z:\Downloads\Code\Arnav Vijay\.hatch-pet-runs\post-hoc-banana-baron\HANDOFF_FOR_CLAUDE.md` (2 of 10 animation rows done: `base`, `idle`; 8 pending: `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`).
- Codex's pet packaging schema (to mirror, for consistency): `~/.codex/pets/<pet_id>/pet.json` + `spritesheet.webp`.
- Visual identity rules (must be preserved across any newly generated frames): pixel-art mischievous monkey, black sunglasses, banana, money bundle/bills, magenta `#FF00FF` background, no text/logos/shadows/speed-lines.
