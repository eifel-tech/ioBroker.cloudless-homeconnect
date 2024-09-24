/**
 * Convert the featuremap and devicedescription XML files into a single JSON
 * this collapses the XML entities and duplicates some things, but makes for
 * easier parsing later
 */

const xml2js = require("xml2js");
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

function parseFeatures(features) {
	Object.values(features).forEach((key) => {
		allFeatures[parseInt(key.$.refUID, 16)] = {
			name: key._,
		};
	});
}

function parseEnums(enums) {
	for (const key of enums) {
		const values = {};
		const enumMember = key.enumMember;
		for (const v of enumMember) {
			const value = parseInt(v.$.refValue);
			values[value] = v._;
		}

		parsedEnums[parseInt(key.$.refENID, 16)] = {
			name: key.$.enumKey,
			values: values,
		};
	}
}

function parseTypes(types) {
	Object.values(types)
		.map((type) => {
			const correctedType = type.$.protocolType.toLowerCase();
			const ret = {
				name: correctedType,
				cid: type.$.cid,
			};
			if (correctedType === "float" || correctedType === "integer") {
				ret.name = "number";
				const unit = tryToGetUnit(type.$.type);
				if (unit) {
					ret.unit = unit;
				}
			}
			if (correctedType === "object") {
				ret.name = "string";
			}
			return ret;
		})
		.forEach((type) => {
			const uid = parseInt(type.cid, 16);
			parsedTypes[uid] = {
				type: type.name,
			};
			if (type.unit) {
				parsedTypes[uid].unit = type.unit;
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

async function xml2json(featuresXml, descriptionXml, typesXml) {
	parsedEnums = {};
	allFeatures = {};
	parsedFeatures = {};
	parsedTypes = {};

	// the feature file has features, errors, and enums
	const $ = cheerio.load(descriptionXml, {
		xml: true,
	});
	const parser = new xml2js.Parser();

	// Parse the feature an enum file
	const result = await parser.parseStringPromise(featuresXml);

	//Parse possible types
	const types = await parser.parseStringPromise(typesXml);

	// Features are all possible UIDs
	parseFeatures(result.featureMappingFile.featureDescription[0].feature);
	// Enums
	parseEnums(result.featureMappingFile.enumDescriptionList[0].enumDescription);
	// Types
	parseTypes(types.cidList.contentType);

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

/**
 * @param {cheerio.Cheerio<import("domhandler").Element>} cheerioObj
 * @param {string} filtername
 */
function getAttribs(cheerioObj, filtername) {
	var ret = [];
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
	var ret = [];
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

module.exports = {
	xml2json,
};
