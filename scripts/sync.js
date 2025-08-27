const {
    initDb, Movie, Episode, Person, Category, Country, Image, MoviePerson, sequelize
} = require('../models');
const { fetchApi } = require('../utils/apiFetcher');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Trạng thái của tiến trình, được quản lý trên server để hỗ trợ chạy ngầm
let syncState = {
    status: 'idle', // idle, running, paused, stopped
    logs: [],
    results: [],
    progress: { processed: 0, total: 0, success: 0, errors: 0 },
    options: {}
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hàm helper để gửi log đến cả console và client qua socket
const log = (socket, type, message) => {
    const logEntry = { type, message, timestamp: new Date().toLocaleTimeString() };
    syncState.logs.push(logEntry);
    if (syncState.logs.length > 200) syncState.logs.shift(); // Giới hạn số lượng log để tránh tràn bộ nhớ
    console.log(`[${type.toUpperCase()}] ${message}`);
    if(socket) socket.emit('sync-log', logEntry);
};

// Hàm điều khiển tiến trình
const control = {
    start: (socket, options) => {
        if (syncState.status === 'running' || syncState.status === 'paused') {
            log(socket, 'error', 'Một tiến trình đồng bộ khác đang chạy. Vui lòng đợi.');
            return;
        }
        syncState = { ...syncState, status: 'running', logs: [], results: [], progress: { processed: 0, total: 0, success: 0, errors: 0 }, options };
        startSync(socket);
    },
    pause: (socket) => {
        if (syncState.status === 'running') {
            syncState.status = 'paused';
            log(socket, 'warning', 'Tiến trình đã được yêu cầu tạm dừng.');
        }
    },
    resume: (socket) => {
        if (syncState.status === 'paused') {
            syncState.status = 'running';
            log(socket, 'info', 'Tiến trình đã được tiếp tục.');
        }
    },
    stop: (socket) => {
        if (syncState.status === 'running' || syncState.status === 'paused') {
            syncState.status = 'stopped';
            log(socket, 'error', 'Tiến trình đã được yêu cầu dừng lại.');
        }
    },
    getState: () => syncState,
};

// Hàm chờ và kiểm tra trạng thái để có thể pause/stop
// Hàm chờ và kiểm tra trạng thái để có thể pause/stop
async function checkStatus(socket) {
    let loggedPaused = false; // Biến cờ để chỉ log một lần
    while (syncState.status === 'paused') {
        if (!loggedPaused) {
            log(socket, 'warning', 'Tiến trình đã tạm dừng. Đang chờ resume...');
            loggedPaused = true;
        }
        await sleep(1000); // Chờ 1 giây trước khi kiểm tra lại
    }
    if (syncState.status === 'stopped') {
        throw new Error('Sync stopped by user'); // Ném lỗi để dừng toàn bộ tiến trình
    }
}

async function startSync(socket) {
    const { 
        sync_type, sync_value, maxPages, maxMovies, delayPages, 
        delayBatches, concurrency, sort_field, sort_type, 
        category, country, year 
    } = syncState.options;
    
    try {
        log(socket, 'info', 'Bắt đầu quá trình đồng bộ hóa...');
        await initDb();
        
        let basePath;
        let isSearch = false;
        switch (sync_type) {
            case 'danh-muc': basePath = `/api/danh-sach/${sync_value}`; break;
            case 'the-loai': basePath = `/api/the-loai/${sync_value}`; break;
            case 'quoc-gia': basePath = `/api/quoc-gia/${sync_value}`; break;
            case 'nam-phat-hanh': basePath = `/api/nam-phat-hanh/${sync_value}`; break;
            case 'tim-kiem': basePath = `/api/tim-kiem`; isSearch = true; break;
            default: throw new Error(`Loại đồng bộ không hợp lệ: ${sync_type}`);
        }

                log(socket, 'info', `PHASE 1: Bắt đầu tìm kiếm phim từ ${sync_type}: ${sync_value}`);
        const allMoviesFound = [];
        
        let currentPage = 1;
        let totalPages = Infinity;
        while (currentPage <= totalPages && currentPage <= maxPages) {
            await checkStatus(socket);
            
            let apiUrl;
            if (isSearch) {
                apiUrl = `${basePath}?page=${currentPage}`;
                if (sync_value) {
                    apiUrl += `&keyword=${encodeURIComponent(sync_value)}`;
                }
            } else {
                apiUrl = `${basePath}?page=${currentPage}`;
                if (sort_field) apiUrl += `&sort_field=${sort_field}`;
                if (sort_type) apiUrl += `&sort_type=${sort_type}`;
                if (category && sync_type !== 'the-loai') apiUrl += `&category=${category}`;
                if (country && sync_type !== 'quoc-gia') apiUrl += `&country=${country}`;
                if (year && sync_type !== 'nam-phat-hanh') apiUrl += `&year=${year}`;
            }

            log(socket, 'info', `  - Đang quét trang: ${currentPage}`);
            const data = await fetchApi(apiUrl);

            if (!data || !data.data || !data.data.items) break;
            if (totalPages === Infinity) {
                totalPages = data.data.params.pagination.totalPages || Math.ceil(data.data.params.pagination.totalItems / data.data.params.pagination.totalItemsPerPage);
            }
            data.data.items.forEach(movie => allMoviesFound.push({ slug: movie.slug, name: movie.name }));
            currentPage++;
            await sleep(delayPages);
        }
        
        let moviesToProcess = allMoviesFound;
        log(socket, 'info', `PHASE 1 KẾT THÚC: Tìm thấy ${moviesToProcess.length} phim.`);

        if (maxMovies !== Infinity && moviesToProcess.length > maxMovies) {
            log(socket, 'info', `Giới hạn xử lý từ ${moviesToProcess.length} xuống còn ${maxMovies} phim.`);
            moviesToProcess = moviesToProcess.slice(0, maxMovies);
        }

        syncState.progress.total = moviesToProcess.length;
        socket.emit('sync-start', { total: moviesToProcess.length });
        
        if (moviesToProcess.length > 0) {
            for (let i = 0; i < moviesToProcess.length; i += concurrency) {
                await checkStatus(socket);
                const batch = moviesToProcess.slice(i, i + concurrency);
                const results = await Promise.all(batch.map(movie => processMovieBySlug(movie.slug, movie.name, socket)));
                
                results.forEach(result => {
                    if (result) {
                        if (result.status !== 'skipped') syncState.progress.success++;
                        syncState.results.push(result);
                        socket.emit('movie-synced', result);
                    } else {
                        syncState.progress.errors++;
                    }
                });

                syncState.progress.processed += batch.length;
                socket.emit('sync-progress', syncState.progress);
                
                log(socket, 'info', `--- Hoàn thành lô ${Math.floor(i / concurrency) + 1} / ${Math.ceil(moviesToProcess.length / concurrency)} ---`);
                await sleep(delayBatches);
            }
        }
        
        log(socket, 'success', '✅ ĐỒNG BỘ HÓA HOÀN TẤT!');

    } catch (error) {
        if (error.message === 'Sync stopped by user') {
            log(socket, 'error', '⏹️ ĐỒNG BỘ ĐÃ DỪNG THEO YÊU CẦU.');
        } else {
            log(socket, 'error', `❌ Đã xảy ra lỗi nghiêm trọng: ${error.message}`);
            console.error(error);
        }
    } finally {
        syncState.status = syncState.status === 'stopped' ? 'stopped' : 'idle';
        socket.emit('sync-finished', syncState.status);
    }
}

async function processMovieBySlug(slug, movieName, socket) {
    await checkStatus(socket);
    log(socket, 'info', `  -> Đang xử lý phim: "${movieName}"`);
    const movieDetail = await fetchApi(`/api/phim/${slug}`);
    if (!movieDetail || !movieDetail.data || !movieDetail.data.item) {
        log(socket, 'error', `Lỗi: Không thể lấy chi tiết phim "${movieName}"`);
        return null;
    }
    const movieData = movieDetail.data.item;
    const imageCdnUrl = movieDetail.data.APP_DOMAIN_CDN_IMAGE || 'https://img.ophim.live';
    const apiModifiedTime = new Date(movieData.modified.time);
    const existingMovie = await Movie.findByPk(movieData._id);
    const action = existingMovie ? 'updated' : 'created';

    if (existingMovie && new Date(existingMovie.modified_at) >= apiModifiedTime) {
        log(socket, 'info', `Bỏ qua '${movieData.name}', dữ liệu đã mới nhất.`);
        const categories = movieData.category ? movieData.category.map(c => c.name).join(', ') : '';
        const countries = movieData.country ? movieData.country.map(c => c.name).join(', ') : '';
        return { name: movieData.name, thumb: existingMovie.thumb_url, status: 'skipped', year: movieData.year, categories: categories, countries: countries };
    }
    
    const movieImageDir = path.join(__dirname, `../public/images/${movieData.slug}`);
    if (!fs.existsSync(movieImageDir)) fs.mkdirSync(movieImageDir, { recursive: true });
    
    await checkStatus(socket);
    const posterDestPath = path.join(movieImageDir, `poster${path.extname(movieData.poster_url) || '.jpg'}`);
    await downloadImage(`${imageCdnUrl}/uploads/movies/${movieData.poster_url}`, posterDestPath, socket);
    const localPosterPath = `/images/${movieData.slug}/${path.basename(posterDestPath)}`;

    await checkStatus(socket);
    const thumbDestPath = path.join(movieImageDir, `thumb${path.extname(movieData.thumb_url) || '.jpg'}`);
    await downloadImage(`${imageCdnUrl}/uploads/movies/${movieData.thumb_url}`, thumbDestPath, socket);
    const localThumbPath = `/images/${movieData.slug}/${path.basename(thumbDestPath)}`;

    const t = await sequelize.transaction();
    try {
        await checkStatus(socket);
        await Movie.upsert({_id: movieData._id, name: movieData.name, origin_name: movieData.origin_name, slug: movieData.slug, content: movieData.content, type: movieData.type, status: movieData.status, thumb_url: localThumbPath, poster_url: localPosterPath, trailer_url: movieData.trailer_url, time: movieData.time, episode_current: movieData.episode_current, episode_total: movieData.episode_total, quality: movieData.quality, lang: movieData.lang, year: movieData.year, view: movieData.view, chieurap: movieData.chieurap, modified_at: apiModifiedTime}, { transaction: t });
        const movieInstance = await Movie.findByPk(movieData._id, { transaction: t });
        
        if (movieData.category) {
            const categoryInstances = await Promise.all(movieData.category.map(cat => Category.findOrCreate({ where: { id: cat.id }, defaults: cat, transaction: t }).then(res => res[0])));
            await movieInstance.setCategories(categoryInstances, { transaction: t });
        }
        if (movieData.country) {
            const countryInstances = await Promise.all(movieData.country.map(c => Country.findOrCreate({ where: { id: c.id }, defaults: c, transaction: t }).then(res => res[0])));
            await movieInstance.setCountries(countryInstances, { transaction: t });
        }
        if (movieData.episodes) {
            const episodesData = movieData.episodes.flatMap(server => server.server_data.map(ep => ({ movie_id: movieData._id, server_name: server.server_name, name: ep.name, slug: ep.slug, link_embed: ep.link_embed, link_m3u8: ep.link_m3u8 })));
            if (episodesData.length > 0) {
                await Episode.destroy({ where: { movie_id: movieData._id }, transaction: t });
                await Episode.bulkCreate(episodesData, { transaction: t });
            }
        }
        
        await t.commit();
        const categories = movieData.category ? movieData.category.map(c => c.name).join(', ') : '';
        const countries = movieData.country ? movieData.country.map(c => c.name).join(', ') : '';
        return { name: movieData.name, thumb: localThumbPath, status: action, year: movieData.year, categories: categories, countries: countries };
    } catch (error) {
        await t.rollback();
        log(socket, 'error', `Giao dịch thất bại cho phim "${movieName}". Đã rollback. Lỗi: ${error.message}`);
        if (error.message === 'Sync stopped by user') throw error; // Re-throw để dừng hẳn
        return null;
    }
}

async function downloadImage(url, destPath, socket) {
    if (!url || !url.startsWith('http')) return;
    await checkStatus(socket);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const fileStream = fs.createWriteStream(destPath);
        await new Promise((resolve, reject) => {
            response.body.pipe(fileStream);
            response.body.on("error", reject);
            fileStream.on("finish", resolve);
        });
    } catch (error) {
        log(socket, 'error', `Could not download image from ${url}. ${error.message}`);
        if (error.message === 'Sync stopped by user') throw error; // Re-throw để dừng hẳn
    }
}

module.exports = control;