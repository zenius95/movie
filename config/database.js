require('dotenv').config();
const { Sequelize } = require('sequelize');

// Khởi tạo Sequelize với thông tin từ file .env
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || 'mysql',
    logging: false, // Tắt log SQL cho gọn
    // Cấu hình pool kết nối (tùy chọn)
  }
);

module.exports = sequelize;