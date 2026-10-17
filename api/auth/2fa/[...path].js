const vercelHandler = require('../../../backends/vercel-handler');

module.exports = function twoFactorHandler(req, res) {
	if (!req.url.startsWith('/api/auth/2fa')) {
		req.url = `/api/auth/2fa${req.url.startsWith('/') ? '' : '/'}${req.url}`;
	}
	return vercelHandler(req, res);
};