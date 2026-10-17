const handler = require('../../../backends/vercel-pharmacy-admin-handler');
module.exports = (req, res) => handler(req, res, 'users');
