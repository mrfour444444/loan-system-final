const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./crm.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'staff',
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id TEXT,
    customer_id INTEGER,
    original_agent TEXT,
    current_agent TEXT,
    remarks TEXT,
    loan_issue_date TEXT,
    due_date TEXT,
    sequence_no INTEGER,
    collected_amount REAL DEFAULT 0,
    overall_amount REAL,
    term_count INTEGER,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    amount REAL,
    date TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS advance_money (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    description TEXT,
    date TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS money_collection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER,
    amount REAL,
    date TEXT,
    collected_by TEXT,
    FOREIGN KEY (loan_id) REFERENCES loans(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS password_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    changed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  console.log('✅ 所有数据库表初始化完成');
});

db.close();
