/**
 * Homeconnect-Device with its socket connection @see Socket.js
 */
class Device {
	constructor(ws, deviceJson) {
		this.ws = ws;
		this.id = deviceJson.id;
		this.json = deviceJson;
		this.features = deviceJson.features;

		this.device_name = "hcpy";
		this.device_id = "0badcafe";

		this.tx_msg_id = 0;
	}

	handleMessage(msg) {
		//Bei Fehler abbrechen
		if (msg.code) {
			return {
				error: msg.code,
				resource: msg.resource,
			};
		}

		const resource = msg.resource;
		const action = msg.action;

		const values = {};
		if (action === "POST" && resource == "/ei/initialValues") {
			this.handleFirstMessage(msg);
		} else if (action === "RESPONSE" || action === "NOTIFY") {
			if (resource == "/ro/allMandatoryValues" || resource == "/ro/values") {
				if (msg.data) {
					Object.values(msg.data).forEach((val) => {
						values[val.uid] = val.value;
					});
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

	handleFirstMessage(msg) {
		// this is the first message they send to us and establishes our session plus message ids
		this.session_id = msg.sID;
		this.tx_msg_id = msg.data[0].edMsgID;

		this.reply(msg, {
			deviceType: "Application",
			deviceName: this.device_name,
			deviceID: this.device_id,
		});

		// ask the device which services it supports
		this.send("/ci/services");

		/* the clothes washer wants this, the token doesn't matter, although they do not handle padding characters
		they send a response, not sure how to interpret it*/
		/*Die nächsten zwei Zeilen mangels Gerät ungetestet*/
		//const token = util.b64random(32).replaceAll("=", "");
		//this.send("/ci/authentication", 2, "GET", { nonce: token });

		//this.send("/ci/info", 2); // clothes washer
		//this.send("/iz/info"); // dish washer
		//this.send("/ci/tzInfo", 2)
		//this.send("/ni/info");
		//this.send("/ni/config", 1, "GET", {"interfaceID": 0})
		this.send("/ei/deviceReady", 2, "NOTIFY");
		//Über die Änderung mancher Werte (z.B. CurrentTemperature) wird kein Event gefeuert. Daher zyklisch abfragen.
		setInterval(() => this.send("/ro/allMandatoryValues"), 60 * 1000);
		//this.send("/ro/allMandatoryValues");
	}

	/**
	 * Reply to a POST or GET message with new data
	 * @param {*} msg
	 * @param {*} replyData
	 */
	reply(msg, replyData) {
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
	 * @param {*} resource
	 * @param {*} version
	 * @param {*} action
	 * @param {*} data
	 */
	send(resource, version = 1, action = "GET", data = undefined) {
		const msg = {
			sID: this.session_id,
			msgID: this.tx_msg_id,
			resource: resource,
			version: version,
			action: action,
		};

		if (data) {
			msg.data = [data];
		}

		this.ws.send(msg);
		this.tx_msg_id += 1;
	}
}

module.exports = Device;
