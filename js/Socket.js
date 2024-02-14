const Websocket = require("ws");
const CryptoJs = require("crypto-js");

/**
 * Create a websocket that wraps a connection to a Bosh-Siemens Home Connect device
 * @TODO Mangels Geräten muss noch wenn nötig die Kommunikation über http implementiert werden.
 * @see https://github.com/osresearch/hcpy/blob/main/HCSocket.py
 */
class Socket {
	constructor(devId, host, key, iv64, mainClass) {
		this.handleMessage = this.handleMessage.bind(this);

		this._this = mainClass;
		this.deviceID = devId;

		this.host = host;
		this.psk = Buffer.from(key + "===", "base64");

		if (iv64) {
			this.isHttp = true;
			this.port = 80;
			this.enckey = CryptoJs.Hmac256(Buffer.from("454E43", "hex"), this.psk);
			this.mackey = CryptoJs.Hmac256(Buffer.from("4D4143", "hex"), this.psk);
			this.iv = Buffer.from(iv64 + "===", "base64");

			this.last_rx_hmac = new Uint8Array(16);
			this.last_tx_hmac = new Uint8Array(16);
		} else {
			this.isHttp = false;
			this.port = 443;
		}
	}

	/**
	 * Stellt eine Socketverbindung zum Endgerät her und gibt die Verbindung zurück
	 * @see https://nodejs.org/api/tls.html#tlsconnectoptions-callback
	 */
	reconnect() {
		this._this.log.debug("Try to (re)connect to device " + this.deviceID);

		let options = {
			origin: "",
		};
		let protocol = "ws";
		if (this.isHttp) {
			// an HTTP self-encrypted socket
			this.reset();
		} else {
			const _this = this;
			options = {
				origin: "",
				ciphers: "ECDHE-PSK-CHACHA20-POLY1305",
				minVersion: "TLSv1.2",
				pskCallback: function () {
					return {
						identity: "Client_identity",
						psk: _this.psk,
					};
				},
				checkServerIdentity: function () {
					return undefined;
				},
			};

			protocol = "wss";
		}
		const ws = new Websocket(protocol + "://" + this.host + ":" + this.port + "/homeconnect", options);

		ws.on("error", (e) => {
			this._this.log.error("Connection error for device " + this.deviceID + ": " + e);
		});
		ws.on("open", () => {
			this._this.log.debug("Connection to device " + this.deviceID + " established.");
		});
		ws.on("close", (event) => {
			if (event === 1000 || event === 1001 || event === 1005 || event === 1008) {
				this.reconnect();
				return;
			}
			this._this.log.debug("Closed connection to " + this.deviceID + "; reason: " + event);
		});
		ws.onmessage = (event) => {
			this.handleMessage(event.data);
		};

		this.ws = ws;
	}

	handleMessage(msg) {
		this._this.handleMessage(this.deviceID, msg);
	}

	isConnected() {
		return this.ws.readyState !== Websocket.CLOSE;
	}

	reset() {
		if (this.isHttp) {
			this.last_rx_hmac = new Uint8Array(16);
			this.last_tx_hmac = new Uint8Array(16);

			this.aes_encrypt = CryptoJs.AES.encrypt(this.iv, this.enckey, { mode: CryptoJs.mode.CBC });
			this.aes_decrypt = CryptoJs.AES.decrypt(this.iv, this.enckey, { mode: CryptoJs.mode.CBC });
		}
	}

	send(msg) {
		this._this.log.debug(this.deviceID + ": " + JSON.stringify(msg));
		/*TODO Senden für Geräte ohne https
		let buf = JSON.stringify(msg);
		if (this.isHttp) {
			buf = this.encrypt(buf);
		}*/
		this.ws.send(JSON.stringify(msg));
	}

	close() {
		this._this.log.debug("Closing socket connection gracefully to " + this.deviceID);
		this.ws.close(3000);
	}
}

module.exports = Socket;
