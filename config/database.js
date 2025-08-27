const { Sequelize } = require('sequelize');

// Khởi tạo Sequelize với MySQL
const sequelize = new Sequelize('movie', 'root', '', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false, // Tắt log SQL cho gọn
  // Cấu hình pool kết nối (tùy chọn)
});

module.exports = sequelize;