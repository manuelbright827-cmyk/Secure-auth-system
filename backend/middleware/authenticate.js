function authenticate(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    next();
}

module.exports = authenticate;