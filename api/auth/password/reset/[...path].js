const vercelHandler = require('../../../../backends/vercel-handler');

module.exports = function passwordResetHandler(req, res) {
	if (!req.url.startsWith('/api/auth')) {
		req.url = `/api/auth${req.url.startsWith('/') ? '' : '/'}${req.url}`;
	}
	return vercelHandler(req, res);
};
