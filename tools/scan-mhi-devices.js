#!/usr/bin/env node
"use strict";

const tls = require("node:tls");

const subnet = process.argv[2] ?? "172.23.1";
const port = Number(process.argv[3] ?? 51443);
const timeoutMs = Number(process.argv[4] ?? 1200);
const hosts = Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`);
const results = [];
let nextIndex = 0;

function scan(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        servername: "mhi"
      },
      () => {
        const cert = socket.getPeerCertificate();
        const org = cert.subject && cert.subject.O;

        if (org && String(org).includes("Mitsubishi Heavy Industries")) {
          results.push({
            host,
            port,
            deviceId: cert.subject.CN,
            subject: cert.subject,
            fingerprint256: cert.fingerprint256
          });
        }

        socket.destroy();
        resolve();
      }
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve();
    });
    socket.on("error", () => resolve());
  });
}

async function worker() {
  while (nextIndex < hosts.length) {
    const host = hosts[nextIndex];
    nextIndex += 1;
    await scan(host);
  }
}

(async () => {
  await Promise.all(Array.from({ length: 40 }, worker));
  console.log(JSON.stringify(results.sort((a, b) => a.host.localeCompare(b.host)), null, 2));
})();
