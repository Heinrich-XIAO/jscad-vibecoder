# Local Agent Guidelines

## Response Completion
* **ALWAYS** use the `question` tool to present options for the next steps instead of asking "Would you like me to..." in the text.
* **EXCEPTION:** Do NOT use the `question` tool if you have no relevant suggestions or choices to offer.
* **EXCEPTION (Codex models):** If the active model is Codex (for example, `gpt-5.3-codex`), responses may be completed directly without using the `question` tool.

## Subagent Policy
* If you are Opus 4.5 or another Anthropic model, do not spin up subagents since that would cost a lot of money.

## Project Status
* **ALWAYS read [PROGRESS.md](./PROGRESS.md) first** before starting work
* Check what features are completed vs remaining
* Understand the current tech stack and architecture
* Review known issues and next steps
* Update PROGRESS.md when completing features
