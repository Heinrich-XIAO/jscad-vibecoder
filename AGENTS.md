# Local Agent Guidelines

## Response Completion
* **ALWAYS** use the `question` tool to present options for the next steps instead of asking "Would you like me to..." in the text.
* **EXCEPTION:** Do NOT use the `question` tool if you have no relevant suggestions or choices to offer.
* **EXCEPTION (Codex models):** If the active model is Codex (for example, `gpt-5.3-codex`), responses may be completed directly without using the `question` tool.
* **ALWAYS** send a final user-facing response after any tool calls. Tool output alone is not a response.
* If a tool call fails or returns empty data, still respond with what happened and what you did next.

## Subagent Policy
* If you are Opus 4.5 or another Anthropic model, do not spin up subagents since that would cost a lot of money.

## System Prompt
* The project system prompt lives in `src/server/routers/codegen.ts` inside `buildSystemPrompt(...)`.

## Local Auth Flag
* To disable Clerk in local/dev testing (and remove the keyless popup overlay), set `NEXT_PUBLIC_DISABLE_CLERK=1`.
* This flag bypasses Clerk provider/hooks and runs the app in guest mode.
* For consistency across server/client paths, set `DISABLE_CLERK=1` alongside `NEXT_PUBLIC_DISABLE_CLERK=1`.

## Mistake Log
* If you make a mistake that costs a significant amount of time, write it down in this file for future agents.
 
## Commit & Push Policy (project-local override)
* After finishing a requested code change or feature, the agent SHOULD create a commit and push it to the repository remote so changes are persisted and visible to collaborators.
  - When committing, always commit only the changes YOU made.
  - This is a project-level override to the default agent behavior; use with caution.
  - Agents must double-check `git status` before staging to confirm only their files are included and no unrelated changes slip into the commit.
  - Pushes must never be forced or involve git config changes. If a push is rejected because the remote changed, stop and notify a human.
  - Do not commit secrets or credentials. If changes include potential secrets, abort the push and notify the user.
  - If a pre-commit hook fails, do not amend the commit; instead surface the failure and let a human resolve it.

## Playwright MCP Testing
* If you want to test with the Playwright MCP, first commit your changes and merge them into `main`.
* After that, test against [http://localhost:3000](http://localhost:3000).
