const {
    initDb, Movie, Episode, Person, Category, Country, MoviePerson, sequelize, Year
} = require('../models');
const { fetchApi } = require('../utils/apiFetcher');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LOG_FILE_PATH = path.join(__dirname, '..', 'logs', 'sync.log');
const API_BASE_URL = process.env.OPHIM_API_URL || 'https://ophim1.com/v1';

let syncState = {
    status: 'idle', logs: [], results: [],
    progress: { processed: 0, total: 0, success: 0, errors: 0 },
    options: {},
    proxies: [],
    currentProxyIndex: 0
};

// Hàm đọc log từ file khi khởi tạo
const loadInitialState = () => {
    let logs = [];
    if (fs.existsSync(LOG_FILE_PATH)) {
        const logData = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
        logs = logData.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);
    }
    syncState.logs = logs;
};

loadInitialState();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const log = (io, type, message) => {
    const logEntry = { type, message, timestamp: new Date().toLocaleTimeString() };
    syncState.logs.push(logEntry);
    fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + '\n');
    if (syncState.logs.length > 500) {
        syncState.logs.splice(0, syncState.logs.length - 500);
        const lines = fs.readFileSync(LOG_FILE_PATH, 'utf-8').split('\n').filter(Boolean);
        const newLines = lines.slice(lines.length - 500);
        fs.writeFileSync(LOG_FILE_PATH, newLines.join('\n') + '\n');
    }
    if(io) io.emit('sync-log', logEntry);
};

const getProxyAgent = () => {
    if (syncState.proxies.length === 0) return null;
    const proxyUrl = syncState.proxies[syncState.currentProxyIndex];
    return new HttpsProxyAgent(proxyUrl);
};

const rotateProxy = (io, originalError) => {
    if (syncState.proxies.length === 0) return false;
    log(io, 'warning', `Proxy hiện tại gặp lỗi (${originalError.code || 'Connection Error'}). Đang thử chuyển sang proxy tiếp theo...`);
    syncState.currentProxyIndex++;
    if (syncState.currentProxyIndex >= syncState.proxies.length) {
        log(io, 'error', 'Tất cả các proxy đều đã được thử và thất bại.');
        return false; // No more proxies
    }
    log(io, 'info', `Đã chuyển sang proxy: ${syncState.proxies[syncState.currentProxyIndex]}`);
    return true; // Switched to a new proxy
};


const control = {
    start: (io, options) => {
        if (syncState.status === 'running' || syncState.status === 'paused') {
            log(io, 'error', 'Một tiến trình đồng bộ khác đang chạy. Vui lòng đợi.');
            return;
        }
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        
        syncState = { 
            ...syncState,
            status: 'running', 
            logs: [], 
            results: [], 
            progress: { processed: 0, total: 0, success: 0, errors: 0 }, 
            options: options,
            proxies: options.proxies || [],
            currentProxyIndex: 0
        };
        
        io.emit('sync-state', syncState);
        log(io, 'info', '====================');
        log(io, 'info', 'BẮT ĐẦU TIẾN TRÌNH ĐỒNG BỘ MỚI');
        log(io, 'info', '====================');
        if (syncState.proxies.length > 0) {
            log(io, 'info', `Sử dụng proxy: ${syncState.proxies[0]}`);
        }
        startSync(io, options); 
    },
    pause: (io) => {
        if (syncState.status === 'running') {
            syncState.status = 'paused';
            log(io, 'warning', 'Tiến trình đã được yêu cầu tạm dừng.');
            io.emit('sync-state', syncState);
        }
    },
    resume: (io) => {
        if (syncState.status === 'paused') {
            syncState.status = 'running';
            log(io, 'info', 'Tiến trình đã được tiếp tục.');
            io.emit('sync-state', syncState);
        }
    },
    stop: (io, reason) => {
        if (syncState.status === 'stopped') return;
        const previousStatus = syncState.status;
        syncState.status = 'stopped';
        log(io, 'error', reason || 'Tiến trình đã được yêu cầu dừng lại.');
        io.emit('sync-state', syncState);
        if (previousStatus === 'paused' || !reason) {
            io.emit('sync-finished', syncState.status);
        }
    },
    getState: () => syncState,
    clearLog: () => {
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        syncState.logs = [];
    }
};

