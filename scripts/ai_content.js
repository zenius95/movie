const { Movie, sequelize } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.join(__dirname, '..', 'ai_content.log');

// Hàm đọc log từ file khi khởi tạo
const loadInitialState = () => {
    let logs = [];
    if (fs.existsSync(LOG_FILE_PATH)) {
        const logData = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
        logs = logData.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);
    }
    return {
        status: 'idle', logs: logs, results: [],
        progress: { processed: 0, total: 0, success: 0, errors: 0 },
        options: {}
    };
};

let aiState = loadInitialState();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const log = (io, type, message) => {
    const logEntry = { type, message, timestamp: new Date().toLocaleTimeString() };
    aiState.logs.push(logEntry);
    fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + '\n');

    if (aiState.logs.length > 500) {
        aiState.logs.splice(0, aiState.logs.length - 500);
        const lines = fs.readFileSync(LOG_FILE_PATH, 'utf-8').split('\n').filter(Boolean);
        fs.writeFileSync(LOG_FILE_PATH, lines.slice(-500).join('\n') + '\n');
    }

    console.log(`[AI-CONTENT][${type.toUpperCase()}] ${message}`);
    if (io) io.emit('ai-log', logEntry);
};

const control = {
    start: (io, options) => {
        if (aiState.status === 'running' || aiState.status === 'paused') {
            log(io, 'error', 'Một tiến trình AI khác đang chạy.');
            return;
        }
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        
        aiState = { 
            status: 'running', logs: [], results: [], 
            progress: { processed: 0, total: 0, success: 0, errors: 0 }, 
            options: options 
        };
        io.emit('ai-state', aiState);
        log(io, 'info', '====================');
        log(io, 'info', 'BẮT ĐẦU TẠO NỘI DUNG AI');
        log(io, 'info', '====================');
        startAiGeneration(io, options); 
    },
    pause: (io) => {
        if (aiState.status === 'running') {
            aiState.status = 'paused';
            log(io, 'warning', 'Tiến trình đã tạm dừng.');
            io.emit('ai-state', aiState);
        }
    },
    resume: (io) => {
        if (aiState.status === 'paused') {
            aiState.status = 'running';
            log(io, 'info', 'Tiến trình đã tiếp tục.');
            io.emit('ai-state', aiState);
        }
    },
    stop: (io) => {
        if (aiState.status === 'running' || aiState.status === 'paused') {
            const previousStatus = aiState.status;
            aiState.status = 'stopped';
            log(io, 'error', 'Tiến trình đã dừng.');
            if (previousStatus === 'paused') io.emit('ai-finished', aiState.status);
        }
    },
    getState: () => aiState,
};

async function checkStatus(io) {
    while (aiState.status === 'paused') {
        await sleep(1000);
    }
    if (aiState.status === 'stopped') {
        throw new Error('AI process stopped by user');
    }
}

async function startAiGeneration(io, options) {
    const { target, concurrency, delay, prompt } = options;
    try {
        let whereCondition = {};
        if (target === 'empty') {
            whereCondition.ai_content = { [Op.or]: [null, ''] };
        }
        
        log(io, 'info', `PHASE 1: Đang tìm phim trong CSDL...`);
        const moviesToProcess = await Movie.findAll({
            where: whereCondition,
            order: [['created_at', 'DESC']]
        });

        if (moviesToProcess.length === 0) {
            log(io, 'warning', 'Không tìm thấy phim nào phù hợp với điều kiện.');
            throw new Error('No movies found');
        }

        log(io, 'info', `PHASE 1 KẾT THÚC: Tìm thấy ${moviesToProcess.length} phim cần xử lý.`);
        aiState.progress.total = moviesToProcess.length;
        io.emit('ai-start', { total: moviesToProcess.length });

        for (let i = 0; i < moviesToProcess.length; i += concurrency) {
            await checkStatus(io);
            const batch = moviesToProcess.slice(i, i + concurrency);
            const results = await Promise.all(batch.map(movie => processMovie(movie, prompt, io)));
            
            results.forEach(result => {
                if (result) {
                    aiState.progress.success++;
                    aiState.results.push(result);
                    io.emit('ai-movie-processed', result);
                } else {
                    aiState.progress.errors++;
                }
            });
            
            aiState.progress.processed += batch.length;
            io.emit('ai-progress', aiState.progress);
            log(io, 'info', `--- Hoàn thành lô ${Math.floor(i / concurrency) + 1} / ${Math.ceil(moviesToProcess.length / concurrency)} ---`);
            if (delay > 0) await sleep(delay);
        }
        
        log(io, 'success', '✅ TẠO NỘI DUNG AI HOÀN TẤT!');

    } catch (error) {
        if (error.message.includes('stopped by user')) {
            log(io, 'error', '⏹️ TIẾN TRÌNH ĐÃ DỪNG.');
        } else {
            log(io, 'error', `❌ Đã xảy ra lỗi: ${error.message}`);
            console.error(error);
        }
    } finally {
        if (aiState.status !== 'stopped') {
            aiState.status = 'idle';
        }
        io.emit('ai-finished', aiState.status);
    }
}

function replaceVariablesInPrompt(prompt, movieData) {
    let replacedPrompt = prompt;
    for (const key in movieData) {
        if (Object.hasOwnProperty.call(movieData, key)) {
            const placeholder = `{${key}}`;
            const value = typeof movieData[key] === 'object' ? JSON.stringify(movieData[key]) : String(movieData[key]);
            replacedPrompt = replacedPrompt.split(placeholder).join(value || '');
        }
    }
    return replacedPrompt;
}

async function processMovie(movie, prompt, io) {
    try {
        await checkStatus(io);
        log(io, 'info', `  -> Đang xử lý phim: "${movie.name}"`);

        const finalPrompt = replaceVariablesInPrompt(prompt, movie.toJSON());

        // --- NƠI ĐẶT LOGIC GỌI API CỦA BÊN THỨ 3 ĐỂ TẠO CONTENT ---
        const generatedContent = `Đây là nội dung AI cho phim <b>"${movie.name}"</b>. <br>Nội dung được tạo dựa trên prompt: "<i>${finalPrompt}</i>". <br><br>Đây là nội dung giả định có hỗ trợ <b>HTML</b>.`;
        await sleep(500);
        // --- KẾT THÚC LOGIC AI ---

        await Movie.update(
            { ai_content: generatedContent },
            { where: { _id: movie._id } }
        );
        
        return {
            _id: movie._id, // Trả về _id để định danh duy nhất
            name: movie.name,
            status: 'updated',
            ai_content: generatedContent 
        };
    } catch (error) {
        log(io, 'error', `Lỗi khi xử lý phim "${movie.name}": ${error.message}`);
        return null;
    }
}

module.exports = control;