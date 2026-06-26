import * as utils from "@iobroker/adapter-core";
import { PlaceholderMitsubishiClient, type MitsubishiClient } from "./lib/MitsubishiClient";
import { discoverLocalDevices, mergeDevices } from "./lib/LocalDiscovery";
import { climateStateEntries, commandFromState, VALID_MODES } from "./lib/StateMapper";
import type { AdapterNativeConfig, ClimateState, ConfiguredDevice } from "./lib/types";

class MitsubishiSmartMAirAdapter extends utils.Adapter {
  private readonly client: MitsubishiClient;
  private pollTimer?: NodeJS.Timeout;
  private devices: ConfiguredDevice[] = [];

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "mitsubishi-smartmair"
    });

    this.client = new PlaceholderMitsubishiClient();

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  private async onReady(): Promise<void> {
    await this.setStateAsync("info.connection", false, true);

    const nativeConfig = this.config as AdapterNativeConfig;
    this.devices = nativeConfig.devices ?? [];

    if (nativeConfig.discoveryEnabled ?? true) {
      const discovered = await discoverLocalDevices({
        timeoutMs: nativeConfig.discoveryTimeoutMs ?? 5000,
        scanPorts: this.parseScanPorts(nativeConfig.discoveryScanPorts)
      });

      this.devices = mergeDevices(this.devices, discovered);
      this.log.info(`Local discovery found ${discovered.length} possible Smart M-Air device(s)`);
    }

    await this.subscribeStatesAsync("devices.*.control.*");

    for (const device of this.devices) {
      await this.ensureDeviceObjects(device);
    }

    await this.refreshAllDevices();
    this.startPolling(nativeConfig.pollIntervalSeconds ?? 30);
  }

  private startPolling(intervalSeconds: number): void {
    const intervalMs = Math.max(10, intervalSeconds) * 1000;

    this.pollTimer = setInterval(() => {
      this.refreshAllDevices().catch((error: unknown) => {
        this.log.warn(`Polling failed: ${String(error)}`);
      });
    }, intervalMs);
  }

  private parseScanPorts(value: AdapterNativeConfig["discoveryScanPorts"]): number[] {
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

  private async refreshAllDevices(): Promise<void> {
    let connected = false;

    for (const device of this.devices) {
      try {
        const state = await this.client.getState(device);
        await this.writeClimateState(device.id, state);
        await this.setStateAsync(`devices.${device.id}.info.online`, true, true);
        await this.setStateAsync(`devices.${device.id}.info.lastSeen`, new Date().toISOString(), true);
        connected = true;
      } catch (error: unknown) {
        await this.setStateAsync(`devices.${device.id}.info.online`, false, true);
        this.log.debug(`Could not refresh ${device.id}: ${String(error)}`);
      }
    }

    await this.setStateAsync("info.connection", connected, true);
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
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
    const command = commandFromState(parsed.stateName, state.val);

    if (!device || !command) {
      this.log.warn(`Ignoring unsupported command state ${id}`);
      return;
    }

    try {
      const nextState = await this.client.setState(device, command);
      await this.writeClimateState(device.id, nextState);
      await this.setStateAsync(`devices.${device.id}.control.${parsed.stateName}`, state.val, true);
    } catch (error: unknown) {
      this.log.warn(`Command failed for ${device.id}.${parsed.stateName}: ${String(error)}`);
    }
  }

  private parseControlStateId(id: string): { deviceId: string; stateName: string } | undefined {
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

  private async ensureDeviceObjects(device: ConfiguredDevice): Promise<void> {
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

    await this.ensureChannel(device.id, "info", "Information");
    await this.ensureChannel(device.id, "status", "Status");
    await this.ensureChannel(device.id, "control", "Control");

    await this.ensureState(`devices.${device.id}.info.name`, device.name, "string", "state", true, false);
    await this.ensureState(`devices.${device.id}.info.host`, device.host ?? "", "string", "state", true, false);
    await this.ensureState(`devices.${device.id}.info.mac`, device.mac ?? "", "string", "state", true, false);
    await this.ensureState(`devices.${device.id}.info.online`, false, "boolean", "indicator.connected", true, false);
    await this.ensureState(`devices.${device.id}.info.lastSeen`, "", "string", "date", true, false);

    await this.ensureState(`devices.${device.id}.status.power`, false, "boolean", "switch.power", true, false);
    await this.ensureState(`devices.${device.id}.status.mode`, "auto", "string", "state", true, false, VALID_MODES);
    await this.ensureState(`devices.${device.id}.status.targetTemperature`, 21, "number", "value.temperature", true, false, undefined, "C", 16, 31);
    await this.ensureState(`devices.${device.id}.status.roomTemperature`, 0, "number", "value.temperature", true, false, undefined, "C");
    await this.ensureState(`devices.${device.id}.status.outdoorTemperature`, 0, "number", "value.temperature", true, false, undefined, "C");
    await this.ensureState(`devices.${device.id}.status.fanSpeed`, "", "string", "state", true, false);
    await this.ensureState(`devices.${device.id}.status.vaneVertical`, "", "string", "state", true, false);
    await this.ensureState(`devices.${device.id}.status.vaneHorizontal`, "", "string", "state", true, false);
    await this.ensureState(`devices.${device.id}.status.errorCode`, "", "string", "state", true, false);

    await this.ensureState(`devices.${device.id}.control.power`, false, "boolean", "switch.power", true, true);
    await this.ensureState(`devices.${device.id}.control.mode`, "auto", "string", "state", true, true, VALID_MODES);
    await this.ensureState(`devices.${device.id}.control.targetTemperature`, 21, "number", "level.temperature", true, true, undefined, "C", 16, 31);
    await this.ensureState(`devices.${device.id}.control.fanSpeed`, "", "string", "state", true, true);
    await this.ensureState(`devices.${device.id}.control.vaneVertical`, "", "string", "state", true, true);
    await this.ensureState(`devices.${device.id}.control.vaneHorizontal`, "", "string", "state", true, true);
    await this.ensureState(`devices.${device.id}.control.refresh`, false, "boolean", "button", true, true);
  }

  private async ensureChannel(deviceId: string, channel: string, name: string): Promise<void> {
    await this.setObjectNotExistsAsync(`devices.${deviceId}.${channel}`, {
      type: "channel",
      common: {
        name
      },
      native: {}
    });
  }

  private async ensureState(
    id: string,
    def: ioBroker.StateValue,
    type: ioBroker.CommonType,
    role: string,
    read: boolean,
    write: boolean,
    states?: readonly string[],
    unit?: string,
    min?: number,
    max?: number
  ): Promise<void> {
    const common: ioBroker.StateCommon = {
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

  private async writeClimateState(deviceId: string, climateState: ClimateState): Promise<void> {
    for (const [name, value] of climateStateEntries(climateState)) {
      await this.setStateAsync(`devices.${deviceId}.status.${name}`, value, true);
      const controlId = `devices.${deviceId}.control.${name}`;

      if (["power", "mode", "targetTemperature", "fanSpeed", "vaneVertical", "vaneHorizontal"].includes(name)) {
        await this.setStateAsync(controlId, value, true);
      }
    }
  }

  private onUnload(callback: () => void): void {
    try {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      callback();
    } catch {
      callback();
    }
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined): MitsubishiSmartMAirAdapter =>
    new MitsubishiSmartMAirAdapter(options);
} else {
  new MitsubishiSmartMAirAdapter();
}
