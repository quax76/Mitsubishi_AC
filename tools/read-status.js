const { LocalSmartMAirClient } = require("../build/lib/LocalSmartMAirClient");

const devices = process.argv.slice(2).map((entry) => {
  const [host, id] = entry.split("=");
  return {
    id: id || host.replace(/[^0-9a-z]/gi, "_"),
    name: `Smart M-Air ${host}`,
    host,
  };
});

if (devices.length === 0) {
  console.error("Usage: node tools/read-status.js <ip=deviceId> [<ip=deviceId>...]");
  process.exit(1);
}

const client = new LocalSmartMAirClient({ timeoutMs: 5000 });

(async () => {
  for (const device of devices) {
    try {
      const state = await client.getState(device);
      console.log(JSON.stringify({ id: device.id, host: device.host, state }, null, 2));
    } catch (error) {
      console.error(`${device.host}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
})();
