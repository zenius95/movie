const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// Định nghĩa các models
const Movie = require('./movie')(sequelize, DataTypes);
const Episode = require('./episode')(sequelize, DataTypes);
const Person = require('./person')(sequelize, DataTypes);
const Category = require('./category')(sequelize, DataTypes);
const Country = require('./country')(sequelize, DataTypes);
const User = require('./user')(sequelize, DataTypes);
const Year = require('./year')(sequelize, DataTypes);

// ===============================================
// ĐỊNH NGHĨA CÁC MỐI QUAN HỆ
// ===============================================

// Movie <-> Category (Nhiều - Nhiều)
Movie.belongsToMany(Category, { 
    through: 'MovieCategory',
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

// Movie <-> Person (Nhiều - Nhiều, với bảng trung gian có thêm cột)
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

// Movie -> Episode (Một - Nhiều)
Movie.hasMany(Episode, { foreignKey: 'movie_id', onDelete: 'CASCADE' });
Episode.belongsTo(Movie, { foreignKey: 'movie_id' });

// Year -> Movie (Một - Nhiều)
Year.hasMany(Movie, { foreignKey: 'year', sourceKey: 'year' });
Movie.belongsTo(Year, { foreignKey: 'year', targetKey: 'year' });


// Đồng bộ models với database
const initDb = async () => {
  await sequelize.sync({ alter: true }); 
  console.log("Database & tables have been synced successfully!");
};

module.exports = {
  sequelize,
  initDb,
  Movie,
  Episode,
  Person,
  Category,
  Country,
  User,
  Year,
  MoviePerson
};