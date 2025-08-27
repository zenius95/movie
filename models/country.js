module.exports = (sequelize, DataTypes) => {
    const Country = sequelize.define('Country', {
        id: {
            type: DataTypes.STRING,
            primaryKey: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        slug: {
            type: DataTypes.STRING,
            unique: true
        }
    }, {
        tableName: 'countries',
        timestamps: false
    });
    return Country;
};