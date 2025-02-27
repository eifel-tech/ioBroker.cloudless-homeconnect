const util = require("./util.js");

/**
 * Homeconnect-Device with its socket connection @see Socket.js
 */
class Device {
	#device_name;
	#device_id;
	#tx_msg_id;
	#sendingMap;

	/**
	 * @param {import("./Socket.js")} ws
	 * @param {{ id: string; description: object; features: object; }} deviceJson
	 */
	constructor(ws, deviceJson) {
		this.refreshInterval = undefined;
		this.ws = ws;
		this.type = deviceJson.description.type;
		this.model = deviceJson.description.model;
		this.id = deviceJson.id;
		this.features = deviceJson.features;

		this.isSendSelectedProgram = this.type !== "Hood";

		this.#device_name = "hcpy";
		this.#device_id = "0badcafe";

		this.#tx_msg_id = 0;

		this.#sendingMap = new Map();
	}

	/**
	 *
	 * @param {object} msg
	 * @returns
	 */
	handleMessage(msg) {
		//Bei Fehler abbrechen
		if (msg.code) {
			return {
				error: msg.code,
				resource: msg.resource,
				info: msg.info,
			};
		}

		const resource = msg.resource;
		const action = msg.action;

		const values = {};
		if (action === "POST" && resource == "/ei/initialValues") {
			this.#handleFirstMessage(msg);
		} else if (action === "RESPONSE" || action === "NOTIFY") {
			if (resource == "/ro/allMandatoryValues" || resource == "/ro/values") {
				if (!msg.data && this.#sendingMap.has(msg.msgID)) {
					msg.data = this.#sendingMap.get(msg.msgID);
				}
				if (msg.data) {
					for (const val of msg.data) {
						values[val.uid] = val.value;
					}
				}
			} else if (resource == "/ci/services") {
				this.services = Object.values(msg.data).map((service) => {
					return {
						service: service.service,
						version: service.version,
					};
				});
			}
		}
		// return whatever we've parsed out of it
		return values;
	}

	/**
	 *
	 * @param {object} msg
	 */
	#handleFirstMessage(msg) {
		this.#sendingMap.clear();

		// this is the first message they send to us and establishes our session plus message ids
		this.session_id = msg.sID;
		this.#tx_msg_id = msg.data[0].edMsgID;

		this.#reply(msg, {
			deviceType: "Application",
			deviceName: this.#device_name,
			deviceID: this.#device_id,
		});

		// ask the device which services it supports
		this.send("/ci/services");

		if (this.ws.isHttp) {
			/* the clothes washer wants this, the token doesn't matter, although they do not handle padding characters
			they send a response, not sure how to interpret it*/
			const token = util.b64random(32).replaceAll("=", "");
			this.send("/ci/authentication", 2, "GET", { nonce: token });
		}

		//this.send("/ci/info", 2); // clothes washer
		//this.send("/iz/info"); // dish washer
		//this.send("/ci/tzInfo", 2)
		//this.send("/ni/info");
		//this.send("/ni/config", 1, "GET", {"interfaceID": 0})
		this.send("/ei/deviceReady", 2, "NOTIFY");
		this.send("/ro/allMandatoryValues");
	}

	/**
	 * Reply to a POST or GET message with new data
	 * @param {object} msg
	 * @param {object} replyData
	 */
	#reply(msg, replyData) {
		this.ws.send({
			sID: msg.sID,
			msgID: msg.msgID, // same one they sent to us
			resource: msg.resource,
			version: msg.version,
			action: "RESPONSE",
			data: [replyData],
		});
	}

	/**
	 * Sends a message to the device
	 * @param {string} resource
	 * @param {number} version
	 * @param {string} action
	 * @param {object} data
	 */
	send(resource, version = 1, action = "GET", data = undefined) {
		if (this.ws.isConnected()) {
			const msg = {
				sID: this.session_id,
				msgID: this.#tx_msg_id,
				resource: resource,
				version: version,
				action: action,
			};

			if (data) {
				msg.data = [data];
			}

			//Werte pro Message zwischenspeichern, um auf Antworten des Geräts reagieren zu können, z.B. sofort ack=true setzen
			this.#sendingMap.set(msg.msgID, msg.data);

			this.ws.send(msg);
			this.#tx_msg_id += 1;
		}
	}
}

module.exports = Device;
