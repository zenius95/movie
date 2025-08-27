module.exports = (sequelize, DataTypes) => {
    const Image = sequelize.define('Image', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        type: {
            type: DataTypes.STRING // 'backdrop' hoặc 'poster'
        },
        file_path: {
            type: DataTypes.STRING
        },
        width: {
            type: DataTypes.INTEGER
        },
        height: {
            type: DataTypes.INTEGER
        },
        aspect_ratio: {
            type: DataTypes.FLOAT
        }
    }, {
        tableName: 'images',
        timestamps: false
    });
    return Image;
};