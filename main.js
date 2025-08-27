const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

const { sequelize, initDb } = require('./models');
const movieRoutes = require('./routes/movieRoutes');
const authRoutes = require('./routes/authRoutes'); // <-- THÊM
const adminRoutes = require('./routes/adminRoutes'); // <-- THÊM
const syncControl = require('./scripts/sync');
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
  secret: 'a-very-secret-key-that-is-long-and-random', // Thay bằng một chuỗi bí mật của bạn
  store: myStore,
  resave: false,
  proxy: true,
  saveUninitialized: false,
}));
myStore.sync();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts); // <-- THÊM


app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // <-- THÊM ĐỂ PARSE FORM

// Routes
app.use('/', movieRoutes);
app.use('/', authRoutes); // <-- THÊM
app.use('/admin', adminRoutes); // <-- THÊM


// API routes (giữ nguyên)
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


// Socket.io (giữ nguyên)
io.on('connection', (socket) => {
  console.log('Một người dùng đã kết nối vào trang sync');
  
  socket.emit('sync-state', syncControl.getState());

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

initDb().then(async () => {
    // TẠO USER ADMIN MẶC ĐỊNH KHI KHỞI ĐỘNG (NẾU CHƯA CÓ)
    const { User } = require('./models');
    const admin = await User.findOne({ where: { username: 'admin' } });
    if (!admin) {
        await User.create({
            username: 'admin',
            password: 'password', // Mật khẩu là 'password', nên đổi ngay sau lần đăng nhập đầu tiên
            role: 'admin'
        });
        console.log('Admin user created with default password "password"');
    }

    server.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
        console.log(`Admin access: http://localhost:${PORT}/admin`);
    });
});