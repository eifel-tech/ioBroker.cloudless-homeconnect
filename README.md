![Logo](admin/cloudless-homeconnect.png)

# ioBroker.cloudless-homeconnect

[![NPM version](https://img.shields.io/npm/v/iobroker.cloudless-homeconnect.svg)](https://www.npmjs.com/package/iobroker.cloudless-homeconnect)
[![Downloads](https://img.shields.io/npm/dm/iobroker.cloudless-homeconnect.svg)](https://www.npmjs.com/package/iobroker.cloudless-homeconnect)
![Number of Installations](https://iobroker.live/badges/cloudless-homeconnect-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/cloudless-homeconnect-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.cloudless-homeconnect.png?downloads=true)](https://nodei.co/npm/iobroker.cloudless-homeconnect/)

**Tests:** ![Test and Release](https://github.com/eifel-tech/ioBroker.cloudless-homeconnect/workflows/Test%20and%20Release/badge.svg)

## cloudless-homeconnect adapter for ioBroker

Adapter für Homeconnect-Geräte ohne Cloud-Kommunikation

## Developer manual

This section is intended for the developer. It can be deleted later.

### DISCLAIMER

Please make sure that you consider copyrights and trademarks when you use names or logos of a company and add a disclaimer to your README.
You can check other adapters for examples or ask in the developer community. Using a name or logo of a company without permission may cause legal problems for you.

## Homeconnect Adapter ohne Cloudzugriff

Der Adapter kommt ohne API für Homeconnect (https://api-docs.home-connect.com/) aus, bei der die Geräte mit dem Internet verbunden sein müssen. In diesem Adapter erfolgt die Kommunikation und Steuerung der Geräte lokal, nachdem einmalig eine Konfiguration erstellt wurde. Die Geräte können somit nach deren Registrierung in der Homeconnect-App durchgängig vom Internet getrennt sein. Um die korrekte Konfiguration laden zu können, muss dann eine Internetverbindung bestehen.

Die Grundidee zu diesem Adapter stammt von https://github.com/osresearch/hcpy. Der Python-Code dort wurde hier in Javascript portiert und für ioBroker angepasst.

## Voraussetzungen vor der Installation

Es muß mindestens Node.js **Version 18** installiert sein.

Für den Adapter wird <ins>keine</ins> ClientID benötigt, lediglich Benutzername und Passwort, welche in der Homeconnect-App verwendet wurden. Geräte müssen einmalig über die Homeconnect-App registriert werden.

## Konfiguration

In der Adapter-Config muss der Homeconnect App Benutzername und Passwort eingetragen werden.

Im Datenpunkt `info.config` wird die geparste Konfiguration gespeichert. Diese sollte nicht verändert werden. Wenn Geräte im Netzwerk hinzukommen oder wegfallen, müssen diese über die Homeconnect-App registriert werden und der Inhalt des o.a. Datenpunktes gelöscht werden. Der Adapter startet daraufhin neu, verbindet sich mit dem konfigurierten Account und liest die Konfiguration neu ein. Danach erfolgt die Kommunikation mit den Geräten wieder rein lokal.

## Datenpunkte

Hier werden die wichtigsten Datenpunkte beschrieben. Im Namen ist die UID hinterlegt, wie sie das jeweilige Gerät kennt und verwendet. Wird ein Wert verändert, der für das Gerät in dem Moment unplausibel ist, wird eine Log-Eintrag im Debug-Modus geschrieben. Dies kann vorkommen, wenn z.B. `AbortProgram` verändert wird, obwohl gerade kein Programm aktiv ist. Die Struktur ist z.B. wie folgt aufgebaut:

```
<cloudless-homeconnect.0>
|
└── info
│       └── config
│
└── <Geräte-ID>
│       └── Command
│       |       └── AbortProgram
│       |       └── PauseProgram
│       |       └── ...
│       └── Event
│       |       └── ProgramFinished
│       |       └── CavityTemperatureTooHigh
│       |       └── ...
│       └── Option
│       |       └── ElapsedProgramTime
│       |       └── ProgramProgress
│       |       └── ...
│       └── Program
│       |       └── KeepWarm
|       |       |       └── Start
|       |       |       └── Duration
|       |       |       └── ...
│       |       └── Hot_Air
|       |       |       └── Start
|       |       |       └── Duration
|       |       |       └── ...
│       |       └── ...
│       └── Setting
│       |       └── ChildLock
│       |       └── PowerState
│       |       └── ...
│       └── Status
│       |       └── BackendConnected
│       |       └── CurrentTemperature
│       |       └── ...
|       └── ActiveProgram
|       └── SelectedProgram
```

### info.config

Hier wird die Konfiguration als JSON gespeichert. Soll diese neu eingelesen werden, bspw. weil neue Geräte hinzugekommen sind, muss der Inhalt gelöscht und der Adapter ggfs. neu gestartet werden.

### `ActiveProgram` und `SelectedProgram`

Die Datenpunkte enthalten als Wert die UID des Programms, das gerade läuft. `ActiveProgram` ist dabei `readonly`.

### Command

Unter `Command` werden Datenpunkte der Rolle `button` gesammelt, die das Gerät zum Fernsteuern zur Verfügung stellt. Es kann nur eine Reaktion der Gegenseite erwartet werden, wenn das Kommando plausibel ist: `AbortProgram` wird nur ausgeführt, wenn auch ein Programm aktiv ist.

### Event

Tritt ein bestimmtes Ereignis wie z.B. "ein Programm ist fertig" ein, wird der entsprechende Datenpunkt im Ordner `Event` getriggert.

### Option

Unter Optionen finden sich die ausschließlich lesbaren Datenpunkte, die die Programme betreffen. Die beschreibbaren Optionen finden sich unter dem Ordner `Program`. Da immer nur ein Programm aktiv sein kann, beziehen sich die lesbaren Optionen immer auf das aktuell laufende Programm.

### Program

Über den Datenpunkt `Start` kann das jeweilge Programm gestartet werden. Außerdem werden die eigestellten Optionen, die das Programm unterstützt, ausgelesen und mit übermittelt. Daher ist es wichtig, die Optionen **vor** dem Klick auf `Start` einzustellen. Wenn das Programm läuft, wird dieses in `ActiveProgram` angezeigt.

Wird ein Programm gestartet, obwohl schon ein Programm aktiv ist, wird das Aktive zunächst vom Adapter beendet.

### Setting

Hier können allgemeine Einstellungen des Geräts vorgenommen werden. Beispielsweise kann über die Einstellung `Light_Cavity_001_Power` das Licht eines Ofens ein- oder ausgeschaltet werden. Der Datenpunkt `InteriorIlluminationActive` unter `Status` ist nur lesbar und zeigt dagegen nur den Status der Beleuchtung an.

### Status

`Status` enthält die Übersicht über Zustände des Gerätes. Diese sind nur lesbar.

## Changelog

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **TODOs**

-   Weitere Geräte hinzufügen, die über <ins>keinen</ins> freigeschalteten Port 443 verfügen.
-   Favoriten in Settings einstellen können

### 1.0.3

-   (eifel-tech) Neue Socketverbindung nach Timeout

### 1.0.2

-   (eifel-tech) Wird ein neues Programm gestartet, wird ein evtl. laufendes zunächst beendet

### 1.0.1

-   (eifel-tech) Erhöhung der Sicherheit bei TLS

### 1.0.0

-   (eifel-tech) initial release

## License

MIT License

Copyright (c) 2024 eifel-tech <hikaso@gmx.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
