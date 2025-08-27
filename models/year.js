module.exports = (sequelize, DataTypes) => {
    const Year = sequelize.define('Year', {
        year: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false
        }
    }, {
        tableName: 'years',
        timestamps: false
    });
    return Year;
};