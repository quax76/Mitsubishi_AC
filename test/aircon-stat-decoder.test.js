const assert = require("node:assert/strict");
const test = require("node:test");
const { decodeAirconStat } = require("../build/lib/AirconStatDecoder");

function decode(hex) {
  return decodeAirconStat(Buffer.from(hex, "hex"));
}

test("decodes power, mode and target temperature", () => {
  const coolOff = decode("0000aabfb0ff0000000000128a000000000001ffffffff933a8104081732a5000088000000000000000000038020a5ff8010e4ff941000007c72");
  const heatOn = decode("0000aabfb0ff0000000000128a000000000001ffffffff933a8104111732a5000081000000000000000000038020a5ff8010e4ff94100000eb90");
  const autoOn = decode("0000aabfb0ff0000000000128a000000000001ffffffff933a8104011730a5000080020000000000000000038020a5ff8010e4ff9410000052e3");
  const dryOn = decode("0000aabfb0ff0000000000128a000000000001ffffffff933a8104051730a5000088000000000000000000038020a5ff8010e4ff94100000da12");
  const fanOn = decode("0000aabfb0ff0000000000128a000000000001ffffffff933a81040d1730a7000088000000000000000000038020a7ff8010e5ff94100000fe2e");

  assert.deepEqual([coolOff.power, coolOff.mode, coolOff.targetTemperature], [false, "cool", 25]);
  assert.deepEqual([heatOn.power, heatOn.mode, heatOn.targetTemperature], [true, "heat", 25]);
  assert.equal(autoOn.mode, "auto");
  assert.equal(dryOn.mode, "dry");
  assert.equal(fanOn.mode, "fan");
});

test("decodes fan speeds and vertical vane positions", () => {
  const speed3 = decode("0000af99b2ff0000000000108a000000000001ffffffff274981040d1230a7000088000000000000000000038020a7ff8010e3ff94100000bf7a");
  const speed4Bottom = decode("0000afbeb2ff0000000000108a000000000001ffffffff981781040d3632a3000088000000000000000000038020a3ff8010eaff941000000025");
  const verticalSwing = decode("0000ef8eb2ff0000000000108a000000000001ffffffff1bb181044d0632a3000088000000000000000000038020a3ff8010e9ff94100000697a");

  assert.deepEqual([speed3.fanSpeed, speed3.vaneVertical], ["3", "position-2"]);
  assert.deepEqual([speed4Bottom.fanSpeed, speed4Bottom.vaneVertical], ["4", "position-4"]);
  assert.equal(verticalSwing.vaneVertical, "swing");
});

test("decodes horizontal vane distributions and swing", () => {
  const wide = decode("0000ef8eb2ff0000000000158a000000000001ffffffffbabf81044d0632a3000088000005000000000000038020a3ff8010e9ff94100000ff61");
  const focus = decode("0000ef8eb2ff0000000000168a000000000001ffffffff25ba81044d0632a3000088000006000000000000038020a3ff8010ebff94100000cd45");
  const swing = decode("0000ef8eb2ff0000000000108b000000000001ffffffff526981044d0632a3000088000000010000000000038020a3ff8010ecff94100000e486");

  assert.equal(wide.vaneHorizontal, "wide");
  assert.equal(focus.vaneHorizontal, "center-focus");
  assert.equal(swing.vaneHorizontal, "swing");
});

test("decodes 3D auto independently from horizontal swing", () => {
  const swing = decode("0000ef8eb2ff0000000000108b000000000001ffffffff526981044d0632a3000088000000010000000000038020a3ff8010ecff94100000e486");
  const auto3d = decode("0000ef8eb2ff0000000000108f000000000001ffffffff153881044d0632a3000088000000050000000000038020a3ff8010eaff941000006519");

  assert.equal(swing.auto3d, false);
  assert.equal(auto3d.auto3d, true);
  assert.equal(auto3d.vaneHorizontal, "swing");
  assert.equal(auto3d.vaneVertical, "swing");
});

test("decodes calibrated temperatures, local energy and error status", () => {
  const state = decode("0000ef8eb2ff0000000000108b000000000001ffffffff526981044d0632a3000088000000010000000000038020a3ff8010ebff94100000c9d7");

  assert.equal(state.roomTemperature, 26);
  assert.equal(state.outdoorTemperature, 36.6);
  assert.equal(state.energyConsumption, 0);
  assert.equal(state.errorCode, "00");
});
