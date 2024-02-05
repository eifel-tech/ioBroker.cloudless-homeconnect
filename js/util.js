/**
 * Sammlung von nützlichen Funktionen.
 */

const crypto = require("crypto");

function b64UrlEncode(str) {
	return str.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64random(num) {
	return b64UrlEncode(crypto.randomBytes(num));
}

function sha256(buffer) {
	return crypto.createHash("sha256").update(buffer).digest();
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

module.exports = {
	b64UrlEncode,
	b64random,
	sha256,
	isConfigJson,
	urlEncode,
	getUrlParams,
	sleep,
};
