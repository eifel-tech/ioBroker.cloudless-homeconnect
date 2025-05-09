![Logo](../../admin/cloudless-homeconnect-880x800.png)

# ioBroker.cloudless-homeconnect

Adapter für Homeconnect-Geräte ohne Cloud-Kommunikation

## Homeconnect Adapter ohne Cloudzugriff

Der Adapter kommt ohne API für Homeconnect (https://api-docs.home-connect.com/) aus, bei der die Geräte mit dem Internet verbunden sein müssen. In diesem Adapter erfolgt die Kommunikation und Steuerung der Geräte lokal, nachdem einmalig eine Konfiguration erstellt wurde. Die Geräte können somit nach deren Registrierung in der Homeconnect-App durchgängig vom Internet getrennt sein. Um die korrekte Konfiguration laden zu können, muss dann eine Internetverbindung bestehen.

Die Grundidee zu diesem Adapter stammt von https://github.com/osresearch/hcpy. Der Python-Code dort wurde hier in Javascript portiert und für ioBroker angepasst.

## Voraussetzungen vor der Installation

Es muss mindestens Node.js **Version 20** installiert sein.

Für den Adapter wird im Gegensatz zur Verwendung der offiziellen API <ins>keine</ins> ClientID benötigt, lediglich Benutzername und Passwort, welche in der Homeconnect-App verwendet wurden. Geräte müssen einmalig über die Homeconnect-App registriert werden.

Im lokalen Netz muss Port 443 am Gerät freigeschaltet sein.

Es kann vorkommen, dass das Gerät nach Laden der Konfiguration nicht angesprochen werden kann. Dann liegt im lokalen Netz kein DNS-Eintrag für die Domain des Geräts vor. Außer diesen im Netzwerk einzurichten, kann im Datenpunkt `info.config` bei `host` einfach die lokale IP des Gerätes eingetragen werden.

## Erste Schritte

Normalerweise werden nach der [Adapterkonfiguration](#konfiguration) beim Adapterstart von Homeconnect-Servern Profile der registrierten Geräte abgerufen. Dieser Loginprozess wurde auf manchen Servern so verändert, dass ein automatisches Downloaden der Profile nicht mehr funktioniert und ein manuelles Downloaden nötig wird. Dazu wird das externes Tool **[Homeconnect Profile Downloader](https://github.com/bruestel/homeconnect-profile-downloader/tags)** empfohlen.

Wenn also ein automatisches Abrufen nicht möglich ist, erscheint im ioBroker-Log eine **Warnung**, **_erscheint keine, und der Adapter startet normal, ist kein weiteres Handeln nötig, und die nächsten Schritte können ignoriert werden!_**

```
warn: Login not successful. Please put the zip from homeconnect-profile-downloader as described in docs manually into path <<Pfad zum Ablageort heruntergeladener Geräteprofile>> and restart adapter. See https://github.com/bruestel/homeconnect-profile-downloader also.
```

Wird die Warnung ausgegeben, muss lokal der **Homeconnect Profile Downloader** installiert werden. Dazu dem Link folgen, die neueste Version für sein Betriebssystem herunterladen und [installieren](https://github.com/bruestel/homeconnect-profile-downloader?tab=readme-ov-file#run-it):
![Versionen von Homeconnect Profile Downloader](../profile_git.png)

Anschließend die installierte Anwednung starten und auf der Startseite die Region wählen:
![Startseite von Homeconnect Profile Downloader](../profile_start.png)

Mit dem Klick auf `FETCH APPLIANCE PROFILE DATA` wird zur Login-Seite von Homeconnect weitergeleitet, bei der man sich mit den Zugangsdaten aus der Homeconnect-App anmelden muss:
![Login bei Homeconnect](../profile_login.png)

Wenn dies erfolgreich war, erscheint eine Übersicht von zip-Dateien für jedes über die Homeconnect-App registrierte Gerät. Die zip-Dateien müssen nun heruntergeladen und **unverändert** in den Ordner verschoben werden, der in der Warnung im Log von ioBroker angezeigt wird.

Anschließend muss der Adapter neu gestartet werden. Die Konfiguration für den Adapter wird nun aus diesen Dateien erstellt.

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
|       └── sendOptionsSeperately
```

### info.connection

Dieser Datenpunkt wird `false`, wenn die Verbindung zu **mindestens** einem Gerät nicht hergestellt werden kann, also bei einem Socketerror. Dadurch wird auch in der Instanzübersicht der Adapter "gelb". Es wird automatisch 15 mal eine Neuverbindung mit maximal 5 Minuten Wartezeit zum Gerät versucht. Danach müsste der Adapter manuell neugestartet werden, um wieder eine Verbindung aufzubauen. Die Anzahl der Neuverbindungen kann aber in den Instanzeinstellungen geändert werden (siehe [Konfiguration](#konfiguration)) Warum das Gerät nicht verbunden werden kann und um welches Gerät es sich handelt, steht in warn-Einträgen im Log. Hier muss dann "von Hand" geschaut werden, wie das Problem zu beheben ist. Der Datenpunkt wird nur für Geräte gesetzt, die sich in der Überwachung des Adapters befinden (siehe [observe](#observe)).

### info.config

Hier wird die Konfiguration als JSON gespeichert. Soll diese neu eingelesen werden, bspw. weil neue Geräte hinzugekommen sind, muss der Inhalt gelöscht und der Adapter ggfs. neu gestartet werden.

### `ActiveProgram` und `SelectedProgram`

Die Datenpunkte enthalten als Wert die UID des Programms, das gerade läuft. `ActiveProgram` ist dabei `readonly`.

### observe

Mit dem Datenpunkt `observe` können bei Änderung auf `false` Geräte von der Überwachung des Adapters ausgeschlossen werden. So kann bspw. im Fehlerfall eingestellt werdne, dass nur ein Gerät vom Adapter beachtet wird und kein anderes "dazwischen funkt".

### sendOptionsSeperately

Normalerweise werden zum Starten eines Programms die nötigen Optionen als Ganzes an das Gerät gesendet. Bei manchen Geräten wrid aber erwartet, dass diese Optionen nicht als Block sondern einzeln übertragen werden.

> [!NOTE]
>
> Funktioniert das Starten eines Programms also nicht wie gewünscht bzw. steht im Debug-Log sowas wie `resource":"/ro/activeProgram","version":1,"action":"RESPONSE","code":400}`, kann dieser Datenpunkt auf `true` geändert werden, bevor erneut versucht werden kann, ein Programm zu starten.

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
