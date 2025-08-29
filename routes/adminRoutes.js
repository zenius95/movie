const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middlewares/auth');
const multer = require('multer'); // <-- THÊM DÒNG NÀY
// Cấu hình Multer để lưu file tải lên vào thư mục 'uploads'
const upload = multer({ dest: 'uploads/' });

router.use(auth.isLoggedIn);

router.get('/', adminController.showDashboard);

// Movie Routes
router.get('/movies', adminController.showMovies);
router.get('/movies/edit/:id', adminController.showEditMovieForm);
router.post('/movies/edit/:id', adminController.updateMovie);
router.post('/movies/delete/:id', adminController.deleteMovie);

// === THÊM ROUTES MỚI CHO ẢNH ===
// Route để xử lý việc tải lên ảnh (poster, thumb, backdrop)
router.post('/movies/edit/:id/upload-image', upload.single('imageFile'), adminController.uploadImage);

// Route để xóa một ảnh trong thư viện (backdrop)
router.post('/images/delete/:id', adminController.deleteImage);
// === KẾT THÚC THÊM ROUTES MỚI ===

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

module.exports = router;