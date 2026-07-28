# Codex-First Connection Slice

**Status:** Approved execution direction
**Date:** 2026-07-28

## Goal

Make the accepted unified Settings view capable of creating, editing, testing, and signing in to a
real Codex connection without exposing credentials or weakening the existing execution boundary.

## User flow

Settings gains an inline **Set up Codex** editor. It has a project folder, the supported Codex
model and reasoning-effort lists, and an explicit access choice. **Full computer access** is the
available default and stays visibly warned. **Workspace only** remains shown but unavailable until
the separately approved WSL boundary exists; selecting it never falls back to Full Computer.

Saving passes the complete draft only to the existing main-owned Full Computer authorization
boundary. The renderer never receives or asks for credentials. Saving a Codex connection does not
silently replace the selected session participant; the existing explicit **Use for active agent**
action still governs that provider switch.

Each saved Codex card exposes **Test connection**, **Sign in to Codex**, and **Edit**. Test and
sign-in are targeted to that exact connection, rather than the global active selection. Test shows
installed/sign-in/access status next to the editor. Sign-in launches the official visible Codex CLI
flow and reports only that it opened; account completion remains outside the application.

## Main-process boundary

Add connection-id-targeted status, permission, and setup delegation to the existing Agent Manager.
`app:intent` validates a saved public connection id, then invokes those methods without changing the
active participant or connection selection. The existing authorization object remains the only save
path for Full Computer. Public error mapping crosses IPC; raw CLI output, auth directories, tokens,
and secrets do not.

## Feedback and failure

The Settings view retains a small rendered result message across snapshot rerenders. It tells the
user whether a save succeeded, whether Codex is installed/signed in, that official sign-in opened,
or the existing public recovery message. Pending actions disable only their own controls. Cancelled
Full Computer confirmation leaves no connection, and failed status/setup actions leave the saved
connection unchanged.

## Out of scope

No WSL installation, Workspace execution, Claude flow, provider API credentials, real agent task,
parallel agents, or visual-shell redesign belongs to this slice. Offline Demo remains clearly
labelled as a demo and must not claim it changed files it did not change.

## Verification

TDD covers exact-connection delegation, authorization cancellation, editor save/edit validation,
visible test/setup feedback, and error paths. A fresh packaged profile is exercised through CDP for
save/restart, Test, official OAuth launch, cancellation/failure, and existing Offline Demo controls.
OAuth completion is the sole user gate.
