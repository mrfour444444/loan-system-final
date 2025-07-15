// backup-db.js
const fs = require('fs');
const path = require('path');

// 获取当前时间戳
const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-');

// 源数据库路径
const source = path.join(__dirname, 'crm.db');

// 目标备份文件夹路径
const backupFolder = path.join(__dirname, 'backups');
if (!fs.existsSync(backupFolder)) {
  fs.mkdirSync(backupFolder);
}

// 备份文件路径
const target = path.join(backupFolder, `crm-backup-${timestamp}.db`);

// 执行备份
fs.copyFile(source, target, (err) => {
  if (err) {
    console.error('❌ Backup failed:', err);
  } else {
    console.log(`✅ Backup created: ${target}`);
  }
});
