const Websocket = require("ws");
const util = require("./util.js");

//Sockettimeout in Sekunden
const socketTimeout = 30;

/**
 * Create a websocket that wraps a connection to a Bosh-Siemens Home Connect device
 * @see https://github.com/osresearch/hcpy/blob/main/HCSocket.py
 */
class Socket {
	#connectionEstablished;
	#retries;
	#maxTimeout;
	#eventEmitter;
	#deviceID;
	#host;
	#psk;
	#port;
	#iv;
	#enckey;
	#mackey;
	#aesEncrypt;
	#aesDecrypt;
	#last_rx_hmac;
	#last_tx_hmac;

	/**
	 *
	 * @param {string} devId
	 * @param {string} host
	 * @param {string} key
	 * @param {string} iv64
	 * @param {*} eventEmitter
	 * @param {number} retries
	 */
	constructor(devId, host, key, iv64, eventEmitter, retries) {
		this.#connectionEstablished = false;
		this.#retries = retries | 0;
		this.#maxTimeout = (socketTimeout / 6) * 60 * 1000; //5 Minuten
		this.#eventEmitter = eventEmitter;

		this.handleMessage = this.#handleMessage.bind(this);

		this.#deviceID = devId;

		this.#host = host;
		this.#psk = Buffer.from(key + "===", "base64");

		if (iv64) {
			this.isHttp = true;
			this.#port = 80;

			this.#iv = Buffer.from(iv64 + "===", "base64");

			// an HTTP self-encrypted socket
			this.#enckey = util.hmac(this.#psk, Buffer.from("454E43", "hex"));
			this.#mackey = util.hmac(this.#psk, Buffer.from("4D4143", "hex"));

			// @ts-ignore
			this.#aesEncrypt = util.aesCipherIv(this.#enckey, this.#iv);
			// @ts-ignore
			this.#aesDecrypt = util.aesDecipherIv(this.#enckey, this.#iv);

			this.#last_rx_hmac = Buffer.alloc(16);
			this.#last_tx_hmac = Buffer.alloc(16);
		} else {
			this.isHttp = false;
			this.#port = 443;
		}
	}

	/**
	 * Stellt eine Socketverbindung zum Endgerät her
	 * @see https://nodejs.org/api/tls.html#tlsconnectoptions-callback
	 */
	async reconnect() {
		this.#eventEmitter.emit("log", "debug", "Try to (re)connect to device " + this.#deviceID);

		let reconnectDelay = Math.ceil(this.#nextReconnectDelay(this.#retries++));
		if (reconnectDelay >= this.#maxTimeout) {
			this.#eventEmitter.emit(
				"log",
				"warn",
				"Max time of trying to reconnect reached for device " + this.#deviceID + ". Giving up.",
			);
			return;
		}
		await util.sleep(reconnectDelay);

		let options = {
			origin: "",
			timeout: socketTimeout * 1000,
		};
		let protocol = "ws";
		if (!this.isHttp) {
			const _this = this;

			options.ciphers = "ECDHE-PSK-CHACHA20-POLY1305";
			options.minVersion = "TLSv1.2";
			options.pskCallback = function () {
				return {
					identity: "Client_identity",
					psk: _this.#psk,
				};
			};
			options.checkServerIdentity = function () {
				return undefined;
			};

			protocol = "wss";
		}
		let ws = new Websocket(`${protocol}://${this.#host}:${this.#port}/homeconnect`, options);

		ws.on("error", (e) => {
			this.#connectionEstablished = false;
			clearTimeout(this.pingTimeout);
			this.ws.removeAllListeners();
			this.ws.terminate();

			this.#eventEmitter.emit("socketError", this.#deviceID, e);
		});
		ws.on("open", () => {
			this.#connectionEstablished = true;
			this.ws.ping();

			this.#eventEmitter.emit("socketOpen", this.#deviceID);
		});
		ws.on("close", (event) => {
			this.#connectionEstablished = false;
			clearTimeout(this.pingTimeout);
			this.ws.removeAllListeners();

			if (event >= 1000 && event <= 1015) {
				this.#eventEmitter.emit("socketGracefullyClose", this.#deviceID);
			} else {
				this.#eventEmitter.emit("socketClose", this.#deviceID, event);
			}
		});
		ws.on("ping", () => {
			this.#eventEmitter.emit("log", "debug", this.#deviceID + ": ping received");
			this.#heartbeat();
		});
		ws.onmessage = (event) => {
			this.#handleMessage(event.data);
		};

		this.ws = ws;
	}

	#heartbeat() {
		clearTimeout(this.pingTimeout);

