# Claude Pet Core V1

Windows 10 22H2 (build 19045+) or Windows 11 x64 and Node 22.12+ are required for development. Run `npm.cmd install`, `npm.cmd test`, then `npm.cmd start`.

Core V1 needs no WSL, Linux distro, API key, or telemetry. Create an Offline Demo connection in Settings, submit a loopback goal, or deliberately drop one UTF-8 text file. Outside-Workspace files require an explicit one-file disclosure; their parent folders are never shared.

New Codex/Claude connections default to warned **Full Computer**, which can access the whole PC and remains permanently badged. Offline Demo uses Workspace. Real-provider Workspace is optional post-V1 work and is not installed by this package. Agents/sessions keep only encrypted bounded visible history; provider-native auth, config, and resume state are never shared.

The portable unsigned package is `dist/Claude Pet-win32-x64`; SmartScreen may warn. Quit before deleting it. User data, encrypted sessions, connection metadata, and official provider CLI auth are separate and are never removed automatically. This is a private test build with no bundled credentials or provider affiliation; recheck terms before distribution.
