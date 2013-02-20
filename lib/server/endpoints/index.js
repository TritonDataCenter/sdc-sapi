var applications = require('./applications');
var configs = require('./configs');
var images = require('./images');
var instances = require('./instances');
var manifests = require('./manifests');
var services = require('./services');

exports.attachTo = function (sapi, model) {
	sapi.post('/loglevel',
		function (req, res, next) {
			var level = req.params.level;
			model.log.debug('Setting loglevel to %s', level);
			model.log.level(level);
			res.send();
			return (next());
		});

	sapi.get('/loglevel',
		function (req, res, next) {
			res.send({ level: model.log.level() });
			return (next());
		});

	applications.attachTo(sapi, model);
	configs.attachTo(sapi, model);
	images.attachTo(sapi, model);
	instances.attachTo(sapi, model);
	manifests.attachTo(sapi, model);
	services.attachTo(sapi, model);
};
