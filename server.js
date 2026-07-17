const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const archiver = require('archiver');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Ensure base uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Parse Authentication Config
const USERS_DB = {};
if (process.env.APP_USERS) {
  const pairs = process.env.APP_USERS.split(',');
  for (const pair of pairs) {
    const [u, p, r] = pair.split(':');
    if (u && p) {
      USERS_DB[u.trim()] = {
        password: p.trim(),
        role: r ? r.trim() : 'Viewer' // Default to Viewer if not specified
      };
    }
  }
} else if (process.env.APP_USERNAME && process.env.APP_PASSWORD) {
  USERS_DB[process.env.APP_USERNAME.trim()] = {
    password: process.env.APP_PASSWORD.trim(),
    role: 'Viewer' // Default to Viewer if not specified
  };
}

const configuredUsers = Object.keys(USERS_DB);
if (configuredUsers.length > 0) {
  const userString = configuredUsers.map(u => `${u} (${USERS_DB[u].role})`).join(', ');
  console.log(`Basic Authentication is ENABLED for users: ${userString}`);
} else {
  console.log(`WARNING: Basic Authentication is DISABLED. No credentials found in .env`);
}

// Map frontend folder names to safe physical directory names
const FOLDER_MAP = {
  'Survey Reports': 'Survey_Reports',
  'Microwave': 'Microwave',
  'Progress': 'Progress',
  'KMLs': 'KMLs',
  'Letters/MOMs': 'Letters_MOMs',
  'Misc': 'Misc',
  'Images': 'Images'
};

// Initialize SQLite Database
const DB_FILE = path.join(UPLOADS_DIR, 'metadata.sqlite');
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      filename TEXT UNIQUE,
      originalname TEXT,
      size INTEGER,
      format TEXT,
      folder TEXT,
      safeFolder TEXT,
      projectId TEXT,
      year TEXT,
      remarks TEXT,
      uploadDate TEXT,
      uploader TEXT
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      } else {
        // Attempt to add uploader column if it doesn't exist
        db.run("ALTER TABLE files ADD COLUMN uploader TEXT DEFAULT 'Unknown'", () => {});
        
        db.run("UPDATE files SET projectId = ''", (err) => {
           if (err) console.error("Error wiping projectId:", err.message);
        });
        migrateJsonToSqlite();
      }
    });
  }
});

