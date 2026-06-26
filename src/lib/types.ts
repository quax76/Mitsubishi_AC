export type HvacMode = "auto" | "cool" | "heat" | "dry" | "fan";

export interface ConfiguredDevice {
  id: string;
  name: string;
  host?: string;
  mac?: string;
  source?: "discovered" | "manual";
}

export interface DiscoveredDevice extends ConfiguredDevice {
  model?: string;
  firmware?: string;
}

export interface ClimateState {
  power?: boolean;
  mode?: HvacMode;
  targetTemperature?: number;
  roomTemperature?: number;
  outdoorTemperature?: number;
  fanSpeed?: string;
  vaneVertical?: string;
  vaneHorizontal?: string;
  errorCode?: string;
  rawAirconStat?: string;
  rawAirconStatHex?: string;
  rawAirconStatLength?: number;
  result?: number;
  expires?: number;
  updatedBy?: string;
  ledStat?: number;
  autoHeating?: number;
  highTempRaw?: string;
  lowTempRaw?: string;
  wirelessFirmware?: string;
  mcuFirmware?: string;
  timezone?: string;
  numOfAccount?: number;
  firmType?: string;
}

export interface ClimateCommand {
  power?: boolean;
  mode?: HvacMode;
  targetTemperature?: number;
  fanSpeed?: string;
  vaneVertical?: string;
  vaneHorizontal?: string;
}

export interface AdapterNativeConfig {
  pollIntervalSeconds?: number;
  commandTimeoutMs?: number;
  discoveryEnabled?: boolean;
  discoveryTimeoutMs?: number;
  discoveryScanPorts?: number[] | string;
  devices?: ConfiguredDevice[];
}
