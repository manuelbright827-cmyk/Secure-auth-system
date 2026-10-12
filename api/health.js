const vercelHandler = require('../backends/vercel-handler');

module.exports = function healthHandler(req, res) {
    req.url = '/api/health';
    return vercelHandler(req, res);
};
