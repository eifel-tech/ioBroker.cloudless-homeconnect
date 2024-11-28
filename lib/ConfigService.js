const util = require("./util.js");
const xml2jsonConverter = require("./Xml2JsonConverter.js");

const fs = require("node:fs");
const path = require("node:path");
const tough = require("tough-cookie");
const axios = require("axios");
const { HttpsCookieAgent } = require("http-cookie-agent/http");

const AdmZip = require("adm-zip");

/**
 * Homeconnect-Device with its socket connection @see Socket.js
 */
class ConfigService {
	#TYPES_URL;
	#BASE_URL;
	#ASSET_URL;
	#SINGLEKEY_URL;
	#LOGIN_URL;
	#TOKEN_URL;
	#APP_ID;
	#CLIENT_ID;
	#REGEX_SESSION;
	#REGEX_TOKEN;
	#REDIRECT_DOMAIN;
	#REDIRECT_URL;
	#VERIFIER;
	#eventEmitter;
	#instanceDir;
	#cookieJar;

	constructor(eventEmitter, instanceDir) {
		this.#TYPES_URL = "https://www.home-connect.com/schemas/DeviceDescription/20140417/HC_INT_BSH_CTD.xml";
		this.#BASE_URL = "https://api.home-connect.com/security/oauth/";
		this.#ASSET_URL = "https://prod.reu.rest.homeconnectegw.com/";
		this.#SINGLEKEY_URL = "https://singlekey-id.com";
		this.#LOGIN_URL = this.#BASE_URL + "authorize";
		this.#TOKEN_URL = this.#BASE_URL + "token";

		this.#APP_ID = "9B75AC9EC512F36C84256AC47D813E2C1DD0D6520DF774B020E1E6E2EB29B1F3";
		this.#CLIENT_ID = "11F75C04-21C2-4DA9-A623-228B54E9A256";

		this.#REGEX_SESSION = /"sessionId" value="(.*?)"/;
		this.#REGEX_TOKEN = /__RequestVerificationToken.*value="(.*?)"/;

		this.#REDIRECT_DOMAIN = "hcauth://";
		this.#REDIRECT_URL = this.#REDIRECT_DOMAIN + "auth/prod";
		this.#VERIFIER = util.b64random(32);

		this.#eventEmitter = eventEmitter;

		this.#instanceDir = instanceDir;
		this.logLevel = "info";
		this.config = {};

		this.#cookieJar = new tough.CookieJar();
		this.requestClient = axios.create({
			withCredentials: true,
			httpsAgent: new HttpsCookieAgent({
				cookies: {
					jar: this.#cookieJar,
				},
			}),
			headers: {
				"user-agent": "iobroker/1.0",
				Accept: "*/*",
				"Accept-Encoding": "gzip, deflate",
				Connection: "keep-alive",
				"content-type": "application/x-www-form-urlencoded",
			},
			timeout: 300000, //Global timeout 5 min
		});
	}

	async loadConfig() {
		const configJson = [];

		const token = await this.#getToken();
		if (token && this.requestClient) {
			this.requestClient.defaults.headers.common["Authorization"] = "Bearer " + token;
			const account = await this.#getAccountInfo();
			if (account) {
				this.requestClient.defaults.responseType = "arraybuffer";

				//Für jedes Gerät wird ein Eintrag im ConfigJsonArray hinzugefügt
				this.#eventEmitter.emit("log", "info", "Found " + account.data.homeAppliances.length + " device(s).");
				//Gefundene Dateien für Debugzwecke ablegen in z.B. /opt/iobroker/iobroker-data/cloudless-homeconnect.0
				const instanceDir = this.#instanceDir;
				if (this.logLevel === "debug" && !fs.existsSync(instanceDir)) {
					fs.mkdirSync(instanceDir);
					this.#eventEmitter.emit("log", "debug", "Created folder: " + instanceDir);
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
					const res = await this.#request(this.#ASSET_URL + "api/iddf/v1/iddf/" + devID);

					// open zip and read entries ....
					try {
						const zip = new AdmZip(res.data);
						const zips = {};

						zip.getEntries().forEach((zipEntry) => {
							if (zipEntry.entryName.indexOf("..") == -1) {
								this.#eventEmitter.emit("log", "info", "Found file: " + zipEntry.entryName);
								const newFilePath = path.join(instanceDir, zipEntry.entryName);
								this.#eventEmitter.emit("log", "debug", "Creating file: " + newFilePath);
								if (zipEntry.entryName.includes("_FeatureMapping.xml")) {
									zips.feature = zip.readAsText(zipEntry);
									if (this.logLevel === "debug") {
										fs.writeFileSync(newFilePath, zips.feature);
									}
								}
								if (zipEntry.entryName.includes("_DeviceDescription.xml")) {
									zips.description = zip.readAsText(zipEntry);
									if (this.logLevel === "debug") {
										fs.writeFileSync(newFilePath, zips.description);
									}
								}
							}
						});
						if (Object.keys(zips).length === 2) {
							const types = await this.#request(this.#TYPES_URL);

							const machine = await xml2jsonConverter.xml2json(
								zips.feature,
								zips.description,
								types.data,
								this.#eventEmitter,
							);
							config.description = machine.description;
							config.features = machine.features;
						}
					} catch (e) {
						this.#eventEmitter.emit("log", "error", "Unparsable zips received. Please try again later", e);
					}
				}
			}
		}

		return configJson;
	}

