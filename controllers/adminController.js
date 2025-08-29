const { Movie, Category, Country, User, Year, Episode, sequelize } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Trang Dashboard (giữ nguyên)
exports.showDashboard = async (req, res) => {
    try {
        const movieCount = await Movie.count();
        const categoryCount = await Category.count();
        const countryCount = await Country.count();
        const userCount = await User.count();
        const latestMovies = await Movie.findAll({ limit: 5, order: [['created_at', 'DESC']] });
        
        res.render('pages/admin/dashboard', {
            title: 'Tổng quan',
            layout: 'layouts/admin',
            movieCount, categoryCount, countryCount, userCount, latestMovies
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

// ===============================================
// QUẢN LÝ PHIM
// ===============================================
exports.showMovies = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const searchQuery = req.query.search || '';
        const where = searchQuery ? { name: { [Op.like]: `%${searchQuery}%` } } : {};

        const { count, rows: movies } = await Movie.findAndCountAll({
            where, limit, offset, order: [['modified_at', 'DESC']]
        });

        res.render('pages/admin/movies', {
            title: 'Quản lý Phim',
            layout: 'layouts/admin',
            movies,
            currentPage: page,
            totalPages: Math.ceil(count / limit),
            searchQuery
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

// Hiển thị form sửa phim
exports.showEditMovieForm = async (req, res) => {
    try {
        const movie = await Movie.findByPk(req.params.id, {
            include: [
                { model: Category }, 
                { model: Country }, 
                { model: Episode, order: [['name', 'ASC']] },
            ]
        });
        if (!movie) return res.status(404).send('Không tìm thấy phim');

        const allCategories = await Category.findAll({ order: [['name', 'ASC']] });
        const allCountries = await Country.findAll({ order: [['name', 'ASC']] });
        const allYears = await Year.findAll({ order: [['year', 'DESC']] });

        res.render('pages/admin/edit_movie', {
            title: `Sửa phim: ${movie.name}`,
            layout: 'layouts/admin',
            movie,
            allCategories,
            allCountries,
            allYears
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

// Cập nhật thông tin phim
exports.updateMovie = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const movie = await Movie.findByPk(req.params.id);
        if (!movie) return res.status(404).send('Không tìm thấy phim');

        await movie.update(req.body, { transaction: t });

        if (req.body.categories) {
            await movie.setCategories(req.body.categories, { transaction: t });
        }
        if (req.body.countries) {
            await movie.setCountries(req.body.countries, { transaction: t });
        }

        await t.commit();
        res.redirect(`/admin/movies/edit/${req.params.id}`);
    } catch (error) {
        await t.rollback();
        console.error(error);
        res.status(500).send('Lỗi khi cập nhật phim');
    }
};

// Xóa phim
exports.deleteMovie = async (req, res) => {
    try {
        await Movie.destroy({ where: { _id: req.params.id } });
        res.redirect('/admin/movies');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi xóa phim');
    }
};

// Upload ảnh (chỉ còn dùng cho poster và thumbnail)
exports.uploadImage = async (req, res) => {
    try {
        const { id } = req.params;
        const { imageType } = req.body; // 'poster' hoặc 'thumb'
        const movie = await Movie.findByPk(id);

        if (!req.file) {
            return res.status(400).send('Không có tệp nào được tải lên.');
        }

        const tempPath = req.file.path;
        const movieImageDir = path.join(__dirname, `../public/images/${movie.slug}`);
        if (!fs.existsSync(movieImageDir)) {
            fs.mkdirSync(movieImageDir, { recursive: true });
        }

        const fileName = `${imageType}-${Date.now()}${path.extname(req.file.originalname)}`;
        const destPath = path.join(movieImageDir, fileName);
        const localPath = `/images/${movie.slug}/${fileName}`;

        fs.renameSync(tempPath, destPath);

        if (imageType === 'poster') {
            if (movie.poster_url && fs.existsSync(path.join(__dirname, `../public${movie.poster_url}`))) {
                fs.unlinkSync(path.join(__dirname, `../public${movie.poster_url}`));
            }
            await movie.update({ poster_url: localPath });
        } else if (imageType === 'thumb') {
            if (movie.thumb_url && fs.existsSync(path.join(__dirname, `../public${movie.thumb_url}`))) {
                fs.unlinkSync(path.join(__dirname, `../public${movie.thumb_url}`));
            }
            await movie.update({ thumb_url: localPath });
        }

        res.redirect(`/admin/movies/edit/${id}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi tải ảnh lên.');
    }
};

// ===============================================
// QUẢN LÝ TẬP PHIM
// ===============================================
exports.createEpisode = async (req, res) => {
    try {
        const { movie_id, server_name, name, slug, link_embed, link_m3u8 } = req.body;
        await Episode.create({ movie_id, server_name, name, slug, link_embed, link_m3u8 });
        res.redirect(`/admin/movies/edit/${movie_id}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi thêm tập phim.');
    }
};

exports.deleteEpisode = async (req, res) => {
    try {
        const episode = await Episode.findByPk(req.params.id);
        const movieId = episode.movie_id;
        await episode.destroy();
        res.redirect(`/admin/movies/edit/${movieId}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi xóa tập phim.');
    }
};


// ===============================================
// QUẢN LÝ THỂ LOẠI
// ===============================================
exports.showCategories = async (req, res) => {
    try {
        const categories = await Category.findAll({ order: [['name', 'ASC']] });
        res.render('pages/admin/categories', {
            title: 'Quản lý Thể loại',
            layout: 'layouts/admin',
            categories
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { id, name, slug } = req.body;
        await Category.create({ id, name, slug });
        res.redirect('/admin/categories');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi tạo thể loại.');
    }
};

exports.updateCategory = async (req, res) => {
    try {
        await Category.update(req.body, { where: { id: req.params.id } });
        res.redirect('/admin/categories');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi cập nhật thể loại.');
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        await Category.destroy({ where: { id: req.params.id } });
        res.redirect('/admin/categories');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi xóa thể loại.');
    }
};

// ===============================================
// QUẢN LÝ QUỐC GIA
// ===============================================
exports.showCountries = async (req, res) => {
    try {
        const countries = await Country.findAll({ order: [['name', 'ASC']] });
        res.render('pages/admin/countries', {
            title: 'Quản lý Quốc gia',
            layout: 'layouts/admin',
            countries
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

exports.createCountry = async (req, res) => {
    try {
        const { id, name, slug } = req.body;
        await Country.create({ id, name, slug });
        res.redirect('/admin/countries');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi tạo quốc gia.');
    }
};

exports.updateCountry = async (req, res) => {
    try {
        await Country.update(req.body, { where: { id: req.params.id } });
        res.redirect('/admin/countries');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi cập nhật quốc gia.');
    }
};

exports.deleteCountry = async (req, res) => {
    try {
        await Country.destroy({ where: { id: req.params.id } });
        res.redirect('/admin/countries');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi xóa quốc gia.');
    }
};


// ===============================================
// QUẢN LÝ NĂM PHÁT HÀNH
// ===============================================
exports.showYears = async (req, res) => {
    try {
        const years = await Year.findAll({ order: [['year', 'DESC']] });
        res.render('pages/admin/years', {
            title: 'Quản lý Năm phát hành',
            layout: 'layouts/admin',
            years
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

exports.createYear = async (req, res) => {
    try {
        const { year } = req.body;
        await Year.findOrCreate({ where: { year } });
        res.redirect('/admin/years');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi thêm năm.');
    }
};

exports.deleteYear = async (req, res) => {
    try {
        await Year.destroy({ where: { year: req.params.year } });
        res.redirect('/admin/years');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi xóa năm.');
    }
};


// ===============================================
// QUẢN LÝ USER (NÂNG CẤP)
// ===============================================
exports.showUsers = async (req, res) => {
    try {
        const users = await User.findAll({ order: [['createdAt', 'DESC']] });
        res.render('pages/admin/users', {
            title: 'Quản lý Người dùng',
            layout: 'layouts/admin',
            users
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi server');
    }
};

exports.createUser = async (req, res) => {
    try {
        const { username, email, password, role } = req.body;
        await User.create({ username, email, password, role });
        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi tạo người dùng.');
    }
};

// --- HÀM MỚI: CẬP NHẬT USER ---
exports.updateUser = async (req, res) => {
    try {
        const { username, email, password, role } = req.body;
        const userToUpdate = await User.findByPk(req.params.id);

        if (!userToUpdate) {
            return res.status(404).send('Không tìm thấy người dùng');
        }

        const updateData = { username, email, role };

        // Chỉ cập nhật mật khẩu nếu người dùng nhập mật khẩu mới
        if (password && password.trim() !== '') {
            updateData.password = password;
        }

        await userToUpdate.update(updateData);
        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi cập nhật người dùng.');
    }
};

// --- HÀM MỚI: XÓA USER ---
exports.deleteUser = async (req, res) => {
    try {
        const userIdToDelete = req.params.id;
        // Ngăn không cho admin tự xóa chính mình
        if (req.session.user.id == userIdToDelete) {
            return res.status(400).send('Bạn không thể tự xóa tài khoản của mình.');
        }

        await User.destroy({ where: { id: userIdToDelete } });
        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi khi xóa người dùng.');
    }
};

// ===============================================
// TRANG ĐỒNG BỘ DỮ LIỆU
// ===============================================
exports.showSyncPage = (req, res) => {
    res.render('pages/admin/sync', {
        title: 'Đồng bộ dữ liệu',
        layout: 'layouts/admin'
    });
};