import type { ClimateCommand, ClimateState, HvacMode } from "./types";

export const VALID_MODES: readonly HvacMode[] = ["auto", "cool", "heat", "dry", "fan"];

export function commandFromState(stateName: string, value: ioBroker.StateValue): ClimateCommand | undefined {
  switch (stateName) {
    case "power":
      return { power: Boolean(value) };
    case "mode":
      if (typeof value === "string" && VALID_MODES.includes(value as HvacMode)) {
        return { mode: value as HvacMode };
      }
      return undefined;
    case "targetTemperature": {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? { targetTemperature: numericValue } : undefined;
    }
    case "fanSpeed":
      return value === null || value === undefined ? undefined : { fanSpeed: String(value) };
    case "vaneVertical":
      return value === null || value === undefined ? undefined : { vaneVertical: String(value) };
    case "vaneHorizontal":
      return value === null || value === undefined ? undefined : { vaneHorizontal: String(value) };
    default:
      return undefined;
  }
}

export function climateStateEntries(state: ClimateState): Array<[string, ioBroker.StateValue]> {
  const entries: Array<[string, ioBroker.StateValue | undefined]> = Object.entries({
    power: state.power,
    mode: state.mode,
    targetTemperature: state.targetTemperature,
    roomTemperature: state.roomTemperature,
    outdoorTemperature: state.outdoorTemperature,
    fanSpeed: state.fanSpeed,
    vaneVertical: state.vaneVertical,
    vaneHorizontal: state.vaneHorizontal,
    errorCode: state.errorCode,
    rawAirconStat: state.rawAirconStat,
    result: state.result,
    expires: state.expires,
    updatedBy: state.updatedBy,
    ledStat: state.ledStat,
    autoHeating: state.autoHeating,
    highTempRaw: state.highTempRaw,
    lowTempRaw: state.lowTempRaw,
    wirelessFirmware: state.wirelessFirmware,
    mcuFirmware: state.mcuFirmware,
    timezone: state.timezone,
    numOfAccount: state.numOfAccount,
    firmType: state.firmType
  });

  return entries.filter((entry): entry is [string, ioBroker.StateValue] => entry[1] !== undefined);
}
