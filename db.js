const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 连接数据库文件（默认 crm.db）
const db = new sqlite3.Database(path.join(__dirname, 'crm.db'), (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
  } else {
    console.log('✅ 已连接到 SQLite 数据库');
  }
});

// 导出执行函数（Promise 封装，便于 async/await 使用）
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

module.exports = {
  db,
  run,
  all,
  get
};
