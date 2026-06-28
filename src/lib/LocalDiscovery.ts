import dgram from "node:dgram";
import os from "node:os";
import * as tls from "node:tls";
import type { ConfiguredDevice, DiscoveredDevice } from "./types";

export interface LocalDiscoveryOptions {
  timeoutMs: number;
  scanPorts: number[];
  seedAddresses?: string[];
  subnets?: string[];
  concurrency?: number;
}

export async function discoverLocalDevices(options: LocalDiscoveryOptions): Promise<DiscoveredDevice[]> {
  const candidates = new Map<string, DiscoveredDevice>();
  const addresses = localSubnetProbeAddresses(options.seedAddresses, options.subnets);
  const [ssdpDevices, tlsDevices] = await Promise.all([
    discoverViaSsdp(options.timeoutMs),
    discoverViaTlsCertificate(options, addresses)
  ]);

  for (const device of ssdpDevices) {
    candidates.set(device.id, device);
  }

  for (const device of tlsDevices) {
    candidates.set(device.id, device);
  }

  return [...candidates.values()];
}

export function mergeDevices(configured: ConfiguredDevice[], discovered: DiscoveredDevice[]): ConfiguredDevice[] {
  const merged = configured.map((device) => ({ ...device }));

  const normalizedMac = (mac: string | undefined): string | undefined => mac?.toLowerCase().replace(/[^a-f0-9]/g, "");

  for (const device of discovered) {
    const mac = normalizedMac(device.mac);
    const index = merged.findIndex(
      (entry) =>
        entry.id === device.id ||
        (mac !== undefined && normalizedMac(entry.mac) === mac) ||
        (entry.host !== undefined && entry.host === device.host)
    );

    if (index === -1) {
      merged.push({
        id: device.id,
        name: device.name,
        host: device.host,
        mac: device.mac,
        source: "discovered"
      });
      continue;
    }

    const existing = merged[index];
    merged[index] = {
      ...existing,
      id: existing.id || device.id,
      host: device.host ?? existing.host,
      mac: device.mac ?? existing.mac
    };
  }

  return merged;
}

async function discoverViaSsdp(timeoutMs: number): Promise<DiscoveredDevice[]> {
  const socket = dgram.createSocket("udp4");
  const found = new Map<string, DiscoveredDevice>();
  const searchPayload = [
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    'MAN: "ssdp:discover"',
    "MX: 2",
    "ST: ssdp:all",
    "",
    ""
  ].join("\r\n");

  return await new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.close();
      } catch {
        // Socket may already be closed after a bind or send error.
      }
      resolve([...found.values()]);
    };

    socket.on("message", (message, remote) => {
      const response = message.toString("utf8");

      if (!looksLikeMhiDevice(response)) {
        return;
      }

      found.set(remote.address, {
        id: normalizeDeviceId(remote.address),
        name: `Smart M-Air ${remote.address}`,
        host: remote.address,
        source: "discovered"
      });
    });

    socket.once("error", finish);
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.send(searchPayload, 1900, "239.255.255.250", (error) => error && finish());
      } catch {
        finish();
      }
    });

    setTimeout(finish, timeoutMs);
  });
}

async function discoverViaTlsCertificate(
  options: LocalDiscoveryOptions,
  addresses: string[]
): Promise<DiscoveredDevice[]> {
  const discovered: DiscoveredDevice[] = [];
  const ports = [51443, ...options.scanPorts.filter((port) => port !== 51443 && port > 1024)];

  await mapWithConcurrency(
    addresses,
    options.concurrency ?? 32,
    async (address) => {
      const fingerprint = await readMhiTlsFingerprint(address, ports, Math.min(options.timeoutMs, 1200));

      if (fingerprint) {
        discovered.push({
          id: fingerprint.deviceId ?? normalizeDeviceId(address),
          name: `Smart M-Air ${address}`,
          host: address,
          mac: fingerprint.mac,
          source: "discovered"
        });
      }
    }
  );

  return discovered;
}

export function localSubnetProbeAddresses(seedAddresses: string[] = [], subnets: string[] = []): string[] {
  const addresses = new Set<string>();
  const prefixes = new Set<string>();

  for (const networkInterface of Object.values(os.networkInterfaces())) {
    for (const address of networkInterface ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      const parts = address.address.split(".");
      if (parts.length !== 4) {
        continue;
      }

      prefixes.add(parts.slice(0, 3).join("."));
    }
  }

  for (const address of seedAddresses) {
    const parts = address.split(".");
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
      prefixes.add(parts.slice(0, 3).join("."));
    }
  }

  for (const subnet of subnets) {
    const normalized = subnet.trim().replace(/\.0\/24$/, "");
    const parts = normalized.split(".");
    if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
      prefixes.add(normalized);
    }
  }

  for (const prefix of prefixes) {
    for (let host = 1; host < 255; host += 1) {
      addresses.add(`${prefix}.${host}`);
    }
  }

  return [...addresses].sort((left, right) => ipToNumber(left) - ipToNumber(right));
}

async function mapWithConcurrency<T>(
  items: string[],
  concurrency: number,
  worker: (item: string) => Promise<T>
): Promise<void> {
  const queue = [...items];
  const workerCount = Math.min(Math.max(1, concurrency), queue.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) {
          await worker(item);
        }
      }
    })
  );
}

function ipToNumber(address: string): number {
  return address.split(".").reduce((result, part) => result * 256 + Number(part), 0);
}

async function readMhiTlsFingerprint(
  host: string,
  ports: number[],
  timeoutMs: number
): Promise<{ deviceId?: string; mac?: string } | undefined> {
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

function firstCertificateValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readTlsCertificate(
  host: string,
  port: number,
  timeoutMs: number
): Promise<tls.PeerCertificate | undefined> {
  return await new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        servername: "mhi"
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        resolve(cert);
      }
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.on("error", () => resolve(undefined));
  });
}

function looksLikeMhiDevice(response: string): boolean {
  const lower = response.toLowerCase();

  return lower.includes("m-air") || lower.includes("smart m") || lower.includes("mitsubishi") || lower.includes("mhi");
}

function normalizeDeviceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
