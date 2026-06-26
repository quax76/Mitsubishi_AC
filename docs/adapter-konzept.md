# ioBroker Adapterkonzept: Mitsubishi Heavy Smart M-Air Klimaanlagen

Stand: 2026-06-26

## Ziel

Der Adapter soll Mitsubishi-Heavy-Klimaanlagen, die heute ueber die Hersteller-App "Smart M-Air" gesteuert werden, in ioBroker abbilden. Ziel ist:

- alle relevanten Statuswerte als ioBroker-Datenpunkte sichtbar machen
- Sollwerte und Betriebsarten aus ioBroker schreiben koennen
- mehrere Innengeraete unter einer Adapterinstanz verwalten
- lokale WLAN-Steuerung ohne Cloud-Zugang
- Discovery im lokalen Netz und automatische Anlage der ioBroker-Datenpunkte

## Wichtige Vorabklaerung

Mitsubishi ist bei Klimaanlagen nicht gleich Mitsubishi:

- Mitsubishi Electric nutzt haeufig MELCloud, Kumo Cloud oder andere Wi-Fi-Module.
- Mitsubishi Heavy Industries nutzt haeufig Smart M-Air mit WF-RAC-/aehnlichen WLAN-Adaptern.

Fuer die Umsetzung werden daher mindestens benoetigt:

- Modell des Innen-/Aussengeraets
- Modell des WLAN-Moduls, falls aufgedruckt oder in der App sichtbar
- optional: ein Netzwerk-Mitschnitt der App-Kommunikation beim Aendern von Power, Modus, Temperatur und Luefter

Bestaetigt:

- App: Smart M-Air
- Herstellerzweig: Mitsubishi Heavy Industries
- gewuenschter Betrieb: lokal im LAN, ohne Cloud-Konfiguration

## Empfohlene Adapterstruktur

Name des npm/ioBroker-Pakets:

`ioBroker.mitsubishi-smartmair`

Technische Basis:

- TypeScript
- `@iobroker/adapter-core`
- daemon/main Adapter
- Admin-Konfiguration mit lokaler Discovery, Geraeteliste und Polling-Intervall
- separater Treiber unter `src/lib/`, damit das Protokoll isoliert testbar bleibt

Vorgeschlagene Ordner:

```text
ioBroker.mitsubishi-smartmair/
  admin/
  src/
    main.ts
    lib/
      MitsubishiClient.ts
      LocalDiscovery.ts
      DeviceRegistry.ts
      StateMapper.ts
      types.ts
  test/
    unit/
    integration/
  io-package.json
  package.json
  tsconfig.json
```

## Datenpunktmodell

Pro Klimageraet:

```text
mitsubishi-smartmair.0.devices.<deviceId>.info.name
mitsubishi-smartmair.0.devices.<deviceId>.info.model
mitsubishi-smartmair.0.devices.<deviceId>.info.host
mitsubishi-smartmair.0.devices.<deviceId>.info.mac
mitsubishi-smartmair.0.devices.<deviceId>.info.firmware
mitsubishi-smartmair.0.devices.<deviceId>.info.online
mitsubishi-smartmair.0.devices.<deviceId>.info.lastSeen

mitsubishi-smartmair.0.devices.<deviceId>.status.roomTemperature
mitsubishi-smartmair.0.devices.<deviceId>.status.outdoorTemperature
mitsubishi-smartmair.0.devices.<deviceId>.status.targetTemperature
mitsubishi-smartmair.0.devices.<deviceId>.status.power
mitsubishi-smartmair.0.devices.<deviceId>.status.mode
mitsubishi-smartmair.0.devices.<deviceId>.status.fanSpeed
mitsubishi-smartmair.0.devices.<deviceId>.status.vaneVertical
mitsubishi-smartmair.0.devices.<deviceId>.status.vaneHorizontal
mitsubishi-smartmair.0.devices.<deviceId>.status.errorCode

mitsubishi-smartmair.0.devices.<deviceId>.control.power
mitsubishi-smartmair.0.devices.<deviceId>.control.mode
mitsubishi-smartmair.0.devices.<deviceId>.control.targetTemperature
mitsubishi-smartmair.0.devices.<deviceId>.control.fanSpeed
mitsubishi-smartmair.0.devices.<deviceId>.control.vaneVertical
mitsubishi-smartmair.0.devices.<deviceId>.control.vaneHorizontal
mitsubishi-smartmair.0.devices.<deviceId>.control.refresh
```

Optionale Komfortfunktionen, sofern vom Protokoll unterstuetzt:

```text
control.eco
control.hiPower
control.silent
control.nightMode
control.clean
control.dry
control.threeD
status.energyToday
status.energyMonth
status.filterDirty
```

