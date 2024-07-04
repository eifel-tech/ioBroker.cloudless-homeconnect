/**
 * Convert the featuremap and devicedescription XML files into a single JSON
 * this collapses the XML entities and duplicates some things, but makes for
 * easier parsing later
 */

const xml2js = require("xml2js");
const parsedEnums = {};
const parsedFeatures = {};
const parsedTypes = {};

/**
 * Parse the description file and collapse everything into a single list of UIDs
 */
function joinFeature(entries) {
	entries
		.filter((el) => parseInt(el.$.uid, 16) in parsedFeatures)
		.forEach((el) => {
			const keys = Object.keys(el.$);

			keys.filter((key) => key === "enumerationType").forEach(() => {
				parsedFeatures[parseInt(el.$.uid, 16)].states = parsedEnums[parseInt(el.$.enumerationType, 16)].values;
			});

			keys.filter((key) => key === "refCID").forEach(() => {
				const uid = parseInt(el.$.uid, 16);
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
				parsedFeatures[parseInt(el.$.uid, 16)].options = optionUIDs;
			});

			keys.filter((key) => key !== "uid").forEach((key) => {
				parsedFeatures[parseInt(el.$.uid, 16)][key] = el.$[key];
			});
		});
}

function getMachineDescription(entries) {
	const description = {};
	Object.entries(entries)
		.filter(([key]) => key !== "pairableDeviceTypes")
		.forEach(([key, value]) => {
			description[key] = value[0];
		});

	return description;
}

function parseFeatures(features) {
	Object.values(features).forEach((key) => {
		parsedFeatures[parseInt(key.$.refUID, 16)] = {
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
	// the feature file has features, errors, and enums
	const parser = new xml2js.Parser();
	const description = await parser.parseStringPromise(descriptionXml);

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

	joinFeature(description.device.statusList[0].status);
	//Oven
	if (description.device.statusList[0].statusList) {
		Object.values(description.device.statusList[0].statusList).forEach((statusList) => {
			joinFeature(statusList.status);
		});
	}

	joinFeature(description.device.settingList[0].setting);
	//Oven
	if (description.device.settingList[0].settingList) {
		Object.values(description.device.settingList[0].settingList).forEach((settingList) => {
			joinFeature(settingList.setting);
		});
	}

	joinFeature(description.device.eventList[0].event);

	joinFeature(description.device.commandList[0].command);
	joinFeature(description.device.optionList[0].option);

	if (description.device.programGroup[0].programGroup) {
		//Oven
		Object.values(description.device.programGroup[0].programGroup).forEach((programGroup) => {
			joinFeature(programGroup.program);
		});
	} else {
		//Dishwasher
		joinFeature(description.device.programGroup[0].program);
	}
	joinFeature(description.device.activeProgram);
	joinFeature(description.device.selectedProgram);

	return {
		description: getMachineDescription(description.device.description[0]),
		features: parsedFeatures,
	};
}

module.exports = {
	xml2json,
};
