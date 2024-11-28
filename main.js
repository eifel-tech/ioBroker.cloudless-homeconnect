"use strict";

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

const Socket = require("./js/Socket.js");
const Device = require("./js/Device.js");
const ConfigService = require("./js/ConfigService.js");
const util = require("./js/util.js");

const events = require("events");

/**
 * Implementation of Homeconnect-Adapter with only local network communication.
 * Ported from https://github.com/osresearch/hcpy
 */
class CloudlessHomeconnect extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "cloudless-homeconnect",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
		this.eventEmitter = new events.EventEmitter();

		this.startingErrors = 0;
		this.configJson = [];
		this.devMap = new Map();
		this.configService = new ConfigService(this.eventEmitter, utils.getAbsoluteInstanceDataDir(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.setState("info.connection", { val: false, ack: true });
		this.subscribeStates("*");
		this.registerEvents();

		const configJsonObj = await this.getStateAsync("info.config");
		if (configJsonObj && !util.isConfigJson(configJsonObj.val)) {
			// @ts-ignore
			if (!this.config.username || !this.config.password) {
				this.log.warn("Please enter homeconnect app username and password in the instance settings");
				return;
			}

			this.configService.logLevel = this.log.level;
			this.configService.config = this.config;
			const loadedConfig = await this.configService.loadConfig();
			this.setState("info.config", JSON.stringify(loadedConfig), true);

			this.configJson = loadedConfig;
		}

		if (this.configJson.length == 0) {
			if (configJsonObj && util.isConfigJson(configJsonObj.val)) {
				// @ts-ignore
				this.configJson = JSON.parse(configJsonObj.val);
			} else {
				this.log.error(
					"JSON in info.config nicht valide. Bitte Adapterkonfiguration checken und Inhalt löschen.",
				);
				return;
			}
		}

		await this.createDatapoints();

		if (this.startingErrors === 0) {
			//Socketverbindung für alle Geräte in der Config, die überwacht werden sollen, herstellen
			Object.values(this.configJson).forEach(async (device) => {
				const observe = await this.getStateAsync(device.id + ".observe");
				if ((observe && observe.val) || !observe) {
					this.connectDevice(device.id);
				}
			});

			this.log.info("Adapter started successfully");
		}
	}

	registerEvents() {
		this.eventEmitter.on("log", (type, msg, e) => {
			if (type === "debug") {
				this.log.debug(msg);
			} else if (type === "error") {
				if (e) {
					msg += ": " + e;
					if (e instanceof Error && e.stack) {
						this.log.debug(e.stack);
					}
				}
				this.log.error(msg);
			} else if (type === "warn") {
				this.log.warn(msg);
			} else {
				this.log.info(msg);
			}
		});
		this.eventEmitter.on("message", (devId, data) => {
			this.handleMessage(devId, data);
		});
		this.eventEmitter.on("socketClose", (devId, event) => {
			if (this.devMap.has(devId)) {
				this.clearInterval(this.devMap.get(devId).refreshInterval);
			}
			this.setDPConnected(devId, false);
			this.log.debug("Closed connection to " + devId + "; reason: " + event);
		});
		this.eventEmitter.on("socketError", async (devId, e) => {
			this.log.warn("Connection interrupted for device " + devId + ": " + e);
			if (this.devMap.has(devId)) {
				this.clearInterval(this.devMap.get(devId).refreshInterval);
			}

			const observe = await this.getStateAsync(devId + ".observe");
			if (observe && observe.val) {
				this.setStateChanged("info.connection", { val: false, ack: true });
				this.setDPConnected(devId, false);
			}
		});
		this.eventEmitter.on("socketOpen", (devId) => {
			this.log.debug("Connection to device " + devId + " established.");
			this.setStateChanged("info.connection", { val: true, ack: true });
			this.setDPConnected(devId, true);
		});
		this.eventEmitter.on("recreateSocket", async (devId) => {
			this.log.debug("Recreate Socket for device " + devId + " requested.");
			this.setDPConnected(devId, false);
			if (this.devMap.has(devId)) {
				const device = this.devMap.get(devId);
				this.clearInterval(device.refreshInterval);
				device.ws.close();
				await util.sleep(2000); //Give sockets a little time to close connections

				this.connectDevice(devId);
			}
		});
	}

	async setDPConnected(devId, isConnected) {
		if (await this.objectExists(devId + ".General.connected")) {
			this.setStateChanged(devId + ".General.connected", isConnected, true);
		}
	}

	async createDatapoints() {
		this.configJson.forEach(async (dev) => {
			const id = dev.id;
			if (!dev.features) {
				this.log.error("Konfiguration unvollständig");
				this.startingErrors++;
				return;
			}

			//Root-Knoten
			await this.setObjectNotExistsAsync(id, {
				type: "device",
				common: {
					name: dev.name,
				},
				native: {},
			});

			//DP zum Deaktivieren eines Geräts
			await this.setObjectNotExistsAsync(id + ".observe", {
				type: "state",
				common: {
					type: "boolean",
					role: "state",
					name: "Gerät über Adapter steuern",
					write: true,
					read: true,
					def: true,
				},
				native: {},
			});

			//Generelles
			await this.setObjectNotExistsAsync(id + ".General", {
				type: "channel",
				common: {
					name: "Generelle Information zum Gerät",
				},
				native: {},
			});

			await this.setObjectNotExistsAsync(id + ".General.connected", {
				type: "state",
				common: {
					name: "Gibt an, ob eine Socketverbindung besteht",
					type: "boolean",
					role: "indicator",
					def: false,
					write: false,
					read: true,
				},
				native: {},
			});

			["name", "id", "enumber", "mac", "serialnumber"].forEach(async (key) => {
				await this.setObjectNotExistsAsync(id + ".General." + key, {
					type: "state",
					common: {
						name: key,
						type: "string",
						role: "indicator",
						write: false,
						read: true,
					},
					native: {},
				});
				this.setStateChanged(id + ".General." + key, dev[key], true);
			});

			["brand", "model"].forEach(async (key) => {
				await this.setObjectNotExistsAsync(id + ".General." + key, {
					type: "state",
					common: {
						name: key,
						type: "string",
						role: "indicator",
						write: false,
						read: true,
					},
					native: {},
				});
				this.setStateChanged(id + ".General." + key, dev.description[key], true);
			});

			//Features
			Object.entries(dev.features).forEach(async ([uid, feature]) => {
				const subFolder = this.getSubfolderByName(feature.name, true);
				const subFolderName = this.getSubfolderByName(feature.name);

				if (
					//Nur Optionen beachten, die nur lesbar sind
					(subFolderName.toLowerCase() === "option" && feature.access === "read") ||
					(["program", "command", "setting", "status", "event"].includes(subFolderName.toLowerCase()) &&
						//Kein Programm "SubsequentMode", weil diese für das Fortsetzen eines bereits beendeten Programms vorgesehen sind
						!feature.name.includes("SubsequentMode")) ||
					feature.name.endsWith("Program")
				) {
					await this.setObjectNotExistsAsync(id + subFolder, {
						type: "channel",
						common: {
							name: subFolderName,
						},
						native: {},
					});

					if (!(await this.objectExists(this.getDpByUid(dev, uid)))) {
						const common = this.getCommonObj(feature, uid, subFolderName);

						if (subFolderName.toLowerCase() === "program") {
							common.read = false;
							common.write = true;
							common.role = "button";
							common.type = "boolean";
							common.def = false;

							await this.setObjectNotExistsAsync(this.getDpByUid(dev, uid), {
								type: "channel",
								common: {
									name: "",
								},
								native: {},
							});

							await this.setObjectNotExistsAsync(this.getDpByUid(dev, uid) + ".Start", {
								type: "state",
								common: common,
								native: {},
							});

							//Bei Programmen müssen die zu konfigurierenden Optionen angelegt werden
							if (feature.options) {
								feature.options.forEach(async (optionUid) => {
									const option = dev.features[optionUid];
									const common = this.getCommonObj(option, optionUid);

									await this.setObjectNotExistsAsync(
										this.getDpByUid(dev, uid) +
											"." +
											option.name
												.split(".")
												.slice(3)
												.join("_")
												.replace(this.FORBIDDEN_CHARS, "_"),
										{
											type: "state",
											common: common,
											native: {},
										},
									);
								});
							}
						}

						//Datenpunkte initial anlegen
						await this.setObjectNotExistsAsync(this.getDpByUid(dev, uid), {
							type: "state",
							common: common,
							native: {},
						});
					}
				}
			});
		});
	}

	getCommonObj(feature, uid, subFolderName) {
		const role = subFolderName && subFolderName.toLowerCase() === "command" ? "button" : "state";
		const typeStr = feature.type ? feature.type : "string";
		const common = {
			name: uid.toString(),
			type: typeStr,
			role: role,
			write: (feature.access && feature.access.toLowerCase().includes("write")) || false,
			read: (feature.access && feature.access.toLowerCase().includes("read")) || true,
		};

		if (typeStr === "number") {
			if (feature.unit) {
				common.unit = feature.unit;
			}
			common.def = 0;
			if (feature.default) {
				common.def = parseInt(feature.default);
			} else if (feature.initValue) {
				common.def = parseInt(feature.initValue);
			}
			if (feature.min) {
				common.min = parseInt(feature.min);
				common.def = common.min;
			}
			if (feature.max) {
				common.max = parseInt(feature.max);
			}
			if (feature.states) {
				common.def = Math.min(...Object.keys(feature.states).map((obj) => parseInt(obj)));
				common.states = feature.states;
			}
		} else if (typeStr === "boolean") {
			common.def = false;
			if (feature.default) {
				common.def = feature.default === "true";
			} else if (feature.initValue) {
				common.def = feature.initValue === "true";
			}
		} else {
			common.def = "";
		}

		return common;
	}

	/**
	 * Delegates messages from Websocket to right device
	 */
	handleMessage(devId, msg) {
		try {
			this.log.debug(devId + ": " + msg);
			if (this.devMap.has(devId)) {
				const device = this.devMap.get(devId);
				const values = device.handleMessage(JSON.parse(msg));
				if (values.error) {
					if (values.error === 400) {
						this.log.debug(
							"Unplausibler Wert wurde zuvor gesendet. Antwort des Gerätes: " +
								values.error +
								" bei Service " +
								values.resource,
						);
					} else if (values.error > 5000) {
						this.log.debug(
							"Unplausibler Wert wurde empfangen (" +
								values.error +
								"): " +
								values.info +
								" ; Wert: " +
								values.resource,
						);
					} else {
						this.log.error("Kommunikationsfehler " + values.error + " bei Service " + values.resource);
					}
					return;
				}
				if (Object.keys(values).length > 0) {
					this.updateDatapoints(device, values);
				}
			}
		} catch (e) {
			this.log.debug("Fehler beim Behandeln einer Nachricht von " + devId + ": " + msg);
			this.log.debug("Fehlermeldung: " + e);
		}
	}

	updateDatapoints(device, values) {
		Object.keys(values)
			.filter((uid) => device.features[uid])
			.forEach(async (uid) => {
				let value = typeof values[uid] === "object" ? JSON.stringify(values[uid]) : values[uid];

				const oid = this.getDpByUid(device, uid);
				//Optionen werden nicht aktualisiert
				if (this.getSubfolderByDp(oid).toLowerCase() === "option" && device.features[uid].access !== "read") {
					return;
				}

				//Objekt holen, um richtigen Typ zu ermitteln
				const obj = await this.getObjectAsync(oid);
				if (obj) {
					const typ = obj.common.type;
					if (typ === "string" && typeof value !== "string") {
						value = value.toString();
					} else if (typ === "number" && typeof value !== "number") {
						value = parseInt(value);
					} else if (typ === "boolean" && typeof value === "string") {
						value = value === "true";
					} else if (typ === "boolean" && typeof value === "number") {
						value = value === 1;
					}
				}

				this.setStateChanged(oid, value, true);
			});
	}

	/**
	 * @param {string} deviceID
	 */
	connectDevice(deviceID) {
		Object.values(this.configJson)
			.filter((val) => val.id === deviceID)
			.forEach((device) => {
				//Socketverbindung zu den Geräten herstellen
				const socket = new Socket(
					device.id,
					device.host,
					device.key,
					device.iv,
					this.eventEmitter,
					this.config,
				);
				const dev = new Device(socket, device);

				socket.connect();

				//Ruft reglmäßig die aktuellen Werte des Geräts ab. Damit kann das Gerät auch über andere Wege gesteuert werden und der Adapter bleibt aktuell
				dev.refreshInterval = this.setInterval(() => {
					if (dev.ws.isConnected()) {
						dev.send("/ro/allMandatoryValues");
					}
				}, 60 * 1000);

				//Die erzeugten Devices cachen
				this.devMap.set(device.id, dev);
			});
	}

	getSubfolderByName(name, withLeadingPoint = false) {
		const splittedKey = name.split(".");
		if (splittedKey[2].toLowerCase() === "root") {
			return "";
		}
		if (withLeadingPoint) {
			return "." + splittedKey[2].replace(this.FORBIDDEN_CHARS, "_");
		}
		return splittedKey[2].replace(this.FORBIDDEN_CHARS, "_");
	}

	getSubfolderByDp(oid) {
		return oid.split(".")[1];
	}

	getDpByUid(device, uid) {
		const name = device.features[uid].name;
		const key = name.split(".").slice(3).join("_").replace(this.FORBIDDEN_CHARS, "_");
		const subFolder = this.getSubfolderByName(name, true);
		return device.id + subFolder + "." + key;
	}

	async getUidByDp(oid) {
		if (!oid.includes(this.namespace)) {
			oid = this.namespace + "." + oid;
		}

		const obj = await this.getObjectAsync(oid);
		if (obj) {
			// @ts-ignore
			return parseInt(obj.common.name);
		}
	}

	closeConnections() {
		this.devMap.forEach((device) => {
			device.ws.close();
			this.clearTimeout(device.refreshInterval);
		});
	}

	/**
	 *
	 * @param {ioBroker.Object|null|undefined} powerStateObj
	 * @returns
	 */
	async getOffOrStandbyValue(powerStateObj) {
		const keys = Object.keys(powerStateObj?.common.states);
		const min = powerStateObj?.common.min;
		const max =
			powerStateObj?.common.max !== undefined ? powerStateObj.common.max : parseInt(keys[keys.length - 1]);
		let ret;
		Object.entries(powerStateObj?.common.states).forEach(([key, value]) => {
			const keyInt = parseInt(key);
			if (keyInt >= min && keyInt <= max && (value === "Off" || value === "Standby")) {
				ret = keyInt;
				return;
			}
		});
		return ret;
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.closeConnections();

			callback();
		} catch (e) {
			this.log.debug("Exception while unload: " + e);
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} oid
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(oid, state) {
		oid = oid.replaceAll(this.namespace + ".", "");
		const systemAdapterId = "system.adapter." + this.namespace;
		if (state && state.from !== systemAdapterId) {
			// The state was changed not by adapter itself
			this.log.debug("state " + oid + " changed: " + state.val + " (ack = " + state.ack + ")");

			//Wird DP info.config geleert, soll diese durch Neustart des Adapters neu geladen werden
			if (oid === "info.config") {
				if (typeof state.val === "string" && state.val.trim().length === 0) {
					this.log.info("Adapter wird neu gestartet, um die Konfiguration zu aktualisieren.");

					this.closeConnections();
					await util.sleep(2000); //Give sockets a little time to close connections

					const adapterObj = await this.getForeignObjectAsync(systemAdapterId);
					if (adapterObj) {
						//Stoppen
						adapterObj.common.enabled = false;
						await this.setForeignObjectAsync(systemAdapterId, adapterObj);

						//Starten
						adapterObj.common.enabled = true;
						await this.setForeignObjectAsync(systemAdapterId, adapterObj);
					}
				}
				return;
			}

			//Keine Optionen direkt an Device senden. Diese werden bei Programmen ausgelesen und mitgesendet.
			if (
				(this.getSubfolderByDp(oid).toLowerCase() === "program" ||
					this.getSubfolderByDp(oid).toLowerCase() === "option") &&
				!oid.endsWith("Start")
			) {
				return;
			}

			const devId = oid.split(".")[0];

			//Wenn Gerät überwacht werden soll, dieses verbinden
			if (oid.includes("observe") && state.val) {
				this.connectDevice(devId);

				this.log.info("Gerät mit ID " + devId + " kann über den Adapter gesteuert werden.");
				return;
			}

			if (!this.devMap.has(devId)) {
				this.log.error("Gerät " + devId + " nicht gefunden. Bitte Adapter neu starten und erneut versuchen.");
				return;
			}

			const uid = await this.getUidByDp(oid);
			const device = this.devMap.get(devId);

			//Wenn Gerät nicht überwacht werden soll, Verbindung schließen und aus der Devicemap entfernen
			if (oid.includes("observe") && !state.val) {
				if (device.refreshInterval) {
					this.clearInterval(device.refreshInterval);
				}
				if (device.ws.isConnected()) {
					device.ws.close();
				}

				if (this.devMap.has(devId)) {
					this.devMap.delete(devId);
				}
				this.setStateChanged("info.connection", { val: true, ack: true });
				this.log.info("Gerät mit ID " + devId + " wird nicht mehr über den Adapter gesteuert.");
				return;
			}

			if (uid) {
				let resource = "/ro/values";
				const data = {};
				if (this.getSubfolderByDp(oid).toLowerCase() === "program" && oid.endsWith("Start")) {
					//Wenn ein Programm bereits aktiv ist, dieses zunächst beenden
					const isAktiv = await this.getStateAsync(devId + ".ActiveProgram");
					if (isAktiv && isAktiv.val !== "0") {
						const powerObj = await this.getObjectAsync(devId + ".Setting.PowerState");
						device.send(resource, 1, "POST", {
							// @ts-ignore
							uid: parseInt(powerObj.common.name),
							value: this.getOffOrStandbyValue(powerObj),
						});
						await util.sleep(2000);
					}

					//Programme haben u.U. Optionen, die auch übertragen werden müssen
					data.program = uid;

					device.send("/ro/selectedProgram", 1, "POST", data);

					const options = await this.getStatesAsync(oid.substring(0, oid.lastIndexOf(".")) + ".*");
					data.options = await Promise.all(
						Object.entries(options)
							.filter(([oid]) => !oid.endsWith("Start"))
							.map(async ([oid, state]) => {
								const obj = await this.getObjectAsync(oid);
								return {
									// @ts-ignore
									uid: parseInt(obj.common.name),
									value: state.val,
								};
							}),
					);
					//Bei Waschmaschine müssen die Optionen der Programme einzeln und nicht in Verbindung mit activeProgram gesetzt werden.
					if (device.type === "Washer") {
						data.options.forEach((option) => {
							device.send("/ro/values", 1, "POST", option);
						});
						delete data.options;
					}

					await util.sleep(1000);
					resource = "/ro/activeProgram";
				} else {
					data.uid = uid;
					let val = state.val;
					if (typeof val === "string") {
						try {
							val = JSON.parse(val);
						} catch (e) {
							this.log.debug("Parsing error: " + e);
						}
					}
					data.value = val;
				}
				device.send(resource, 1, "POST", data);
			}
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new CloudlessHomeconnect(options);
} else {
	// otherwise start the instance directly
	new CloudlessHomeconnect();
}