## Rollen und Schreiblogik

- `status.*` wird nur vom Adapter geschrieben und immer mit `ack=true`.
- `control.*` wird von ioBroker-Skripten/Vis/Blockly geschrieben.
- Bei `ack=false` sendet der Adapter den Befehl ans Geraet.
- Nach erfolgreicher Rueckmeldung aktualisiert der Adapter den passenden `status.*`-Wert.
- Wenn das Geraet den Befehl ablehnt oder nicht antwortet, bleibt `status.*` unveraendert und der Adapter schreibt eine Warnung ins Log.

## Konfiguration

Admin-Felder:

- `pollIntervalSeconds`, Standard 30
- `commandTimeoutMs`, Standard 5000
- `discoveryEnabled`, Standard true
- `discoveryTimeoutMs`, Standard 5000
- `discoveryScanPorts`, Standard `[80, 443, 51443]`
- `devices[]`
  - `name`
  - `host`
  - `deviceId`
  - `mac`
  - `source`, `discovered` oder `manual`

## Protokollstrategie

Phase 1: Lokale Identifikation

1. Pruefen, ob die App im lokalen WLAN ohne Internet funktioniert.
2. IP-Adresse des Klimageraets im Router ermitteln.
3. Per SSDP/mDNS und gezielten HTTP-Fingerprints suchen.
4. App-Befehle mitschneiden:
   - Power an/aus
   - Modus Kuehlen/Heizen/Auto/Trocknen/Lueften
   - Solltemperatur aendern
   - Luefterstufe aendern
   - Lamellenposition aendern

Wichtig: Ein generischer Portscan darf nicht automatisch alle Webgeraete als Klimaanlage eintragen. Geraete werden nur ueber einen Smart-M-Air-/MHI-Fingerprint uebernommen.

Phase 2: Lokaler Treiber

- Fuer lokale HTTP/TCP/UDP-Kommunikation: `MitsubishiClient` direkt gegen die Geraete-IP.
- Einheitliche interne Struktur `ClimateState`, damit der ioBroker-Teil nicht vom Protokoll abhaengt.

Phase 3: ioBroker-Integration

- Objekte dynamisch pro erkanntem Geraet anlegen.
- Schreibbare Datenpunkte abonnieren.
- Polling plus Sofort-Refresh nach Befehlen.
- Reconnect- und Offline-Erkennung.

## Minimaler TypeScript-Schnitt

```ts
export type HvacMode = "auto" | "cool" | "heat" | "dry" | "fan";

export interface ClimateState {
  power: boolean;
  mode: HvacMode;
  targetTemperature: number;
  roomTemperature?: number;
  fanSpeed?: string;
  vaneVertical?: string;
  vaneHorizontal?: string;
  errorCode?: string;
}

export interface ClimateCommand {
  power?: boolean;
  mode?: HvacMode;
  targetTemperature?: number;
  fanSpeed?: string;
  vaneVertical?: string;
  vaneHorizontal?: string;
}

export interface MitsubishiClient {
  discover(): Promise<DiscoveredDevice[]>;
  getState(deviceId: string): Promise<ClimateState>;
  setState(deviceId: string, command: ClimateCommand): Promise<ClimateState>;
}
```

## Entwicklungsablauf

1. Adaptergeruest mit dem offiziellen ioBroker-Generator erzeugen:

   ```powershell
   npx @iobroker/create-adapter@latest
   ```

   Empfohlene Antworten:

   - Adapter, kein VIS-Widget
   - TypeScript
   - daemon
   - Kategorie `climate-control`
   - Admin UI aktivieren
   - Tests aktivieren

2. Treiber ohne ioBroker-Abhaengigkeit implementieren und mit Mock-Daten testen.
3. Datenpunkte in ioBroker anlegen und Mapping testen.
4. Echte Klimaanlage zuerst nur lesen.
5. Schreibbefehle einzeln freischalten.
6. Beta-Test mit mehreren Geraeten.

## Erste sinnvolle Implementierung

Der erste lauffaehige Prototyp sollte nur diese Funktionen koennen:

- manuelle IP-Konfiguration
- `info.online`
- `status.roomTemperature`
- `status.power`
- `status.mode`
- `status.targetTemperature`
- `control.power`
- `control.mode`
- `control.targetTemperature`

Alles andere kann danach ergaenzt werden. So bleibt das Risiko klein und man erkennt frueh, ob das Protokoll stabil genug ist.

## Offene Punkte

- Welches Wi-Fi-Modul ist verbaut?
- Welche lokale Geraetesignatur liefert das Modul bei Discovery/HTTP/UDP?
- Wird lokal Authentifizierung pro Geraet benoetigt?
- Welche Werte zeigt die Original-App tatsaechlich an?
