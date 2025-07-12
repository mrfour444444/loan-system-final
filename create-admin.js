const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

// 连接数据库
const db = new sqlite3.Database('./crm.db');

// 创建管理员账号
(async () => {
  const email = 'mrfour444444@gmail.com';
  const plainPassword = '123456';
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err) {
      console.error('❌ 查询失败:', err.message);
      db.close();
      return;
    }

    if (user) {
      console.log('ℹ️ 已存在用户，无需重复添加');
      db.close();
    } else {
      db.run(
        `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
        ['admin', email, hashedPassword, 'admin'],
        (err2) => {
          if (err2) {
            console.error('❌ 插入失败:', err2.message);
          } else {
            console.log('✅ Admin 用户创建成功');
          }
          db.close();
        }
      );
    }
  });
})();

