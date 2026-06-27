# ioBroker.mitsubishi-smartmair

Development adapter for controlling Mitsubishi Heavy Smart M-Air air conditioners locally from ioBroker.

## Current status

Implemented so far:

- Local discovery by Mitsubishi Heavy TLS certificate on port `51443`.
- Read-only local status polling via Smart M-Air's `beaver` API.
- Decoding for power, operating mode, target and measured temperatures, fan speed, vertical vane, horizontal vane, 3D Auto, local energy and error status.
- ioBroker objects for raw `airconStat` plus device metadata such as firmware, timezone, LED state and firm type.

Local write support is implemented with read-modify-write telegram encoding and CRC protection. It is still considered experimental until each command type has been validated on hardware.

Hardware validation completed so far:

- Target temperature `24 -> 25 -> 24 C`, with all unrelated controls preserved.
- Power `on -> off -> on`, with all unrelated controls preserved.
- Operating mode `cool -> fan -> cool`, followed by restoration of the original target temperature.
- Fan speed `auto -> 1 -> auto`, with all unrelated controls preserved.
- Vertical vane `position-4 -> position-1 -> position-4`, with all unrelated controls preserved.
- Horizontal vane `both-left -> both-center -> both-left`, with all unrelated controls preserved.
- Vertical vane `position-4 -> swing -> position-4`, with all unrelated controls preserved.
- Horizontal vane `both-left -> swing -> both-left`, with all unrelated controls preserved.
- 3D Auto `off -> on -> off`, followed by explicit restoration of the original vane positions.

## Next steps

1. Decode remaining `airconStat` fields such as measured temperatures, error state and special functions.
2. Validate each `setAirconStat` command type on hardware.
3. Expand regression tests as additional device models are tested.
4. Run automatic local device discovery whenever the adapter starts and merge the results with the saved configuration.
5. Add persistent device naming in the adapter configuration. Match discovered units by normalized MAC address (with device ID as a fallback), preserve the assigned name when an IP address changes, and expose newly discovered units for naming without losing existing assignments.

## Manual device configuration

Discovery is enabled by default. Devices can also be added manually in the adapter native config:

```json
{
  "devices": [
    {
      "id": "348e89becfe1",
      "name": "Wohnzimmer",
      "host": "172.23.1.66",
      "mac": "34:8e:89:be:cf:e1"
    }
  ]
}
```

## Local device scan

To find Mitsubishi Heavy Smart M-Air devices on a local subnet:

```bash
node tools/scan-mhi-devices.js 172.23.1 51443
```

The script only performs TLS handshakes and checks for Mitsubishi Heavy certificate metadata. It does not send control commands.

## Local status test

Build the adapter and query one or more devices with:

```bash
pnpm build
node tools/read-status.js 172.23.1.66=348e89becfe1
```

The local Smart M-Air endpoint is:

```text
POST https://<device-ip>:51443/beaver/command/getAirconStat
Content-Type: application/json; charset=utf-8
```

This read-only command returns `contents.airconStat` as Base64 plus metadata such as `firmType`, `wireless.firmVer`, `mcu.firmVer`, `timezone`, `ledStat` and `autoHeating`.

The telegram also contains calibrated indoor and outdoor temperatures and a local energy counter in `0.25 kWh` increments. This local counter may differ from the consumption shown by Smart M-Air because the app also queries the cloud endpoint `server/getConsumption` for aggregated consumption data.

## Protocol measurement

Capture a labelled baseline and compare each later capture with the previous telegram:

```bash
node tools/capture-status.js 172.23.1.66=348e89becfe1 "baseline power off"
node tools/capture-status.js 172.23.1.66=348e89becfe1 "power on"
```

Captures are appended to `measurements/<deviceId>.jsonl`. Change only one setting between captures and wait a few seconds for the indoor unit to apply it. The output lists every changed byte, its XOR mask and the changed bit positions.
