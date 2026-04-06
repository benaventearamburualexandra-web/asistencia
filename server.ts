import express from "express";
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
  max: 20, // Aumentamos conexiones para evitar bloqueos
  min: 2,  // Mantenemos conexiones mínimas abiertas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000, // 30s para dar tiempo a Supabase a despertar
  maxUses: 7500, // Ayuda a refrescar conexiones y evitar fugas de memoria
});

// Manejo de errores de conexión para evitar que el servidor se cuelgue
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Initialize Database
async function initDb() {
  let retries = 5;
  while (retries > 0) {
    let client;
    try {
      console.log(`🔍 Intentando conectar con Supabase... (Intentos restantes: ${retries})`);
      client = await pool.connect();
      console.log("✅ Conexión exitosa a PostgreSQL.");
      
      await client.query(`
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
          status TEXT,
          reason TEXT
        );
  
        CREATE TABLE IF NOT EXISTS admins (
          username TEXT PRIMARY KEY,
          password TEXT NOT NULL,
          name TEXT NOT NULL
        );
      `);
  
      // Seed default data if needed
      const { rows } = await client.query("SELECT COUNT(*) as count FROM teachers");
      if (parseInt(rows[0].count) === 0) {
        await client.query("INSERT INTO teachers (id, name) VALUES ('DOC-001', 'Juan Pérez'), ('DOC-002', 'María García')");
      }

      // Crear administrador por defecto si no existe ninguno
      const { rows: adminCount } = await client.query("SELECT COUNT(*) as count FROM admins");
      if (parseInt(adminCount[0].count) === 0) {
        await client.query(
          "INSERT INTO admins (username, password, name) VALUES ($1, $2, $3)",
          ["admin", "admin123", "Administrador Principal"]
        );
        console.log("✅ Usuario administrador creado por defecto (admin / admin123)");
      }

      return; // Éxito, salimos del bucle
    } catch (err) {
      retries--;
      console.error(`❌ Error de conexión o inicialización de DB: ${err instanceof Error ? err.message : err}. Reintentando...`);
      if (retries > 0) await new Promise(res => setTimeout(res, 5000)); // Esperar 5s antes de reintentar
      else {
        console.error("❌ Fallaron todos los intentos de conexión/inicialización de DB.");
        throw new Error(`Failed to connect or initialize database after multiple retries: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      if (client) client.release();
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Health check inmediato para que Render no falle el despliegue
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      uptime: Math.floor(process.uptime()) + "s",
      message: "Server is running"
    });
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
    } catch (err: any) {
      console.error("❌ Error de autenticación:", err.message);
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
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Usar CWD (Current Working Directory) es más seguro en Render para encontrar la carpeta dist
    const distPath = path.resolve(process.cwd(), "dist");
    
    app.use(express.static(distPath, { maxAge: '1d' })); // Cache para velocidad
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`
=================================================
  SERVIDOR ESCUCHANDO EN PUERTO ${PORT}
  Inicializando base de datos en segundo plano...
=================================================
    `);
    // Iniciamos la DB después de que el servidor ya está escuchando peticiones
    initDb().catch(console.error);
  });
}

startServer().catch(err => {
  console.error("*****************************************");
  console.error("ERROR CRITICO AL INICIAR EL SERVIDOR:");
  console.error(err);
  console.error("*****************************************");
  process.exit(1);
});
