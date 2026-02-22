# Mechanism Kinematics Roadmap (Metadata-First + Autodetect Fallback)

## Goal

Build a unified motion system where:
- each mechanism defines movement relative to one input,
- pitch features come from library metadata when available,
- fallback autodetection is used only when metadata is missing,
- global feasible range of motion (ROM) is solved from all constraints,
- UI and agents animate only within that solved ROM.

## Phase 0 - Foundations (MVP Plumbing)

### Files
- `src/lib/kinematics/types.ts` (new)
- `src/lib/kinematics/registry.ts` (new)
- `src/lib/kinematics/features.ts` (new)

### Functions
- `types.ts`
  - `type MechanismFeature`
  - `type PitchCircleFeature`
  - `type PitchLineFeature`
  - `type KinematicConstraint`
  - `type MechanismSpec`
  - `type RomSolution`
- `registry.ts`
  - `registerMechanismSpec(name, spec)`
  - `getMechanismSpec(name)`
- `features.ts`
  - `extractDeclaredFeatures(spec)`
  - `mergeDeclaredAndDetectedFeatures(declared, detected)`

### Acceptance Criteria
- Shared types exist and are importable from server + worker paths.
- No geometry logic yet, just schema and registration.

---

## Phase 1 - Library Metadata Emission (Gear + Rack)

### Files
- `public/jscad-libs/mechanics/gears.jscad`
- `public/jscad-libs/mechanics/racks.jscad`

### Functions
- Add metadata accessors on returned objects:
  - `getPitchFeatures()`
  - `getKinematicDefaults()`
- Gear metadata should include:
  - `pitchCircle.center`
  - `pitchCircle.radius`
  - `axis`
  - `module`, `teethNumber`, `pressureAngle`
- Rack metadata should include:
  - `pitchLine.point`
  - `pitchLine.direction`
  - `pitchLine.normal`
  - `module`, `pressureAngle`

### Compatibility Rule
- Keep existing `getModel()` behavior unchanged.
- Metadata is additive; old scripts continue to run.

### Acceptance Criteria
- Existing gear/rack scripts render exactly as before.
- New metadata methods return serializable objects.

---

## Phase 2 - Autodetect Fallback

### Files
- `src/lib/kinematics/detect.ts` (new)
- `src/lib/geometry-analyzer.ts` (extend)

### Functions
- `detectPitchFeaturesFromParams(context)`
- `detectPitchFeaturesFromGeometry(geometry)`
- `detectPitchFeatures(context)` returns `{ features, confidence, source }`

### Detection Order
1. explicit metadata (from libs)
2. known constructor params (module/teeth/diameter)
3. geometric heuristics (radial/linear profile)

### Acceptance Criteria
- `source` is one of: `metadata | params | geometry`.
- low-confidence results include warnings.

---

## Phase 3 - Constraint Graph + ROM Solver (Gear/Rack First)

### Files
- `src/lib/kinematics/constraints.ts` (new)
- `src/lib/kinematics/solver.ts` (new)

### Functions
- `buildConstraintGraph(parts, features)`
- `addGearGearConstraint(...)`
- `addGearRackConstraint(...)`
- `solveRomInterval(inputDomain, constraints)`
- `sampleConstraintResiduals(solution, nSamples)`

### Initial Constraint Set
- gear-gear center distance: `d = r1 + r2 (+ backlash)`
- gear-rack tangency: gear center to pitch line distance: `d = r (+ backlash)`
- optional user limits: angle/travel bounds

### Acceptance Criteria
- Returns `uMin`, `uMax`, active constraints, and first failing sample if invalid.

---

## Phase 4 - Tool Integration

### Files
- `src/server/routers/codegen.ts`

### Functions/Changes
- Extend `measure_geometry` output with:
  - `features[]`
  - `featureSource`
  - `featureConfidence`
- Extend `check_alignment` with:
  - numeric residuals
  - pass/fail thresholds
  - optional `romSampleReport`
- Add new tool:
  - `solve_mechanism_rom`
  - input: parts/features/limits
  - output: `uMin/uMax`, diagnostics

### Acceptance Criteria
- Agent can ask for solved ROM and use it to drive normalized `progress`.

---

## Phase 5 - Runtime Motion Contract (Developer-Abstracted)

### Files
- `src/app/project/[id]/project-client.tsx` (parameter handling)
- `src/components/geometry-info.tsx` (show ROM diagnostics)

### Contract
- Standard mechanism parameter:
  - `progress` in `[0,1]`
- optional playback params:
  - `autoPlay`, `durationSec`, `direction`
- mapping:
  - `u = lerp(uMin, uMax, progress)`

### Acceptance Criteria
- Users manipulate one slider for full mechanism ROM.
- Solver-constrained motion prevents invalid poses.

---

## Phase 6 - Prompt + Agent Behavior

### Files
- `src/server/routers/codegen.ts` (`buildSystemPrompt(...)` section)

### Prompt Rules
- Prefer metadata pitch features from supported libraries.
- Fallback to autodetect once when missing.
- If confidence is low, surface warning and conservative defaults.
- Always express mechanism playback through normalized `progress`.

### Acceptance Criteria
- Generated mechanism scripts consistently expose `progress` as primary motion control.

---

## Test Plan

### Files
- `src/lib/kinematics/__tests__/solver.test.ts` (new)
- `src/lib/kinematics/__tests__/detect.test.ts` (new)
- `src/lib/kinematics/__tests__/gear-rack-rom.test.ts` (new)

### Tests
- metadata-first selection beats autodetect fallback
- autodetect confidence scoring behavior
- gear-rack solved ROM correctness
- conflicting constraints return informative failure
- translated v1 library geometries remain visible in viewport (regression)

---

## Delivery Order

1. Phase 0 + 1 (schema + metadata emitters)
2. Phase 2 (fallback detection)
3. Phase 3 (ROM solver)
4. Phase 4 (tool integration)
5. Phase 5 + 6 (UI motion contract + prompt rules)

## Notes

- Keep all geometry libraries backward compatible.
- Prefer explicit metadata whenever available.
- Do not silently trust low-confidence autodetect for tight meshing logic.
