var applications = require('./applications');
var services = require('./services');

exports.attachTo = function (shareapi, model) {
	shareapi.post('/loglevel',
		function (req, res, next) {
			var level = req.params.level;
			model.log.debug('Setting loglevel to %s', level);
			model.log.level(level);
			res.send();
			return (next());
		});

	shareapi.get('/loglevel',
		function (req, res, next) {
			res.send({ level: model.log.level() });
			return (next());
		});

	applications.attachTo(shareapi, model);
	services.attachTo(shareapi, model);
};