// Helper for database queries
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Migrate old metadata.json if it exists
async function migrateJsonToSqlite() {
  const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');
  if (fs.existsSync(METADATA_FILE)) {
    console.log('Found legacy metadata.json. Starting migration to SQLite...');
    try {
      const data = fs.readFileSync(METADATA_FILE, 'utf8');
      if (data.trim()) {
        const metadata = JSON.parse(data);
        for (const m of metadata) {
          // Check if it already exists
          const exists = await getQuery(`SELECT filename FROM files WHERE filename = ?`, [m.filename]);
          if (!exists) {
            // Re-map folder name if it was the old one
            let folder = m.folder || 'Misc';
            if (folder === 'Letter/MOMs/Reports' || folder === 'Letter/MOM/Report') folder = 'Letters/MOMs';
            
            const safeFolder = FOLDER_MAP[folder] || m.safeFolder || '';
            
            await runQuery(`INSERT INTO files (id, filename, originalname, size, format, folder, safeFolder, projectId, year, remarks, uploadDate) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
              [m.id || Date.now().toString(), m.filename, m.originalname, m.size, m.format, folder, safeFolder, m.projectId, m.year, m.remarks, m.uploadDate]
            );
          }
        }
      }
      // Backup old JSON to prevent re-migration and avoid cleanup script crash
      fs.renameSync(METADATA_FILE, METADATA_FILE + '.bak');
      console.log('Migration complete. Renamed metadata.json to metadata.json.bak.');
    } catch (e) {
      console.error('Error during migration:', e);
    }
  }
}

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Save to root uploads dir temporarily because req.body is not fully parsed yet
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 30 * 1024 * 1024 } // 30 MB
});

// Basic Authentication Middleware
function basicAuth(req, res, next) {
  // Allow login endpoint to bypass auth
  if (req.path === '/api/login') return next();

  // If no credentials configured, skip auth
  if (Object.keys(USERS_DB).length === 0) {
    return next();
  }

  let b64auth = req.headers['x-auth-token'] || req.query.token || '';
  if (b64auth.startsWith('Basic ')) {
    b64auth = b64auth.split(' ')[1];
  }
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login && password && USERS_DB[login] && USERS_DB[login].password === password) {
    req.user = login; // Attach user to request
    req.userRole = USERS_DB[login].role; // Attach role to request
    return next();
  }

  res.status(401).json({ error: 'Authentication required' });
}

// Role Verification Middleware
function requireRole(role) {
  return (req, res, next) => {
    // If no credentials configured, allow all
    if (Object.keys(USERS_DB).length === 0) {
      return next();
    }
    if (req.userRole === role) {
      return next();
    }
    res.status(403).json({ error: `Forbidden: ${role} role required` });
  };
}

// Serve frontend UI without authentication
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(express.json());
app.use(basicAuth);
app.use('/uploads', express.static(UPLOADS_DIR));

// Login Endpoint
app.post('/api/login', express.json(), (req, res) => {
  const { username, password } = req.body;

  if (Object.keys(USERS_DB).length === 0) {
    return res.json({ success: true, message: 'Auth disabled', role: 'Master' });
  }

  if (username && password && USERS_DB[username] && USERS_DB[username].password === password) {
    res.json({ success: true, username, role: USERS_DB[username].role });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// API Endpoints

app.get('/api/files', async (req, res) => {
  try {
    const rows = await allQuery(`SELECT * FROM files ORDER BY uploadDate DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or file exceeds 30MB limit.' });
  }

  const year = req.body.year || '';
  if (year && !/^\d{4}$/.test(year)) {
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (err) {
      console.error('Failed to clean up temp file:', err);
    }
    return res.status(400).json({ error: 'Year must be a 4-digit integer' });
  }

  let folder = req.body.folder || 'Misc';
  const safeFolder = FOLDER_MAP[folder] || 'Misc';
  
  // Now that we have the parsed req.body, move the file to the correct folder
  const folderPath = path.join(UPLOADS_DIR, safeFolder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  const tempPath = req.file.path;
  const finalPath = path.join(folderPath, req.file.filename);
  fs.renameSync(tempPath, finalPath);

  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const format = ext || 'unknown';

  const fileData = {
    id: Date.now().toString(),
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    format: format,
    folder: folder,
    safeFolder: safeFolder,
    projectId: req.body.projectId || '',
    year: req.body.year || '',
    remarks: req.body.remarks || '',
    uploadDate: new Date().toISOString(),
    uploader: req.user || 'Unknown'
  };

  try {
    await runQuery(`INSERT INTO files (id, filename, originalname, size, format, folder, safeFolder, projectId, year, remarks, uploadDate, uploader) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [fileData.id, fileData.filename, fileData.originalname, fileData.size, fileData.format, fileData.folder, fileData.safeFolder, fileData.projectId, fileData.year, fileData.remarks, fileData.uploadDate, fileData.uploader]
    );
    res.json({ message: 'File uploaded successfully', file: fileData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup-zip', async (req, res) => {
  const folderFilter = req.query.folder;
  try {
    let query = `SELECT * FROM files`;
    let params = [];
    if (folderFilter) {
      query += ` WHERE folder = ?`;
      params.push(folderFilter);
    }

    const files = await allQuery(query, params);
    if (files.length === 0) {
      return res.status(404).json({ error: 'No files to backup' });
    }

    const safeFolderName = folderFilter ? folderFilter.replace(/[^a-zA-Z0-9]/g, '_') : 'all';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=ftp_files_backup_${safeFolderName}.zip`);

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(res);

    for (const file of files) {
      const filePath = path.join(UPLOADS_DIR, file.safeFolder || '', file.filename);
      if (fs.existsSync(filePath)) {
        const zipPath = path.join(file.folder || 'Misc', file.originalname);
        archive.file(filePath, { name: zipPath });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Error creating zip:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.get('/api/download/:filename', async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (fileData) {
      const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
      if (fs.existsSync(filePath)) {
        res.download(filePath, fileData.originalname);
      } else {
        res.status(404).json({ error: 'File not found on disk' });
      }
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/view/:filename', async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (fileData) {
      const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
      if (fs.existsSync(filePath)) {
        // Set content disposition to inline to force browser viewing instead of downloading
        res.setHeader('Content-Disposition', `inline; filename="${fileData.originalname}"`);
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: 'File not found on disk' });
      }
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename', async (req, res) => {
  const filename = req.params.filename;
  const { projectId, year, remarks, folder } = req.body;

  if (year !== undefined && year !== '') {
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: 'Year must be a 4-digit integer' });
    }
  }
  
  try {
    const currentData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (currentData) {
      let newFolder = currentData.folder;
      let newSafeFolder = currentData.safeFolder || '';

      // Handle Folder Change / Physical Move
      if (folder && folder !== currentData.folder) {
        newFolder = folder;
        newSafeFolder = FOLDER_MAP[newFolder] || 'Misc';
        
        const oldPath = path.join(UPLOADS_DIR, currentData.safeFolder || '', filename);
        const newDirPath = path.join(UPLOADS_DIR, newSafeFolder);
        const newPath = path.join(newDirPath, filename);

        try {
          if (!fs.existsSync(newDirPath)) {
            fs.mkdirSync(newDirPath, { recursive: true });
          }
          if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
          }
        } catch (err) {
          console.error("Error moving file:", err);
          return res.status(500).json({ error: 'Failed to move physical file.' });
        }
      }

      const pId = projectId !== undefined ? projectId : currentData.projectId;
      const yr = year !== undefined ? year : currentData.year;
      const rm = remarks !== undefined ? remarks : currentData.remarks;

      await runQuery(`UPDATE files SET projectId = ?, year = ?, remarks = ?, folder = ?, safeFolder = ? WHERE filename = ?`, 
        [pId, yr, rm, newFolder, newSafeFolder, filename]
      );
      
      res.json({ message: 'Metadata updated successfully' });
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename', requireRole('Master'), async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (fileData) {
      const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
      
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete physical file ${filePath} but removing metadata anyway:`, err);
      }
      
      await runQuery(`DELETE FROM files WHERE filename = ?`, [filename]);
      res.json({ message: 'File processed for deletion successfully' });
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
