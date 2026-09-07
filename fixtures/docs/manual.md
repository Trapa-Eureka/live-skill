<!-- Self-authored document (CLAUDE.md guardrail 4), written by this project for the fictional device
     "SkillSync X200". Not related to any real product. -->

# SkillSync X200 User Manual

The SkillSync X200 is a fictional bench-top controller used only as a test fixture for this
project. Any resemblance to a real product is coincidental.

## Overview

The X200 reads sensor input over a serial bus and reports status through three LEDs: power,
link, and fault. It ships with a single control button and a recessed reset pin.

## Package Contents

The box includes the X200 unit, a USB-C cable, a quick-start card, and a spare fuse.

## Installation

### Prerequisites

The X200 requires a host computer running the SkillSync Console, version 4 or later, and a free
USB-C port capable of supplying 500 mA.

### Mounting

Mount the unit on a flat, grounded surface using the two M3 screw holes on the base plate.

## Configuration

### Network Settings

Open the Console, select the X200 from the device list, and assign a static address in the
192.168.50.0/24 range. The default address is 192.168.50.10.

### Sensor Calibration

Run the guided calibration wizard once per sensor. Calibration values are stored on the unit,
not on the host, so they survive a factory reset of the Console.

## Basic Operation

Press the control button once to arm the unit and twice to enter standby. The link LED blinks
while the unit searches for the host and stays solid once connected.

## Advanced Settings

### Logging

The X200 can log up to 30 days of sensor readings to its internal flash. Logging is disabled by
default and must be turned on from the Console's Advanced tab.

### Alarm Thresholds

Each sensor supports an independent high and low threshold. Crossing either threshold lights the
fault LED and, if logging is on, writes an alarm record.

## Maintenance

Replace the fuse only with the spare provided or an exact equivalent (250V, 1A, fast-blow). Do
not substitute a higher-rated fuse.

## Troubleshooting

If the link LED never turns solid, confirm the static address does not collide with another
device on the same subnet, then reboot the unit by holding the control button for five seconds.

## Error Codes

| Code | Meaning |
|---|---|
| E01 | Sensor bus timeout |
| E02 | Calibration data corrupt |
| E03 | Fuse open |

## Warranty

The X200 fixture carries no warranty; it exists solely for this project's automated tests and
manual smoke runs.

## Support Contacts

This is a fictional support address for test purposes only: support@example.invalid.
