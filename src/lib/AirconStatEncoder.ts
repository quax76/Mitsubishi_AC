import type { ClimateState, HvacMode } from "./types";

type EncodableClimateState = ClimateState & Required<Pick<ClimateState, "power" | "mode" | "targetTemperature" | "fanSpeed" | "vaneVertical" | "vaneHorizontal" | "auto3d">>;

const COMMAND_MODE: Readonly<Record<HvacMode, number>> = {
  auto: 0x20,
  cool: 0x28,
  heat: 0x30,
  fan: 0x2c,
  dry: 0x24
};

const RECEIVE_MODE: Readonly<Record<HvacMode, number>> = {
  auto: 0x00,
  cool: 0x08,
  heat: 0x10,
  fan: 0x0c,
  dry: 0x04
};

const COMMAND_FAN: Readonly<Record<string, number>> = {
  auto: 0x0f,
  "1": 0x08,
  "2": 0x09,
  "3": 0x0a,
  "4": 0x0e
};

const RECEIVE_FAN: Readonly<Record<string, number>> = {
  auto: 0x07,
  "1": 0x00,
  "2": 0x01,
  "3": 0x02,
  "4": 0x06
};

const HORIZONTAL_POSITION: Readonly<Record<string, number>> = {
  "both-left": 0,
  "left-and-center": 1,
  "both-center": 2,
  "center-and-right": 3,
  "both-right": 4,
  wide: 5,
  "center-focus": 6
};

export function encodeAirconStat(currentBytes: Buffer, state: ClimateState): string {
  const current = currentReceiveData(currentBytes);
  validateState(state);

  const command = createCommandData(current, state);
  const receive = createReceiveData(current, state);
  return Buffer.concat([addFrameCrc(command), addFrameCrc(receive)]).toString("base64");
}

export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;

  for (const byte of data) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      const inputBit = (byte >> bit) & 1;
      const topBit = (crc >> 15) & 1;
      crc = (crc << 1) & 0xffff;
      if (inputBit !== topBit) {
        crc ^= 0x1021;
      }
    }
  }

  return crc;
}

function currentReceiveData(bytes: Buffer): Buffer {
  if (bytes.length < 21) {
    throw new Error(`Smart M-Air airconStat is too short: ${bytes.length} bytes`);
  }

  const dataStart = bytes[18] * 4 + 21;
  if (dataStart + 18 > bytes.length - 2) {
    throw new Error(`Smart M-Air airconStat has an invalid data offset: ${dataStart}`);
  }

  return bytes.subarray(dataStart, dataStart + 18);
}

function validateState(state: ClimateState): asserts state is EncodableClimateState {
  const required: Array<keyof ClimateState> = [
    "power",
    "mode",
    "targetTemperature",
    "fanSpeed",
    "vaneVertical",
    "vaneHorizontal",
    "auto3d"
  ];

  for (const field of required) {
    if (state[field] === undefined) {
      throw new Error(`Cannot encode Smart M-Air state without ${field}`);
    }
  }

  const completeState = state as EncodableClimateState;
  if (completeState.targetTemperature < 16 || completeState.targetTemperature > 31 || completeState.targetTemperature * 2 % 1 !== 0) {
    throw new Error(`Invalid target temperature: ${completeState.targetTemperature}`);
  }
  if (COMMAND_FAN[completeState.fanSpeed] === undefined) {
    throw new Error(`Invalid fan speed: ${completeState.fanSpeed}`);
  }
  if (completeState.vaneVertical !== "swing" && !/^position-[1-4]$/.test(completeState.vaneVertical)) {
    throw new Error(`Invalid vertical vane setting: ${completeState.vaneVertical}`);
  }
  if (completeState.vaneHorizontal !== "swing" && HORIZONTAL_POSITION[completeState.vaneHorizontal] === undefined) {
    throw new Error(`Invalid horizontal vane setting: ${completeState.vaneHorizontal}`);
  }
}

function createCommandData(current: Buffer, state: EncodableClimateState): Buffer {
  const data = Buffer.alloc(18);
  data[5] = 0xff;
  data[2] = (state.power ? 0x03 : 0x02) | COMMAND_MODE[state.mode];
  data[3] = COMMAND_FAN[state.fanSpeed];

  if (state.vaneVertical === "swing") {
    data[2] |= 0xc0;
    data[3] |= 0x80;
  } else {
    const position = Number(state.vaneVertical.at(-1));
    data[2] |= 0x80;
    data[3] |= 0x80 + (position - 1) * 0x10;
  }

  if (state.vaneHorizontal === "swing") {
    data[11] = 0x10;
    data[12] |= 0x03;
  } else {
    data[11] = 0x10 + HORIZONTAL_POSITION[state.vaneHorizontal];
    data[12] |= 0x02;
  }

  const targetTemperature = state.mode === "fan" ? 25 : state.targetTemperature;
  data[4] = Math.floor(targetTemperature * 2) + 0x80;
  data[12] |= state.auto3d ? 0x0c : 0x08;
  preserveModelFlags(current, data, true);
  return data;
}

function createReceiveData(current: Buffer, state: EncodableClimateState): Buffer {
  const data = Buffer.alloc(18);
  data[5] = 0xff;
  data[2] = (state.power ? 0x01 : 0x00) | RECEIVE_MODE[state.mode];
  data[3] = RECEIVE_FAN[state.fanSpeed];

  if (state.vaneVertical === "swing") {
    data[2] |= 0x40;
  } else {
    const position = Number(state.vaneVertical.at(-1));
    data[3] |= (position - 1) * 0x10;
  }

  if (state.vaneHorizontal === "swing") {
    data[12] |= 0x01;
  } else {
    data[11] = HORIZONTAL_POSITION[state.vaneHorizontal];
  }

  const targetTemperature = state.mode === "fan" ? 25 : state.targetTemperature;
  data[4] = Math.floor(targetTemperature * 2);
  data[12] |= state.auto3d ? 0x04 : 0x00;
  data[8] |= current[8] & 0x08;
  preserveModelFlags(current, data, false);
  return data;
}

function preserveModelFlags(current: Buffer, target: Buffer, commandFrame: boolean): void {
  const modelValue = current[0] & 0x7f;
  const modelNo = [0, 1, 2].indexOf(modelValue);

  if (modelNo === 1) {
    if (!commandFrame) {
      target[0] |= 0x01;
    }
    target[10] |= current[10] & 0x01;
  } else if (modelNo === 2) {
    if (!commandFrame) {
      target[0] |= 0x02;
    }
  }

  if (modelNo !== 1 && modelNo !== 2) {
    return;
  }

  const selfClean = (current[15] & 0x01) !== 0;
  if (commandFrame) {
    target[10] |= selfClean ? 0x90 : 0x80;
  } else if (selfClean) {
    target[15] |= 0x01;
  }
}

function addFrameCrc(data: Buffer): Buffer {
  const frameWithoutCrc = Buffer.concat([data, Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff])]);
  const crc = crc16Ccitt(frameWithoutCrc);
  const frame = Buffer.alloc(frameWithoutCrc.length + 2);
  frameWithoutCrc.copy(frame);
  frame.writeUInt16LE(crc, frameWithoutCrc.length);
  return frame;
}
