/* eslint-disable no-unused-vars */
/**
 * Sammlung von nützlichen Funktionen.
 */

const crypto = require("crypto");
const fs = require("node:fs");

function b64UrlEncode(str) {
	return str.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64random(num) {
	return b64UrlEncode(randomBytes(num));
}

function randomBytes(num) {
	return crypto.randomBytes(num);
}

function sha256(buffer) {
	return crypto.createHash("sha256").update(buffer).digest();
}

function hmac(key, msg) {
	return crypto.createHmac("sha256", key).update(msg).digest();
}

/**
 * hmac an inbound or outbound message, chaining the last hmac too
 * @param {Buffer} iv
 * @param {Buffer} direction
 * @param {Buffer} enc_msg
 * @param {Buffer} key
 */
function getHmacOfMessage(iv, direction, enc_msg, key) {
	const hmac_msg = Buffer.concat([iv, direction, enc_msg]);
	return hmac(key, hmac_msg).subarray(0, 16);
}

/**
 * @param {Buffer} key
 * @param {Buffer} iv
 */
function aesCipherIv(key, iv) {
	return crypto.createCipheriv("aes-256-cbc", key, iv);
}

/**
 * @param {Buffer} key
 * @param {Buffer} iv
 */
function aesDecipherIv(key, iv) {
	const decrypter = crypto.createDecipheriv("aes-256-cbc", key, iv);
	decrypter.setAutoPadding(false);
	return decrypter;
}

function isConfigJson(str) {
	if (str.length <= 4) {
		return false;
	}

	let ret = false;
	try {
		const keys = Object.keys(JSON.parse(str)[0]);
		ret =
			keys.includes("name") &&
			keys.includes("host") &&
			keys.includes("key") &&
			keys.includes("description") &&
			keys.includes("features");
	} catch (e) {
		ret = false;
	}
	return ret;
}

function urlEncode(params) {
	return Object.entries(params)
		.map((kv) => kv.map(encodeURIComponent).join("="))
		.join("&");
}

function getUrlParams(url) {
	return new URLSearchParams(url.substring(url.indexOf("?") + 1));
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function existsDir(path) {
	return fs.existsSync(path);
}

module.exports = {
	b64UrlEncode,
	b64random,
	randomBytes,
	sha256,
	hmac,
	getHmacOfMessage,
	aesCipherIv,
	aesDecipherIv,
	isConfigJson,
	urlEncode,
	getUrlParams,
	sleep,
	existsDir,
};
