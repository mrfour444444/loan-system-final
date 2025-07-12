require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const expressLayouts = require('express-ejs-layouts');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIG ==========
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore,
  secret: 'secret',
  resave: false,
  saveUninitialized: false
}));

// ========== MIDDLEWARE ==========
function authRequired(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function adminOnly(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  res.status(403).send('Forbidden');
}

// ========== MAIL SETUP ==========
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ========== ROUTES ==========

// LOGIN
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.render('login', { error: 'Invalid email' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('login', { error: 'Wrong password' });
    req.session.user = user;
    return res.redirect('/due-installments');
  });
});

// LOGOUT
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// REGISTER (ADMIN ONLY)
app.get('/register', authRequired, adminOnly, (req, res) => res.render('register', { error: null }));

app.post('/register', authRequired, adminOnly, async (req, res) => {
  const { username, email, password, role } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
    [username, email, hashed, role || 'staff'],
    err => {
      if (err) return res.render('register', { error: 'Email exists' });
      res.redirect('/users');
    });
});

// FORGOT PASSWORD
app.get('/forgot-password', (req, res) => res.render('forgot-password', { error: null, success: null }));

app.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  const newPass = crypto.randomBytes(4).toString('hex');
  bcrypt.hash(newPass, 10, (err, hashed) => {
    db.run(`UPDATE users SET password = ? WHERE email = ?`, [hashed, email], function (err2) {
      if (err2 || this.changes === 0) return res.render('forgot-password', { error: 'Email not found', success: null });
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset',
        text: `Your new password: ${newPass}`
      }, (err3) => {
        if (err3) return res.render('forgot-password', { error: 'Mail error', success: null });
        res.render('forgot-password', { error: null, success: 'New password sent to email' });
      });
    });
  });
});

// CHANGE PASSWORD
app.get('/change-password', authRequired, (req, res) => res.render('change-password', { error: null, success: null }));

app.post('/change-password', authRequired, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = req.session.user;
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.render('change-password', { error: 'Wrong current password', success: null });

  const hashed = await bcrypt.hash(newPassword, 10);
  db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, user.id], err => {
    if (err) return res.render('change-password', { error: 'Update error', success: null });
    db.run(`INSERT INTO password_logs (user_id, changed_at) VALUES (?, datetime('now'))`, [user.id]);
    req.session.user.password = hashed;
    res.render('change-password', { error: null, success: 'Password changed' });
  });
});

// DUE INSTALLMENTS
app.get('/due-installments', authRequired, (req, res) => {
  db.all(`
    SELECT loans.*, customers.name AS customer_name
    FROM loans
    JOIN customers ON loans.customer_id = customers.id
    WHERE date(loans.due_date) >= date('now')
    ORDER BY loans.due_date ASC
  `, [], (err, rows) => {
    res.render('due-installments', { loans: rows });
  });
});

// NEW LOAN
app.get('/loan/add', authRequired, adminOnly, (req, res) => {
  db.all(`SELECT * FROM customers`, [], (err, customers) => {
    res.render('new-loan', { customers });
  });
});