async function checkStatus(io) {
    let loggedPaused = false;
    while (syncState.status === 'paused') {
        if (!loggedPaused) {
            log(io, 'warning', 'Tiến trình đã tạm dừng. Đang chờ resume...');
            loggedPaused = true;
        }
        await sleep(1000);
    }
    if (syncState.status === 'stopped') {
        throw new Error('Sync stopped by user');
    }
}

async function startSync(io, options) {
    const { 
        sync_type, sync_value, maxPages, limit, delayPages, 
        delayBatches, concurrency, sync_value_text,
        category, country, year, sort_field, sort_type, post_status,
        movie_links
    } = options;
    
    try {
        await initDb();
        let moviesToProcess = [];

        if (movie_links && movie_links.trim() !== '') {
            log(io, 'info', 'PHASE 1: Đồng bộ từ danh sách link được cung cấp.');
            const links = movie_links.split('\n').map(l => l.trim()).filter(Boolean);
            moviesToProcess = links.map(link => {
                try {
                    const url = new URL(link);
                    const slug = path.basename(url.pathname);
                    return { slug, name: slug }; // Tên sẽ được cập nhật sau khi fetch
                } catch (e) {
                    log(io, 'warning', `Bỏ qua link không hợp lệ: ${link}`);
                    return null;
                }
            }).filter(Boolean);

        } else {
             let basePath;
            switch (sync_type) {
                case 'danh-muc': basePath = `/api/danh-sach/${sync_value}`; break;
                case 'the-loai': basePath = `/api/the-loai/${sync_value}`; break;
                case 'quoc-gia': basePath = `/api/quoc-gia/${sync_value}`; break;
                case 'nam-phat-hanh': basePath = `/api/nam-phat-hanh/${sync_value}`; break;
                case 'tim-kiem': basePath = `/api/tim-kiem`; break;
                default: throw new Error(`Loại đồng bộ không hợp lệ: ${sync_type}`);
            }

            const queryParams = new URLSearchParams();
            if (sort_field) queryParams.append('sort_field', sort_field);
            if (sort_type) queryParams.append('sort_type', sort_type);

            switch (sync_type) {
                case 'danh-muc':
                    if (category) queryParams.append('category', category);
                    if (country) queryParams.append('country', country);
                    if (year) queryParams.append('year', year);
                    break;
                case 'the-loai':
                    if (country) queryParams.append('country', country);
                    if (year) queryParams.append('year', year);
                    break;
                case 'quoc-gia':
                    if (year) queryParams.append('year', year);
                    break;
                case 'nam-phat-hanh':
                    if (category) queryParams.append('category', category);
                    if (country) queryParams.append('country', country);
                    break;
            }
            const filterQueryString = queryParams.toString();
            
            const syncTypeMap = {
                'danh-muc': 'danh mục', 'the-loai': 'thể loại', 'quoc-gia': 'quốc gia',
                'nam-phat-hanh': 'năm phát hành', 'tim-kiem': 'từ khóa'
            };
            const readableSyncType = syncTypeMap[sync_type] || sync_type;
            const readableSyncValue = sync_value_text && sync_value_text.trim() !== '' ? sync_value_text : sync_value;

            log(io, 'info', `PHASE 1: Tìm kiếm phim từ ${readableSyncType}: ${readableSyncValue}`);
            
            let currentPage = 1;
            let totalPages = Infinity;

            while (currentPage <= totalPages && (maxPages === 0 || currentPage <= maxPages)) {
                await checkStatus(io);
                
                let apiUrl = `${basePath}?page=${currentPage}&limit=${limit}`;
                if (sync_type === 'tim-kiem') apiUrl += `&keyword=${encodeURIComponent(sync_value)}`;
                if (filterQueryString) apiUrl += `&${filterQueryString}`;
                
                log(io, 'info', `  - Đang quét trang: ${currentPage}`);
                const data = await fetchApi(apiUrl, getProxyAgent());

                if (!data || !data.data || !data.data.items || data.data.items.length === 0) break;
                
                const pagination = data.data.params.pagination;
                totalPages = Math.ceil(pagination.totalItems / pagination.totalItemsPerPage) || 1;

                const moviesFromApi = data.data.items;
                const movieIds = moviesFromApi.map(m => m._id);
                const existingMovies = await Movie.findAll({ where: { _id: movieIds }, attributes: ['_id', 'modified_at'] });
                const existingMoviesMap = new Map(existingMovies.map(m => [m._id, new Date(m.modified_at).getTime()]));
                const moviesToAdd = moviesFromApi.filter(apiMovie => {
                    const existingTimestamp = existingMoviesMap.get(apiMovie._id);
                    const apiTimestamp = new Date(apiMovie.modified.time).getTime();
                    return !existingTimestamp || apiTimestamp > existingTimestamp;
                });
                
                if (moviesToAdd.length > 0) {
                     const foundLinks = moviesToAdd.map(movie => `${API_BASE_URL}/api/phim/${movie.slug}`);
                     io.emit('sync:movies-found', foundLinks); // Gửi link về client
                     moviesToAdd.forEach(movie => moviesToProcess.push({ slug: movie.slug, name: movie.name }));
                     log(io, 'info', `    -> Tìm thấy ${moviesToAdd.length} phim mới/cần cập nhật trên trang ${currentPage}.`);
                } else {
                     log(io, 'info', `    -> Không có phim mới/cập nhật trên trang ${currentPage}.`);
                }
               
                currentPage++;
                if (delayPages > 0) await sleep(delayPages);
            }
        }
        
        log(io, 'info', `PHASE 1 KẾT THÚC: Tìm thấy ${moviesToProcess.length} phim.`);
        syncState.progress.total = moviesToProcess.length;
        io.emit('sync-start', { total: moviesToProcess.length });
        
        if (moviesToProcess.length > 0) {
            for (let i = 0; i < moviesToProcess.length; i += concurrency) {
                await checkStatus(io);
                const batch = moviesToProcess.slice(i, i + concurrency);
                const results = await Promise.all(batch.map(movie => processMovieBySlug(movie.slug, movie.name, io, post_status)));
                results.forEach(result => {
                    if (result) {
                        if (result.status !== 'skipped') syncState.progress.success++;
                        syncState.results.push(result);
                        io.emit('movie-synced', result);
                    } else {
                        syncState.progress.errors++;
                    }
                });
                syncState.progress.processed += batch.length;
                io.emit('sync-progress', syncState.progress);
                log(io, 'info', `--- Hoàn thành lô ${Math.floor(i / concurrency) + 1} / ${Math.ceil(moviesToProcess.length / concurrency)} ---`);
                if (delayBatches > 0) await sleep(delayBatches);
            }
        }
        
        log(io, 'success', '✅ ĐỒNG BỘ HÓA HOÀN TẤT!');

    } catch (error) {
        if (error.message === 'Sync stopped by user') {
            log(io, 'error', '⏹️ ĐỒNG BỘ ĐÃ DỪNG THEO YÊU CẦU.');
        } else {
            control.stop(io, `❌ Đã xảy ra lỗi nghiêm trọng: ${error.message}`);
        }
    } finally {
        if (syncState.status !== 'stopped') {
            syncState.status = 'idle';
        }
        io.emit('sync-finished', syncState.status);
    }
}

