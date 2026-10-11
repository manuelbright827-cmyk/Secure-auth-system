const roleLevels = {
    inputer: 1,
    manager: 2,
    admin: 3,
    administrator: 4
};

function authorize(minimumRole) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        const userLevel = roleLevels[req.session.user.role];
        const requiredLevel = roleLevels[minimumRole];

        if (!userLevel || userLevel < requiredLevel) {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        next();
    };
}

module.exports = {
    authorize
};