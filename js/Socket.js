const Websocket = require("ws");
const CryptoJs = require("crypto-js");
const util = require("./util.js");

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
			this.enckey = util.hmac(this.psk, Buffer.from("454E43", "hex"));
			this.mackey = util.hmac(this.psk, Buffer.from("4D4143", "hex"));
			this.iv = Buffer.from(iv64 + "===", "base64");

			this.last_rx_hmac = Buffer.alloc(16);
			this.last_tx_hmac = Buffer.alloc(16);
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
		if (this.isHttp) {
			msg = this.decrypt(Buffer.from(msg));
		}
		this._this.handleMessage(this.deviceID, msg);
	}

	isConnected() {
		return this.ws.readyState !== Websocket.CLOSE;
	}

	reset() {
		if (this.isHttp) {
			this.last_rx_hmac = Buffer.alloc(16);
			this.last_tx_hmac = Buffer.alloc(16);

			// @ts-ignore
			this.aesEncrypt = util.aesCipherIv(this.enckey, this.iv);
			// @ts-ignore
			this.aesDecrypt = util.aesDecipherIv(this.enckey, this.iv);
		}
	}

	send(msg) {
		this._this.log.debug(this.deviceID + ": " + JSON.stringify(msg));

		let buf = JSON.stringify(msg);
		if (this.isHttp) {
			this.ws.send(this.encrypt(buf));
		} else {
			this.ws.send(buf);
		}
	}

	/**
	 * @param {string} msg
	 */
	encrypt(msg) {
		this._this.log.debug("---------------- Starting encryption -----------------------");
		// convert the UTF-8 string into a byte array
		const textEncoder = new TextEncoder();
		let msgBuf = textEncoder.encode(msg);
		this._this.log.debug("Encoded msg bytes: ");
		this._this.log.debug(msgBuf);

		// pad the buffer, adding an extra block if necessary
		let pad_len = 16 - (msgBuf.length % 16);
		if (pad_len === 1) {
			pad_len += 16;
		}
		this._this.log.debug("pad length: " + pad_len);

		let pad = Buffer.concat([Buffer.from("00", "hex"), util.randomBytes(pad_len - 2), Buffer.alloc(pad_len)]);
		msgBuf = Buffer.concat([msgBuf, pad]);

		// encrypt the padded message with CBC, so there is chained state from the last cipher block sent
		// @ts-ignore
		let enc_msg = this.aesEncrypt.update(msg);
		this._this.log.debug("Encrypted msg: " + enc_msg.toString("base64"));

		// compute the hmac of the encrypted message, chaining the hmac of the previous message plus direction 'E'
		this.last_tx_hmac = util.getHmacOfMessage(
			// @ts-ignore
			this.iv,
			// @ts-ignore
			Buffer.concat([Buffer.from("45", "hex"), this.last_tx_hmac]),
			enc_msg,
			this.mackey,
		);
		this._this.log.debug("Hmac of encrypted msg: " + this.last_tx_hmac.toString("base64"));

		// append the new hmac to the message
		let ret = Buffer.concat([enc_msg, this.last_tx_hmac]);
		this._this.log.debug("Encrypted msg with hmac: " + ret.toString("base64"));
		return ret;
	}

	/**
	 * @param {Buffer} buf
	 */
	decrypt(buf) {
		this._this.log.debug("---------------- Starting decryption -----------------------");
		this._this.log.debug("recieved msg: " + buf.toString("base64"));
		if (buf.length < 32) {
			this._this.log.debug("Short message? " + buf.toString("base64"));
			return buf;
		}
		if (buf.length % 16 !== 0) {
			this._this.log.debug("Unaligned message? probably bad: " + buf.toString("base64"));
		}

		// split the message into the encrypted message and the first 16-bytes of the HMAC
		let enc_msg = buf.subarray(0, -16);
		this._this.log.debug("encrypted msg " + enc_msg.toString("base64"));
		let their_hmac = buf.subarray(-16);

		// compute the expected hmac on the encrypted message with direction 'C'
		let our_hmac = util.getHmacOfMessage(
			// @ts-ignore
			this.iv,
			// @ts-ignore
			Buffer.concat([Buffer.from("43", "hex"), this.last_rx_hmac]),
			enc_msg,
			this.mackey,
		);

		this._this.log.debug("my hmac " + our_hmac.toString("base64"));
		this._this.log.debug("their hmac " + their_hmac.toString("base64"));
		if (!their_hmac.equals(our_hmac)) {
			this._this.log.error(
				"HMAC failure: " + their_hmac.toString("base64") + " vs. " + our_hmac.toString("base64"),
			);
			return;
		}

		this.last_rx_hmac = their_hmac;

		// decrypt the message with CBC, so the last message block is mixed in
		// @ts-ignore
		let msg = this.aesDecrypt.update(enc_msg);
		this._this.log.debug("decrypted msg: " + msg.toString());

		// check for padding and trim it off the end
		/*this._this.log.debug("pad: " + msg.subarray(-1).toString("hex"));
		let pad_len = msg.subarray(-1).length;
		this._this.log.debug("pad length: " + pad_len);
		this._this.log.debug("msg length: " + msg.length);
		if (msg.length < pad_len) {
			this._this.log.debug("padding error? " + msg.toString("hex"));
			return;
		}*/

		let ret = msg.toString().trim();
		this._this.log.debug("decrypt return: " + ret);
		//return msg.subarray(0, -pad_len);
		return ret;
	}

	close() {
		this._this.log.debug("Closing socket connection gracefully to " + this.deviceID);
		this.ws.close(3000);
	}
}

module.exports = Socket;
