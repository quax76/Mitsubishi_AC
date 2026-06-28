"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const LocalDiscovery_1 = require("./lib/LocalDiscovery");
const LocalSmartMAirClient_1 = require("./lib/LocalSmartMAirClient");
const StateMapper_1 = require("./lib/StateMapper");
class MitsubishiSmartMAirAdapter extends utils.Adapter {
    client;
    pollTimer;
    devices = [];
    constructor(options = {}) {
        super({
            ...options,
            name: "mitsubishi-smartmair"
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
    async onReady() {
        await this.setStateAsync("info.connection", false, true);
        const instanceObject = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
        const persistedNative = (instanceObject?.native ?? {});
        const nativeConfig = {
            ...this.config,
            ...persistedNative
        };
        this.devices = nativeConfig.devices ?? [];
        this.client = new LocalSmartMAirClient_1.LocalSmartMAirClient({
            timeoutMs: nativeConfig.commandTimeoutMs ?? 5000,
            operatorId: nativeConfig.operatorId?.trim() || undefined
        });
        if (nativeConfig.discoveryEnabled ?? true) {
            const hostObject = await this.getForeignObjectAsync(`system.host.${this.host}`);
            const hostAddresses = hostObject?.common?.address ?? [];
            const discovered = await (0, LocalDiscovery_1.discoverLocalDevices)({
                timeoutMs: nativeConfig.discoveryTimeoutMs ?? 5000,
                scanPorts: this.parseScanPorts(nativeConfig.discoveryScanPorts),
                seedAddresses: hostAddresses,
                subnets: this.parseDiscoverySubnets(nativeConfig.discoverySubnets),
                concurrency: 32
            });
            const mergedDevices = (0, LocalDiscovery_1.mergeDevices)(this.devices, discovered);
            const configurationChanged = JSON.stringify(mergedDevices) !== JSON.stringify(this.devices);
            this.devices = mergedDevices;
            this.log.info(`Local discovery found ${discovered.length} possible Smart M-Air device(s)`);
            if (configurationChanged) {
                await this.persistDevices();
                this.log.info(`Saved ${this.devices.length} Smart M-Air device(s) in the adapter configuration`);
            }
        }
        await this.subscribeStatesAsync("devices.*.control.*");
        for (const device of this.devices) {
            await this.ensureDeviceObjects(device);
        }
        await this.refreshAllDevices();
        this.startPolling(nativeConfig.pollIntervalSeconds ?? 30);
    }
    startPolling(intervalSeconds) {
        const intervalMs = Math.max(10, intervalSeconds) * 1000;
        this.pollTimer = setInterval(() => {
            this.refreshAllDevices().catch((error) => {
                this.log.warn(`Polling failed: ${String(error)}`);
            });
        }, intervalMs);
    }
    parseScanPorts(value) {
        if (Array.isArray(value)) {
            return value.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
        }
        if (typeof value === "string") {
            const ports = value
                .split(",")
                .map((entry) => Number(entry.trim()))
                .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
            return ports.length > 0 ? ports : [80, 443, 51443];
        }
        return [80, 443, 51443];
    }
    parseDiscoverySubnets(value) {
        if (Array.isArray(value)) {
            return value.map((entry) => entry.trim()).filter(Boolean);
        }
        return typeof value === "string" ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
    }
    async persistDevices() {
        const objectId = `system.adapter.${this.namespace}`;
        const instanceObject = await this.getForeignObjectAsync(objectId);
        if (!instanceObject || instanceObject.type !== "instance") {
            this.log.warn(`Cannot persist discovered devices because ${objectId} was not found`);
            return;
        }
        instanceObject.native = instanceObject.native ?? {};
        instanceObject.native.devices = this.devices;
        await this.setForeignObjectAsync(objectId, instanceObject);
    }
    async refreshAllDevices() {
        let connected = false;
        for (const device of this.devices) {
            try {
                const state = await this.client?.getState(device);
                if (!state) {
                    throw new Error("Smart M-Air client is not initialized");
                }
                await this.writeClimateState(device.id, state);
                await this.setStateAsync(`devices.${device.id}.info.online`, true, true);
                await this.setStateAsync(`devices.${device.id}.info.lastSeen`, new Date().toISOString(), true);
                connected = true;
            }
            catch (error) {
                await this.setStateAsync(`devices.${device.id}.info.online`, false, true);
                this.log.debug(`Could not refresh ${device.id}: ${String(error)}`);
            }
        }
        await this.setStateAsync("info.connection", connected, true);
    }
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const parsed = this.parseControlStateId(id);
        if (!parsed) {
            return;
        }
        if (parsed.stateName === "refresh") {
            await this.refreshAllDevices();
            return;
        }
        const device = this.devices.find((entry) => entry.id === parsed.deviceId);
        const command = (0, StateMapper_1.commandFromState)(parsed.stateName, state.val);
        if (!device || !command) {
            this.log.warn(`Ignoring unsupported command state ${id}`);
            return;
        }
        try {
            if (!this.client) {
                throw new Error("Smart M-Air client is not initialized");
            }
            const nextState = await this.client.setState(device, command);
            await this.writeClimateState(device.id, nextState);
            await this.setStateAsync(`devices.${device.id}.control.${parsed.stateName}`, state.val, true);
        }
        catch (error) {
            this.log.warn(`Command failed for ${device.id}.${parsed.stateName}: ${String(error)}`);
        }
    }
    parseControlStateId(id) {
        const prefix = `${this.namespace}.devices.`;
        if (!id.startsWith(prefix)) {
            return undefined;
        }
        const parts = id.slice(prefix.length).split(".");
        if (parts.length !== 3 || parts[1] !== "control") {
            return undefined;
        }
        return {
            deviceId: parts[0],
            stateName: parts[2]
        };
    }
    async ensureDeviceObjects(device) {
        await this.setObjectNotExistsAsync(`devices.${device.id}`, {
            type: "device",
            common: {
                name: device.name
            },
            native: {
                host: device.host,
                mac: device.mac
            }
        });
        await this.extendObjectAsync(`devices.${device.id}`, {
            common: {
                name: device.name
            },
            native: {
                host: device.host,
                mac: device.mac
            }
        });
        await this.ensureChannel(device.id, "info", "Information");
        await this.ensureChannel(device.id, "status", "Status");
        await this.ensureChannel(device.id, "control", "Control");
        await this.ensureState(`devices.${device.id}.info.name`, device.name, "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.info.host`, device.host ?? "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.info.mac`, device.mac ?? "", "string", "state", true, false);
        await this.setStateAsync(`devices.${device.id}.info.name`, device.name, true);
        await this.setStateAsync(`devices.${device.id}.info.host`, device.host ?? "", true);
        await this.setStateAsync(`devices.${device.id}.info.mac`, device.mac ?? "", true);
        await this.ensureState(`devices.${device.id}.info.online`, false, "boolean", "indicator.connected", true, false);
        await this.ensureState(`devices.${device.id}.info.lastSeen`, "", "string", "date", true, false);
        await this.ensureState(`devices.${device.id}.status.power`, false, "boolean", "switch.power", true, false);
        await this.ensureState(`devices.${device.id}.status.mode`, "auto", "string", "state", true, false, StateMapper_1.VALID_MODES);
        await this.ensureState(`devices.${device.id}.status.targetTemperature`, 21, "number", "value.temperature", true, false, undefined, "C", 16, 31);
        await this.ensureState(`devices.${device.id}.status.roomTemperature`, 0, "number", "value.temperature", true, false, undefined, "C");
        await this.ensureState(`devices.${device.id}.status.outdoorTemperature`, 0, "number", "value.temperature", true, false, undefined, "C");
        await this.ensureState(`devices.${device.id}.status.energyConsumption`, 0, "number", "value.power.consumption", true, false, undefined, "kWh");
        await this.ensureState(`devices.${device.id}.status.fanSpeed`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.vaneVertical`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.vaneHorizontal`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.auto3d`, false, "boolean", "indicator", true, false);
        await this.ensureState(`devices.${device.id}.status.errorCode`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.rawAirconStat`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.rawAirconStatHex`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.rawAirconStatLength`, 0, "number", "value", true, false);
        await this.ensureState(`devices.${device.id}.status.result`, 0, "number", "value", true, false);
        await this.ensureState(`devices.${device.id}.status.expires`, 0, "number", "date", true, false);
        await this.ensureState(`devices.${device.id}.status.updatedBy`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.ledStat`, 0, "number", "value", true, false);
        await this.ensureState(`devices.${device.id}.status.autoHeating`, 0, "number", "value", true, false);
        await this.ensureState(`devices.${device.id}.status.highTempRaw`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.lowTempRaw`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.wirelessFirmware`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.mcuFirmware`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.timezone`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.status.numOfAccount`, 0, "number", "value", true, false);
        await this.ensureState(`devices.${device.id}.status.firmType`, "", "string", "state", true, false);
        await this.ensureState(`devices.${device.id}.control.power`, false, "boolean", "switch.power", true, true);
        await this.ensureState(`devices.${device.id}.control.mode`, "auto", "string", "state", true, true, StateMapper_1.VALID_MODES);
        await this.ensureState(`devices.${device.id}.control.targetTemperature`, 21, "number", "level.temperature", true, true, undefined, "C", 16, 31);
        await this.ensureState(`devices.${device.id}.control.fanSpeed`, "", "string", "state", true, true);
        await this.ensureState(`devices.${device.id}.control.vaneVertical`, "", "string", "state", true, true);
        await this.ensureState(`devices.${device.id}.control.vaneHorizontal`, "", "string", "state", true, true);
        await this.ensureState(`devices.${device.id}.control.auto3d`, false, "boolean", "switch", true, true);
        await this.ensureState(`devices.${device.id}.control.refresh`, false, "boolean", "button", true, true);
    }
    async ensureChannel(deviceId, channel, name) {
        await this.setObjectNotExistsAsync(`devices.${deviceId}.${channel}`, {
            type: "channel",
            common: {
                name
            },
            native: {}
        });
    }
    async ensureState(id, def, type, role, read, write, states, unit, min, max) {
        const common = {
            name: id.split(".").at(-1) ?? id,
            type,
            role,
            read,
            write,
            def
        };
        if (states) {
            common.states = Object.fromEntries(states.map((value) => [value, value]));
        }
        if (unit) {
            common.unit = unit;
        }
        if (min !== undefined) {
            common.min = min;
        }
        if (max !== undefined) {
            common.max = max;
        }
        await this.setObjectNotExistsAsync(id, {
            type: "state",
            common,
            native: {}
        });
    }
    async writeClimateState(deviceId, climateState) {
        for (const [name, value] of (0, StateMapper_1.climateStateEntries)(climateState)) {
            await this.setStateAsync(`devices.${deviceId}.status.${name}`, value, true);
            const controlId = `devices.${deviceId}.control.${name}`;
            if (["power", "mode", "targetTemperature", "fanSpeed", "vaneVertical", "vaneHorizontal", "auto3d"].includes(name)) {
                await this.setStateAsync(controlId, value, true);
            }
        }
    }
    onUnload(callback) {
        try {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = undefined;
            }
            callback();
        }
        catch {
            callback();
        }
    }
}
if (require.main !== module) {
    module.exports = (options) => new MitsubishiSmartMAirAdapter(options);
}
else {
    new MitsubishiSmartMAirAdapter();
}

