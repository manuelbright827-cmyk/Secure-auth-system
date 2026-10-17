const vercelHandler = require('../../../backends/vercel-handler');

module.exports = function adminHandler(req, res) {
	if (!req.url.startsWith('/api/auth/admin')) {
		req.url = `/api/auth/admin${req.url.startsWith('/') ? '' : '/'}${req.url}`;
	}
	return vercelHandler(req, res);
};