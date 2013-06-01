/*
States
STARTING -> NOT_ASANA
         -> READY -> FETCHING -> AVAILABLE
*/

var asanaTaskPattern = /^https:\/\/app\.asana\.com\/0\/([0-9]+)\/([0-9]+)$/
var dharanaStartPattern = /\[dharana (start|end) (\d+)\]$/
var dailyTimes = {}
var activeTasks = {}
var numActiveTasks = 0
var lastStartedTask = {id:null, title:""}

var currentUser = null

function getTask(taskid, stories, callback) {
	Dharana.dlog("Fetching data for task ID " + taskid)
	// Get main task data
	$.getJSON('https://app.asana.com/api/1.0/tasks/' + taskid, function(data) {
		var task = {id:data.data.id, name:data.data.name, completed:data.data.completed, completed_at:data.data.completed_at}
		task.starts = {}

		if (!stories) {
			callback(task)
			return
		}

		Dharana.dlog("Fetching stories for task ID " + taskid)
		// Get task stories
		$.getJSON('https://app.asana.com/api/1.0/tasks/' + taskid + '/stories', function(data) {
			var lastTxId = -1

			$.each(data.data, function(idx,story) {
				if (story.created_by.id == currentUser.id) {
					var matches = dharanaStartPattern.exec(story.text)
					if (matches && matches.length == 3) {
						var evt = matches[1]
						var evtTime = (new Date(story.created_at)).getTime()
						var txId = matches[2]
					
						if (task.starts[txId] != undefined) {
							task.starts[txId][evt] = evtTime
						} else {
							var newObj = {}
							newObj[evt] = evtTime
							task.starts[txId] = newObj
						}

						lastTxId = (txId > lastTxId ? txId : lastTxId)
					}
				}
			})

			task.lastTxId = lastTxId

			// If task is completed, automatically "close" last transaction
			if (task.completed && task.starts[lastTxId].end == undefined) {
				task.starts[lastTxId].end = task.completed_at
			}

			callback(task)
		})
	})
}

function addStory(taskid, storyText, callback) {
	$.post('https://app.asana.com/api/1.0/tasks/' + taskid + '/stories',
		{"text":storyText},
		function(data, status, xhr) {
			callback(data)
		},
		"json")
}

function startAsanaTask(task, callback) {
	var txid = (new Date()).getTime()
	addStory(task.id, "Started work [dharana start " + txid + "]", function(asanaResp) {
		Dharana.dlog("Task start logged with txid " + txid)
		task.lastTxId = txid
		task.starts[txid] = {start:(new Date(asanaResp.data.created_at)).getTime()}

		callback(task)
	})
}

function logDateStr(date) {
	return (date.getFullYear() * 10000) + (date.getMonth() * 100) + (date.getDate())
}

function timeFragmentInfo(callback) {
	var fragments = []
	var today = new Date()
	var midnightMillis = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0)
	var now = Date.now()

	$.each(activeTasks, function(tid, task) {
		$.each(task.starts, function(txid, timeBlock) {
			var physicalEnd = timeBlock.end || now
			if (physicalEnd > midnightMillis) {
				var startTime = timeBlock.start >= midnightMillis ? timeBlock.start : midnightMillis
				var fragmentIdx = -1
				for (var idx = 0; idx < fragments.length && fragmentIdx < 0; ++idx) {
					fragment = fragments[idx]

					// Extend the fragment start if
					// 1. block starts before fragment start
					// 2. block is open ended or block ends at or after fragment start
					if (timeBlock.start < fragment.start && physicalEnd >= fragment.start) {
						fragment.start = timeBlock.start
						fragmentIdx = idx
					}

					// Extend the fragment end if
					// 1. block starts before or at fragment end
					// 2. block is open ended or block ends after fragment end
					if (timeBlock.start <= fragment.end && physicalEnd > fragment.end) {
						fragment.end = timeBlock.end
						fragmentIdx = idx
					}

					// Update fragments if we expanded the fragment
					if (fragmentIdx >= 0) {
						fragment.tasks[tid] = true
						fragments[idx] = fragment
					}
				}

				if (fragmentIdx < 0) {
					var newFragment = {start:timeBlock.start, end:physicalEnd, tasks:{}}
					newFragment.tasks[tid] = true
					fragments.push(newFragment)
				}
			}
		})
	})

	var firstStart = Number.MAX_VALUE
	var lastEnd = 0
	var activeTime = 0
	$.each(fragments, function(idx, fragment) {
		firstStart = fragment.start < firstStart ? fragment.start : firstStart
		lastEnd = fragment.end > lastEnd ? fragment.end : lastEnd
		activeTime += (fragment.end || now) - fragment.start
		Dharana.dlog('Adding fragment ' + JSON.stringify(fragment) + ' activeTime now ' + activeTime)
	})
	
	var totalTime = now - firstStart
	var loggedTime = lastEnd - firstStart
	callback({start:firstStart, end:lastEnd, total:totalTime, logged:loggedTime, active:activeTime, data:fragments})
}

function pauseAsanaTask(task, txid, callback) {
	addStory(task.id, "Paused work [dharana end " + txid + "]", function(asanaResp) {
		Dharana.dlog("Task pause logged")
		task.starts[txid].end = (new Date(asanaResp.data.created_at)).getTime()

		callback(task)
	})
}

function timeSpent(task) {
	var time = 0;
	$.each(task.starts, function(idx, start) {
		if (start.start != undefined && start.end != undefined) {
			time += (start.end - start.start)
		}
	})

	return time;
}

