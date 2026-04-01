import express from "express";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from 'xlsx';
import nodemailer from 'nodemailer';

const { Pool } = pg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️ ADVERTENCIA: DATABASE_URL no está definida en las variables de entorno.");
}

console.log("🚀 Iniciando configuración de base de datos...");

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString?.includes("supabase") || process.env.NODE_ENV === "production" 
    ? { rejectUnauthorized: false } 
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Aumentamos a 10s para dar tiempo a Supabase a "despertar"
});

// Manejo de errores de conexión para evitar que el servidor se cuelgue
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Initialize Database
async function initDb() {
  console.log("🔍 Iniciando conexión con Supabase...");
  try {
    const client = await pool.connect();
    console.log("✅ Conexión exitosa a PostgreSQL.");
    client.release();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
        type TEXT,
        date TEXT,
        time TEXT
      );

      CREATE TABLE IF NOT EXISTS absences (
        id SERIAL PRIMARY KEY,
        teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
        date TEXT,
        status TEXT, -- 'JUSTIFICADA' | 'INJUSTIFICADA'
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS admins (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        name TEXT NOT NULL
      );
    `);

    console.log("📊 Verificando tablas...");
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM teachers");
    if (parseInt(rows[0].count) === 0) {
      await pool.query("INSERT INTO teachers (id, name) VALUES ('DOC-001', 'Juan Pérez'), ('DOC-002', 'María García'), ('DOC-003', 'Carlos Rodríguez')");
      console.log("✅ Datos iniciales insertados");
    }

    // Seed default admin if none exists
    const { rows: adminRows } = await pool.query("SELECT COUNT(*) as count FROM admins");
    if (parseInt(adminRows[0].count) === 0) {
      await pool.query("INSERT INTO admins (username, password, name) VALUES ($1, $2, $3)", ["admin", "admin123", "Administrador Principal"]);
    }
  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR O INICIALIZAR DB:", err instanceof Error ? err.stack : err);
  }
}

async function startServer() {
  await initDb();
  
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Ruta de salud mejorada para diagnosticar problemas de conexión
  app.get("/api/health", async (req, res) => {
    try {
      const startTime = Date.now();
      const client = await pool.connect();
      const dbRes = await client.query("SELECT NOW()");
      client.release();
      
      res.json({ 
        status: "ok", 
        database: "connected",
        latency: `${Date.now() - startTime}ms`,
        serverTime: dbRes.rows[0].now
      });
    } catch (err: any) {
      console.error("🚨 Error de salud de DB:", err.message);
      res.status(500).json({ 
        status: "error", 
        database: "disconnected",
        message: err.message 
      });
    }
  });

  // Rutas de Administración
  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    try {
      const { rows } = await pool.query(
        "SELECT username, name FROM admins WHERE username = $1 AND password = $2",
        [username, password]
      );
      if (rows.length > 0) {
        res.json({ success: true, user: rows[0] });
      } else {
        res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      }
    } catch (err) {
      res.status(500).json({ error: "Error en el servidor al autenticar" });
    }
  });

  app.get("/api/admins", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT username, name FROM admins");
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "Error al obtener administradores" });
    }
  });

  app.post("/api/admins", async (req, res) => {
    const { username, password, name } = req.body;
    try {
      // ON CONFLICT permite actualizar si el usuario ya existe (cambiar contraseña/nombre)
      await pool.query(
        `INSERT INTO admins (username, password, name) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (username) 
         DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name`,
        [username, password, name]
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Error al guardar administrador" });
    }
  });

  // Bloqueo en memoria para evitar registros dobles simultáneos (Race Conditions)
  const processingLocks = new Set<string>();

  app.post("/api/attendance", async (req, res) => {
    let lockKey = "";
    try {
      let { teacherId, type } = req.body; // type: 'ENTRADA' | 'SALIDA'
      
      if (!teacherId || !type) {
        return res.status(400).json({ error: "Faltan datos requeridos" });
      }

      if (!['ENTRADA', 'SALIDA'].includes(type)) {
        return res.status(400).json({ error: "Tipo de asistencia inválido" });
      }

      const tid = teacherId.toString().trim();

      // VERIFICACIÓN DE BLOQUEO: Si ya se está procesando este ID, detenemos.
      lockKey = `${tid}-${type}`;
      if (processingLocks.has(lockKey)) {
        return res.status(429).json({ error: "⏳ Procesando... espera un momento." });
      }
      processingLocks.add(lockKey);

      // 1. Validar si el docente existe y obtener su nombre
      const teacherRes = await pool.query("SELECT name FROM teachers WHERE id = $1", [tid]);
      if (teacherRes.rows.length === 0) {
        return res.status(404).json({ error: `El ID "${tid}" no está registrado en el sistema.` });
      }
      const teacherName = teacherRes.rows[0].name;

      const now = new Date();
      const timeZone = 'America/Lima';
      // Formato YYYY-MM-DD en hora Perú
      const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(now);
      // Usamos en-GB para forzar formato 24h (HH:mm:ss) y evitar problemas de AM/PM
      const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone }).format(now);

      await pool.query(
        "INSERT INTO attendance (teacher_id, type, date, time) VALUES ($1, $2, $3, $4)",
        [tid, type, date, time]
      );

      res.json({ success: true, message: `Asistencia de ${type} registrada`, teacherName });
    } catch (error: any) {
      console.error("Error recording attendance:", error);
      res.status(500).json({ error: "Error al registrar asistencia" });
    } finally {
      if (lockKey) processingLocks.delete(lockKey);
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

  // Ruta para generar y enviar el reporte mensual por correo
  app.post("/api/admin/send-monthly-report", async (req, res) => {
    // Solo permitimos la ejecución si se envía una clave secreta (opcional por seguridad)
    // o si confiamos en el cron-job.
    
    try {
      const now = new Date();
      // Obtenemos el mes pasado
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthPrefix = lastMonthDate.toISOString().slice(0, 7); // "YYYY-MM"
      const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(lastMonthDate);

      // 1. Obtener datos de asistencia del mes pasado
      const attendance = await pool.query(`
        SELECT t.name as teacher_name, a.teacher_id, a.type, a.date, a.time 
        FROM attendance a 
        JOIN teachers t ON a.teacher_id = t.id
        WHERE a.date LIKE $1
        ORDER BY a.date DESC, a.time DESC
      `, [`${monthPrefix}%`]);

      // 2. Obtener faltas del mes pasado
      const absences = await pool.query(`
        SELECT t.name as teacher_name, ab.teacher_id, ab.status, ab.date, ab.reason 
        FROM absences ab 
        JOIN teachers t ON ab.teacher_id = t.id
        WHERE ab.date LIKE $1
        ORDER BY ab.date DESC
      `, [`${monthPrefix}%`]);

      // 3. Crear el libro de Excel
      const dataForExcel = [
        ...attendance.rows.map(r => ({
          'Tipo': 'ASISTENCIA', 'Docente': r.teacher_name, 'ID': r.teacher_id, 
          'Evento': r.type, 'Fecha': r.date, 'Detalle': r.time
        })),
        ...absences.rows.map(a => ({
          'Tipo': 'FALTA', 'Docente': a.teacher_name, 'ID': a.teacher_id, 
          'Evento': a.status, 'Fecha': a.date, 'Detalle': a.reason || 'Sin motivo'
        }))
      ];

      if (dataForExcel.length === 0) {
        return res.json({ success: true, message: "No había datos para el mes pasado." });
      }

      const ws = XLSX.utils.json_to_sheet(dataForExcel);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reporte Mensual");
      const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      // 4. Configurar el envío de correo (Debes configurar estas variables en Render)
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER, // Tu correo Gmail
          pass: process.env.SMTP_PASS  // Tu "Contraseña de Aplicación" de Google
        }
      });

      const mailOptions = {
        from: `"Sistema de Asistencia" <${process.env.SMTP_USER}>`,
        to: process.env.ADMIN_EMAIL || process.env.SMTP_USER, // A quién se le envía
        subject: `Reporte Mensual de Asistencia - ${monthName}`,
        text: `Hola, adjuntamos el reporte automático de asistencia correspondiente a ${monthName}.`,
        attachments: [
          {
            filename: `Reporte_Asistencia_${monthPrefix}.xlsx`,
            content: excelBuffer
          }
        ]
      };

      await transporter.sendMail(mailOptions);
      console.log(`✅ Reporte de ${monthName} enviado correctamente.`);
      res.json({ success: true, message: "Reporte enviado por correo." });

    } catch (error: any) {
      console.error("❌ Error generando reporte automático:", error);
      res.status(500).json({ error: "Error al generar o enviar el reporte mensual." });
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

  // Actualizar un docente
  app.put("/api/teachers/:id", async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
      await pool.query("UPDATE teachers SET name = $1 WHERE id = $2", [name, id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Error al actualizar docente" });
    }
  });

  // Eliminar un docente
  app.delete("/api/teachers/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Eliminamos primero los registros vinculados en las tablas de asistencia y faltas
      await client.query("DELETE FROM attendance WHERE teacher_id = $1", [id]);
      await client.query("DELETE FROM absences WHERE teacher_id = $1", [id]);

      // 2. Ahora que no hay dependencias, eliminamos al docente
      await client.query("DELETE FROM teachers WHERE id = $1", [id]);

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e: any) {
      await client.query('ROLLBACK');
      console.error("Error al eliminar docente en cascada:", e);
      res.status(500).json({ error: "Error al eliminar docente y sus registros asociados" });
    } finally {
      client.release();
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

  app.listen(Number(PORT), "0.0.0.0", () => {
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
