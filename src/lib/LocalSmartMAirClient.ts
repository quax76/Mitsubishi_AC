import https from "node:https";
import type { ClimateCommand, ClimateState, ConfiguredDevice, DiscoveredDevice } from "./types";

export interface LocalSmartMAirClientOptions {
  timeoutMs: number;
  operatorId?: string;
}

interface SmartMAirResponse {
  command?: string;
  apiVer?: string;
  operatorId?: string;
  deviceId?: string;
  timestamp?: number;
  result?: number;
  contents?: {
    airconId?: string;
    airconStat?: string;
    logStat?: number;
    updatedBy?: string;
    expires?: number;
    ledStat?: number;
    autoHeating?: number;
    highTemp?: string;
    lowTemp?: string;
    wireless?: {
      firmVer?: string;
    };
    mcu?: {
      firmVer?: string;
    };
    timezone?: string;
    numOfAccount?: number;
    firmType?: string;
  };
}

export class LocalSmartMAirClient {
  private readonly timeoutMs: number;
  private readonly operatorId: string;

  public constructor(options: LocalSmartMAirClientOptions) {
    this.timeoutMs = options.timeoutMs;
    this.operatorId = options.operatorId ?? "iobroker-smartmair";
  }

  public async discover(): Promise<DiscoveredDevice[]> {
    return [];
  }

  public async getState(device: ConfiguredDevice): Promise<ClimateState> {
    const response = await this.postCommand(device, "getAirconStat");
    const contents = response.contents;

    if (!contents) {
      throw new Error(`Smart M-Air response for ${device.id} did not include contents`);
    }

    return {
      rawAirconStat: contents.airconStat,
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

  public async setState(device: ConfiguredDevice, command: ClimateCommand): Promise<ClimateState> {
    void device;
    void command;
    throw new Error("Smart M-Air local write support is not implemented yet; refusing to send setAirconStat");
  }

  private async postCommand(device: ConfiguredDevice, command: string): Promise<SmartMAirResponse> {
    if (!device.host) {
      throw new Error(`Device ${device.id} has no host configured`);
    }

    const body = {
      apiVer: "1.0",
      command,
      deviceId: this.deviceIdForRequest(device),
      operatorId: this.operatorId,
      timestamp: Math.floor(Date.now() / 1000),
      contents: {}
    };
    const payload = JSON.stringify(body);
    const responseBody = await this.postJson(device.host, `/beaver/command/${command}`, payload);

    try {
      return JSON.parse(responseBody) as SmartMAirResponse;
    } catch (error: unknown) {
      throw new Error(`Could not parse Smart M-Air response from ${device.id}: ${String(error)}`);
    }
  }

  private async postJson(host: string, path: string, payload: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const request = https.request(
        {
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
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString("utf8");

            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`Smart M-Air HTTP ${response.statusCode}: ${responseBody}`));
              return;
            }

            resolve(responseBody);
          });
        }
      );

      request.once("timeout", () => {
        request.destroy(new Error("Smart M-Air request timed out"));
      });
      request.once("error", reject);
      request.end(payload);
    });
  }

  private deviceIdForRequest(device: ConfiguredDevice): string {
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