function updateBadge() {
	var numActive = 0
	var numOnHold = 0
	$.each(activeTasks, function(tid, dharanaTask) {
		if (!dharanaTask.completed) {
			// If last start was not completed then active, otherwise on hold
			if (dharanaTask.starts[dharanaTask.lastTxId].end == undefined) {
				++numActive
			} else {
				++numOnHold
			}
		}
	})

	var badgeColor = "#2ECC71" // Badge default to green
	if (numActive == 0) {
		badgeColor = "#D35400" // if no active tasks, badge goes pumpkin
	}

	chrome.browserAction.setBadgeBackgroundColor({color:badgeColor})
	chrome.browserAction.setBadgeText({text:numActive + numOnHold + ''})
}

function addActiveTask(task) {
	if (activeTasks[task.id] == undefined) {
		activeTasks[task.id] = task
		++numActiveTasks
		updateBadge()
	}
}

function removeActiveTask(asanaTask) {
	if (activeTasks[task.id] != undefined) {
		// delete activeTasks[task.id]
		if (!activeTasks[task.id].completed) {
			activeTasks[task.id].completed = task.completed
			activeTasks[task.id].completed_at = task.completed_at
			updateBadge()
		}
	}
}

function toggleTask(taskurl, callback) {
	var taskUrlComponents = asanaTaskPattern.exec(taskurl)
	if (taskUrlComponents && taskUrlComponents.length == 3 && taskUrlComponents[1] != taskUrlComponents[2]) {
		var taskid = taskUrlComponents[2]
		Dharana.dlog('Toggling task ' + taskid + ' for url ' + taskurl)

		// Check our task cache first
		// If task is not in cache, then refetch it and try again
		// (via recursive call)

		if (activeTasks[taskid] != undefined) {
			activeTasks[taskid].lastUrl = taskurl
			var task = activeTasks[taskid]
			Dharana.dlog('Got task ' + JSON.stringify(task))

			if ($.isEmptyObject(task.starts) || task.starts[task.lastTxId].end != undefined) {
				// No starts or last start closed

				Dharana.dlog('Starting task')
				startAsanaTask(task, function(updatedTask) {
					lastStartedTask.id = task.id
					lastStartedTask.title = task.name
					Dharana.dlog('lastStartedTask is now ' + JSON.stringify(lastStartedTask))
					updateBadge()

					var time = timeSpent(updatedTask)
					callback({id: updatedTask.id, action: "started", time:time})
				})
			} else {
				// Have starts and last start open, so need to pause

				Dharana.dlog('Pausing task with txid ' + task.lastTxId)
				pauseAsanaTask(task, task.lastTxId, function(updatedTask) {
					lastStartedTask.id = null
					lastStartedTask.title = ""
					Dharana.dlog('lastStartedTask is now ' + JSON.stringify(lastStartedTask))
					updateBadge()

					var pausedStart = task.starts[task.lastTxId]
					callback({id: updatedTask.id, action: "paused", time:(pausedStart.end - pausedStart.start)})
				})
			}

		} else {
			Dharana.dlog('Fetching task data')
			getTask(taskid, true, function(task) {
				task.lastUrl = taskurl
				addActiveTask(task)
				toggleTask(taskurl, callback)
			})
		}
	}
}

function popupTaskRecord(task) {
	return {id:task.id, name:task.name, link:task.lastUrl}
}

function tasks(callback) {
	var taskList = {activeTasks:[], startedTasks:[]}
	$.each(activeTasks, function(tid, task) {
		if (!task.completed) {
			if (task.starts[task.lastTxId].end == undefined) {
				// Task is active
				taskList.activeTasks.push(popupTaskRecord(task))
			} else {
				// Task is started, but not active
				taskList.startedTasks.push(popupTaskRecord(task))
			}
		}
	})

	callback(taskList)
}

Dharana.LOGNAME = 'dharana-bg'

// Set badge background color

// Fetch user data and start listening for
// messages from the browser UI components

Dharana.dlog("Fetching user data")
$.getJSON('https://app.asana.com/api/1.0/users/me', function(data) {
	currentUser = data.data
	Dharana.dlog("Current user is " + JSON.stringify(currentUser))

	chrome.runtime.onMessage.addListener(function(msg, sender, resp) {
		Dharana.dlog("Got a message: " + JSON.stringify(msg || '{msg:"none"}'))
		switch(msg.msg) {
			case Dharana.MSG_QT_TOGGLE:
				toggleTask(msg.data, resp)
				return true
			case Dharana.MSG_QT_LASTTASK:
				Dharana.dlog(JSON.stringify(lastStartedTask))
				resp(lastStartedTask)
				return false
			case Dharana.MSG_QT_TASKS:
				tasks(resp)
				return true
			case Dharana.MSG_QT_FRAGMENTATION:
				timeFragmentInfo(resp)
				return true
		}
	})
})

// Setup timer to check status of active tasks
var checkDoneTimer = setInterval(function() {
		$.each(activeTasks, function(tid, task) {
			if (!task.completed) {
				getTask(tid, false, function(retrievedTask) {
					if (retrievedTask.completed) {
						var lastTxId = task.lastTxId
						if (task.starts[lastTxId].end == undefined) {
							pauseAsanaTask(task, lastTxId, function() {
								Dharana.dlog('Tx ' + lastTxId + ' on task ' + tid + ' automatically paused due to completion.')
								removeActiveTask(retrievedTask)
							})
						} else {
							Dharana.dlog('Task ' + tid + ' is complete. Removing from active tasks.')
							removeActiveTask(retrievedTask)
						}
					}
				})
			}
		})
	}, 15000)