async function processMovieBySlug(slug, movieName, io, post_status) {
    const MAX_RETRIES = 3;
    let currentRetries = 0;

    while(currentRetries < MAX_RETRIES) {
        try {
            await checkStatus(io);
            log(io, 'info', `  -> Đang xử lý phim: "${movieName}" (Lần thử ${currentRetries + 1})`);
            
            const agent = getProxyAgent();

            const [movieDetail, peopleDetail, imageDetail] = await Promise.all([
                fetchApi(`/api/phim/${slug}`, agent),
                fetchApi(`/api/phim/${slug}/peoples`, agent),
                fetchApi(`/api/phim/${slug}/images`, agent)
            ]);

            if (!movieDetail || !movieDetail.data || !movieDetail.data.item) {
                throw new Error(`Không thể lấy chi tiết phim "${movieName}"`);
            }
            
            const movieData = movieDetail.data.item;
            const peopleData = (peopleDetail && peopleDetail.data && peopleDetail.data.peoples) ? peopleDetail.data.peoples : [];
            const imageData = (imageDetail && imageDetail.data && imageDetail.data.images) ? imageDetail.data.images : [];
            
            const ophimCdnUrl = movieDetail.data.APP_DOMAIN_CDN_IMAGE || 'https://img.ophim.live';
            const tmdbCdnUrl = imageDetail?.data?.image_sizes?.backdrop?.original || 'https://image.tmdb.org/t/p/original';

            const apiModifiedTime = new Date(movieData.modified.time);

            const movieImageDir = path.join(__dirname, `../public/images/${movieData.slug}`);
            if (!fs.existsSync(movieImageDir)) fs.mkdirSync(movieImageDir, { recursive: true });
            
            const posterDestPath = path.join(movieImageDir, `poster${path.extname(movieData.poster_url) || '.jpg'}`);
            await downloadImage(`${ophimCdnUrl}/uploads/movies/${movieData.poster_url}`, posterDestPath, io);
            const localPosterPath = `/images/${movieData.slug}/${path.basename(posterDestPath)}`;

            const thumbDestPath = path.join(movieImageDir, `thumb${path.extname(movieData.thumb_url) || '.jpg'}`);
            await downloadImage(`${ophimCdnUrl}/uploads/movies/${movieData.thumb_url}`, thumbDestPath, io);
            const localThumbPath = `/images/${movieData.slug}/${path.basename(thumbDestPath)}`;

            const t = await sequelize.transaction();
            try {
                if (movieData.year) {
                    await Year.findOrCreate({ where: { year: movieData.year }, transaction: t });
                }

                const images = imageData.map(img => `${tmdbCdnUrl}${img.file_path}`);

                const moviePayload = {
                    _id: movieData._id, name: movieData.name, origin_name: movieData.origin_name,
                    slug: movieData.slug, content: movieData.content, type: movieData.type,
                    movie_status: movieData.status, // Ghi vào cột mới
                    thumb_url: localThumbPath, poster_url: localPosterPath,
                    trailer_url: movieData.trailer_url, time: movieData.time, episode_current: movieData.episode_current,
                    episode_total: movieData.episode_total, quality: movieData.quality, lang: movieData.lang,
                    year: movieData.year, view: movieData.view, chieurap: movieData.chieurap,
                    modified_at: apiModifiedTime, tmdb: movieData.tmdb, imdb: movieData.imdb,
                    images: images
                };
                
                if (post_status) {
                    moviePayload.status = post_status;
                }

                const [movieInstance, created] = await Movie.upsert(moviePayload, { transaction: t, returning: true });
                const action = created ? 'created' : 'updated';
                
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
                
                await t.commit();
                return {
                    _id: movieData._id,
                    name: movieData.name,
                    thumb: localThumbPath,
                    status: action,
                    movie_status: movieData.status,
                    year: movieData.year,
                    categories: movieData.category.map(c => c.name).join(', '),
                    countries: movieData.country.map(c => c.name).join(', ')
                };
            } catch (dbError) {
                if (t && !t.finished) await t.rollback();
                throw dbError;
            }

        } catch (error) {
             const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'API Error'];
             if (networkErrors.some(e => error.message.includes(e)) && syncState.proxies.length > 0) {
                if (!rotateProxy(io, error)) {
                    throw new Error('Tất cả proxy đều thất bại.');
                }
             } else {
                log(io, 'error', `Lỗi xử lý phim "${movieName}" (lần thử ${currentRetries + 1}): ${error.message}`);
                currentRetries++;
                if (error.message === 'Sync stopped by user') throw error;
                await sleep(2000);
             }
        }
    }
     log(io, 'error', `Bỏ qua phim "${movieName}" sau ${MAX_RETRIES} lần thử thất bại.`);
     return null;
}