		this.pingTimeout = setTimeout(
			() => {
				this.#eventEmitter.emit("log", "debug", this.#deviceID + ": expected ping not received");
				this.ws.terminate();
				this.#connectionEstablished = false;
			},
			socketTimeout * 4 * 1000,
		);
	}

	#nextReconnectDelay(retries) {
		return Math.min((1 + Math.random()) * Math.pow(1.5, retries) * 1000, this.#maxTimeout);
	}

	/**
	 *
	 * @param {object} msg
	 */
	#handleMessage(msg) {
		if (this.isHttp) {
			this.#eventEmitter.emit("log", "debug", "Encrypted message from " + this.#deviceID);
			msg = this.#decrypt(Buffer.from(msg));
		}
		this.#eventEmitter.emit("message", this.#deviceID, msg);
	}

	isConnected() {
		return this.#connectionEstablished;
	}

	/**
	 *
	 * @param {object} msg
	 */
	send(msg) {
		this.#eventEmitter.emit("log", "debug", this.#deviceID + ": " + JSON.stringify(msg));

		let buf = JSON.stringify(msg);
		if (this.isHttp) {
			this.ws.send(this.#encrypt(buf));
		} else {
			this.ws.send(buf);
		}
	}

	/**
	 * @param {string} msg
	 */
	#encrypt(msg) {
		this.#eventEmitter.emit("log", "debug", "---------------- Starting encryption -----------------------");
		// convert the UTF-8 string into a byte array
		let msgBuf = Buffer.from(msg);
		this.#eventEmitter.emit("log", "debug", "msg as bytes:");
		this.#eventEmitter.emit("log", "debug", msgBuf.toString("hex"));

		// pad the buffer, adding an extra block if necessary
		let pad_len = 16 - (msgBuf.length % 16);
		if (pad_len === 1) {
			pad_len += 16;
		}
		this.#eventEmitter.emit("log", "debug", "pad length: " + pad_len);

		let pad = Buffer.concat([Buffer.from("00", "hex"), util.randomBytes(pad_len - 2), Buffer.from([pad_len])]);
		msgBuf = Buffer.concat([msgBuf, pad]);

		this.#eventEmitter.emit("log", "debug", "msg plus pad:");
		this.#eventEmitter.emit("log", "debug", msgBuf.toString("hex"));

		// encrypt the padded message with CBC, so there is chained state from the last cipher block sent
		// @ts-ignore
		let enc_msg = this.#aesEncrypt.update(msgBuf);
		this.#eventEmitter.emit("log", "debug", "Encrypted msg:");
		this.#eventEmitter.emit("log", "debug", enc_msg.toString("hex"));

		// compute the hmac of the encrypted message, chaining the hmac of the previous message plus direction 'E'
		this.#last_tx_hmac = util.getHmacOfMessage(
			// @ts-ignore
			this.#iv,
			// @ts-ignore
			Buffer.concat([Buffer.from("E"), this.#last_tx_hmac]),
			enc_msg,
			this.#mackey,
		);

		// append the new hmac to the message
		let ret = Buffer.concat([enc_msg, this.#last_tx_hmac]);
		this.#eventEmitter.emit("log", "debug", "Encrypted msg with hmac (return):");
		this.#eventEmitter.emit("log", "debug", ret.toString("hex"));
		this.#eventEmitter.emit("log", "debug", "---------------- Ending encryption -----------------------");
		return ret;
	}

	/**
	 * @param {Buffer} buf
	 */
	#decrypt(buf) {
		this.#eventEmitter.emit("log", "debug", "---------------- Starting decryption -----------------------");
		this.#eventEmitter.emit("log", "debug", "recieved msg: ");
		this.#eventEmitter.emit("log", "debug", buf.toString("hex"));
		if (buf.length < 32) {
			return JSON.stringify({
				code: 5001,
				info: "Received message length < 32: " + buf.length,
				resource: buf.toString("base64"),
			});
		}
		if (buf.length % 16 !== 0) {
			this.#eventEmitter.emit(
				"log",
				"debug",
				"Unaligned message? probably bad: " + buf.toString("base64") + " ; length: " + buf.length,
			);
		}

		// split the message into the encrypted message and the first 16-bytes of the HMAC
		let enc_msg = buf.subarray(0, -16);
		let their_hmac = buf.subarray(-16);

		// compute the expected hmac on the encrypted message with direction 'C'
		let our_hmac = util.getHmacOfMessage(
			// @ts-ignore
			this.#iv,
			// @ts-ignore
			Buffer.concat([Buffer.from("C"), this.#last_rx_hmac]),
			enc_msg,
			this.#mackey,
		);

		if (!their_hmac.equals(our_hmac)) {
			this.#eventEmitter.emit(
				"log",
				"debug",
				"HMAC failure; Wert: " + their_hmac.toString("hex") + " vs. " + our_hmac.toString("hex"),
			);
		}

		this.#last_rx_hmac = their_hmac;

		// decrypt the message with CBC, so the last message block is mixed in
		// @ts-ignore
		let msg = this.#aesDecrypt.update(enc_msg);
		this.#eventEmitter.emit("log", "debug", "decrypted as bytes:");
		this.#eventEmitter.emit("log", "debug", msg.toString("hex"));

		// check for padding and trim it off
		let pad_len = parseInt(msg.subarray(-1).toString("hex"), 16);
		this.#eventEmitter.emit("log", "debug", "pad length: " + pad_len);

		//check for valid json
		let ret = msg.subarray(0, -pad_len).toString();
		if (ret[0] !== "{" || ret[ret.length - 1] !== "}") {
			return JSON.stringify({
				code: 5003,
				info: "Invalid JSON format",
				resource: ret.toString(),
			});
		}

		this.#eventEmitter.emit("log", "debug", "---------------- Ending decryption -----------------------");
		return ret;
	}

	close() {
		this.#eventEmitter.emit("log", "debug", "Closing socket connection gracefully to " + this.#deviceID);
		this.ws.close(4665);
	}
}

module.exports = Socket;
