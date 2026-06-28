"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALID_MODES = void 0;
exports.commandFromState = commandFromState;
exports.climateStateEntries = climateStateEntries;
exports.VALID_MODES = ["auto", "cool", "heat", "dry", "fan"];
function commandFromState(stateName, value) {
    switch (stateName) {
        case "power":
            return { power: Boolean(value) };
        case "mode":
            if (typeof value === "string" && exports.VALID_MODES.includes(value)) {
                return { mode: value };
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
        case "auto3d":
            return { auto3d: Boolean(value) };
        default:
            return undefined;
    }
}
function climateStateEntries(state) {
    const entries = Object.entries({
        power: state.power,
        mode: state.mode,
        targetTemperature: state.targetTemperature,
        roomTemperature: state.roomTemperature,
        outdoorTemperature: state.outdoorTemperature,
        energyConsumption: state.energyConsumption,
        fanSpeed: state.fanSpeed,
        vaneVertical: state.vaneVertical,
        vaneHorizontal: state.vaneHorizontal,
        auto3d: state.auto3d,
        errorCode: state.errorCode,
        rawAirconStat: state.rawAirconStat,
        rawAirconStatHex: state.rawAirconStatHex,
        rawAirconStatLength: state.rawAirconStatLength,
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
    return entries.filter((entry) => entry[1] !== undefined);
}
