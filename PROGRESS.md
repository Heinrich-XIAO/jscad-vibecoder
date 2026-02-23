# Project Progress

## Completed
- Fixed pane resizing in stack layouts (leftStack/rightStack) by using correct flex ratios for stack containers instead of flex-1.
- Added persistent chat prompt queue with FIFO processing:
  - users can submit new prompts while an agent run is in progress
  - prompts are stored in Convex and processed sequentially after current run
  - queue survives refreshes/crashes with stale-runner recovery + heartbeat
  - UI now shows queued prompt count during active generation
- Rack helper now throws for invalid explicit length/module combinations:
  - positive `length` must be an exact multiple of `module * PI`
  - removed silent rounding to nearest tooth count for explicit lengths
  - added regression test for invalid-length rejection
- Added server-side guardrails to prevent assistant from dumping full JSCAD code in chat responses:
  - detects code-like assistant output (fenced blocks/JSCAD patterns)
  - forces retry with strict plain-language-only system instruction
  - reinforces final-response prompt to avoid code blocks
- Added mechanism phase metadata accessors to gear and rack libraries:
  - `getPitchFeatures()`
  - `getKinematicDefaults()`
  - `getPhaseMetadata()`
- Added codegen tool `check_animation_intersections` for gear-rack animation diagnostics:
  - radial meshing residuals
  - translation/rotation kinematic residuals
  - phase residuals and recommended phase shift
- Extended prompt guidance for normalized `progress` motion contract and animation-phase diagnostics.
- Strengthened system prompt phase guidance to require iterative phase-misalignment correction:
  - always run diagnostics for phase residuals
  - apply recommended phase correction
  - rerun until no phase misalignment remains
- Added tests for metadata exposure and animation diagnostic tool wiring.
- Gear library now aligns the initial phase to half the tooth thickness (no gap), matching rack-centered expectations.
- Added a viewport snapshot button that captures the current 3D view and injects the image into the chat prompt for richer context.
- Fixed codegen prompt handling to convert markdown image attachments into true multimodal `image_url` message parts for OpenRouter models.
- Chat input now has a dedicated image-attachment strip with removable thumbnail previews; queued prompts persist image attachments separately and send them as multimodal inputs.
- Improved project page pane resizing on constrained viewports by scaling minimum split constraints when panes cannot all satisfy hard mins, preventing stuck chat resize behavior and unintended adjacent pane collapse.
- Added a reset-layout control on the project page toolbar to restore default pane order/sizes after aggressive dragging/resizing.
- Updated 3-pane drag/drop stacking behavior for vertical drops:
  - dropping one pane above/below another now prefers a side stack layout over collapsing into 3 horizontal rows
  - when dropping viewport onto code (top/bottom), chat stays as the single pane on the opposite side and code+viewport stack vertically
- Tuned chat input padding with image attachments so adding an image only increases input bottom space slightly (roughly thumbnail height) instead of causing a large jump.
- Rebalanced default 3-pane ratios to prioritize viewport visibility on initial load, reducing cases where the viewport starts too cramped on narrower windows.
- Added initial narrow-window auto-compaction: when 3 columns cannot fit pane minimum widths, layout now switches to a side-stack (code+viewport stacked, chat opposite) so viewport is immediately visible.
- Made `/project/:id` accessible while signed out for local layout debugging: project page now loads in guest mode with starter code and a visible viewport.
- In guest mode, chat attempts now return a clear auth error (`You are not logged in. Sign in to use the agent.`) instead of trying to run the agent.
- Added a codegen tool `get_viewport_snapshot` so the agent can request the current 3D viewport image during a run; tool responses now attach the snapshot as multimodal image content when available.

## Notes
- Metadata changes are additive and do not change existing `getModel()` behavior.
- Gear phase metadata encodes the bundled helper's quarter-tooth initial phase behavior.
