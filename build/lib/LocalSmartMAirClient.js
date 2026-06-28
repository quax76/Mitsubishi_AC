"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalSmartMAirClient = void 0;
const node_https_1 = __importDefault(require("node:https"));
const AirconStatDecoder_1 = require("./AirconStatDecoder");
const AirconStatEncoder_1 = require("./AirconStatEncoder");
class LocalSmartMAirClient {
    timeoutMs;
    operatorId;
    registeredOperatorByDevice = new Map();
    commandQueues = new Map();
    constructor(options) {
        this.timeoutMs = options.timeoutMs;
        this.operatorId = options.operatorId;
    }
    async discover() {
        return [];
    }
    async getState(device) {
        return await this.enqueue(device, async () => await this.getStateDirect(device));
    }
    async getStateDirect(device) {
        const response = await this.postCommand(device, "getAirconStat");
        this.rememberRegisteredOperator(device, response);
        return this.mapResponse(device, response);
    }
    async setState(device, command) {
        return await this.enqueue(device, async () => await this.setStateDirect(device, command));
    }
    async setStateDirect(device, command) {
        const currentState = await this.getStateDirect(device);
        if (!currentState.rawAirconStat) {
            throw new Error(`Cannot write ${device.id} without a current airconStat telegram`);
        }
        const operatorId = this.operatorId ?? this.registeredOperatorByDevice.get(this.deviceKey(device));
        if (!operatorId) {
            throw new Error(`Cannot write ${device.id}: no registered Smart M-Air operator ID was reported`);
        }
        const airconStat = (0, AirconStatEncoder_1.encodeAirconStat)(Buffer.from(currentState.rawAirconStat, "base64"), {
            ...currentState,
            ...command
        });
        const response = await this.postCommand(device, "setAirconStat", {
            airconId: this.deviceIdForRequest(device),
            airconStat
        }, operatorId);
        if (response.result !== 0) {
            throw new Error(`Smart M-Air rejected setAirconStat for ${device.id} with result ${String(response.result)}`);
        }
        return this.mapResponse(device, response);
    }
    async enqueue(device, task) {
        const key = this.deviceKey(device);
        const previous = this.commandQueues.get(key) ?? Promise.resolve();
        const current = previous.then(task, task);
        this.commandQueues.set(key, current.then(() => undefined, () => undefined));
        return await current;
    }
    async postCommand(device, command, contents = {}, operatorId = this.operatorId ?? "iobroker-smartmair") {
        if (!device.host) {
            throw new Error(`Device ${device.id} has no host configured`);
        }
        const body = {
            apiVer: "1.0",
            command,
            deviceId: this.deviceIdForRequest(device),
            operatorId,
            timestamp: Math.floor(Date.now() / 1000),
            contents
        };
        const payload = JSON.stringify(body);
        const responseBody = await this.postJson(device.host, `/beaver/command/${command}`, payload);
        try {
            return JSON.parse(responseBody);
        }
        catch (error) {
            throw new Error(`Could not parse Smart M-Air response from ${device.id}: ${String(error)}`);
        }
    }
    mapResponse(device, response) {
        const contents = response.contents;
        if (!contents) {
            throw new Error(`Smart M-Air response for ${device.id} did not include contents`);
        }
        const rawAirconStatBytes = contents.airconStat ? Buffer.from(contents.airconStat, "base64") : undefined;
        if (!rawAirconStatBytes) {
            throw new Error(`Smart M-Air response for ${device.id} did not include airconStat`);
        }
        return {
            ...(0, AirconStatDecoder_1.decodeAirconStat)(rawAirconStatBytes),
            rawAirconStat: contents.airconStat,
            rawAirconStatHex: rawAirconStatBytes.toString("hex"),
            rawAirconStatLength: rawAirconStatBytes.length,
            result: response.result,
            expires: contents.expires,
            updatedBy: contents.updatedBy,
            ledStat: contents.ledStat,
            autoHeating: contents.autoHeating,
            highTempRaw: contents.highTemp,
            lowTempRaw: contents.lowTemp,
            wirelessFirmware: contents.wireless?.firmVer,
            mcuFirmware: contents.mcu?.firmVer,
            timezone: contents.timezone,
            numOfAccount: contents.numOfAccount,
            firmType: contents.firmType
        };
    }
    rememberRegisteredOperator(device, response) {
        const registeredOperator = response.contents?.remoteList?.find((entry) => entry.trim().length > 0);
        if (registeredOperator) {
            this.registeredOperatorByDevice.set(this.deviceKey(device), registeredOperator);
        }
    }
    deviceKey(device) {
        return this.deviceIdForRequest(device).toLowerCase();
    }
    async postJson(host, path, payload) {
        return await new Promise((resolve, reject) => {
            const request = node_https_1.default.request({
                host,
                port: 51443,
                path,
                method: "POST",
                rejectUnauthorized: false,
                timeout: this.timeoutMs,
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Length": Buffer.byteLength(payload),
                    Connection: "close"
                }
            }, (response) => {
                const chunks = [];
                response.on("data", (chunk) => chunks.push(chunk));
                response.on("end", () => {
                    const responseBody = Buffer.concat(chunks).toString("utf8");
                    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(`Smart M-Air HTTP ${response.statusCode}: ${responseBody}`));
                        return;
                    }
                    resolve(responseBody);
                });
            });
            request.once("timeout", () => {
                request.destroy(new Error("Smart M-Air request timed out"));
            });
            request.once("error", reject);
            request.end(payload);
        });
    }
    deviceIdForRequest(device) {
        if (/^[0-9a-f]{12}$/i.test(device.id)) {
            return device.id.toLowerCase();
        }
        const macDeviceId = device.mac?.replace(/[^0-9a-f]/gi, "").toLowerCase();
        if (macDeviceId?.length === 12) {
            return macDeviceId;
        }
        return device.id;
    }
}
exports.LocalSmartMAirClient = LocalSmartMAirClient;
