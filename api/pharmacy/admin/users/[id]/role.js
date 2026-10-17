const handler = require('../../../../../backends/vercel-pharmacy-admin-handler');
module.exports = (req, res) => handler(req, res, (request) => `users/${encodeURIComponent(request.query.id)}/role`);
