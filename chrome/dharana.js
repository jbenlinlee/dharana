Dharana = {
	EXTENSIONID: 'dharana_chrome',
	LOGNAME: 'dharana-unknown',

	MSG_QT_TOGGLE: 'dharana.quicktime.toggle',
	MSG_QT_LASTTASK: 'dharana.quicktime.last_active_task',
	MSG_QT_TASKS: 'dharana.quicktime.tasks',

	ERR_NOTASK: 'dharana.quicktime.notask',
	
	dlog: function(str) {
		self = Dharana
		console.log('[' + self.LOGNAME + '] ' + str)
	}
}
