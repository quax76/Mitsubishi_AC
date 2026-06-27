import https from "node:https";
import { decodeAirconStat } from "./AirconStatDecoder";
import { encodeAirconStat } from "./AirconStatEncoder";
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
    remoteList?: string[];
  };
}

export class LocalSmartMAirClient {
  private readonly timeoutMs: number;
  private readonly operatorId?: string;
  private readonly registeredOperatorByDevice = new Map<string, string>();
  private readonly commandQueues = new Map<string, Promise<void>>();

  public constructor(options: LocalSmartMAirClientOptions) {
    this.timeoutMs = options.timeoutMs;
    this.operatorId = options.operatorId;
  }

  public async discover(): Promise<DiscoveredDevice[]> {
    return [];
  }

  public async getState(device: ConfiguredDevice): Promise<ClimateState> {
    return await this.enqueue(device, async () => await this.getStateDirect(device));
  }

  private async getStateDirect(device: ConfiguredDevice): Promise<ClimateState> {
    const response = await this.postCommand(device, "getAirconStat");
    this.rememberRegisteredOperator(device, response);
    return this.mapResponse(device, response);
  }

  public async setState(device: ConfiguredDevice, command: ClimateCommand): Promise<ClimateState> {
    return await this.enqueue(device, async () => await this.setStateDirect(device, command));
  }

  private async setStateDirect(device: ConfiguredDevice, command: ClimateCommand): Promise<ClimateState> {
    const currentState = await this.getStateDirect(device);
    if (!currentState.rawAirconStat) {
      throw new Error(`Cannot write ${device.id} without a current airconStat telegram`);
    }

    const operatorId = this.operatorId ?? this.registeredOperatorByDevice.get(this.deviceKey(device));
    if (!operatorId) {
      throw new Error(`Cannot write ${device.id}: no registered Smart M-Air operator ID was reported`);
    }

    const airconStat = encodeAirconStat(Buffer.from(currentState.rawAirconStat, "base64"), {
      ...currentState,
      ...command
    });
    const response = await this.postCommand(
      device,
      "setAirconStat",
      {
        airconId: this.deviceIdForRequest(device),
        airconStat
      },
      operatorId
    );

    if (response.result !== 0) {
      throw new Error(`Smart M-Air rejected setAirconStat for ${device.id} with result ${String(response.result)}`);
    }

    return this.mapResponse(device, response);
  }

  private async enqueue<T>(device: ConfiguredDevice, task: () => Promise<T>): Promise<T> {
    const key = this.deviceKey(device);
    const previous = this.commandQueues.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    this.commandQueues.set(
      key,
      current.then(
        () => undefined,
        () => undefined
      )
    );
    return await current;
  }

  private async postCommand(
    device: ConfiguredDevice,
    command: string,
    contents: Record<string, unknown> = {},
    operatorId: string = this.operatorId ?? "iobroker-smartmair"
  ): Promise<SmartMAirResponse> {
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
      return JSON.parse(responseBody) as SmartMAirResponse;
    } catch (error: unknown) {
      throw new Error(`Could not parse Smart M-Air response from ${device.id}: ${String(error)}`);
    }
  }

  private mapResponse(device: ConfiguredDevice, response: SmartMAirResponse): ClimateState {
    const contents = response.contents;
    if (!contents) {
      throw new Error(`Smart M-Air response for ${device.id} did not include contents`);
    }

    const rawAirconStatBytes = contents.airconStat ? Buffer.from(contents.airconStat, "base64") : undefined;
    if (!rawAirconStatBytes) {
      throw new Error(`Smart M-Air response for ${device.id} did not include airconStat`);
    }

    return {
      ...decodeAirconStat(rawAirconStatBytes),
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

  private rememberRegisteredOperator(device: ConfiguredDevice, response: SmartMAirResponse): void {
    const registeredOperator = response.contents?.remoteList?.find((entry) => entry.trim().length > 0);
    if (registeredOperator) {
      this.registeredOperatorByDevice.set(this.deviceKey(device), registeredOperator);
    }
  }

  private deviceKey(device: ConfiguredDevice): string {
    return this.deviceIdForRequest(device).toLowerCase();
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