async function downloadImage(url, destPath, io, retries = 3) {
    if (!url || !(url.startsWith('http') || url.startsWith('https'))) {
        log(io, 'warning', `URL không hợp lệ, bỏ qua tải ảnh: ${url}`);
        return;
    };
    
    let currentRetries = 0;
    while(currentRetries < retries) {
        try {
            await checkStatus(io);
            const agent = getProxyAgent();
            const response = await fetch(url, { agent, timeout: 15000 });
            if (!response.ok) throw new Error(`Server response: ${response.statusText}`);
            
            const fileStream = fs.createWriteStream(destPath);
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                response.body.on("error", reject);
                fileStream.on("finish", resolve);
            });
            return; // Success
        } catch (error) {
            const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'];
             if (networkErrors.some(e => error.message.includes(e)) && syncState.proxies.length > 0) {
                 if (!rotateProxy(io, error)) {
                    throw new Error('Tất cả proxy đều thất bại khi tải ảnh.');
                }
             } else {
                log(io, 'warning', `Lần ${currentRetries + 1}/${retries}: Lỗi khi tải ảnh từ ${url}. Thử lại sau 1 giây...`);
                currentRetries++;
                if (currentRetries === retries) {
                     log(io, 'error', `Không thể tải ảnh từ ${url} sau ${retries} lần thử. Lỗi: ${error.message}`);
                } else {
                    await sleep(1000);
                }
            }
        }
    }
}

module.exports = control;