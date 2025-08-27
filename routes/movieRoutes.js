const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');

router.get('/', movieController.getHomePage);
router.get('/phim/:slug', movieController.getMovieDetail);

module.exports = router;