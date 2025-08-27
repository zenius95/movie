const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// Định nghĩa các models
const Movie = require('./movie')(sequelize, DataTypes);
const Episode = require('./episode')(sequelize, DataTypes);
const Person = require('./person')(sequelize, DataTypes);
const Category = require('./category')(sequelize, DataTypes);
const Country = require('./country')(sequelize, DataTypes);
const Image = require('./image')(sequelize, DataTypes);

// === SỬA LỖI ĐỊNH NGHĨA BẢNG TRUNG GIAN ===

// Movie <-> Category (Nhiều - Nhiều)
Movie.belongsToMany(Category, { 
    through: 'MovieCategory', // Sử dụng tên chuỗi thay vì định nghĩa riêng
    foreignKey: 'movie_id', 
    timestamps: false 
});
Category.belongsToMany(Movie, { 
    through: 'MovieCategory', 
    foreignKey: 'category_id', 
    timestamps: false 
});

// Movie <-> Country (Nhiều - Nhiều)
Movie.belongsToMany(Country, { 
    through: 'MovieCountry', 
    foreignKey: 'movie_id', 
    timestamps: false 
});
Country.belongsToMany(Movie, { 
    through: 'MovieCountry', 
    foreignKey: 'country_id', 
    timestamps: false 
});

// Movie <-> Person (Nhiều - Nhiều)
const MoviePerson = sequelize.define('MoviePerson', {
    character: DataTypes.STRING
}, { timestamps: false });
Movie.belongsToMany(Person, { 
    through: MoviePerson, 
    foreignKey: 'movie_id' 
});
Person.belongsToMany(Movie, { 
    through: MoviePerson, 
    foreignKey: 'person_id' 
});

// === KẾT THÚC PHẦN SỬA LỖI ===

// Movie -> Episode (Một - Nhiều)
Movie.hasMany(Episode, { foreignKey: 'movie_id', onDelete: 'CASCADE' });
Episode.belongsTo(Movie, { foreignKey: 'movie_id' });

// Movie -> Image (Một - Nhiều)
Movie.hasMany(Image, { foreignKey: 'movie_id', onDelete: 'CASCADE' });
Image.belongsTo(Movie, { foreignKey: 'movie_id' });

// Đồng bộ models với database
const initDb = async () => {
  // Sử dụng 'force: true' MỘT LẦN DUY NHẤT để tạo lại schema đúng
  await sequelize.sync({ after: true }); 
  console.log("Database & tables have been recreated successfully!");
};

module.exports = {
  sequelize,
  initDb,
  Movie,
  Episode,
  Person,
  Category,
  Country,
  Image,
  MoviePerson // Vẫn export để script sync có thể dùng
};