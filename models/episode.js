module.exports = (sequelize, DataTypes) => {
    const Episode = sequelize.define('Episode', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        server_name: {
            type: DataTypes.STRING
        },
        name: {
            type: DataTypes.STRING
        },
        slug: {
            type: DataTypes.STRING
        },
        link_embed: {
            type: DataTypes.STRING
        },
        link_m3u8: {
            type: DataTypes.STRING
        }
    }, {
        tableName: 'episodes',
        timestamps: false
    });
    return Episode;
};