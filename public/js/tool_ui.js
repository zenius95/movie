// File: public/js/tool_ui.js

function createToolInterface(config) {
    const socket = io();
    let processedItems = {}; // Dùng chung để lưu trữ kết quả (phim, v.v.)

    const ui = {
        renderState(state) {
            const isRunning = state.status === 'running' || state.status === 'paused';
            const isPaused = state.status === 'paused';

            config.elements.startButton.disabled = isRunning;
            config.elements.buttonText.textContent = isRunning ? 'Đang chạy...' : 'Bắt đầu';
            config.elements.pauseButton.disabled = !isRunning;
            config.elements.stopButton.disabled = !isRunning;
            
            // Logic vô hiệu hóa input được chuyển cho từng trang cụ thể quản lý
            if (config.onStateChange) {
                config.onStateChange(state);
            }

            config.elements.pauseButton.innerHTML = isPaused ? '<i class="bi bi-play-fill me-1"></i>Tiếp tục' : '<i class="bi bi-pause-fill me-1"></i>Tạm dừng';
            config.elements.pauseButton.classList.toggle('btn-warning', !isPaused);
            config.elements.pauseButton.classList.toggle('btn-info', isPaused);
            
            this.updateProgressBar(state.progress, state.status);
            config.elements.logContainer.innerHTML = '';
            state.logs.forEach(log => this.logToUI(log, false));
            config.elements.logContainer.scrollTop = config.elements.logContainer.scrollHeight;
            
            config.elements.resultsBody.innerHTML = '';
            
            Object.keys(processedItems).forEach(key => delete processedItems[key]);
            
            state.results.forEach(this.addResultRow);
            
            if (config.elements.loadingOverlay) {
                config.elements.loadingOverlay.style.display = 'none';
            }
        },
        updateProgressBar(progress, status) {
            const total = progress.total || 0;
            const percentage = total === 0 ? 0 : Math.round((progress.processed / total) * 100);
            config.elements.progressBar.style.width = `${percentage}%`;
            config.elements.progressBar.textContent = `${percentage}%`;
            config.elements.statFound.textContent = total;
            config.elements.statSuccess.textContent = progress.success;
            config.elements.statErrors.textContent = progress.errors;

            config.elements.progressBar.classList.remove('progress-bar-animated', 'bg-success', 'bg-danger');
            if (status === 'running' || status === 'paused') {
                config.elements.progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
            } else if (status === 'stopped') {
                config.elements.progressBar.classList.add('bg-danger');
            } else if (status === 'idle' && progress.processed > 0 && progress.processed === total) {
                config.elements.progressBar.classList.add('bg-success');
            }
        },
        logToUI(data, shouldScroll = true) {
            const logContainer = config.elements.logContainer;
            const isAtBottom = logContainer.scrollTop + logContainer.clientHeight >= logContainer.scrollHeight - 20;
            const logEntry = document.createElement('div');
            const typeToClass = { 'info': 'text-info-emphasis', 'success': 'text-success', 'error': 'text-danger', 'warning': 'text-warning' };
            logEntry.className = typeToClass[data.type] || 'text-muted';
            logEntry.innerHTML = `[${data.timestamp}] ${data.message}`;
            logContainer.appendChild(logEntry);
            if (shouldScroll && isAtBottom) {
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        },
        addResultRow(item) {
            config.renderResultRow(item, processedItems);
        }
    };

    const settings = {
        get() {
            const opts = config.getSettings();
            localStorage.setItem(config.localStorageKey, JSON.stringify(opts));
            return opts;
        },
        load() {
            const saved = JSON.parse(localStorage.getItem(config.localStorageKey)) || {};
            config.loadSettings(saved);
        }
    };

    function addAutoSaveListeners() {
        config.elements.inputs.forEach(input => {
            input.addEventListener('change', () => {
                settings.get();
            });
            if (input.type === 'text' || input.type === 'password' || input.tagName === 'TEXTAREA') {
                input.addEventListener('keyup', () => {
                    settings.get();
                });
            }
        });
    }

    config.elements.startButton.addEventListener('click', () => {
        const options = settings.get();
        if (config.validateOptions && !config.validateOptions(options)) {
            return;
        }
        socket.emit(`${config.socketEventPrefix}:start`, options);
    });
    
    config.elements.pauseButton.addEventListener('click', () => {
        const isCurrentlyPaused = config.elements.pauseButton.textContent.trim() === 'Tiếp tục';
        socket.emit(`${config.socketEventPrefix}:${isCurrentlyPaused ? 'resume' : 'pause'}`);
    });

    config.elements.stopButton.addEventListener('click', () => socket.emit(`${config.socketEventPrefix}:stop`));
    
    if (config.elements.resultsBody && config.handleResultClick) {
        config.elements.resultsBody.addEventListener('click', (event) => {
            config.handleResultClick(event, processedItems);
        });
    }

    if (config.elements.clearLogButton) {
        config.elements.clearLogButton.addEventListener('click', () => {
            Swal.fire({
                title: 'Bạn có chắc chắn muốn xóa?',
                text: "Hành động này sẽ xóa vĩnh viễn file log và không thể hoàn tác!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Vâng, xóa nó!',
                cancelButtonText: 'Hủy'
            }).then((result) => {
                if (result.isConfirmed) {
                    socket.emit(`${config.socketEventPrefix}:clear-log`);
                    config.elements.logContainer.innerHTML = '';
                    Swal.fire('Đã xóa!', 'File log đã được xóa.', 'success');
                }
            });
        });
    }

    socket.on(`${config.socketEventPrefix}-state`, ui.renderState.bind(ui));
    socket.on(`${config.socketEventPrefix}-log`, ui.logToUI.bind(ui));
    socket.on(`${config.socketEventPrefix}-progress`, (progress) => ui.updateProgressBar(progress, 'running'));
    socket.on(`${config.socketEventPrefix}-start`, (data) => {
        ui.updateProgressBar({ processed: 0, total: data.total, success: 0, errors: 0 }, 'running');
    });
    socket.on(`${config.socketEventPrefix}-finished`, () => {
        socket.emit(`${config.socketEventPrefix}:get-state`);
    });
    
    if (config.customSocketEvents) {
        config.customSocketEvents(socket, ui, processedItems);
    }
    
    if (config.initialize) {
        config.initialize();
    }
    settings.load();
    addAutoSaveListeners();
    socket.emit(`${config.socketEventPrefix}:get-state`);
}