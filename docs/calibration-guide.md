# Tank and Device Calibration Guide

The application converts a distance reading into a fuel height, a volume, and a
fill percentage. Those numbers are only as good as the physical measurements
behind them. This guide is the procedure for verifying — and correcting — the
values that make that conversion true for one tank.

A tank is **calibrated** when a physical dip and the application agree to within
the tolerance agreed with the site operator (the pilot target is ±3 % of full
capacity). Until then, the dashboard is an indicator, not a measurement.

## 1. What Must Be Measured

| Value in the registry | Where it comes from | How to verify |
|---|---|---|
| `capacity_liter` | Tank nameplate or a calibrated refill (litres added ÷ fill fraction change) | Compare the nameplate with a recorded refill; a 5 % error here moves every percentage |
| `shape` (`horizontal-cylinder` / `rectangular`) | The physical tank, not the drawing | Look at the tank |
| `diameter_cm`, `length_cm` (cylinder) | Tape measure, inside the shell | Measure twice, from a fixed reference |
| `length_cm`, `width_cm`, `height_cm` (rectangular) | Tape measure | Same |
| `sensor_mount_height_cm` | Distance from the sensor face to the tank floor | Measure after the sensor is mounted, not before |
| `low_level_percent`, `critical_level_percent` | The site's operating policy | Agree the values with the operator in writing |
| `consumption_liter_per_hour` | Average use of the equipment the tank feeds | Derive from a period with known refills |

The sensor's own readings — `distance_cm`, `fuel_height_cm` — are what the
firmware sends. Everything else above is reference data the server uses.

## 2. Before You Start

- [ ] The device is installed, powered, and reporting (visible on the device
      registry page and on the tank detail page).
- [ ] You can edit the tank registry values (an administrator account).
- [ ] You have a dipstick or a calibrated measuring tape accurate to ±1 cm.
- [ ] The tank is stable: not being filled or drawn from during the measurement.
- [ ] The site operator is present and knows what you are doing.

Safety first: fuel vapour, confined spaces, and hot surfaces are site hazards.
Follow the site's permit and safety rules, and never open a tank you are not
authorised to open.

## 3. Procedure

### Step 1 — Record the current state

Capture a screenshot or note of the tank page: current fill percentage, volume,
and fuel height. Record the sensor distance the dashboard shows.

### Step 2 — Measure the physical level

1. Dip or measure the actual fuel height, `H_physical`, from the tank floor.
2. Note it in centimetres and in litres using the tank's geometry
   (the application's own volume formula is documented in `docs/data-model.md`).
3. Repeat the measurement three times if the surface is moving.

### Step 3 — Compare

| Comparison | Formula | Target |
|---|---|---|
| Level | `H_physical` vs the app's `fuel_height_cm` | ±2 cm |
| Volume | physical litres vs the app's `volume_liter` | ±3 % of capacity |
| Sensor geometry | `sensor_mount_height_cm` vs (`distance_cm` + `fuel_height_cm`) | ±1 cm |

If the sensor geometry does not add up, the mount height is wrong — fix that
before touching thresholds.

### Step 4 — Correct the registry

1. Open the tank in the registry (dashboard → tank → edit, or the pilot registry
   tooling for bulk work).
2. Correct the measured value that is wrong: capacity, geometry, or mount
   height.
3. Never adjust `low_level_percent` or `critical_level_percent` to make a wrong
   measurement look acceptable. Thresholds are policy; they are not calibration.
4. Save. The next reading recalculates with the corrected reference data.

### Step 5 — Confirm

1. Wait for at least two reporting intervals.
2. Compare again (Step 3). Repeat until inside tolerance, or stop and escalate if
   the sensor itself is suspect: a sensor that disagrees with two independent
   physical measurements is faulty, not misconfigured.
3. Ask the operator to confirm the level looks right on the tank page.

### Step 6 — Record

Copy this block into the site record (not into Git, if it contains real
locations or readings):

```text
Tank calibration record
-----------------------
Date:
Tank:                  <tank id / name>
Site:                  <site / STO>
Device:                <device code>
Operator on site:
Measured by:

Physical measurement:   H = ___ cm        Volume = ___ L
Application before:     H = ___ cm        Volume = ___ L   Fill = ___ %
Difference:             ___ cm            ___ L             ___ %

Values changed:         <capacity / geometry / mount height / none>
Confirmed after:        H = ___ cm        Volume = ___ L   Fill = ___ %

Sensor health:          <normal / suspect: describe>
Result:                 <within tolerance / outside tolerance — escalated>
Notes:
```

## 4. Refill Verification

The most reliable calibration check is a refill:

1. Record the fill percentage before the refill.
2. Record the litres actually delivered (from the delivery note).
3. After the refill settles, record the new fill percentage.
4. Check that `litres delivered ≈ capacity × (fill_after − fill_before) / 100`.
   A persistent error means the capacity value is wrong.

Schedule one refill verification per tank during the pilot, and record it with
the calibration record above.

## 5. Threshold Setting

After calibration, agree the warning and critical levels with the operator:

| Threshold | Meaning | Typical basis |
|---|---|---|
| `critical_level_percent` | Below this the equipment must not run | Equipment's minimum feed requirement plus one day of consumption |
| `low_level_percent` | Time to order fuel | Consumption × delivery lead time ÷ capacity |
| `consumption_liter_per_hour` | Used for the runtime estimate | Measured over a full operating cycle, not a single day |

The runtime estimate (`status.ts`) classifies remaining runtime as critical under
13 hours, warning under 16 hours, and limited at or under 24 hours. If those
boundaries do not fit a site's lead time, change the site's consumption and
thresholds — do not change the formulas in code without a recorded decision.

## 6. Limitations to State Honestly

- The ultrasonic sensor measures one point and assumes a flat liquid surface;
  a tilted tank or a baffled compartment reads low.
- Vapour, foam, and condensation on the transducer cause sporadic errors; the
  firmware reports `ultra_*_samples` counts in the payload so those can be
  spotted.
- Ambient temperature changes the speed of sound; the error over a normal day is
  small but real.
- The application computes volume from geometry. A tank that has deformed, or
  has an internal slope, will differ from that geometry.
- Telemetry is an aid. A physical dip before a critical operation is still the
  authoritative check.
