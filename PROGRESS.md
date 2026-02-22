# Project Progress

## Completed
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
- Updated 3-pane drag/drop stacking behavior for vertical drops:
  - dropping one pane above/below another now prefers a side stack layout over collapsing into 3 horizontal rows
  - when dropping viewport onto code (top/bottom), chat stays as the single pane on the opposite side and code+viewport stack vertically

## Notes
- Metadata changes are additive and do not change existing `getModel()` behavior.
- Gear phase metadata encodes the bundled helper's quarter-tooth initial phase behavior.
