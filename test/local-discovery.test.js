const assert = require("node:assert/strict");
const test = require("node:test");

const { localSubnetProbeAddresses, mergeDevices } = require("../build/lib/LocalDiscovery");

test("builds /24 probe addresses from host addresses and configured subnets", () => {
  const addresses = localSubnetProbeAddresses(["172.23.1.152"], ["192.168.50.0/24"]);

  assert.ok(addresses.includes("172.23.1.29"));
  assert.ok(addresses.includes("192.168.50.254"));
  assert.ok(!addresses.includes("172.23.1.0"));
  assert.ok(!addresses.includes("192.168.50.255"));
});

test("preserves assigned names and updates addresses by normalized MAC", () => {
  const configured = [
    {
      id: "348e89be7d9d",
      name: "Wohnzimmer",
      host: "172.23.1.20",
      mac: "34:8E:89:BE:7D:9D",
      source: "manual"
    }
  ];
  const discovered = [
    {
      id: "348e89be7d9d",
      name: "Smart M-Air 172.23.1.29",
      host: "172.23.1.29",
      mac: "34:8e:89:be:7d:9d",
      source: "discovered"
    }
  ];

  assert.deepEqual(mergeDevices(configured, discovered), [
    {
      id: "348e89be7d9d",
      name: "Wohnzimmer",
      host: "172.23.1.29",
      mac: "34:8e:89:be:7d:9d",
      source: "manual"
    }
  ]);
});
