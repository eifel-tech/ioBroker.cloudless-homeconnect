"use strict";

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const fs = require("node:fs");
const path = require("node:path");

const axios = require("axios");
const tough = require("tough-cookie");
const { HttpsCookieAgent } = require("http-cookie-agent/http");
const AdmZip = require("adm-zip");

const xml2jsonConverter = require("./js/Xml2JsonConverter.js");
const Socket = require("./js/Socket.js");
const Device = require("./js/Device.js");
const util = require("./js/util.js");

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

		this.TYPES_URL = "https://www.home-connect.com/schemas/DeviceDescription/20140417/HC_INT_BSH_CTD.xml";
		this.BASE_URL = "https://api.home-connect.com/security/oauth/";
		this.ASSET_URL = "https://prod.reu.rest.homeconnectegw.com/";
		this.SINGLEKEY_URL = "https://singlekey-id.com";
		this.LOGIN_URL = this.BASE_URL + "authorize";
		this.AUTH_URL = this.BASE_URL + "login";
		this.TOKEN_URL = this.BASE_URL + "token";

		this.APP_ID = "9B75AC9EC512F36C84256AC47D813E2C1DD0D6520DF774B020E1E6E2EB29B1F3";
		this.CLIENT_ID = "11F75C04-21C2-4DA9-A623-228B54E9A256";

		this.REGEX_SESSION = /"sessionId" value="(.*?)"/;
		this.REGEX_TOKEN = /__RequestVerificationToken.*value="(.*?)"/;

		this.REDIRECT_DOMAIN = "hcauth://";
		this.REDIRECT_URL = this.REDIRECT_DOMAIN + "auth/prod";
		this.VERIFIER = util.b64random(32);

		this.configJson = [];
		this.devMap = new Map();
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.subscribeStates("*");

		const configJsonObj = await this.getStateAsync("info.config");
		if (configJsonObj && !util.isConfigJson(configJsonObj.val)) {
			this.cookieJar = new tough.CookieJar();
			this.requestClient = axios.create({
				withCredentials: true,
				httpsAgent: new HttpsCookieAgent({
					cookies: {
						jar: this.cookieJar,
					},
				}),
				headers: {
					"user-agent": "iobroker/1.0",
					Accept: "*/*",
					"Accept-Encoding": "gzip, deflate",
					Connection: "keep-alive",
					"content-type": "application/x-www-form-urlencoded",
				},
			});

			// @ts-ignore
			if (!this.config.username || !this.config.password) {
				this.log.warn("Please enter homeconnect app username and password in the instance settings");
				return;
			}

			const loadedConfig = await this.loadConfig();
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

		//Sockerverbindung für alle Geräte in der Config, die überwacht werden sollen, herstellen
		Object.values(this.configJson).forEach(async (device) => {
			const observe = await this.getStateAsync(device.id + ".observe");
			if (observe && observe.val) {
				this.connectDevice(device.id);
			}
		});

		this.log.info("Adapter started successfully");
	}

	async createDatapoints() {
		this.configJson.forEach(async (dev) => {
			const id = dev.id;
			if (!dev.features) {
				this.log.error("Konfiguration unvollständig");
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
				this.setState(id + ".General." + key, dev[key], true);
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
				this.setState(id + ".General." + key, dev.description[key], true);
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
										this.getDpByUid(dev, uid) + "." + option.name.split(".").slice(3).join("_"),
										{
											type: "state",
											common: common,
											native: {},
										},
									);
								});
							}

							return;
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
			common.def = feature.default ? parseInt(feature.default) : 0;
			common.min = common.def;
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
			common.def = feature.default ? feature.default === "true" : false;
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

				this.setState(oid, value, true);
			});
	}

	/**
	 * @param {string} deviceID
	 */
	connectDevice(deviceID) {
		Object.values(this.configJson)
			.filter((val) => val.id === deviceID)
			.forEach(async (device) => {
				//Socketverbindung zu den Geräten herstellen
				const socket = new Socket(device.id, device.host, device.key, device.iv, this);
				const dev = new Device(socket, device);

				socket.reconnect();

				//Ruft reglmäßig die aktuellen Werte des Geräts ab. Damit kann das Gerät auch über andere Wege gesteuert werden und der Adapter bleibt aktuell
				dev.refreshInterval = setInterval(() => {
					if (dev.ws.isConnected()) {
						dev.send("/ro/allMandatoryValues");
					} else {
						this.recreateSocket(dev.id);
					}
				}, 59 * 1000);

				//Die erzeugten Devices cachen
				this.devMap.set(dev.id, dev);
			});
	}

	async loadConfig() {
		const configJson = [];

		const token = await this.getToken();
		if (token && this.requestClient) {
			this.requestClient.defaults.headers.common["Authorization"] = "Bearer " + token;
			const account = await this.getAccountInfo();
			if (account) {
				this.requestClient.defaults.responseType = "arraybuffer";

				//Für jedes Gerät wird ein Eintrag im ConfigJsonArray hinzugefügt
				this.log.info("Found " + account.data.homeAppliances.length + " device(s).");
				//Gefundene Dateien für Debugzwecke ablegen in z.B. /opt/iobroker/iobroker-data/cloudless-homeconnect.0
				const instanceDir = utils.getAbsoluteInstanceDataDir(this);
				if (this.log.level === "debug" && !fs.existsSync(instanceDir)) {
					fs.mkdirSync(instanceDir);
					this.log.debug("Created folder: " + instanceDir);
				}
				for (const app of account.data.homeAppliances) {
					const devID = app.identifier;

					const config = {
						name: app.type.toLowerCase(),
						id: devID,
						mac: app.mac,
						enumber: app.enumber,
						serialnumber: app.serialnumber,
					};
					if (app.tls) {
						// fancy machine with TLS support
						config.host = app.brand + "-" + app.type + "-" + devID;
						config.key = app.tls.key;
					} else {
						// less fancy machine with HTTP support
						config.host = devID;
						config.key = app.aes.key;
						config.iv = app.aes.iv;
					}
					configJson.push(config);

					//Fetch the XML zip file for this device
					const res = await this.request(this.ASSET_URL + "api/iddf/v1/iddf/" + devID);

					// open zip and read entries ....
					try {
						const zip = new AdmZip(res.data);
						const zips = {};

						zip.getEntries().forEach((zipEntry) => {
							this.log.info("Found file: " + zipEntry.entryName);
							const newFilePath = path.join(instanceDir, zipEntry.entryName);
							this.log.debug("Creating file: " + newFilePath);
							if (zipEntry.entryName.includes("_FeatureMapping.xml")) {
								zips.feature = zip.readAsText(zipEntry);
								if (this.log.level === "debug") {
									fs.writeFileSync(newFilePath, zips.feature);
								}
							}
							if (zipEntry.entryName.includes("_DeviceDescription.xml")) {
								zips.description = zip.readAsText(zipEntry);
								if (this.log.level === "debug") {
									fs.writeFileSync(newFilePath, zips.description);
								}
							}
						});
						if (Object.keys(zips).length === 2) {
							const types = await this.request(this.TYPES_URL);

							const machine = await xml2jsonConverter.xml2json(
								zips.feature,
								zips.description,
								types.data,
							);
							config.description = machine.description;
							config.features = machine.features;
						}
					} catch (e) {
						this.log.error("Unparsable zips received. Please try again later. " + e);
					}
				}
			}
		}

		return configJson;
	}

	async getToken() {
		this.log.debug("Start normal login");

		const loginpageUrl =
			this.LOGIN_URL +
			"?" +
			util.urlEncode({
				response_type: "code",
				prompt: "login",
				code_challenge: util.b64UrlEncode(util.sha256(this.VERIFIER)),
				code_challenge_method: "S256",
				client_id: this.APP_ID,
				scope: "ReadOrigApi",
				nonce: util.b64random(16),
				state: util.b64random(16),
				redirect_uri: this.REDIRECT_URL,
				redirect_target: "icore",
			});
		const deviceAuth = await this.request(loginpageUrl)
			.then((res) => {
				this.log.debug(res.data.toString());
				return res.data.toString();
			})
			.catch((error) => {
				this.log.error(error);
				if (error.response) {
					this.log.error(JSON.stringify(error.response.data));
				}
			});

		//Extract SessionID
		const arr = deviceAuth.match(this.REGEX_SESSION);
		if (arr == null) {
			this.log.warn("Unable to find session id in login page");
			return;
		}
		const sessionId = arr[1];

		this.log.debug("--------");

		// now that we have a session id, contact the single key host to start the new login flow
		const preauthQuery = {
			client_id: this.CLIENT_ID,
			redirect_uri: this.BASE_URL + "redirect_target",
			response_type: "code",
			scope: "openid email profile offline_access homeconnect.general",
			prompt: "login",
			style_id: "bsh_hc_01",
			state: '{"session_id":"' + sessionId + '"}', // important: no spaces!
		};

		// fetch the preauth state to get the final callback url
		let preauthUrl = this.SINGLEKEY_URL + "/auth/connect/authorize?" + util.urlEncode(preauthQuery);
		let preauthData = "";
		// loop until we have the callback url
		do {
			this.log.debug("next preauth_url=" + preauthUrl);

			const response = await this.request(preauthUrl, false);
			if (response.status === 200) {
				preauthData = response.data;
			}
			if (response.status > 300 && response.status < 400) {
				preauthUrl = this.addSinglekeyHost(response.headers["location"]);
			}
			if (response.status === 403) {
				this.log.error("Server has a temporary problem. Try again later.");
				return;
			}
		} while (!preauthData);

		if (!preauthData) {
			return;
		}

		let returnUrl = this.addSinglekeyHost(util.getUrlParams(preauthUrl).get("ReturnUrl"));

		this.log.debug("return_url: " + returnUrl);
		this.log.debug("--------");

		//Do login with determined data and url
		const isLoginSuccessfull = await this.doLogin(preauthData.toString(), preauthUrl);
		if (isLoginSuccessfull) {
			this.log.info("Login sucessfull. Trying to catch token...");

			do {
				const response = await this.request(returnUrl, false);
				this.log.debug("next return_url=" + returnUrl);
				if (response.status !== 302 && response.status !== 307) {
					break;
				}

				returnUrl = this.addSinglekeyHost(response.headers["location"]);
			} while (!returnUrl.startsWith(this.REDIRECT_DOMAIN));

			this.log.debug("return_url=" + returnUrl);
			this.log.debug("--------");

			const params = util.getUrlParams(returnUrl);
			const code = params.get("code");
			const state = params.get("state");
			const grantType = params.get("grant_type");

			this.log.debug("code=" + code + " grant_type=" + grantType + " state=" + state);

			const tokenQuery = {
				grant_type: grantType,
				client_id: this.APP_ID,
				code_verifier: this.VERIFIER,
				code: code,
				redirect_uri: this.REDIRECT_URL,
			};
			this.log.debug("tokenUrl: " + this.TOKEN_URL + " tokenFields: " + JSON.stringify(tokenQuery));
			const tokenPage = await this.request(this.TOKEN_URL, false, tokenQuery, "post")
				.then((res) => {
					this.log.debug(JSON.stringify(res.data));
					return res.data;
				})
				.catch((error) => {
					this.log.error("Bad code? " + error);
					if (error.response) {
						this.log.error(JSON.stringify(error.response.data));
					}
				});

			if (tokenPage.error) {
				this.log.error(JSON.stringify(tokenPage));
				return;
			}

			this.log.debug("--------- got token page ----------");
			this.log.debug("Received access token: " + tokenPage.access_token);

			return tokenPage.access_token;
		}

		this.log.info("Login nicht erfolgreich. Bitte Zugangsdaten prüfen.");
	}

	async doLogin(preauthData, preauthUrl) {
		let arr = preauthData.match(this.REGEX_TOKEN);
		if (arr) {
			const response = await this.request(
				preauthUrl,
				false,
				{
					// @ts-ignore
					"UserIdentifierInput.EmailInput.StringValue": this.config.username,
					__RequestVerificationToken: arr[1],
				},
				"post",
			);

			const passwortUrl = this.addSinglekeyHost(response.headers["location"]);
			if (!passwortUrl.includes("password")) {
				return false;
			}
			const responseData = await this.request(passwortUrl, false)
				.then((res) => {
					return res.data.toString();
				})
				.catch((error) => {
					this.log.error(error);
					if (error.response) {
						this.log.error(JSON.stringify(error.response.data));
					}
				});
			arr = responseData.match(this.REGEX_TOKEN);
			if (arr) {
				await this.request(
					passwortUrl,
					false,
					{
						// @ts-ignore
						Password: this.config.password,
						RememberMe: "false",
						__RequestVerificationToken: arr[1],
					},
					"post",
				);
				return true;
			}
		}
		return false;
	}

	async getAccountInfo() {
		// now we can fetch the rest of the account info
		const account = await this.request(this.ASSET_URL + "account/details")
			.then((res) => {
				this.log.debug(JSON.stringify(res.data));
				return res.data;
			})
			.catch((error) => {
				this.log.error("Unable to fetch account details " + error);
				if (error.response) {
					this.log.error(JSON.stringify(error.response.data));
				}
			});

		if (account.error) {
			this.log.error(JSON.stringify(account));
			return;
		}

		this.log.debug("account: " + JSON.stringify(account));

		return account;
	}

	addSinglekeyHost(url) {
		if (url.startsWith(this.REDIRECT_DOMAIN)) {
			return url;
		}

		// Make relative locations absolute
		if (!url.startsWith("http")) {
			url = this.SINGLEKEY_URL + url;
		}

		return url;
	}

	async request(url, allowRedirects = true, data, method = "get") {
		let options = {
			method: "get",
			url: url,
			maxRedirects: allowRedirects ? 5 : 0,
		};
		if ("post" === method.toLowerCase()) {
			options = {
				method: "post",
				url: url,
				maxRedirects: allowRedirects ? 5 : 0,
				data: data,
			};
		}
		if (this.requestClient) {
			const response = await this.requestClient(options)
				.then((res) => {
					return res;
				})
				.catch((error) => {
					return error.response;
				});

			return response;
		}
	}

	getSubfolderByName(name, withLeadingPoint = false) {
		const splittedKey = name.split(".");
		if (splittedKey[2].toLowerCase() === "root") {
			return "";
		}
		if (withLeadingPoint) {
			return "." + splittedKey[2];
		}
		return splittedKey[2];
	}

	getSubfolderByDp(oid) {
		return oid.split(".")[1];
	}

	getDpByUid(device, uid) {
		const name = device.features[uid].name;
		const key = name.split(".").slice(3).join("_");
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
		});
	}

	recreateSocket(deviceID) {
		const device = this.devMap.get(deviceID);
		this.log.debug("Socket of device " + deviceID + " destroyed.");
		device.ws = new Socket(device.json.id, device.json.host, device.json.key, device.json.iv, this);
		device.ws.reconnect();
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
					clearInterval(device.refreshInterval);
				}
				device.ws.close();

				if (this.devMap.has(devId)) {
					this.devMap.delete(devId);
				}
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
					if (device.json.description.type === "Washer") {
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
							// eslint-disable-next-line no-empty
						} catch (e) {}
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
