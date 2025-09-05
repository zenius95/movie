// File: controllers/movieController.js
const { Movie, Category, Country, Episode, Person } = require('../models');

// Đảm bảo hàm này được export với từ khóa 'exports'
exports.getHomePage = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        const { count, rows: movies } = await Movie.findAndCountAll({
            order: [['modified_at', 'DESC']],
            limit,
            offset,
        });

        res.render('pages/home', {
            title: 'Danh sách phim',
            movies,
            currentPage: page,
            totalPages: Math.ceil(count / limit)
        });
    } catch (error) {
        console.error("Error getting home page:", error);
        res.status(500).send('Error loading movies');
    }
};

// Đảm bảo hàm này cũng được export chính xác
exports.getMovieDetail = async (req, res) => {
    try {
        const movie = await Movie.findOne({
            where: { slug: req.params.slug },
            include: [
                { model: Category, through: { attributes: [] } },
                { model: Country, through: { attributes: [] } },
                { model: Episode, order: [['name', 'ASC']] },
                { model: Person, through: { attributes: ['character'] } }
            ]
        });

        if (!movie) {
            return res.status(404).send('Movie not found');
        }

        // Không cần phân tích JSON nữa vì dữ liệu là HTML
        res.render('pages/movieDetail', {
            title: movie.name,
            movie
        });
    } catch (error) {
        console.error("Error getting movie detail:", error);
        res.status(500).send('Error loading movie detail');
    }
};