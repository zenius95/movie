const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

const { sequelize, initDb } = require('./models');
const movieRoutes = require('./routes/movieRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const syncControl = require('./scripts/sync');
const aiControl = require('./scripts/ai_content'); // Thêm dòng này
const { fetchApi } = require('./utils/apiFetcher');
const expressLayouts = require('express-ejs-layouts');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;


// Cấu hình Session
const myStore = new SequelizeStore({
  db: sequelize,
});

app.use(session({
  secret: 'a-very-secret-key-that-is-long-and-random',
  store: myStore,
  resave: false,
  proxy: true,
  saveUninitialized: false,
}));
myStore.sync();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);


app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', movieRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);


// API routes
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


// Socket.io
io.on('connection', (socket) => {
  console.log('Một người dùng đã kết nối');
  
  // Gửi trạng thái Sync
  socket.emit('sync-state', syncControl.getState());
  socket.on('sync:get-state', () => {
    socket.emit('sync-state', syncControl.getState());
  });

  socket.on('sync:start', (options) => syncControl.start(io, options));
  socket.on('sync:pause', () => syncControl.pause(io));
  socket.on('sync:resume', () => syncControl.resume(io));
  socket.on('sync:stop', () => syncControl.stop(io));

  // --- THÊM LOGIC CHO AI CONTENT ---
  // Gửi trạng thái AI Content
  socket.emit('ai-state', aiControl.getState());
  socket.on('ai:get-state', () => {
    socket.emit('ai-state', aiControl.getState());
  });

  socket.on('ai:start', (options) => aiControl.start(io, options));
  socket.on('ai:pause', () => aiControl.pause(io));
  socket.on('ai:resume', () => aiControl.resume(io));
  socket.on('ai:stop', () => aiControl.stop(io));
  // --- KẾT THÚC ---
});

initDb().then(async () => {
    const { User } = require('./models');
    const admin = await User.findOne({ where: { username: 'admin' } });
    if (!admin) {
        await User.create({
            username: 'admin',
            password: 'password',
            role: 'admin'
        });
        console.log('Admin user created with default password "password"');
    }

    server.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
        console.log(`Admin access: http://localhost:${PORT}/admin`);
    });
});