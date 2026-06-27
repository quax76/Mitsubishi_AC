const fs = require("node:fs");
const path = require("node:path");

const sourcePath = process.argv[2];

if (!sourcePath) {
  console.error("Usage: node tools/generate-temperature-tables.js <reference-device.ts>");
  process.exit(1);
}

const source = fs.readFileSync(sourcePath, "utf8");

function extract(name) {
  const match = source.match(new RegExp(`static ${name} = \\[(.*?)\\];`, "s"));
  if (!match) {
    throw new Error(`Could not find ${name} in ${sourcePath}`);
  }

  return match[1]
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

function format(values) {
  const lines = [];
  for (let index = 0; index < values.length; index += 16) {
    lines.push(`  ${values.slice(index, index + 16).join(", ")}`);
  }
  return lines.join(",\n");
}

const outdoor = extract("outdoorTempList");
const indoor = extract("indoorTempList");

if (outdoor.length !== 256 || indoor.length !== 256) {
  throw new Error(`Expected 256 entries per table, got outdoor=${outdoor.length}, indoor=${indoor.length}`);
}

const output = `// Generated from JobDoesburg/homebridge-mhi-wfrac (Apache-2.0).\n` +
  `// See THIRD_PARTY_NOTICES.md.\n` +
  `export const OUTDOOR_TEMPERATURES: readonly number[] = [\n${format(outdoor)}\n];\n\n` +
  `export const INDOOR_TEMPERATURES: readonly number[] = [\n${format(indoor)}\n];\n`;

const outputPath = path.join(__dirname, "..", "src", "lib", "TemperatureTables.ts");
fs.writeFileSync(outputPath, output, "utf8");
console.log(`Generated ${outputPath}`);
