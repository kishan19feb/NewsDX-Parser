var masterDB = require('./database/masterData');
var clientDB = require('./database/clientData');
var constants = require('./database/constants');
var Parser = require('rss-parser');
var domParser = require('html-dom-parser');
var axios = require('axios');
var response = {'status': false, 'message': 'Failed', 'data': []};
var ndx = {
	isNull: function (dataVar) {
		let isNull = false;
		if (dataVar != null || dataVar != undefined) {
			isNull = (dataVar == 'null' || dataVar == 'undefined') ? true : isNull;
		} else {
			isNull = true;
		}
		return isNull;
	},
	isValidJSON : function(jsonStr){
		let isValid = true;
	    try {
	        JSON.parse(jsonStr);
	    } catch (e) {
	        isValid = false;
	    }
	    return isValid;
	},
	isRecordExists : function (sqlString, items, inMaster = false){
		return new Promise(function (resolve, reject){
			let isExist = false;
			let dataHandle = inMaster ? masterDB : clientDB;
			dataHandle.query(sqlString, function(err, result){
				if((!err) && (result.length > 0)){
					isExist = ((!ndx.isNull(result[0]['COUNT'])) && result[0]['COUNT'] > 0) ? true : false;
				}
				resolve(isExist);
			});
		});
	},
	insertRecord : function (sqlString, items, inMaster = false){
		return new Promise(function (resolve, reject){
			let isSuccess = 0;
			let dataHandle = inMaster ? masterDB : clientDB;
			dataHandle.query(sqlString, items, function(err, result){
				if((!err)){
					isSuccess = 1;
				}
				resolve(isSuccess);
			});
		});
	},
	executeSQL : function (sqlString, items, inMaster = false){
		return new Promise(function (resolve, reject){
			let isSuccess = 0;
			let dataHandle = inMaster ? masterDB : clientDB;
			dataHandle.query(sqlString, items, function(err, result){
				if(!err){
					isSuccess = result.affectedRows;
				}
				resolve(isSuccess);
			});
		});
	},
	sanitize : function(str){
		str = str.replace(/<figcaption[^>]*>.*<\/figcaption>/g,"");
		str = str.replace(/<img[^>]*>/g,"")
		return str;
	},
	getImagesAndCaptions : function(descStr){
		let media = [];
		let arrTags = domParser(descStr);
		for (const tag of arrTags) {
			if(tag['type'] == 'tag' && tag['name'] == 'img'){
				media.push({
				    'IMAGE': tag['attribs']['src'],
				    'CAPTION': tag['attribs']['alt']
				});
			}
		}
		return media;
	},
	updateTopics : function(propertyId, articleId, reqTopics){
		let oldTopics = [];
		let newTopics = [];
		let reqTopicName = "";
		for(i=0; i<reqTopics.length;i++){
			reqTopicName = reqTopics[i].trim();
			if(reqTopicName != ""){
				newTopics.push(reqTopicName);
			}
		}
		let oldTopicsSQL = "SELECT TOPIC_NAME FROM `topics_articles` WHERE `ARTICLE_ID` = ?";
		let oldTopicsItem = [articleId];
		clientDB.query(oldTopicsSQL, oldTopicsItem, async function(err, topics){
			if((!err) && (topics.length > 0)){
				for(const topic of topics){
					oldTopics.push(topic['TOPIC_NAME']);
				}
				let toBeAdded = [];
				for(const topic of newTopics){
					if(!oldTopics.includes(topic)){
						toBeAdded.push(topic);
					}
				}
				let toBeRemoved = [];
				for(const topic of oldTopics){
					if(!newTopics.includes(topic)){
						toBeRemoved.push(topic);
					}
				}
				if(toBeRemoved.length > 0){
					// DELETE topics_articles where TOPIC_NAME IN (toBeRemoved)
					let remTopicsSQL = "DELETE FROM `topics_articles` WHERE `ARTICLE_ID` LIKE ? AND `TOPIC_NAME` IN (?)";
					let remTopicsItem = [articleId, toBeRemoved];
					await ndx.executeSQL(remTopicsSQL, remTopicsItem, false);
					// Update SET SCORE = SCORE - 1 WHERE TOPIC_NAME IN
					// (toBeRemoved)
					let updateScoreSQL = "UPDATE `topics` SET `SCORE` = `SCORE` - 1 WHERE `NAME` IN (?)";
					let updateScoreItem = [toBeRemoved];
					await ndx.executeSQL(updateScoreSQL, updateScoreItem, false);
				}
				if(toBeAdded.length > 0){
					for(const topic of toBeAdded){
						let existCheckSQL = "SELECT COUNT(*) as COUNT FROM `topics` WHERE `NAME` LIKE ?";
						let existCheckItem = [topic];
						let isTopicExists = await ndx.isRecordExists(existCheckSQL, existCheckItem, false);
						if(isTopicExists){
							let updateScoreSQL = "UPDATE `topics` SET `NAME` = ?, `SCORE` = `SCORE` + 1 WHERE LOWER(`NAME`) LIKE ? AND PROP_ID = ?";
							let updateScoreItem = [topic, topic.toLowerCase(), propertyId];
							await ndx.executeSQL(updateScoreSQL, updateScoreItem, false);
						} else {
							let insertScoreSQL = "UPDATE `topics` SET `NAME` = ?, `SCORE` = `SCORE` + 1 WHERE LOWER(`NAME`) LIKE ? AND PROP_ID = ?";
							let insertScoreItem = [topic, topic.toLowerCase(), propertyId];
							await ndx.executeSQL(insertScoreSQL, insertScoreItem, false);
						}
						// Create mappings articleId with each toBeAdded
						let scoreMapSQL = "INSERT IGNORE INTO `topics_articles` (`TOPIC_NAME`, `ARTICLE_ID`) VALUES (?,?)";
						let scoreMapItem = [topic, articleId];
						await ndx.executeSQL(scoreMapSQL, scoreMapItem, false);
					}
				}
			}
		});
	},
	uploadToServer : function(propertyId, imageUrl, fileName){
		return new Promise(function (resolve, reject){
			axios.post(constants.IMAGE_SERVICE, {'clientId' : constants.CLIENT, 'propertyId' : propertyId, 'imageUrl' : imageUrl, 'fileName' : fileName}).then(res => {
				resolve(res.data.status);
			}).catch(error => {
			    resolve(false);
			});
		});
	},
	updateSectionThumbnail : function (propertyId, sectionId){
		let updateStatus = 0;
		let articleId = "";
		let imageId = "X";
		let articleSQL = "SELECT `sections`.`ID`, `article_section_map`.*, `articles`.ID AS ARTICLE_ID FROM `sections` JOIN `article_section_map` ON `sections`.`ID` = `article_section_map`.`SECTION_ID` JOIN `articles` ON `article_section_map`.`ARTICLE_ID` = `articles`.`ID` WHERE `sections`.`ID` = '" + sectionId + "' AND `articles`.`PROP_ID` = '" + propertyId + "' ORDER BY `articles`.`CREATED_DATE` DESC LIMIT 1";
		clientDB.query(articleSQL, function(err, articleResult){
			if(!err && (articleResult.length > 0)){
				articleId = articleResult[0]['ARTICLE_ID'];
				let imageSQL = "SELECT `IMAGE_ID` FROM `article_images_map` WHERE `ARTICLE_ID` = '" + articleId + "' AND `PROP_ID` = " + propertyId;
				clientDB.query(imageSQL, async function(err, imageResult){
					if(!err && (imageResult.length > 0)){
						imageId = imageResult[0]['IMAGE_ID'];
						let imageMapSQL = "UPDATE `sections` SET `SECTION_THUMBNAIL` = ?, `TIMESTAMP` = ? WHERE `ID` = ? AND `PROP_ID` = ?";
						let timestamp = new Date().getTime();
						let imageMapItem = [imageId, timestamp, sectionId, propertyId];
						updateStatus = await ndx.executeSQL(imageMapSQL, imageMapItem, false);
					}
				});
			}
		});
	},
	getPropertyKey : function (propertyId){
		return new Promise(function (resolve, reject){
			let propertyKey = "";
			let propSQL = "SELECT * FROM `properties` WHERE `CLIENT_ID` = '" + constants.CLIENT + "' AND `PROPERTY_ID` = " + propertyId;
			masterDB.query(propSQL, function(err, result){
				if((!err) && (result.length > 0)){
					propertyKey = result[0]['PROP_KEY'];
				}
				resolve(propertyKey);
			});
		});
	},
	getSectionMappings : function (sectionId){
		return new Promise(function (resolve, reject){
			let secMappings = "";
			let secMapSQL = "SELECT * FROM section_feed_map WHERE SECTION_ID = " + sectionId;
			clientDB.query(secMapSQL, function (err, result){
				if((!err) && (result.length > 0)){
					secMappings = result[0]['CONFIG_JSON'];
				}
				resolve(secMappings);
			});
		});
	},
	isNDX_CDN : function(propertyId){
		return new Promise(function (resolve, reject){
			let isNDX = true;
			let isNDXSQL = "SELECT CONFIG_VALUE FROM `configurations` WHERE `CONFIG_KEY` LIKE 'CDN_TYPE' AND `PROP_ID` = " + propertyId;
			clientDB.query(isNDXSQL, function (err, result){
				if((!err) && (result.length > 0)){
					isNDX = result[0]['CONFIG_VALUE'];
					isNDX = JSON.parse(isNDX);
					isNDX = isNDX['IS_NDX'];
				}
				resolve(isNDX);
			});
		});
	},
	parse: function (req, res) {
		let cronTimeInMins = req.query.cronTime;
		let sectionsSQL = "SELECT * FROM `sections` WHERE `CRON_TIME_IN_MINS` = '" + cronTimeInMins + "' AND `SECTION_TYPE` LIKE 'GENERAL' AND `STATUS` = '1' AND `PROP_ID` IN (SELECT ID FROM `properties` WHERE `STATUS` = '1')";
		clientDB.query(sectionsSQL, async function (err, sections, fields){
			if(!err && sections.length > 0){
				try{
					for(const section of sections){
						let sectionId = section.ID;
						let propertyId = section.PROP_ID;
						let feedUrl = section.SECTION_FEED;
						let propertyKey = await ndx.getPropertyKey(propertyId);
						let sectionMappings = await ndx.getSectionMappings(sectionId);
						if(ndx.isValidJSON(sectionMappings)){
							sectionMappings = JSON.parse(sectionMappings);
							let idCol = sectionMappings.id;
							let titleCol = sectionMappings.title;
							let leadTextCol = sectionMappings.leadText;
							let descCol = sectionMappings.description;
							let linkCol = sectionMappings.link;
							let categoryCol = sectionMappings.category;
							let authorCol = sectionMappings.authors;
							let pubDateCol = sectionMappings.publishedDate;
							let createdDateCol = sectionMappings.createdDate;
							let locationCol = sectionMappings.location;
							let isVideoSection = sectionMappings.isVideoSection;
							let isAudioSection = sectionMappings.isAudioSection;
							let isPhotoSection = sectionMappings.isPhotoSection;
							let pushNotifyCol = sectionMappings.pushNotify;
							let topicsCol = sectionMappings.topics;
							// RSS Feed Parser
							let parser = new Parser({
								customFields: {
									item: [['description', 'description'],['location', 'location'],['pushnotify', 'pushnotify'],['topics', 'topics']]
								}
							});
							let feed = await parser.parseURL(feedUrl);
							for(const item of feed.items){
								let id = ndx.isNull(item[idCol]) ? "" : item[idCol];
								let title = ndx.isNull(item[titleCol]) ? "" : item[titleCol];
								let leadText = ndx.isNull(item[leadTextCol]) ? "" : item[leadTextCol];
								let description = ndx.isNull(item[descCol]) ? "" : item[descCol];
								let link = ndx.isNull(item[linkCol]) ? "" : item[linkCol];
								let categories = ndx.isNull(item[categoryCol]) ? "" : item[categoryCol];
								let authors = ndx.isNull(item[authorCol]) ? "" : item[authorCol];
								let pubDate = ndx.isNull(item[pubDateCol]) ? "" : item[pubDateCol];
								let createdDate = ndx.isNull(item[createdDateCol]) ? "" : item[createdDateCol];
								let location = ndx.isNull(item[locationCol]) ? "" : item[locationCol];
								let topics = ndx.isNull(item[topicsCol]) ? "" : item[topicsCol];
								let pushNotify = ndx.isNull(item[pushNotifyCol]) ? "" : item[pushNotifyCol];
								let articleType = "ARTICLE";
								// Video Section
								let videoUrl = "";
								if(isVideoSection == "TRUE"){
									articleType = "VIDEO";
									let videoUrlCol = sectionMappings.videoUrl;
									videoUrl = ndx.isNull(item[videoUrlCol]) ? "" : item[videoUrlCol];
									description += "<p><img src='https://img.youtube.com/vi/" + videoUrl + "/0.jpg'></p>";
								}
								// Audio Section
								let audioUrl = "";
								if(isAudioSection == "TRUE"){
									articleType = "AUDIO";
									let audioUrlCol = sectionMappings.audioUrl;
									audioUrl = ndx.isNull(item[audioUrlCol]) ? "" : item[audioUrlCol];
								}
								// Photo Section
								if(isPhotoSection == "TRUE"){
									articleType = "PHOTO";
								}
								// Format and Convert Timezones for the Dates
								if(pubDate != ""){
									pubDate = new Date(pubDate).toISOString().replace(/T/, ' ').replace(/\..+/, '');
								}
								if(createdDate != ""){
									createdDate = new Date(createdDate).toISOString().replace(/T/, ' ').replace(/\..+/, '');
								}
								let existCheckSQL = "SELECT count(*) as COUNT FROM `articles` WHERE `ID` = ? AND `PROP_ID` = ?";
								let existCheckItem = [id, propertyId];
								let isRecExist = await ndx.isRecordExists(existCheckSQL, existCheckItem, false);
								let sanitizedDesc = await ndx.sanitize(description);
								let articleStatus = 0;
								if(isRecExist){
									let updateSQL = "UPDATE `articles` SET `TITLE` = ?, `LEAD_TEXT` = ?, `DESCRIPTION` = ?, `LINK` = ?, `TYPE` = ?, `CATEGORY` = ?, `AUTHOR` = ?, `AUDIO_URL` = ?, `VIDEO_URL` = ? , `PUBLISH_DATE` = ?, `CREATED_DATE` = ?, `LOCATION` = ? WHERE `ID` = ? AND `PROP_ID` = ?";
									let updateItem = [title, leadText, sanitizedDesc, link, articleType, categories, authors, audioUrl, videoUrl, pubDate, createdDate, location, id, propertyId];
									articleStatus = await ndx.executeSQL(updateSQL, updateItem, false);
								} else {
									let insertSQL = "INSERT IGNORE INTO `articles` (`ID`,`PROP_ID`,`PROP_KEY`,`TITLE`,`LEAD_TEXT`,`DESCRIPTION`,`LINK`,`TYPE`,`CATEGORY`,`AUTHOR`,`AUDIO_URL`,`VIDEO_URL`,`PUBLISH_DATE`,`CREATED_DATE`,`LOCATION`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
									let insertItem = [id, propertyId, propertyKey, title, leadText, sanitizedDesc, link, articleType, categories, authors, audioUrl, videoUrl, pubDate, createdDate, location];
									articleStatus = await ndx.insertRecord(insertSQL, insertItem, false);
								}
								if(articleStatus > 0){
									// Remove Old Image Mappings
									let remImageMapSQL = "DELETE FROM `article_images_map` WHERE `ARTICLE_ID` LIKE ? AND `PROP_ID` = ?";
									let remImageMapItem = [id, propertyId];
									await ndx.executeSQL(remImageMapSQL, remImageMapItem, false);
									// Update New Image Mappings
									let arrMedia = await ndx.getImagesAndCaptions(description);
									let isNDX = await ndx.isNDX_CDN(propertyId);
									for(const [index, media] of arrMedia.entries()){
										if(!ndx.isNull(media['IMAGE']) || media['IMAGE'] != ""){
											let fileName = media['IMAGE'];
											let uploadStatus = false;
											if(isNDX){
												fileName = id + "_" + index;
												uploadStatus = await ndx.uploadToServer(propertyId, media['IMAGE'], fileName);
											} else {
												uploadStatus = true;
											}
											if(uploadStatus){
												let newImageMapSQL = "INSERT IGNORE INTO `article_images_map` (`PROP_ID`, `ARTICLE_ID`, `IMAGE_ID`, `CAPTION`) VALUES (?, ?, ?, ?)";
												let newImageMapItem = [propertyId, id, fileName, media['CAPTION']];
												await ndx.executeSQL(newImageMapSQL, newImageMapItem, false);
											}
										}
									}
									// Remove Old Section Mappings
									let remSecMapSQL = "DELETE FROM `article_section_map` WHERE `ARTICLE_ID` = ?";
									let remSecMapItem = [id];
									await ndx.executeSQL(remSecMapSQL, remSecMapItem, false);
									// Update New Section Mappings
									let newSecMapSQL = "INSERT IGNORE INTO `article_section_map` (`SECTION_ID`,`ARTICLE_ID`) VALUES (?, ?)";
									let newSecMapItem = [sectionId, id];
									await ndx.executeSQL(newSecMapSQL, newSecMapItem, false);
									// Update Section Thumbnail
									ndx.updateSectionThumbnail(propertyId, sectionId);
								}
								// Add to Push Notification Queue
								if(pushNotify == true || pushNotify == "true" || pushNotify == "TRUE"){
									let isInQueueSQL = "SELECT count(*) as COUNT FROM `notification_queue` WHERE `CLIENT_ID` = ? AND `PROP_ID` = ? AND `ARTICLE_ID` = ?";
									let isInQueueItem = [constants.CLIENT, propertyId, id];
									let isInQueue = await ndx.isRecordExists(isInQueueSQL, isInQueueItem, true);
									if(!isInQueue){
										let addToQueueSQL = "INSERT IGNORE INTO `notification_queue` (`CLIENT_ID`, `PROP_ID`, `ARTICLE_ID`) VALUES (?, ?, ?)";
										let addToQueueItem = [constants.CLIENT, propertyId, id];
										ndx.insertRecord(addToQueueSQL, addToQueueItem, true);
									}
								}
								// Update Topics
								let arrTopics = topics.split(',');
								if((propertyId != "") && (id!= "") && (arrTopics.length > 0)){
									ndx.updateTopics(propertyId, id, arrTopics);
								}
								response.data.push({'Parsing' : 'Article => ' + id + ' : Success'});
							}
						} else {
							console.log("Invalid Mappings => Section : " + sectionId);
						}
					}
					// Response
					response.status = response.data.length > 0 ? true : false;
					response.message = response.status ? "Success" : "Failed";
					// Response to Client
					res.setHeader('Content-Type', 'application/json');
					res.send(response);
				} catch(e){
					console.log(e);
				}
			}
		});
	}
}
module.exports = ndx;