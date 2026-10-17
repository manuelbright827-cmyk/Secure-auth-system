const vercelHandler = require('../../backends/vercel-handler');

module.exports = function pharmacyHandler(req, res) {
    if (!req.url.startsWith('/api/pharmacy')) {
        req.url = `/api/pharmacy${req.url.startsWith('/') ? '' : '/'}${req.url}`;
    }
    return vercelHandler(req, res);
};
