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

Adapter for Homeconnect devices without cloud communication

## Documentation

[🇺🇸 Documentation](./docs/en/README.md)

[🇩🇪 Dokumentation](./docs/de/README.md)

## Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (eifel-tech) Admin-Version >= 7.4.10

### 1.4.3 (2025-02-18)

- (eifel-tech) Handling to start program for dishwasher SN53ES02CE (Issue #194)

### 1.4.2 (2025-02-13)

- (eifel-tech) Error message after sending to /ro/selectedProgram on hood devices (Issue #193)

### 1.4.1 (2025-01-16)

- (eifel-tech) Creating instance directory if absent

### 1.4.0 (2025-01-15)

- (eifel-tech) Dependency updates
- (eifel-tech) Changed login process for getting device information by homeconnect (Issue #170)

### 1.3.0 (2024-12-02)

- (eifel-tech) Dependency updates
- (eifel-tech) common.min is only set if it is also present in the config (Issue #149)
- (eifel-tech) Password in admin will be stored encrypted natively
    > [!CAUTION]
    > You have to reenter your password in admin config!

### 1.2.10 (2024-11-20)

- (eifel-tech) Handle missing enums during parsing (Issue #148)

### 1.2.9 (2024-11-14)

- (eifel-tech) Bugfix while reading program options (Issue #143)

### 1.2.8 (2024-11-05)

- (eifel-tech) Prevent forbidden signs
- (eifel-tech) More resolutions considered in instance settings
- (eifel-tech) Number of connection attempts configurable (Issue #135)

### 1.2.7 (2024-10-24)

- (eifel-tech) Notes from adapter checker

### 1.2.6 (2024-10-24)

- (eifel-tech) Added translations

### 1.2.5 (2024-10-23)

- (eifel-tech) Instance remains yellow when first started (Issue #129)

### 1.2.4 (2024-10-23)

- (eifel-tech) Prevent message `undefined` from being sent

### 1.2.3

- (eifel-tech) Added datapoint to indicate whether a socket connection exists

### 1.2.2

- (eifel-tech) Using a persistent websocket connection

### 1.2.1

- (eifel-tech) Abort the connection if errors occur in the socket connection to the device

### 1.2.0

- (eifel-tech) Ability to exclude individual devices from control (Issue #117)
    > [!CAUTION]
    > The configuration had to be expanded for this, so the contents of the `info.config` data point have to be deleted and the adapter has to be restarted. Also delete the `General` object tree.

### 1.1.2

- (eifel-tech) Washing machine: Program options are sent separately and not including the program to be started

### 1.1.1

- (eifel-tech) Parsing the configuration simplified

### 1.1.0

- (eifel-tech) Parsing of configuration for multiple devices revised

### 1.0.4

- (eifel-tech) Dishwasher support

### 1.0.3

- (eifel-tech) New socket connection after timeout

### 1.0.2

- (eifel-tech) If a new program is started, any program that may be running will first be terminated

### 1.0.1

- (eifel-tech) Increasing security with TLS

### 1.0.0

- (eifel-tech) initial release

## License

MIT License

Copyright (c) 2025 eifel-tech <hikaso@gmx.net>

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
