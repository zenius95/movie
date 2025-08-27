module.exports = (sequelize, DataTypes) => {
    const Person = sequelize.define('Person', {
        tmdb_people_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING
        },
        original_name: {
            type: DataTypes.STRING
        },
        gender: {
            type: DataTypes.INTEGER
        },
        profile_path: {
            type: DataTypes.STRING
        },
        known_for_department: {
            type: DataTypes.STRING
        },
        also_known_as: {
            type: DataTypes.JSON // Sequelize sẽ tự chuyển thành TEXT trong SQLite
        }
    }, {
        tableName: 'people',
        timestamps: false
    });
    return Person;
};