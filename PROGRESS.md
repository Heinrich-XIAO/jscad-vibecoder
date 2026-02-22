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

## Notes
- Metadata changes are additive and do not change existing `getModel()` behavior.
- Gear phase metadata encodes the bundled helper's quarter-tooth initial phase behavior.
