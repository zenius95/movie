// Middleware kiểm tra đã đăng nhập
exports.isLoggedIn = (req, res, next) => {
    if (req.session && req.session.user) {
        res.locals.user = req.session.user; // Giúp view có thể truy cập thông tin user
        return next();
    }
    res.redirect('/login');
};

// Middleware kiểm tra có phải là Admin
exports.isAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).render('pages/error', { title: 'Lỗi', message: 'Bạn không có quyền truy cập chức năng này.' });
};