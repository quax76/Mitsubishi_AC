import type { ClimateCommand, ClimateState, ConfiguredDevice, DiscoveredDevice } from "./types";

export interface MitsubishiClient {
  discover(): Promise<DiscoveredDevice[]>;
  getState(device: ConfiguredDevice): Promise<ClimateState>;
  setState(device: ConfiguredDevice, command: ClimateCommand): Promise<ClimateState>;
}

export class PlaceholderMitsubishiClient implements MitsubishiClient {
  public async discover(): Promise<DiscoveredDevice[]> {
    return [];
  }

  public async getState(device: ConfiguredDevice): Promise<ClimateState> {
    throw new Error(`Mitsubishi Smart M-Air LAN protocol is not implemented yet for device ${device.id}`);
  }

  public async setState(device: ConfiguredDevice, command: ClimateCommand): Promise<ClimateState> {
    void command;
    throw new Error(`Mitsubishi Smart M-Air LAN protocol is not implemented yet for device ${device.id}`);
  }
}
