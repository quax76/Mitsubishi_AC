# ioBroker.mitsubishi-smartmair

Development adapter for controlling Mitsubishi Heavy Smart M-Air air conditioners locally from ioBroker.

## Current status

Implemented so far:

- Local discovery by Mitsubishi Heavy TLS certificate on port `51443`.
- Read-only local status polling via Smart M-Air's `beaver` API.
- ioBroker objects for raw `airconStat` plus device metadata such as firmware, timezone, LED state and firm type.

Write commands are intentionally blocked until the Base64 `airconStat` telegram can be decoded and re-encoded safely.

## Next steps

1. Decode `airconStat` into readable states such as power, mode, temperatures, fan and vanes.
2. Implement `setAirconStat` using the decoded telegram model.
3. Add focused tests around status decoding and command encoding.

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
