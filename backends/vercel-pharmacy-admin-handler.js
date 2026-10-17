const vercelHandler = require('./vercel-handler');

module.exports = function pharmacyAdminHandler(req, res, endpoint) {
    const requestPath = typeof endpoint === 'function' ? endpoint(req) : endpoint;
    req.url = `/api/pharmacy/admin/${requestPath}`;
    return vercelHandler(req, res);
};
