const fs = require("node:fs");
const path = require("node:path");
const { LocalSmartMAirClient } = require("../build/lib/LocalSmartMAirClient");

const [deviceArgument, ...labelParts] = process.argv.slice(2);

if (!deviceArgument || labelParts.length === 0) {
  console.error("Usage: node tools/capture-status.js <ip=deviceId> <label>");
  process.exit(1);
}

const [host, configuredId] = deviceArgument.split("=");
const id = configuredId || host.replace(/[^0-9a-z]/gi, "_");
const label = labelParts.join(" ");
const device = { id, name: `Smart M-Air ${host}`, host };
const client = new LocalSmartMAirClient({ timeoutMs: 5000 });
const outputDirectory = path.join(__dirname, "..", "measurements");
const outputFile = path.join(outputDirectory, `${id}.jsonl`);

function readPreviousCapture() {
  if (!fs.existsSync(outputFile)) {
    return undefined;
  }

  const lines = fs.readFileSync(outputFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
  return lines.length > 0 ? JSON.parse(lines.at(-1)) : undefined;
}

function compareHex(previousHex, currentHex) {
  const previous = Buffer.from(previousHex, "hex");
  const current = Buffer.from(currentHex, "hex");
  const changes = [];

  for (let offset = 0; offset < Math.max(previous.length, current.length); offset += 1) {
    const before = previous[offset];
    const after = current[offset];

    if (before === after) {
      continue;
    }

    const xor = (before ?? 0) ^ (after ?? 0);
    changes.push({
      offset,
      offsetHex: `0x${offset.toString(16).padStart(2, "0")}`,
      before,
      after,
      beforeHex: before === undefined ? undefined : `0x${before.toString(16).padStart(2, "0")}`,
      afterHex: after === undefined ? undefined : `0x${after.toString(16).padStart(2, "0")}`,
      xorHex: `0x${xor.toString(16).padStart(2, "0")}`,
      changedBits: Array.from({ length: 8 }, (_, bit) => bit).filter((bit) => (xor & (1 << bit)) !== 0),
    });
  }

  return changes;
}

(async () => {
  const previous = readPreviousCapture();
  const state = await client.getState(device);

  if (!state.rawAirconStatHex) {
    throw new Error("The response did not contain an airconStat telegram");
  }

  const capture = {
    capturedAt: new Date().toISOString(),
    label,
    host,
    deviceId: id,
    rawAirconStat: state.rawAirconStat,
    rawAirconStatHex: state.rawAirconStatHex,
    rawAirconStatLength: state.rawAirconStatLength,
    metadata: {
      updatedBy: state.updatedBy,
      ledStat: state.ledStat,
      autoHeating: state.autoHeating,
      highTempRaw: state.highTempRaw,
      lowTempRaw: state.lowTempRaw,
    },
  };

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.appendFileSync(outputFile, `${JSON.stringify(capture)}\n`, "utf8");

  console.log(`Captured: ${label}`);
  console.log(`Telegram: ${state.rawAirconStatHex} (${state.rawAirconStatLength} bytes)`);

  if (!previous) {
    console.log("Diff: baseline created; no previous capture");
    return;
  }

  const changes = compareHex(previous.rawAirconStatHex, state.rawAirconStatHex);
  console.log(`Compared with: ${previous.label} (${previous.capturedAt})`);

  if (changes.length === 0) {
    console.log("Diff: no changed bytes");
    return;
  }

  console.table(changes);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
