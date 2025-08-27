module.exports = (sequelize, DataTypes) => {
    const Movie = sequelize.define('Movie', {
        _id: {
            type: DataTypes.STRING,
            primaryKey: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        origin_name: {
            type: DataTypes.STRING
        },
        slug: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false
        },
        content: {
            type: DataTypes.TEXT
        },
        type: {
            type: DataTypes.STRING
        },
        status: {
            type: DataTypes.STRING
        },
        thumb_url: {
            type: DataTypes.STRING
        },
        poster_url: {
            type: DataTypes.STRING
        },
        trailer_url: {
            type: DataTypes.STRING
        },
        time: {
            type: DataTypes.STRING
        },
        episode_current: {
            type: DataTypes.STRING
        },
        episode_total: {
            type: DataTypes.STRING
        },
        quality: {
            type: DataTypes.STRING
        },
        lang: {
            type: DataTypes.STRING
        },
        year: {
            type: DataTypes.INTEGER
        },
        view: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        chieurap: {
            type: DataTypes.BOOLEAN
        },
        modified_at: {
            type: DataTypes.DATE,
            allowNull: false
        }
    }, {
        tableName: 'movies',
        timestamps: true, // Tự động quản lý createdAt, updatedAt
        updatedAt: 'updated_at',
        createdAt: 'created_at'
    });
    return Movie;
};