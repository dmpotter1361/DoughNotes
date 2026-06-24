import 'dotenv/config'; // load .env before any module reads process.env
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import './db.js'; // initialize schema on boot
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import recipeRoutes from './routes/recipes.js';
import imageRoutes from './routes/images.js';
import bakeRoutes from './routes/bakes.js';
import collectionRoutes from './routes/collections.js';
import adminRoutes from './routes/admin.js';
import driveRoutes from './routes/drive.js';
import importRoutes from './routes/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3500; // 3500 → a nod to 350°F

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

// --- API routes ---
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api', imageRoutes);       // /api/recipes/:id/images, /api/images/:id
app.use('/api', bakeRoutes);        // /api/recipes/:id/bakes, /api/bakes/:id
app.use('/api', collectionRoutes);  // /api/tags, /api/collections...
app.use('/api/admin', adminRoutes);
app.use('/api/drive', driveRoutes); // /api/drive/connect, callback, status, export...
app.use('/api/import', importRoutes); // /api/import/ocr

// --- Serve frontend (production / Docker) ---
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`DoughNotes server running on port ${PORT}`);
});
