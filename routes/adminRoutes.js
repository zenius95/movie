const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middlewares/auth');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.use(auth.isLoggedIn);

router.get('/', adminController.showDashboard);

// Movie Routes
router.get('/movies', adminController.showMovies);
router.post('/movies/bulk-delete', adminController.bulkDeleteMovies); // ROUTE MỚI
router.get('/movies/edit/:id', adminController.showEditMovieForm);
router.post('/movies/edit/:id', adminController.updateMovie);
router.post('/movies/delete/:id', adminController.deleteMovie);
router.post('/movies/edit/:id/upload-image', upload.single('imageFile'), adminController.uploadImage);

// THÊM ROUTE MỚI ĐỂ LẤY NỘI DUNG AI
router.get('/movies/get-ai-content/:id', adminController.getAiContent);
// ROUTE CẬP NHẬT NỘI DUNG AI
router.post('/movies/update-ai-content/:id', adminController.updateAiContent);

// Episode Routes
router.post('/episodes', adminController.createEpisode);
router.post('/episodes/delete/:id', adminController.deleteEpisode);

// Category Routes
router.get('/categories', adminController.showCategories);
router.post('/categories', adminController.createCategory);
router.post('/categories/edit/:id', adminController.updateCategory);
router.post('/categories/delete/:id', adminController.deleteCategory);

// Country Routes
router.get('/countries', adminController.showCountries);
router.post('/countries', adminController.createCountry);
router.post('/countries/edit/:id', adminController.updateCountry);
router.post('/countries/delete/:id', adminController.deleteCountry);

// Year Routes
router.get('/years', adminController.showYears);
router.post('/years', adminController.createYear);
router.post('/years/delete/:year', adminController.deleteYear);

// User Routes
router.get('/users', auth.isAdmin, adminController.showUsers);
router.post('/users', auth.isAdmin, adminController.createUser);
router.post('/users/edit/:id', auth.isAdmin, adminController.updateUser);
router.post('/users/delete/:id', auth.isAdmin, adminController.deleteUser);

router.get('/sync', adminController.showSyncPage);
router.get('/ai-content', adminController.showAiContentPage);

module.exports = router;