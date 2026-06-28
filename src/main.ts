import * as utils from "@iobroker/adapter-core";
import type { MitsubishiClient } from "./lib/MitsubishiClient";
import { discoverLocalDevices, mergeDevices } from "./lib/LocalDiscovery";
import { LocalSmartMAirClient } from "./lib/LocalSmartMAirClient";
import { climateStateEntries, commandFromState, VALID_MODES } from "./lib/StateMapper";
import type { AdapterNativeConfig, ClimateState, ConfiguredDevice } from "./lib/types";

class MitsubishiSmartMAirAdapter extends utils.Adapter {
  private client?: MitsubishiClient;
  private pollTimer?: NodeJS.Timeout;
  private devices: ConfiguredDevice[] = [];

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "mitsubishi-smartmair"
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  private async onReady(): Promise<void> {
    await this.setStateAsync("info.connection", false, true);

    const nativeConfig = this.config as AdapterNativeConfig;
    this.devices = nativeConfig.devices ?? [];
    this.client = new LocalSmartMAirClient({
      timeoutMs: nativeConfig.commandTimeoutMs ?? 5000,
      operatorId: nativeConfig.operatorId?.trim() || undefined
    });

    if (nativeConfig.discoveryEnabled ?? true) {
      const hostObject = await this.getForeignObjectAsync(`system.host.${this.host}`);
      const hostAddresses = (hostObject?.common as { address?: string[] } | undefined)?.address ?? [];
      const discovered = await discoverLocalDevices({
        timeoutMs: nativeConfig.discoveryTimeoutMs ?? 5000,
        scanPorts: this.parseScanPorts(nativeConfig.discoveryScanPorts),
        seedAddresses: hostAddresses,
        subnets: this.parseDiscoverySubnets(nativeConfig.discoverySubnets),
        concurrency: 32
      });

      const mergedDevices = mergeDevices(this.devices, discovered);
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

    ret}{çm¢G§²ÚîÆ­yÔMs) {
    for (const port of ports) {
        const cert = await readTlsCertificate(host, port, timeoutMs);
        const org = firstCertificateValue(cert?.subject?.O);
        if (org && org.includes("Mitsubishi Heavy Industries")) {
            const deviceId = firstCertificateValue(cert?.subject?.CN);
            return {
                deviceId,
                mac: deviceId && deviceId.length === 12 ? deviceId.match(/.{1,2}/g)?.join(":") : undefined
            };
        }
    }
    return undefined;
}
function firstCertificateValue(value) {
    return Array.isArray(value) ? value[0] : value;
}
async function readTlsCertificate(host, port, timeoutMs) {
    return await new Promise((resolve) => {
        const socket = tls.connect({
            host,
            port,
            rejectUnauthorized: false,
            servername: "mhi"
        }, () => {
            const cert = socket.getPeerCertificate();
            socket.destroy();
            resolve(cert);
        });
        socket.setTimeout(timeoutMs, () => {
            socket.destroy();
            resolve(undefined);
        });
        socket.on("error", () => resolve(undefined));
    });
}
function looksLikeMhiDevice(response) {
    const lower = response.toLowerCase();
    return lower.includes("m-air") || lower.includes("smart m") || lower.includes("mitsubishi") || lower.includes("mhi");
}
function normalizeDeviceId(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