	async #getToken() {
		this.#eventEmitter.emit("log", "debug", "Start normal login");

		const loginpageUrl =
			this.#LOGIN_URL +
			"?" +
			util.urlEncode({
				response_type: "code",
				prompt: "login",
				code_challenge: util.b64UrlEncode(util.sha256(this.#VERIFIER)),
				code_challenge_method: "S256",
				client_id: this.#APP_ID,
				scope: "ReadOrigApi",
				nonce: util.b64random(16),
				state: util.b64random(16),
				redirect_uri: this.#REDIRECT_URL,
				redirect_target: "icore",
			});
		const deviceAuth = await this.#request(loginpageUrl)
			.then((res) => {
				this.#eventEmitter.emit("log", "debug", res.data.toString());
				return res.data.toString();
			})
			.catch((error) => {
				this.#eventEmitter.emit("log", "error", error);
				if (error.response) {
					this.#eventEmitter.emit("log", "error", JSON.stringify(error.response.data));
				}
			});

		//Extract SessionID
		const arr = deviceAuth.match(this.#REGEX_SESSION);
		if (arr == null) {
			this.#eventEmitter.emit("log", "warn", "Unable to find session id in login page");
			return;
		}
		const sessionId = arr[1];

		this.#eventEmitter.emit("log", "debug", "--------");

		// now that we have a session id, contact the single key host to start the new login flow
		const preauthQuery = {
			client_id: this.#CLIENT_ID,
			redirect_uri: this.#BASE_URL + "redirect_target",
			response_type: "code",
			scope: "openid email profile offline_access homeconnect.general",
			prompt: "login",
			style_id: "bsh_hc_01",
			state: '{"session_id":"' + sessionId + '"}', // important: no spaces!
		};

		// fetch the preauth state to get the final callback url
		let preauthUrl = this.#SINGLEKEY_URL + "/auth/connect/authorize?" + util.urlEncode(preauthQuery);
		let preauthData = "";
		// loop until we have the callback url
		do {
			this.#eventEmitter.emit("log", "debug", "next preauth_url=" + preauthUrl);

			const response = await this.#request(preauthUrl, false);
			if (response.status === 200) {
				preauthData = response.data;
			}
			if (response.status > 300 && response.status < 400) {
				preauthUrl = this.#addSinglekeyHost(response.headers["location"]);
			}
			if (response.status === 403) {
				this.#eventEmitter.emit("log", "error", "Server has a temporary problem. Try again later.");
				return;
			}
		} while (!preauthData);

		if (!preauthData) {
			return;
		}

		let returnUrl = this.#addSinglekeyHost(util.getUrlParams(preauthUrl).get("ReturnUrl"));

		this.#eventEmitter.emit("log", "debug", "return_url: " + returnUrl);
		this.#eventEmitter.emit("log", "debug", "--------");

		//Do login with determined data and url
		const isLoginSuccessfull = await this.#doLogin(preauthData.toString(), preauthUrl);
		if (isLoginSuccessfull) {
			this.#eventEmitter.emit("log", "info", "Login sucessfull. Trying to catch token...");

			do {
				const response = await this.#request(returnUrl, false);
				this.#eventEmitter.emit("log", "debug", "next return_url=" + returnUrl);
				if (response.status !== 302 && response.status !== 307) {
					break;
				}

				returnUrl = this.#addSinglekeyHost(response.headers["location"]);
			} while (!returnUrl.startsWith(this.#REDIRECT_DOMAIN));

			this.#eventEmitter.emit("log", "debug", "return_url=" + returnUrl);
			this.#eventEmitter.emit("log", "debug", "--------");

			const params = util.getUrlParams(returnUrl);
			const code = params.get("code");
			const state = params.get("state");
			const grantType = params.get("grant_type");

			this.#eventEmitter.emit("log", "debug", "code=" + code + " grant_type=" + grantType + " state=" + state);

			const tokenQuery = {
				grant_type: grantType,
				client_id: this.#APP_ID,
				code_verifier: this.#VERIFIER,
				code: code,
				redirect_uri: this.#REDIRECT_URL,
			};
			this.#eventEmitter.emit(
				"log",
				"debug",
				"tokenUrl: " + this.#TOKEN_URL + " tokenFields: " + JSON.stringify(tokenQuery),
			);
			const tokenPage = await this.#request(this.#TOKEN_URL, false, tokenQuery, "post")
				.then((res) => {
					this.#eventEmitter.emit("log", "debug", JSON.stringify(res.data));
					return res.data;
				})
				.catch((error) => {
					this.#eventEmitter.emit("log", "error", "Bad code? " + error);
					if (error.response) {
						this.#eventEmitter.emit("log", "error", JSON.stringify(error.response.data));
					}
				});

			if (tokenPage.error) {
				this.#eventEmitter.emit("log", "error", JSON.stringify(tokenPage));
				return;
			}

			this.#eventEmitter.emit("log", "debug", "--------- got token page ----------");
			this.#eventEmitter.emit("log", "debug", "Received access token: " + tokenPage.access_token);

			return tokenPage.access_token;
		}

		this.#eventEmitter.emit("log", "warn", "Login not successful. Please check your login details.");
	}

	async #doLogin(preauthData, preauthUrl) {
		let arr = preauthData.match(this.#REGEX_TOKEN);
		if (arr) {
			const response = await this.#request(
				preauthUrl,
				false,
				{
					// @ts-ignore
					"UserIdentifierInput.EmailInput.StringValue": this.config.username,
					__RequestVerificationToken: arr[1],
				},
				"post",
			);

			const passwortUrl = this.#addSinglekeyHost(response.headers["location"]);
			if (!passwortUrl.includes("password")) {
				return false;
			}
			const responseData = await this.#request(passwortUrl, false)
				.then((res) => {
					return res.data.toString();
				})
				.catch((error) => {
					this.#eventEmitter.emit("log", "error", error);
					if (error.response) {
						this.#eventEmitter.emit("log", "error", JSON.stringify(error.response.data));
					}
				});
			arr = responseData.match(this.#REGEX_TOKEN);
			if (arr) {
				await this.#request(
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

	async #getAccountInfo() {
		// now we can fetch the rest of the account info
		const account = await this.#request(this.#ASSET_URL + "account/details")
			.then((res) => {
				this.#eventEmitter.emit("log", "debug", JSON.stringify(res.data));
				return res.data;
			})
			.catch((error) => {
				this.#eventEmitter.emit("log", "error", "Unable to fetch account details " + error);
				if (error.response) {
					this.#eventEmitter.emit("log", "error", JSON.stringify(error.response.data));
				}
			});

		if (account.error) {
			this.#eventEmitter.emit("log", "error", JSON.stringify(account));
			return;
		}

		this.#eventEmitter.emit("log", "debug", JSON.stringify(account));

		return account;
	}

	#addSinglekeyHost(url) {
		if (url.startsWith(this.#REDIRECT_DOMAIN)) {
			return url;
		}

		// Make relative locations absolute
		if (!url.startsWith("http")) {
			url = this.#SINGLEKEY_URL + url;
		}

		return url;
	}

	async #request(url, allowRedirects = true, data, method = "get") {
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
}

module.exports = ConfigService;
