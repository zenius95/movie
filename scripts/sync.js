const {
    initDb, Movie, Episode, Person, Category, Country, Image, MoviePerson, sequelize, Year
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
    if (syncState.logs.length > 200) syncState.logs.shift();
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
async function checkStatus(socket) {
    let loggedPaused = false;
    while (syncState.status === 'paused') {
        if (!loggedPaused) {
            log(socket, 'warning', 'Tiến trình đã tạm dừng. Đang chờ resume...');
            loggedPaused = true;
        }
        await sleep(1000);
    }
    if (syncState.status === 'stopped') {
        throw new Error('Sync stopped by user');
    }
}

async function startSync(socket) {
    const { 
        sync_type, sync_value, maxPages, delayPages, 
        delayBatches, concurrency
    } = syncState.options;
    
    try {
        log(socket, 'info', 'Bắt đầu quá trình đồng bộ hóa...');
        await initDb();
        
        let basePath;
        switch (sync_type) {
            case 'danh-muc': basePath = `/api/danh-sach/${sync_value}`; break;
            case 'the-loai': basePath = `/api/the-loai/${sync_value}`; break;
            case 'quoc-gia': basePath = `/api/quoc-gia/${sync_value}`; break;
            case 'nam-phat-hanh': basePath = `/api/nam-phat-hanh/${sync_value}`; break;
            case 'tim-kiem': basePath = `/api/tim-kiem`; break;
            default: throw new Error(`Loại đồng bộ không hợp lệ: ${sync_type}`);
        }

        log(socket, 'info', `PHASE 1: Tìm kiếm phim từ ${sync_type}: ${sync_value}`);
        const allMoviesFound = [];
        let currentPage = 1;
        let totalPages = Infinity;

        while (currentPage <= totalPages && (maxPages === 0 || currentPage <= maxPages)) {
            await checkStatus(socket);
            let apiUrl = `${basePath}?page=${currentPage}`;
            if (sync_type === 'tim-kiem') apiUrl += `&keyword=${encodeURIComponent(sync_value)}`;
            
            log(socket, 'info', `  - Đang quét trang: ${currentPage}`);
            const data = await fetchApi(apiUrl);

            if (!data || !data.data || !data.data.items) break;
            totalPages = data.data.params.pagination.totalPages || 1;
            data.data.items.forEach(movie => allMoviesFound.push({ slug: movie.slug, name: movie.name }));
            currentPage++;
            await sleep(delayPages);
        }
        
        let moviesToProcess = allMoviesFound;
        log(socket, 'info', `PHASE 1 KẾT THÚC: Tìm thấy ${allMoviesFound.length} phim. Sẽ xử lý ${moviesToProcess.length} phim.`);

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
        syncState.status = 'idle';
        socket.emit('sync-finished', syncState.status);
    }
}

async function processMovieBySlug(slug, movieName, socket) {
    await checkStatus(socket);
    log(socket, 'info', `  -> Đang xử lý phim: "${movieName}"`);

    // Fetch all necessary data first
    const [movieDetail, peopleDetail, imageDetail] = await Promise.all([
        fetchApi(`/api/phim/${slug}`),
        fetchApi(`/api/phim/${slug}/peoples`),
        fetchApi(`/api/phim/${slug}/images`)
    ]);

    if (!movieDetail || !movieDetail.data || !movieDetail.data.item) {
        log(socket, 'error', `Lỗi: Không thể lấy chi tiết phim "${movieName}"`);
        return null;
    }
    
    const movieData = movieDetail.data.item;
    const peopleData = (peopleDetail && peopleDetail.data && peopleDetail.data.peoples) ? peopleDetail.data.peoples : [];
    const imageData = (imageDetail && imageDetail.data && imageDetail.data.images) ? imageDetail.data.images : [];
    
    const ophimCdnUrl = movieDetail.data.APP_DOMAIN_CDN_IMAGE || 'https://img.ophim.live';
    const tmdbCdnUrl = imageDetail?.data?.image_sizes?.backdrop?.original || 'https://image.tmdb.org/t/p/original';

    const apiModifiedTime = new Date(movieData.modified.time);
    const existingMovie = await Movie.findByPk(movieData._id);
    const action = existingMovie ? 'updated' : 'created';

    if (existingMovie && new Date(existingMovie.modified_at) >= apiModifiedTime) {
        log(socket, 'info', `Bỏ qua '${movieData.name}', dữ liệu đã mới nhất.`);
        return { name: movieData.name, thumb: existingMovie.thumb_url, status: 'skipped', year: movieData.year };
    }
    
    const movieImageDir = path.join(__dirname, `../public/images/${movieData.slug}`);
    if (!fs.existsSync(movieImageDir)) fs.mkdirSync(movieImageDir, { recursive: true });
    
    const posterDestPath = path.join(movieImageDir, `poster${path.extname(movieData.poster_url) || '.jpg'}`);
    await downloadImage(`${ophimCdnUrl}/uploads/movies/${movieData.poster_url}`, posterDestPath, socket);
    const localPosterPath = `/images/${movieData.slug}/${path.basename(posterDestPath)}`;

    const thumbDestPath = path.join(movieImageDir, `thumb${path.extname(movieData.thumb_url) || '.jpg'}`);
    await downloadImage(`${ophimCdnUrl}/uploads/movies/${movieData.thumb_url}`, thumbDestPath, socket);
    const localThumbPath = `/images/${movieData.slug}/${path.basename(thumbDestPath)}`;

    const t = await sequelize.transaction();
    try {
        if (movieData.year) {
            await Year.findOrCreate({ where: { year: movieData.year }, transaction: t });
        }

        const moviePayload = {
            _id: movieData._id, name: movieData.name, origin_name: movieData.origin_name,
            slug: movieData.slug, content: movieData.content, type: movieData.type,
            status: movieData.status, thumb_url: localThumbPath, poster_url: localPosterPath,
            trailer_url: movieData.trailer_url, time: movieData.time, episode_current: movieData.episode_current,
            episode_total: movieData.episode_total, quality: movieData.quality, lang: movieData.lang,
            year: movieData.year, view: movieData.view, chieurap: movieData.chieurap,
            modified_at: apiModifiedTime, tmdb: movieData.tmdb, imdb: movieData.imdb
        };
        await Movie.upsert(moviePayload, { transaction: t });
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
        
        if (peopleData.length > 0) {
            const peoplePayload = peopleData.map(p => ({
                tmdb_people_id: p.tmdb_people_id, name: p.name, original_name: p.original_name,
                gender: p.gender, profile_path: p.profile_path, known_for_department: p.known_for_department,
                also_known_as: p.also_known_as
            }));
            await Person.bulkCreate(peoplePayload, { 
                updateOnDuplicate: ["name", "original_name", "gender", "profile_path", "known_for_department", "also_known_as"],
                transaction: t 
            });
            const moviePersonAssociations = peopleData.map(p => ({
                movie_id: movieInstance._id,
                person_id: p.tmdb_people_id,
                character: p.character
            }));
            await MoviePerson.destroy({ where: { movie_id: movieInstance._id }, transaction: t });
            await MoviePerson.bulkCreate(moviePersonAssociations, { transaction: t });
        }

        if (imageData.length > 0) {
            await Image.destroy({ where: { movie_id: movieInstance._id }, transaction: t });
            
            const downloadedImages = await Promise.all(imageData.map(async (img, index) => {
                await checkStatus(socket);
                const imageName = `${img.type}-${index}${path.extname(img.file_path) || '.jpg'}`;
                const destPath = path.join(movieImageDir, imageName);
                const fullImageUrl = `${tmdbCdnUrl}${img.file_path}`;
                
                await downloadImage(fullImageUrl, destPath, socket);

                return {
                    movie_id: movieInstance._id,
                    type: img.type,
                    file_path: `/images/${movieData.slug}/${imageName}`,
                    width: img.width,
                    height: img.height,
                    aspect_ratio: img.aspect_ratio
                };
            }));

            await Image.bulkCreate(downloadedImages, { transaction: t });
            log(socket, 'info', `  -> Đã tải và lưu ${downloadedImages.length} hình ảnh cho phim.`);
        }
        
        await t.commit();
        return { name: movieData.name, thumb: localThumbPath, status: action, year: movieData.year };
    } catch (error) {
        await t.rollback();
        log(socket, 'error', `Giao dịch thất bại cho phim "${movieName}". Đã rollback. Lỗi: ${error.message}`);
        if (error.message === 'Sync stopped by user') throw error;
        return null;
    }
}

async function downloadImage(url, destPath, socket, retries = 3) {
    if (!url || !(url.startsWith('http') || url.startsWith('https'))) {
        log(socket, 'warning', `URL không hợp lệ, bỏ qua tải ảnh: ${url}`);
        return;
    };
    
    for (let i = 0; i < retries; i++) {
        try {
            await checkStatus(socket);
            const response = await fetch(url, { timeout: 15000 }); // Thêm timeout 15s
            if (!response.ok) throw new Error(`Server response: ${response.statusText}`);
            
            const fileStream = fs.createWriteStream(destPath);
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                response.body.on("error", reject);
                fileStream.on("finish", resolve);
            });
            return; // Thành công, thoát khỏi vòng lặp
        } catch (error) {
            log(socket, 'warning', `Lần ${i + 1}/${retries}: Lỗi khi tải ảnh từ ${url}. Thử lại sau 1 giây...`);
            if (i === retries - 1) { // Nếu đây là lần thử cuối cùng
                log(socket, 'error', `Không thể tải ảnh từ ${url} sau ${retries} lần thử. Lỗi: ${error.message}`);
            } else {
                await sleep(1000); // Chờ 1 giây trước khi thử lại
            }
        }
    }
}

module.exports = control;