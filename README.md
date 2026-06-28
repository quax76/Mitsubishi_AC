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

## Installation from GitHub

Install the development version through ioBroker Admin's custom URL dialog using:

```text
https://github.com/quax76/ioBroker.mitsubishi-smartmair
```

After installing the adapter package, create one `mitsubishi-smartmair` instance
with the `+` button in ioBroker Admin. This separation between package installation
and instance creation is standard ioBroker behavior. On its first start, the
instance discovers all reachable Smart M-Air units, saves them by MAC address and
creates every state automatically. No device entry is required.

For command-line installation, use:

```bash
iobroker url https://github.com/quax76/ioBroker.mitsubishi-smartmair
iobroker add mitsubishi-smartmair --enabled
```

Discovery scans the local `/24` networks known to the ioBroker host. Additional
networks can be entered in the instance settings, for example `172.23.1.0/24`.

## Next steps

1. Decode remaining `airconStat` fields such as measured temperatures, error state and special functions.
2. Validate each `setAirconStat` command type on hardware.
3. Expand regression tests as additional device models are tested.
4. Add model-specific validation as more Mitsubishi Heavy units become available.

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

## Changelog

### 0.0.4

- Load the latest persisted device names when the adapter starts.

### 0.0.3

- Synchronize configured device names, hosts and MAC addresses with the ioBroker object tree.

### 0.0.2

- Fixed GitHub installation metadata and committed build output.
- Added bounded automatic LAN discovery with port `51443` priority.
- Persist discovered devices by MAC address while preserving assigned names.
- Added optional additional `/24` discovery networks.

### 0.0.1

- Initial local protocol implementation.

## License

MIT License. See [LICENSE](LICENSE).

