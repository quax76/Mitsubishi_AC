# ioBroker.mitsubishi-smartmair

Development scaffold for an ioBroker adapter that controls Mitsubishi Heavy Smart M-Air air conditioners locally.

## Current status

This is a starter project. The ioBroker object model, local discovery flow and command flow are prepared, but the real Mitsubishi Smart M-Air LAN protocol implementation is still missing.

## Next steps

1. Confirm the exact Wi-Fi module and local network signature.
2. Implement `src/lib/MitsubishiClient.ts` for the real local protocol.
3. Install dependencies with `npm install`.
4. Build with `npm run build`.
5. Test read-only status updates before enabling write commands.

## Manual device configuration

Discovery is enabled by default. Devices can also be added manually in the adapter native config:

```json
{
  "devices": [
    {
      "id": "livingroom",
      "name": "Wohnzimmer",
      "host": "192.168.178.50"
    }
  ]
}
```
