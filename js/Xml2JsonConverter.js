/**
 * Convert the featuremap and devicedescription XML files into a single JSON
 * this collapses the XML entities and duplicates some things, but makes for
 * easier parsing later
 */
const cheerio = require("cheerio");
let parsedEnums = {};
let allFeatures = {};
let parsedFeatures = {};
let parsedTypes = {};

/**
 * Parse the description file and collapse everything into a single list of UIDs
 */
function joinFeature(entries) {
	entries
		.filter((el) => parseInt(el.$.uid, 16) in allFeatures)
		.forEach((el) => {
			const uid = parseInt(el.$.uid, 16);
			parsedFeatures[uid] = {
				name: allFeatures[uid].name,
			};

			const keys = Object.keys(el.$);

			keys.filter((key) => key === "enumerationType").forEach(() => {
				parsedFeatures[uid].states = parsedEnums[parseInt(el.$.enumerationType, 16)].values;
			});

			keys.filter((key) => key === "refCID").forEach(() => {
				const obj = parsedTypes[parseInt(el.$.refCID, 16)];
				parsedFeatures[uid].type = obj.type;

				if (obj.unit) {
					parsedFeatures[uid].unit = obj.unit;
				}
			});

			//Programs
			keys.filter((key) => key === "execution").forEach(() => {
				const optionUIDs = Object.values(el.option)
					.filter((option) => option.$.access.toLowerCase().includes("write"))
					.map((option) => {
						return parseInt(option.$.refUID, 16);
					});
				parsedFeatures[uid].options = optionUIDs;
			});

			keys.filter((key) => key !== "uid").forEach((key) => {
				parsedFeatures[uid][key] = el.$[key];
			});
		});
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function getMachineDescription($) {
	const description = {};
	$("device")
		.find("description")
		.children()
		.filter(function () {
			return this.name != "pairableDeviceTypes";
		})
		.each(function () {
			description[this.name] = $(this).text();
		});

	return description;
}

/**
 * @param {cheerio.Cheerio<import("domhandler").Element>} features
 */
function parseFeatures(features) {
	features.each(function () {
		allFeatures[parseInt(this.attribs.refUID, 16)] = {
			// @ts-ignore
			name: this.children[0].data,
		};
	});
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function parseEnums($) {
	$("enumDescription").each(function () {
		const values = {};
		$(this)
			.children("enumMember")
			.map(function () {
				return (values[parseInt(this.attribs.refValue)] = $(this).text());
			});
		parsedEnums[parseInt(this.attribs.refENID, 16)] = {
			name: this.attribs.enumKey,
			values: values,
		};
	});
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function parseTypes($) {
	$("contentType")
		.map(function () {
			const correctedType = this.attribs.protocolType.toLowerCase();
			const ret = {
				name: correctedType,
				cid: this.attribs.cid,
			};
			if (correctedType === "float" || correctedType === "integer") {
				ret.name = "number";
				const unit = tryToGetUnit(this.attribs.type);
				if (unit) {
					ret.unit = unit;
				}
			}
			if (correctedType === "object") {
				ret.name = "string";
			}
			return ret;
		})
		.each(function () {
			const uid = parseInt(this.cid, 16);
			parsedTypes[uid] = {
				type: this.name,
			};
			if (this.unit) {
				parsedTypes[uid].unit = this.unit;
			}
		});
}

function tryToGetUnit(type) {
	if (type === "percent") {
		return "%";
	}
	if (type === "temperatureCelsius") {
		return "°C";
	}
	if (type === "temperatureFahrenheit") {
		return "°F";
	}
	if (type === "weight") {
		return "g";
	}
	if (type === "liquidVolume") {
		return "ml";
	}
	if (type === "timeSpan") {
		return "s";
	}

	return "";
}

/**
 * @param {cheerio.Cheerio<import("domhandler").Element>} cheerioObj
 * @param {string} filtername
 */
function getAttribs(cheerioObj, filtername) {
	const ret = [];
	cheerioObj.find(filtername).each(function () {
		ret.push({
			$: this.attribs,
		});
	});
	return ret;
}

/**
 * @param {cheerio.CheerioAPI} $
 */
function getPrograms($) {
	const ret = [];
	$("device")
		.find("program")
		.each(function () {
			ret.push({
				$: this.attribs,
				option: getAttribs($(this), "option"),
			});
		});
	return ret;
}

async function xml2json(featuresXml, descriptionXml, typesXml) {
	parsedEnums = {};
	allFeatures = {};
	parsedFeatures = {};
	parsedTypes = {};

	// the feature file has features, errors, and enums
	let $ = cheerio.load(featuresXml, {
		xml: true,
	});
	// Features are all possible UIDs
	parseFeatures($("feature"));
	// Enums
	parseEnums($);

	//Parse possible types
	$ = cheerio.load(typesXml, {
		xml: true,
	});
	parseTypes($);

	//Parse description
	$ = cheerio.load(descriptionXml, {
		xml: true,
	});
	const theDevice = $("device");
	joinFeature(getAttribs(theDevice, "status"));
	joinFeature(getAttribs(theDevice, "setting"));
	joinFeature(getAttribs(theDevice, "event"));
	joinFeature(getAttribs(theDevice, "command"));
	joinFeature(getAttribs(theDevice, "option"));
	joinFeature(getPrograms($));
	joinFeature(getAttribs(theDevice, "activeProgram"));
	joinFeature(getAttribs(theDevice, "selectedProgram"));

	return {
		description: getMachineDescription($),
		features: parsedFeatures,
	};
}

module.exports = {
	xml2json,
};
