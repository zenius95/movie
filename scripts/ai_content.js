require('dotenv').config();
const { OpenAI } = require('openai');
const { Movie, sequelize } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.join(__dirname, '..', 'ai_content.log');

function loadInitialState(logPath) {
    let logs = [];
    if (fs.existsSync(logPath)) {
        const logData = fs.readFileSync(logPath, 'utf-8');
        logs = logData.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);
    }
    return {
        status: 'idle', logs, results: [],
        progress: { processed: 0, total: 0, success: 0, errors: 0 },
        options: {}
    };
}

let contentState = loadInitialState(LOG_FILE_PATH);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function log(io, message, type = 'info') {
    const logEntry = { type, message, timestamp: new Date().toLocaleTimeString() };
    contentState.logs.push(logEntry);
    fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + '\n');
    console.log(`[AI-CONTENT][${type.toUpperCase()}] ${message}`);
    if (io) io.emit('ai-log', logEntry);
}

async function checkStatus() {
    while (contentState.status === 'paused') await sleep(1000);
    if (contentState.status === 'stopped') throw new Error('AI process stopped by user');
}

const control = {
    start: (io, options) => {
        if (contentState.status === 'running' || contentState.status === 'paused') return;
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        contentState = { status: 'running', logs: [], results: [], progress: { processed: 0, total: 0, success: 0, errors: 0 }, options };
        io.emit('ai-state', contentState);
        log(io, 'BẮT ĐẦU TẠO NỘI DUNG AI');
        startGeneration(io, options);
    },
    pause: (io) => {
        if (contentState.status === 'running') {
            contentState.status = 'paused';
            log(io, 'Tiến trình đã tạm dừng.', 'warning');
            io.emit('ai-state', contentState);
        }
    },
    resume: (io) => {
        if (contentState.status === 'paused') {
            contentState.status = 'running';
            log(io, 'Tiến trình đã tiếp tục.');
            io.emit('ai-state', contentState);
        }
    },
    stop: (io) => {
        if (contentState.status === 'running' || contentState.status === 'paused') {
            const previousStatus = contentState.status;
            contentState.status = 'stopped';
            log(io, 'Tiến trình đã dừng theo yêu cầu.', 'error');
            io.emit('ai-state', contentState);
            if (previousStatus === 'paused') io.emit('ai-finished', contentState.status);
        }
    },
    getState: () => contentState,
    clearLog: () => {
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        contentState.logs = [];
    }
};

async function startGeneration(io, options) {
    const { target, concurrency, delay, systemPrompt, userPrompt, apiKeys, model } = options;
    let currentKeyIndex = 0;

    try {
        const effectiveApiKeys = apiKeys.length > 0 ? apiKeys : [process.env.OPENAI_API_KEY].filter(Boolean);
        if (effectiveApiKeys.length === 0) throw new Error('Không tìm thấy OpenAI API Key nào được cung cấp.');

        let whereCondition = {};
        if (target === 'empty') {
            whereCondition.ai_content = { [Op.or]: [null, ''] };
        }
        
        log(io, `PHASE 1: Đang tìm phim trong CSDL...`);
        let moviesToProcess = await Movie.findAll({ 
            where: whereCondition, 
            order: target === 'random_10' ? sequelize.random() : [['created_at', 'DESC']],
            limit: target === 'random_10' ? 10 : null
        });

        if (moviesToProcess.length === 0) {
            log(io, 'Không tìm thấy phim nào phù hợp.', 'warning');
            throw new Error('No movies found');
        }

        log(io, `PHASE 1 KẾT THÚC: Tìm thấy ${moviesToProcess.length} phim.`);
        contentState.progress.total = moviesToProcess.length;
        io.emit('ai-start', { total: moviesToProcess.length });

        for (let i = 0; i < moviesToProcess.length; i += concurrency) {
            await checkStatus();
            const batch = moviesToProcess.slice(i, i + concurrency);

            const results = await Promise.all(batch.map(async (movie) => {
                let success = false;
                let result = null;
                while (!success) {
                    if (currentKeyIndex >= effectiveApiKeys.length) throw new Error('Tất cả API key đều lỗi hoặc hết hạn mức.');
                    try {
                        result = await processMovie(movie, systemPrompt, userPrompt, effectiveApiKeys[currentKeyIndex], model, io);
                        success = true;
                    } catch (error) {
                        const statusCode = error.response ? error.response.status : null;
                        if (statusCode === 401 || statusCode === 429) {
                            log(io, `Key API thứ ${currentKeyIndex + 1} gặp lỗi. Thử key tiếp theo...`, 'warning');
                            currentKeyIndex++;
                        } else {
                            throw error;
                        }
                    }
                }
                return result;
            }));
            
            results.forEach(result => {
                if (result) {
                    contentState.progress.success++;
                    contentState.results.push(result);
                    io.emit('ai-movie-processed', result);
                } else {
                    contentState.progress.errors++;
                }
            });
            
            contentState.progress.processed += batch.length;
            io.emit('ai-progress', contentState.progress);
            log(io, `--- Hoàn thành lô ${Math.floor(i / concurrency) + 1} / ${Math.ceil(moviesToProcess.length / concurrency)} ---`);
            if (delay > 0) await sleep(delay);
        }
        
        log(io, '✅ TIẾN TRÌNH HOÀN TẤT!', 'success');

    } catch (error) {
        if (error.message !== 'AI process stopped by user') {
            log(io, `❌ Đã xảy ra lỗi nghiêm trọng: ${error.message}`, 'error');
        }
        control.stop(io);
    } finally {
        if (contentState.status !== 'stopped') {
            contentState.status = 'idle';
        }
        io.emit('ai-finished', contentState.status);
    }
}

async function processMovie(movie, systemPrompt, userPrompt, apiKey, model, io) {
    try {
        await checkStatus();
        log(io, `  -> Đang xử lý phim: "${movie.name}" với model: ${model}`);

        const finalUserPrompt = replaceVariablesInPrompt(userPrompt, movie.toJSON());
        
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: finalUserPrompt }
            ],
            model: model,
            response_format: { "type": "json_object" },
        });
        
        let resultJson = completion.choices[0].message.content;
        if (!resultJson) throw new Error('API không trả về kết quả.');
        
        await Movie.update({ ai_content: resultJson }, { where: { _id: movie._id } });
        return {
            _id: movie._id,
            name: movie.name,
            status: 'updated',
            ai_content: resultJson 
        };
    } catch (error) {
        throw error;
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

module.exports = control;