app.post('/loan/add', authRequired, adminOnly, (req, res) => {
  const {
    customer_id, agent, collector, loan_date, purpose, remarks,
    installment_count, sequence_days, amounts, due_dates
  } = req.body;

  const amountsArr = Array.isArray(amounts) ? amounts : [amounts];
  const dueDatesArr = Array.isArray(due_dates) ? due_dates : [due_dates];

  for (let i = 0; i < dueDatesArr.length; i++) {
    let amount = parseFloat(amountsArr[i]);
    if (agent !== collector) amount /= 2;
    db.run(`
      INSERT INTO loans (customer_id, agent, collector, loan_date, due_date, purpose, remarks, sequence_no, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer_id, agent, collector, loan_date, dueDatesArr[i], purpose, remarks, i + 1, amount]);
  }
  res.redirect('/due-installments');
});

// SEARCH
app.get('/search', authRequired, (req, res) => {
  res.render('search', { results: null });
});

app.post('/search', authRequired, (req, res) => {
  const term = `%${req.body.term}%`;
  db.all(`
    SELECT loans.*, customers.name AS customer_name
    FROM loans
    JOIN customers ON loans.customer_id = customers.id
    WHERE customers.name LIKE ? OR customers.id LIKE ?
    ORDER BY loans.due_date ASC
  `, [term, term], (err, rows) => {
    res.render('search', { results: rows });
  });
});

// CUSTOMERS
app.get('/customers', authRequired, (req, res) => {
  db.all(`SELECT * FROM customers`, [], (err, rows) => {
    res.render('customers', { customers: rows });
  });
});

app.post('/customers', authRequired, (req, res) => {
  const { name, email, phone } = req.body;
  db.run(`INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)`, [name, email, phone], () => {
    res.redirect('/customers');
  });
});

// SYSTEM USERS
app.get('/users', authRequired, adminOnly, (req, res) => {
  db.all(`SELECT * FROM users`, [], (err, users) => {
    res.render('users', { users });
  });
});

// ADVANCE MONEY
app.get('/advance-money', authRequired, (req, res) => {
  db.all(`
    SELECT advance_money.*, customers.name AS customer_name
    FROM advance_money
    JOIN customers ON advance_money.customer_id = customers.id
  `, [], (err, rows) => {
    res.render('advance-money', { advances: rows });
  });
});

app.post('/advance-money', authRequired, (req, res) => {
  const { customer_id, amount, remarks, date } = req.body;
  db.run(`
    INSERT INTO advance_money (customer_id, amount, remarks, date)
    VALUES (?, ?, ?, ?)`, [customer_id, amount, remarks, date], () => {
    res.redirect('/advance-money');
  });
});

// MONEY COLLECTION
app.get('/money-collection', authRequired, (req, res) => {
  db.all(`
    SELECT loans.id AS loan_id, loans.amount, loans.collected_amount, customers.name AS customer_name
    FROM loans
    JOIN customers ON loans.customer_id = customers.id
  `, [], (err, rows) => {
    res.render('money-collection', { loans: rows });
  });
});

app.post('/money-collection', authRequired, (req, res) => {
  const { loan_id, amount, date, remarks } = req.body;
  db.run(`INSERT INTO money_collection (loan_id, amount, date, remarks) VALUES (?, ?, ?, ?)`,
    [loan_id, amount, date, remarks], () => {
      db.run(`UPDATE loans SET collected_amount = collected_amount + ? WHERE id = ?`,
        [amount, loan_id], () => {
        res.redirect('/money-collection');
      });
    });
});

// EXPENSES
app.get('/expenses', authRequired, (req, res) => {
  db.all(`SELECT * FROM expenses ORDER BY date DESC`, [], (err, rows) => {
    res.render('expenses', { expenses: rows });
  });
});

app.post('/expenses', authRequired, (req, res) => {
  const { name, amount, date, remarks } = req.body;
  db.run(`INSERT INTO expenses (name, amount, date, remarks) VALUES (?, ?, ?, ?)`,
    [name, amount, date, remarks], () => res.redirect('/expenses'));
});

// REPORTS
app.get('/reports', authRequired, (req, res) => {
  db.all(`SELECT SUM(amount) as total_loan FROM loans`, [], (err1, loans) => {
    db.all(`SELECT SUM(amount) as total_collected FROM money_collection`, [], (err2, collections) => {
      db.all(`SELECT SUM(amount) as total_expenses FROM expenses`, [], (err3, expenses) => {
        res.render('reports', {
          total_loan: loans[0].total_loan || 0,
          total_collected: collections[0].total_collected || 0,
          total_expenses: expenses[0].total_expenses || 0
        });
      });
    });
  });
});

// 🟢 首页跳转到登录页
app.get('/', (req, res) => {
  res.redirect('/login');
});

// 🟢 启动服务
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
