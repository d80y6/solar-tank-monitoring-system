# Domain Model and Calculations

This document explains the formulas and statuses at the core of the monitoring system.

## Key Concepts

The sensor usually reads the distance from the sensor to the liquid surface.

What users want to see is liters, percent, and runtime.

That is why conversion is needed:

```text
distance -> fuel height -> volume -> percent -> runtime -> status
```

## Fuel Height

If the sensor is mounted above the tank:

```text
fuelHeightCm = sensorMountHeightCm - sensorDistanceCm
```

Example:

```text
sensorMountHeightCm = 150
sensorDistanceCm = 40.5
fuelHeightCm = 109.5
```

Values must be clamped so they are not below 0 and do not exceed the tank's maximum height.

## Horizontal Cylinder Tank Volume

For a horizontal cylinder tank, volume is not linear against height.

That means:

```text
a 50% height cannot always be treated as a 50% volume without the correct formula.
```

Circular segment area formula:

```text
r = tank radius
h = liquid height
L = tank length

area = r^2 * acos((r - h) / r) - (r - h) * sqrt(2*r*h - h^2)
volumeLiter = area * L / 1000
```

The calculation code lives at:

```text
src/features/monitoring/lib/tank-volume.ts
```

## Rectangular Tank Volume

For a rectangular tank, volume is simpler.

```text
volumeLiter = lengthCm x widthCm x liquidHeightCm / 1000
```

Example calculation:

```text
length = 150 cm
width  = 60 cm
liquid height = 49.8 cm

volume = 150 x 60 x 49.8 / 1000
       = 448.2 liters
```

If the tank capacity is 540 liters:

```text
448.2 / 540 x 100 = 83%
```

Real-format payloads can carry rectangular configuration from the device. The system still compares that configuration with the registry so large differences are not hidden.

## Fill Percentage

```text
fillPercent = volumeLiter / capacityLiter * 100
```

Example:

```text
volumeLiter = 3650
capacityLiter = 5000
fillPercent = 73
```

## Runtime

Runtime is an estimate of how many hours the fuel lasts if hourly consumption matches the assumptions.

```text
runtimeHour = volumeLiter / consumptionLiterPerHour
```

Example:

```text
volumeLiter = 3650
consumptionLiterPerHour = 25
runtimeHour = 146
```

The runtime code lives at:

```text
src/features/monitoring/lib/runtime.ts
```

## Runtime Status

Initial rules:

| Runtime | Status |
|---:|---|
| `< 13 hrs` | Critical |
| `13 - < 16 hrs` | Warning |
| `16 - 24 hrs` | Limited safe |
| `> 24 hrs` | Long safe |

These rules may change after operational validation.

## Device Status

A device is judged by the age of its latest data compared to the expected send interval.

Example:

```text
expectedReportIntervalSec = 20
```

That means the device is expected to send every 20 seconds. This value comes from the device registry/profile and can differ for demo devices or bandwidth-saving modes. Online/delayed/offline status always uses the registered device values, not numbers hardcoded in the UI.

If the latest data is too old, the status can become delayed or offline.

## Payload Normalization

Device payloads can have field name variations.

The normalizer makes them uniform.

Example mapping:

| Incoming payload | Internal field |
|---|---|
| `distance` | `sensorDistanceCm` |
| `raw.H_cm` | `fuelHeightCm` |
| `raw.volume` | `volumeLiter` |
| `raw.percent` | `fillPercent` |
| `raw.wifi_rssi` | `rssiDbm` |
| `voltage` | `batteryVolt` |
| `raw.local_H_cm` | `fuelHeightCm` |
| `raw.local_volume_l` | `volumeLiter` |
| `raw.local_percent` | `fillPercent` |
| `tank_shape` | payload config snapshot |
| `capacity_liter` | payload config snapshot |
| `consumption_liter_per_hour` | payload config snapshot |

Normalizer code:

```text
src/features/monitoring/lib/normalize-reading.ts
```

## Why Tests Are Needed

Volume, runtime, and status numbers affect operational decisions.

That is why the domain logic must be tested.

Tests live at:

```text
src/features/monitoring/tests
```

Run:

```powershell
pnpm test
```
