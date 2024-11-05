![Logo](admin/cloudless-homeconnect.png)

# ioBroker.cloudless-homeconnect

[![NPM version](https://img.shields.io/npm/v/iobroker.cloudless-homeconnect.svg)](https://www.npmjs.com/package/iobroker.cloudless-homeconnect)
[![Downloads](https://img.shields.io/npm/dm/iobroker.cloudless-homeconnect.svg)](https://www.npmjs.com/package/iobroker.cloudless-homeconnect)
![Number of Installations](https://iobroker.live/badges/cloudless-homeconnect-installed.svg)

![GitHub](https://img.shields.io/github/license/eifel-tech/iobroker.cloudless-homeconnect?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/eifel-tech/iobroker.cloudless-homeconnect?logo=github&style=flat-square)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/eifel-tech/iobroker.cloudless-homeconnect?logo=github&style=flat-square)
![GitHub last commit](https://img.shields.io/github/last-commit/eifel-tech/iobroker.cloudless-homeconnect?logo=github&style=flat-square)
![GitHub issues](https://img.shields.io/github/issues/eifel-tech/iobroker.cloudless-homeconnect?logo=github&style=flat-square)
![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/eifel-tech/iobroker.cloudless-homeconnect/test-and-release.yml?branch=master&logo=github&style=flat-square)

Adapter für Homeconnect-Geräte ohne Cloud-Kommunikation

### DISCLAIMER

Please make sure that you consider copyrights and trademarks when you use names or logos of a company and add a disclaimer to your README.
You can check other adapters for examples or ask in the developer community. Using a name or logo of a company without permission may cause legal problems for you.

## Homeconnect Adapter ohne Cloudzugriff

Der Adapter kommt ohne API für Homeconnect (https://api-docs.home-connect.com/) aus, bei der die Geräte mit dem Internet verbunden sein müssen. In diesem Adapter erfolgt die Kommunikation und Steuerung der Geräte lokal, nachdem einmalig eine Konfiguration erstellt wurde. Die Geräte können somit nach deren Registrierung in der Homeconnect-App durchgängig vom Internet getrennt sein. Um die korrekte Konfiguration laden zu können, muss dann eine Internetverbindung bestehen.

Die Grundidee zu diesem Adapter stammt von https://github.com/osresearch/hcpy. Der Python-Code dort wurde hier in Javascript portiert und für ioBroker angepasst.

## Voraussetzungen vor der Installation

Es muss mindestens Node.js **Version 18** installiert sein.

Für den Adapter wird im Gegensatz zur Verwendung der offiziellen API <ins>keine</ins> ClientID benötigt, lediglich Benutzername und Passwort, welche in der Homeconnect-App verwendet wurden. Geräte müssen einmalig über die Homeconnect-App registriert werden.

Im lokalen Netz muss Port 443 am Gerät freigeschaltet sein.

Es kann vorkommen, dass das Gerät nach Laden der Konfiguration nicht angesprochen werden kann. Dann liegt im lokalen Netz kein DNS-Eintrag für die Domain des Geräts vor. Außer diesen im Netzwerk einzurichten, kann im Datenpunkt `info.config` bei `host` einfach die lokale IP des Gerätes eingetragen werden.

## Konfiguration

In der Adapter-Config muss der Homeconnect App Benutzername und Passwort eingetragen werden.

Im Datenpunkt `info.config` wird die geparste Konfiguration gespeichert. Diese sollte nicht verändert werden. Wenn Geräte im Netzwerk hinzukommen oder wegfallen, müssen diese über die Homeconnect-App registriert werden und der Inhalt des o.a. Datenpunktes gelöscht werden. Der Adapter startet daraufhin neu, verbindet sich mit dem konfigurierten Account und liest die Konfiguration neu ein. Danach erfolgt die Kommunikation mit den Geräten wieder rein lokal.

Kommt es im Laufe der Zeit zu Verbindungsfehlern wird eine Neuverbindung zum Gerät versucht. Dieses geschieht standardmäßig 15 mal, kann aber bei der Instanz eingestellt werden. Soll der Versuch nie abgebrochen werden, also immer wieder versucht werden, eine Verbindung herzustellen, muss eine `0` eingestellt werden.

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

### info.connection

Dieser Datenpunkt wird `false`, wenn die Verbindung zu **mindestens** einem Gerät nicht hergestellt werden kann, also bei einem Socketerror. Dadurch wird auch in der Instanzübersicht der Adapter "gelb". Es wird automatisch 15 mal eine Neuverbindung mit maximal 5 Minuten Wartezeit zum Gerät versucht. Danach müsste der Adapter manuell neugestartet werden, um wieder eine Verbindung aufzubauen. Die Anzahl der Neuverbindungen kann aber in den Instanzeinstellungen geändert werden (siehe [Konfiguration](#konfiguration)) Warum das Gerät nicht verbunden werden kann und um welches Gerät es sich handelt, steht in warn-Einträgen im Log. Hier muss dann "von Hand" geschaut werden, wie das Problem zu beheben ist. Der Datenpunkt wird nur für Geräte gesetzt, die sich in der Überwachung des Adapters befinden (siehe [observe](#observe)).

### info.config

Hier wird die Konfiguration als JSON gespeichert. Soll diese neu eingelesen werden, bspw. weil neue Geräte hinzugekommen sind, muss der Inhalt gelöscht und der Adapter ggfs. neu gestartet werden.

### `ActiveProgram` und `SelectedProgram`

Die Datenpunkte enthalten als Wert die UID des Programms, das gerade läuft. `ActiveProgram` ist dabei `readonly`.

### observe

Mit dem Datenpunkt `observe` können bei Änderung auf `false` Geräte von der Überwachung des Adapters ausgeschlossen werden. So kann bspw. im Fehlerfall eingestellt werdne, dass nur ein Gerät vom Adapter beachtet wird und kein anderes "dazwischen funkt".

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
### 1.2.8 (2024-11-05)

-   (eifel-tech) Verbotene Zeichen verhindern
-   (eifel-tech) Mehr Auflösungen in Instanzeinstellungen berücksichtigt
-   (eifel-tech) Anzahl Verbindungsversuche konfigurierbar
-   (eifel-tech) Bugfix beim Einlesen von Programmoptionen

### 1.2.7 (2024-10-24)

-   (eifel-tech) Hinweise vom Adapterchecker

### 1.2.6 (2024-10-24)

-   (eifel-tech) Übersetzungen hinzugefügt

### 1.2.5 (2024-10-23)

-   (eifel-tech) Instanz bleibt beim ersten Start gelb

### 1.2.4 (2024-10-23)

-   (eifel-tech) Verhindern, dass Nachricht `undefined` gesendet wird

### 1.2.3

-   (eifel-tech) Datenpunkt hinzugefügt, um anzuzeigen, ob eine Socketverbindung besteht

### 1.2.2

-   (eifel-tech) Verwendung einer persistenten Websocketverbindung
-   (eifel-tech) Abhängigkeiten überarbeitet

### 1.2.1

-   (eifel-tech) Abbrechen der Verbindung, wenn bei der Socketverbindung zum Gerät Fehler auftreten

### 1.2.0

-   (eifel-tech) Möglichkeit, einzelne Geräte von der Steuerung auszuschließen.
    > [!CAUTION]
    > Die Konfiguration musste dafür erweitert werden, weswegen der Inhalt des Datenpunkts `info.config` gelöscht und der Adapter neu gestartet werden muss. Ebenfalls den Objektbaum `General` löschen.

### 1.1.2

-   (eifel-tech) Waschmaschine: Optionen der Programme werden separat und nicht inkl. des zu startenden Programms gesendet

### 1.1.1

-   (eifel-tech) Parsen der Konfiguration vereinfacht

### 1.1.0

-   (eifel-tech) Parsen der Konfiguration bei mehreren Geräten überarbeitet
-   (eifel-tech) Abhängigkeiten aktualisiert

### 1.0.4

-   (eifel-tech) Unterstützung für Geschirrspüler

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
