const { User } = require('../models');

exports.showLoginPage = (req, res) => {
    // Thêm layout: false để trang này không sử dụng layout nào
    res.render('pages/login', { title: 'Đăng nhập', error: null, layout: false });
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ where: { username } });

        if (!user || !user.validPassword(password)) {
            // Thêm layout: false
            return res.render('pages/login', { title: 'Đăng nhập', error: 'Tên đăng nhập hoặc mật khẩu không đúng.', layout: false });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        res.redirect('/admin');
    } catch (error) {
        console.error(error);
         // Thêm layout: false
        res.render('pages/login', { title: 'Đăng nhập', error: 'Đã có lỗi xảy ra.', layout: false });
    }
};

exports.logout = (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/admin');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
};