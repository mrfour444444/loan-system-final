require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const csrf = require('csurf');
const { db, run, all, get } = require('./db');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// 设置 EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

// 设置 session（30分钟自动过期）
app.use(session({
  store: new SQLiteStore(),
  secret: 'loan_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 60 * 1000 // 30 分钟
  }
}));

// 启用 CSRF 保护
app.use(csrf());

// 设置语言
app.use((req, res, next) => {
  if (!req.session.lang) req.session.lang = 'en';
  if (req.query.lang) req.session.lang = req.query.lang;
  res.locals.lang = req.session.lang;
  next();
});

// 权限中间件
function authRequired(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function adminOnly(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/');
  }
  next();
}

// 登录页面
app.get('/login', (req, res) => {
  res.render('login', { error: null, lang: req.session.lang });
});

// 登录尝试限制（基于 IP）
const loginAttempts = {};
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;

  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, lastAttempt: Date.now() };

  if (loginAttempts[ip].count >= 5 && Date.now() - loginAttempts[ip].lastAttempt < 15 * 60 * 1000) {
    return res.render('login', {
      error: 'Too many login attempts. Please try again after 15 minutes.',
      lang: req.session.lang
    });
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    loginAttempts[ip].count++;
    loginAttempts[ip].lastAttempt = Date.now();
    return res.render('login', { error: 'User not found', lang: req.session.lang });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    loginAttempts[ip].count++;
    loginAttempts[ip].lastAttempt = Date.now();
    return res.render('login', { error: 'Incorrect password', lang: req.session.lang });
  }

  loginAttempts[ip] = { count: 0, lastAttempt: 0 }; // 重置
  req.session.user = user;
  res.redirect('/due-installments');
});

// 登出
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// 注册页面
app.get('/register', adminOnly, (req, res) => {
  res.render('register', { error: null, message: null, lang: req.session.lang });
});
app.post('/register', adminOnly, async (req, res) => {
  const { username, email, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    await run('INSERT INTO users (username, email, password, role, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
      [username, email, hash, role]);
    res.render('register', { message: 'User created', error: null, lang: req.session.lang });
  } catch (e) {
    res.render('register', { error: 'Email already used', message: null, lang: req.session.lang });
  }
});

// 忘记密码
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { message: null, error: null, lang: req.session.lang });
});
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    return res.render('forgot-password', { error: 'Email not found', message: null, lang: req.session.lang });
  }

  const newPassword = crypto.randomBytes(4).toString('hex');
  const hashed = await bcrypt.hash(newPassword, 10);
  await run('UPDATE users SET password = ? WHERE email = ?', [hashed, email]);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: email,
    subject: 'Password Reset',
    text: `Your new password is: ${newPassword}`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      return res.render('forgot-password', { error: 'Failed to send email', message: null, lang: req.session.lang });
    }
    res.render('forgot-password', { message: 'New password sent to your email', error: null, lang: req.session.lang });
  });
});

// 修改密码
app.get('/change-password', authRequired, (req, res) => {
  res.render('change-password', {
    message: null,
    error: null,
    csrfToken: req.csrfToken(),
    lang: req.session.lang
  });
});
app.post('/change-password', authRequired, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = await get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);

  if (!await bcrypt.compare(current_password, user.password)) {
    return res.render('change-password', { error: 'Incorrect current password', message: null, csrfToken: req.csrfToken(), lang: req.session.lang });
  }
  if (new_password !== confirm_password) {
    return res.render('change-password', { error: 'Passwords do not match', message: null, csrfToken: req.csrfToken(), lang: req.session.lang });
  }

  const hash = await bcrypt.hash(new_password, 10);
  await run('UPDATE users SET password = ? WHERE id = ?', [hash, user.id]);
  await run('INSERT INTO password_logs (user_id, changed_at) VALUES (?, datetime("now"))', [user.id]);

  res.render('change-password', { message: 'Password updated', error: null, csrfToken: req.csrfToken(), lang: req.session.lang });
});

// 首页重定向
app.get('/', authRequired, (req, res) => {
  res.redirect('/due-installments');
});

// 各功能页面
app.get('/due-installments', authRequired, async (req, res) => {
  const loans = await all(`
    SELECT l.*, c.name AS customer_name
    FROM loans l
    JOIN customers c ON l.customer_id = c.id
    ORDER BY l.due_date ASC
  `);
  res.render('due-installments', { loans, user: req.session.user, lang: req.session.lang });
});

app.get('/loan', adminOnly, async (req, res) => {
  const loans = await all(`
    SELECT DISTINCT l.loan_id AS id,
      c.name AS customer_name,
      l.original_agent AS agent_name,
      l.overall_amount AS amount,
      l.term_count,
      l.loan_issue_date AS start_date,
      l.remarks
    FROM loans l
    JOIN customers c ON l.customer_id = c.id
    ORDER BY l.loan_issue_date DESC
  `);
  res.render('loan', { loans, user: req.session.user, lang: req.session.lang });
});

app.get('/search', authRequired, (req, res) => {
  res.render('search', { user: req.session.user, lang: req.session.lang });
});

app.get('/customers', authRequired, async (req, res) => {
  const customers = await all('SELECT * FROM customers ORDER BY name ASC');
  res.render('customers', { customers, user: req.session.user, lang: req.session.lang });
});

app.get('/advance-money', authRequired, async (req, res) => {
  const records = await all(`
    SELECT a.*, u.username FROM advance_money a
    JOIN users u ON a.user_id = u.id
    ORDER BY a.date DESC
  `);
  res.render('advance-money', { records, user: req.session.user, lang: req.session.lang });
});

app.get('/expenses', authRequired, async (req, res) => {
  const expenses = await all('SELECT * FROM expenses ORDER BY date DESC');
  res.render('expenses', { expenses, user: req.session.user, lang: req.session.lang });
});

app.get('/money-collection', authRequired, async (req, res) => {
  const collections = await all(`
    SELECT m.*, l.loan_id, c.name AS customer_name
    FROM money_collection m
    JOIN loans l ON m.loan_id = l.id
    JOIN customers c ON l.customer_id = c.id
    ORDER BY m.date DESC
  `);
  res.render('money-collection', { collections, user: req.session.user, lang: req.session.lang });
});

app.get('/reports', authRequired, async (req, res) => {
  const loanCount = await get('SELECT COUNT(DISTINCT loan_id) AS count FROM loans');
  const totalCollected = await get('SELECT SUM(amount) AS total FROM money_collection');
  const totalExpense = await get('SELECT SUM(amount) AS total FROM expenses');
  res.render('reports', {
    loanCount: loanCount.count || 0,
    totalCollected: totalCollected.total || 0,
    totalExpense: totalExpense.total || 0,
    user: req.session.user,
    lang: req.session.lang
  });
});

app.get('/users', adminOnly, async (req, res) => {
  const users = await all('SELECT * FROM users ORDER BY created_at DESC');
  res.render('users', { users, user: req.session.user, lang: req.session.lang });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`✅ Loan System is running at http://localhost:${PORT}`);
});
