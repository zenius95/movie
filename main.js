const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");

const { initDb } = require('./models');
const movieRoutes = require('./routes/movieRoutes');
const syncControl = require('./scripts/sync'); // Import sync controller
const { fetchApi } = require('./utils/apiFetcher');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use('/', movieRoutes);

app.get('/sync', (req, res) => {
    res.render('pages/sync', { title: 'Bảng điều khiển đồng bộ' });
});

app.get('/api/the-loai', async (req, res) => {
    try {
        const data = await fetchApi('/api/the-loai');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

app.get('/api/quoc-gia', async (req, res) => {
    try {
        const data = await fetchApi('/api/quoc-gia');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch countries' });
    }
});

app.get('/api/nam-phat-hanh', async (req, res) => {
    try {
        const data = await fetchApi('/api/nam-phat-hanh');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch years' });
    }
});


// Lắng nghe kết nối từ client
io.on('connection', (socket) => {
  console.log('Một người dùng đã kết nối vào trang sync');
  
  // Gửi trạng thái hiện tại ngay khi kết nối
  socket.emit('sync-state', syncControl.getState());

  // Lắng nghe các sự kiện điều khiển từ client
  socket.on('sync:start', (options) => {
    syncControl.start(io, options);
  });
  socket.on('sync:pause', () => {
    syncControl.pause(socket);
  });
  socket.on('sync:resume', () => {
    syncControl.resume(socket);
  });
  socket.on('sync:stop', () => {
    syncControl.stop(socket);
  });
});

initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
});