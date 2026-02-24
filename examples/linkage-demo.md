# Linkage Tool Demo

This example shows how to call the new `linkage` tool with the compact `coord(...)` inputs and what the tool returns for a rack-and-pinion relationship.

## Input
Use two motions that only move along a single axis and rotate around a single axis. In JSON form these can be tuples (the JSON representation of `coord(...)`):

```json
{
  "motionA": {
    "initial": [0, -2, 0],
    "final": [0, 2, 0]
  },
  "motionB": {
    "initial": [10, 0, 0, 0, 0, 0],
    "final": [10, 0, 0, 0, 0, 50]
  }
}
```

The first motion describes a pure translation along the Y axis (4 mm total travel), and the second motion describes a rotation around the Z axis (50°).

## Expected behavior

1. The tool identifies `motionA` as the translation and `motionB` as the rotation (opposite association works as long as each motion stays single-axis).
2. It computes the pitch radius via

   
   pitchRadius = |Δlinear| / (|Δtheta| * π/180) ≈ 4mm / (50° * π/180) ≈ 4.58mm

3. It returns both forward/inverse equations for driving the mechanism with one `progress` parameter:

   ```text
   expectedTranslationMm = translation0 + 4 * progress
   expectedRotationDeg  = rotation0 + 50 * progress
   ```

4. The metadata also includes the dominant axes (`linearAxis: y`, `rotationalAxis: rotZ`), sign conventions, and guidance on solving the final offsets from the provided endpoints.

This information can then be fed into generated JSCAD code so the pinion and rack move together without manual linkage math.
