import express from "express";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase or any Postgres connection string
// BUSCA ESTO EN TU server.ts (Línea 15 aprox)
// Y REEMPLÁZALO POR ESTO:

const connectionString = process.env.DATABASE_URL;

console.log("🚀 Intentando conexión forzada a Supabase...");

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString?.includes("supabase") ? { rejectUnauthorized: false } : false
});

// Initialize Database
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        teacher_id TEXT REFERENCES teachers(id),
        type TEXT,
        date TEXT,
        time TEXT
      );

      CREATE TABLE IF NOT EXISTS absences (
        id SERIAL PRIMARY KEY,
        teacher_id TEXT REFERENCES teachers(id),
        date TEXT,
        status TEXT, -- 'JUSTIFICADA' | 'INJUSTIFICADA'
        reason TEXT
      );
    `);

    // Seed some initial data if empty
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM teachers");
    if (parseInt(rows[0].count) === 0) {
      await pool.query("INSERT INTO teachers (id, name) VALUES ($1, $2)", ["DOC-001", "Juan Pérez"]);
      await pool.query("INSERT INTO teachers (id, name) VALUES ($1, $2)", ["DOC-002", "María García"]);
      await pool.query("INSERT INTO teachers (id, name) VALUES ($1, $2)", ["DOC-003", "Carlos Rodríguez"]);
      console.log("✅ Datos iniciales insertados");
    }
  } catch (err) {
    console.error("❌ Error inicializando la base de datos:", err);
  }
}

async function startServer() {
  await initDb();
  
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  // En server.ts, busca la ruta de health y cámbiala por esta:
app.get("/api/health", async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    res.json({ status: "ok", database: "connected" });
  } catch (err: any) {
    res.status(500).json({ 
      status: "error", 
      database: "disconnected",
      message: err.message 
    });
  }
});

  app.post("/api/attendance", async (req, res) => {
    try {
      const { teacherId, type } = req.body; // type: 'ENTRADA' | 'SALIDA'
      
      if (!teacherId || !type) {
        return res.status(400).json({ error: "Faltan datos requeridos" });
      }

      const now = new Date();
      const date = now.toISOString().split('T')[0];
      const time = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Check if already registered for this type today
      const { rows } = await pool.query(
        "SELECT * FROM attendance WHERE teacher_id = $1 AND type = $2 AND date = $3",
        [teacherId, type, date]
      );
      
      if (rows.length > 0) {
        return res.status(400).json({ error: `Ya se registró una ${type} para este docente el día de hoy.` });
      }

      await pool.query(
        "INSERT INTO attendance (teacher_id, type, date, time) VALUES ($1, $2, $3, $4)",
        [teacherId, type, date, time]
      );

      res.json({ success: true, message: `Asistencia de ${type} registrada` });
    } catch (error: any) {
      console.error("Error recording attendance:", error);
      res.status(500).json({ error: "Error al registrar asistencia" });
    }
  });

  app.get("/api/teachers", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM teachers");
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "Error al obtener docentes" });
    }
  });

  app.get("/api/report", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT a.id, t.name as teacher_name, a.teacher_id, a.type, a.date, a.time 
        FROM attendance a 
        JOIN teachers t ON a.teacher_id = t.id
        ORDER BY a.id DESC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "Error al generar reporte" });
    }
  });

  // Add a new teacher (Manual)
  app.post("/api/teachers", async (req, res) => {
    const { id, name } = req.body;
    try {
      await pool.query("INSERT INTO teachers (id, name) VALUES ($1, $2)", [id, name]);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: "El ID ya existe o error en la base de datos" });
    }
  });

  // Absences API
  app.get("/api/absences", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT a.*, t.name as teacher_name 
        FROM absences a 
        JOIN teachers t ON a.teacher_id = t.id
        ORDER BY a.date DESC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "Error al obtener faltas" });
    }
  });

  app.post("/api/absences", async (req, res) => {
    const { teacherId, date, status, reason } = req.body;
    try {
      await pool.query(
        "INSERT INTO absences (teacher_id, date, status, reason) VALUES ($1, $2, $3, $4)",
        [teacherId, date, status, reason]
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Error al registrar falta" });
    }
  });

  app.delete("/api/absences/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query("DELETE FROM absences WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Error al eliminar falta" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`
=================================================
  SERVIDOR INICIADO EXITOSAMENTE (POSTGRES)
  Local:    http://localhost:${PORT}
=================================================
    `);
  });
}

startServer().catch(err => {
  console.error("*****************************************");
  console.error("ERROR CRITICO AL INICIAR EL SERVIDOR:");
  console.error(err);
  console.error("*****************************************");
  process.exit(1);
});

