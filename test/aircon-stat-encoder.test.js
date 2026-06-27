const assert = require("node:assert/strict");
const test = require("node:test");
const { decodeAirconStat } = require("../build/lib/AirconStatDecoder");
const { crc16Ccitt, encodeAirconStat } = require("../build/lib/AirconStatEncoder");

const CURRENT_HEX = "0000abbfb0ff0000000000108a000000000001ffffffff8fe98104093730a3000088020000000000000000038020a3ff8010eaff94100100deb1";

function currentState() {
  const bytes = Buffer.from(CURRENT_HEX, "hex");
  return { bytes, state: decodeAirconStat(bytes) };
}

function assertFrameCrc(frame) {
  assert.equal(frame.length, 25);
  assert.equal(frame.readUInt16LE(23), crc16Ccitt(frame.subarray(0, 23)));
}

test("encodes two CRC-protected Smart M-Air frames", () => {
  const { bytes, state } = currentState();
  const encoded = Buffer.from(encodeAirconStat(bytes, state), "base64");

  assert.equal(encoded.length, 50);
  assertFrameCrc(encoded.subarray(0, 25));
  assertFrameCrc(encoded.subarray(25, 50));
  assert.equal(encoded[0], 0, "command frame must not include the model number");
  assert.equal(encoded[25], 1, "receive frame must preserve model number 1");
});

test("roundtrips the decoded controllable state", () => {
  const { bytes, state } = currentState();
  const encoded = Buffer.from(encodeAirconStat(bytes, state), "base64");
  const decoded = decodeAirconStat(encoded);

  for (const field of ["power", "mode", "targetTemperature", "fanSpeed", "vaneVertical", "vaneHorizontal", "auto3d"]) {
    assert.equal(decoded[field], state[field], field);
  }
});

test("changes only requested decoded controls", () => {
  const { bytes, state } = currentState();
  const next = { ...state, targetTemperature: 25 };
  const encoded = Buffer.from(encodeAirconStat(bytes, next), "base64");
  const decoded = decodeAirconStat(encoded);

  assert.equal(decoded.targetTemperature, 25);
  assert.equal(decoded.power, true);
  assert.equal(decoded.mode, "cool");
  assert.equal(decoded.fanSpeed, "auto");
  assert.equal(decoded.vaneVertical, "position-4");
  assert.equal(decoded.vaneHorizontal, "both-left");
  assert.equal(decoded.auto3d, false);
});

test("rejects unsafe incomplete or invalid states", () => {
  const { bytes, state } = currentState();
  assert.throws(() => encodeAirconStat(bytes, { power: true }), /without mode/);
  assert.throws(() => encodeAirconStat(bytes, { ...state, targetTemperature: 25.3 }), /Invalid target temperature/);
});
