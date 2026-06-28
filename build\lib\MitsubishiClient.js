"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaceholderMitsubishiClient = void 0;
class PlaceholderMitsubishiClient {
    async discover() {
        return [];
    }
    async getState(device) {
        throw new Error(`Mitsubishi Smart M-Air LAN protocol is not implemented yet for device ${device.id}`);
    }
    async setState(device, command) {
        void command;
        throw new Error(`Mitsubishi Smart M-Air LAN protocol is not implemented yet for device ${device.id}`);
    }
}
exports.PlaceholderMitsubishiClient = PlaceholderMitsubishiClient;
