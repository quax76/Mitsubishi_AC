import type { ClimateState, HvacMode } from "./types";
import { INDOOR_TEMPERATURES, OUTDOOR_TEMPERATURES } from "./TemperatureTables";

const MODE_BY_CODE: Readonly<Record<number, HvacMode>> = {
  0: "auto",
  1: "dry",
  2: "cool",
  3: "fan",
  4: "heat"
};

const FAN_SPEED_BY_CODE: Readonly<Record<number, string>> = {
  0: "1",
  1: "2",
  2: "3",
  6: "4",
  7: "auto"
};

const HORIZONTAL_VANE_BY_CODE: Readonly<Record<number, string>> = {
  0: "both-left",
  1: "left-and-center",
  2: "both-center",
  3: "center-and-right",
  4: "both-right",
  5: "wide",
  6: "center-focus"
};

export function decodeAirconStat(bytes: Buffer): Partial<ClimateState> {
  if (bytes.length < 21) {
    throw new Error(`Smart M-Air airconStat is too short: ${bytes.length} bytes`);
  }

  const dataStart = bytes[18] * 4 + 21;
  if (dataStart + 13 > bytes.length - 2) {
    throw new Error(`Smart M-Air airconStat has an invalid data offset: ${dataStart}`);
  }

  const operation = bytes[dataStart + 2];
  const fanAndVerticalVane = bytes[dataStart + 3];
  const modeCode = (operation >> 2) & 0x07;
  const fanSpeedCode = fanAndVerticalVane & 0x0f;
  const verticalVaneCode = (fanAndVerticalVane >> 4) & 0x0f;
  const verticalSwing = (operation & 0x40) !== 0;
  const horizontalFlags = bytes[dataStart + 12];
  const horizontalSwing = (horizontalFlags & 0x01) !== 0;
  const measurements = decodeMeasurements(bytes, dataStart + 19);
  const errorValue = bytes[dataStart + 6];
  const errorCode = errorValue & 0x7f;

  return {
    power: (operation & 0x01) !== 0,
    mode: MODE_BY_CODE[modeCode],
    targetTemperature: bytes[dataStart + 4] / 2,
    roomTemperature: measurements.roomTemperature,
    outdoorTemperature: measurements.outdoorTemperature,
    energyConsumption: measurements.energyConsumption,
    fanSpeed: FAN_SPEED_BY_CODE[fanSpeedCode] ?? `unknown-${fanSpeedCode}`,
    vaneVertical: verticalSwing ? "swing" : `position-${verticalVaneCode + 1}`,
    vaneHorizontal: horizontalSwing
      ? "swing"
      : (HORIZONTAL_VANE_BY_CODE[bytes[dataStart + 11]] ?? `unknown-${bytes[dataStart + 11]}`),
    auto3d: (horizontalFlags & 0x04) !== 0,
    errorCode: errorCode === 0 ? "00" : `${(errorValue & 0x80) !== 0 ? "E" : "M"}${String(errorCode).padStart(2, "0")}`
  };
}

function decodeMeasurements(bytes: Buffer, start: number): Pick<ClimateState, "roomTemperature" | "outdoorTemperature" | "energyConsumption"> {
  const result: Pick<ClimateState, "roomTemperature" | "outdoorTemperature" | "energyConsumption"> = {};

  for (let offset = start; offset + 3 < bytes.length - 2; offset += 4) {
    const type = bytes[offset];
    const subtype = bytes[offset + 1];

    if (type === 0x80 && subtype === 0x10) {
      result.outdoorTemperature = OUTDOOR_TEMPERATURES[bytes[offset + 2]];
    } else if (type === 0x80 && subtype === 0x20) {
      result.roomTemperature = INDOOR_TEMPERATURES[bytes[offset + 2]];
    } else if (type === 0x94 && subtype === 0x10) {
      result.energyConsumption = bytes.readUInt16LE(offset + 2) * 0.25;
    }
  }

  return result;
}
