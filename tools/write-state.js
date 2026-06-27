const { LocalSmartMAirClient } = require("../build/lib/LocalSmartMAirClient");

const [deviceArgument, assignment, executeFlag] = process.argv.slice(2);

if (!deviceArgument || !assignment) {
  console.error("Usage: node tools/write-state.js <ip=deviceId> <state=value> --execute");
  process.exit(1);
}

if (executeFlag !== "--execute") {
  console.error("Refusing to write without the final --execute flag");
  process.exit(2);
}

const [host, configuredId] = deviceArgument.split("=");
const [stateName, rawValue] = assignment.split("=");
const id = configuredId || host.replace(/[^0-9a-z]/gi, "_");
const device = { id, name: `Smart M-Air ${host}`, host };
const allowedStates = new Set([
  "power",
  "mode",
  "targetTemperature",
  "fanSpeed",
  "vaneVertical",
  "vaneHorizontal",
  "auto3d",
]);

if (!allowedStates.has(stateName) || rawValue === undefined) {
  console.error(`Unsupported assignment: ${assignment}`);
  process.exit(1);
}

let value = rawValue;
if (stateName === "power" || stateName === "auto3d") {
  if (rawValue !== "true" && rawValue !== "false") {
    console.error(`${stateName} must be true or false`);
    process.exit(1);
  }
  value = rawValue === "true";
} else if (stateName === "targetTemperature") {
  value = Number(rawValue);
}

const client = new LocalSmartMAirClient({ timeoutMs: 5000 });

(async () => {
  const before = await client.getState(device);
  console.log("Before:", JSON.stringify(before, null, 2));
  const after = await client.setState(device, { [stateName]: value });
  console.log("After:", JSON.stringify(after, null, 2));
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
