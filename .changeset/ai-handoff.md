---
'my-pi': minor
---

Upgrade the built-in handoff extension to use AI-generated session
transfer prompts.

The `/handoff` command now:

- summarizes the current branch conversation with the active model
- asks the user to review and edit the generated prompt
- creates a new session linked to the current one
- prefills the editor in the new session with the handoff prompt

This replaces the older file-based handoff export flow.
