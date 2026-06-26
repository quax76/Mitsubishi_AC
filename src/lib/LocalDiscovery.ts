import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import * as tls from "node:tls";
import type { ConfiguredDevice, DiscoveredDevice } from "./types";

export interface LocalDiscoveryOptions {
  timeoutMs: number;
  scanPorts: number[];
}

export async function discoverLocalDevices(options: LocalDiscoveryOptions): Promise<DiscoveredDevice[]> {
  const candidates = new Map<string, DiscoveredDevice>();

  for (const device of await discoverViaSsdp(options.timeoutMs)) {
    candidates.set(device.id, device);
  }

  for (const device of await discoverViaTlsCertificate(options)) {
    candidates.set(device.id, device);
  }

  for (const device of await discoverViaHttpFingerprint(options)) {
    candidates.set(device.id, device);
  }

  return [...candidates.values()];
}

export function mergeDevices(configured: ConfiguredDevice[], discovered: DiscoveredDevice[]): ConfiguredDevice[] {
  const merged = new Map<string, ConfiguredDevice>();

  for (const device of configured) {
    merged.set(device.id, device);
  }

  for (const device of discovered) {
    const existingById = merged.get(device.id);
    const existingByHost = [...merged.values()].find((entry) => entry.host && entry.host === device.host);

    if (!existingById && !existingByHost) {
      merged.set(device.id, {
        id: device.id,
        name: device.name,
        host: device.host,
        mac: device.mac,
        source: "discovered"
      });
    }
  }

  return [...merged.values()];
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
    const finish = (): void => {
      socket.close();
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

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(searchPayload, 1900, "239.255.255.250");
    });

    setTimeout(finish, timeoutMs);
  });
}

async function discoverViaHttpFingerprint(options: LocalDiscoveryOptions): Promise<DiscoveredDevice[]> {
  const addresses = localSubnetProbeAddresses();
  const discovered: DiscoveredDevice[] = [];

  await Promise.all(
    addresses.map(async (address) => {
      const fingerprint = await readMhiHttpFingerprint(address, options.scanPorts, Math.min(options.timeoutMs, 1200));

      if (fingerprint) {
        discovered.push({
          id: normalizeDeviceId(address),
          name: fingerprint.name ?? `Smart M-Air ${address}`,
          host: address,
          model: fingerprint.model,
          source: "discovered"
        });
      }
    })
  );

  return discovered;
}

async function discoverViaTlsCertificate(options: LocalDiscoveryOptions): Promise<DiscoveredDevice[]> {
  const addresses = localSubnetProbeAddresses();
  const discovered: DiscoveredDevice[] = [];
  const ports = options.scanPorts.includes(51443) ? options.scanPorts : [51443, ...options.scanPorts];

  await Promise.all(
    addresses.map(async (address) => {
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
    })
  );

  return discovered;
}

function localSubnetProbeAddresses(): string[] {
  const addresses = new Set<string>();

  for (const networkInterface of Object.values(os.networkInterfaces())) {
    for (const address of networkInterface ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      const parts = address.address.split(".");
      if (parts.length !== 4) {
        continue;
      }

      const prefix = parts.slice(0, 3).join(".");
      for (let host = 1; host < 255; host += 1) {
        addresses.add(`${prefix}.${host}`);
      }
    }
  }

  return [...addresses];
}

async function readMhiHttpFingerprint(
  host: string,
  ports: number[],
  timeoutMs: number
): Promise<{ name?: string; model?: string } | undefined> {
  for (const port of ports) {
    const response = await readHttpProbe(host, port, timeoutMs);

    if (response && looksLikeMhiDevice(response)) {
      return {
        name: `Smart M-Air ${host}`
      };
    }
  }

  return undefined;
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

async function readHttpProbe(host: string, port: number, timeoutMs: number): Promise<string | undefined> {
  return (await requestProbe("http", host, port, timeoutMs)) ?? (await requestProbe("https", host, port, timeoutMs));
}

async function requestProbe(
  protocol: "http" | "https",
  host: string,
  port: number,
  timeoutMs: number
): Promise<string | undefined> {
  return await new Promise((resolve) => {
    const options: http.RequestOptions = {
      host,
      port,
      path: "/",
      method: "GET",
      timeout: timeoutMs
    };
    const onResponse = (response: http.IncomingMessage): void => {
      const chunks: Buffer[] = [];

      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const headers = JSON.stringify(response.headers);
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(`${headers}\n${body}`);
      });
    };
    const request =
      protocol === "http"
        ? http.request(options, onResponse)
        : https.request({ ...options, rejectUnauthorized: false }, onResponse);

    request.once("timeout", () => {
      request.destroy();
      resolve(undefined);
    });
    request.once("error", () => resolve(undefined));
    request.end();
  });
}

function looksLikeMhiDevice(response: string): boolean {
  const lower = response.toLowerCase();

  return lower.includes("m-air") || lower.includes("smart m") || lower.includes("mitsubishi") || lower.includes("mhi");
}

function normalizeDeviceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
