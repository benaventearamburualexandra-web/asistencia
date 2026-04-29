import express from "express";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
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
  allowExitOnIdle: true,
  application_name: 'asistencia_docente'
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
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          specialty TEXT NOT NULL,
          photo_url TEXT,
          schedule JSONB DEFAULT '{}'::jsonb
        );
        ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
        
        CREATE TABLE IF NOT EXISTS attendance (
          id SERIAL PRIMARY KEY,
          teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
          type TEXT,
          date TEXT,
          time TEXT,
          status TEXT DEFAULT 'PUNTUAL'
        );
        ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
  
        CREATE TABLE IF NOT EXISTS absences (
          id SERIAL PRIMARY KEY,
          teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
          date TEXT,
          status TEXT,
          reason TEXT
        );
        ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
  
        CREATE TABLE IF NOT EXISTS admins (
          username TEXT PRIMARY KEY,
          password TEXT NOT NULL,
          name TEXT NOT NULL
        );
        ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
      `);

      // Asegurar que la columna existe si la tabla ya estaba creada
      await client.query("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS photo_url TEXT");
      await client.query("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS schedule JSONB DEFAULT '{}'::jsonb");
      await client.query("ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PUNTUAL'");
  
      // Seed default data if needed
      const { rows } = await client.query("SELECT COUNT(*) as count FROM teachers");
      if (parseInt(rows[0].count) === 0) {
        await client.query(`
          INSERT INTO teachers (id, first_name, last_name, specialty) 
          VALUES ('DOC-001', 'Juan', 'Pérez', 'Matemática'), ('DOC-002', 'María', 'García', 'Comunicación')
        `);
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

    } catch (err) {
      retries--;
      const errorMsg = err instanceof Error ? err.message : String(err).substring(0, 500);
      console.error(`❌ Error de conexión o inicialización de DB: ${errorMsg}. Reintentando...`);
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

  // Aumentamos el límite para permitir el envío de fotos en Base64
  app.use(express.json({ limit: '10mb' }));

  // Health check mejorado para verificar también la base de datos
  app.get("/api/health", async (req, res) => {
    try {
      // Una consulta ultra rápida para verificar conexión sin carga
      const start = Date.now();
      await pool.query('SELECT 1');
      res.json({ 
        status: "ok", 
        db: "connected",
        uptime: Math.floor(process.uptime()) + "s",
        latency: (Date.now() - start) + "ms"
      });
    } catch (err) {
      // Si la DB no responde rápido, el servidor aún está vivo
      res.json({ status: "ok", db: "reconnecting" });
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
      let { teacherId, type, manualDate, manualTime } = req.body; // type: 'ENTRADA' | 'SALIDA'
      
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
      const teacherRes = await pool.query("SELECT (first_name || ' ' || last_name) as name, schedule FROM teachers WHERE id = $1", [tid]);
      if (teacherRes.rows.length === 0) {
        return res.status(404).json({ error: `El ID "${tid}" no está registrado en el sistema.` });
      }
      const { name: teacherName, schedule } = teacherRes.rows[0];

      const now = new Date();
      const timeZone = 'America/Lima';
      // Formato YYYY-MM-DD en hora Perú
      const date = manualDate || new Intl.DateTimeFormat('en-CA', { 
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone 
      }).format(now);
      // Usamos en-GB para forzar formato 24h (HH:mm:ss) y evitar problemas de AM/PM
      const time = manualTime || new Intl.DateTimeFormat('en-GB', { 
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone 
      }).format(now);

      // --- LÓGICA DE TARDANZA ---
      let status = 'PUNTUAL';
      if (type === 'ENTRADA' && schedule) {
        // Obtener el día de la semana en español/inglés para el objeto schedule
        const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(now).toLowerCase();
        const daySchedule = schedule[dayName] as any;
        
        if (daySchedule && daySchedule.enabled) {
          // Comparación simple de strings "HH:mm"
          const currentTimeStr = time.substring(0, 5);
          let referenceStart = null;

          if (Array.isArray(daySchedule.slots) && daySchedule.slots.length > 0) {
            // Buscamos el bloque de inicio más cercano a la hora actual
            let minDiff = Infinity;
            const toMinutes = (t: string) => {
              const [h, m] = t.split(':').map(Number);
              return (h || 0) * 60 + (m || 0);
            };
            const currentMins = toMinutes(currentTimeStr);

            for (const slot of daySchedule.slots) {
              if (slot.start) {
                const slotMins = toMinutes(slot.start);
                const diff = Math.abs(currentMins - slotMins);
                if (diff < minDiff) {
                  minDiff = diff;
                  referenceStart = slot.start;
                }
              }
            }
          } else if (daySchedule.start) {
            referenceStart = daySchedule.start;
          }

          if (referenceStart && currentTimeStr > referenceStart) {
            status = 'TARDE';
          }
        }
      }
      // --------------------------

      // --- VALIDACIÓN DE DUPLICADOS ---
      // Buscamos el último registro de este docente, hoy y del mismo tipo
      const lastMark = await pool.query(
        "SELECT time FROM attendance WHERE teacher_id = $1 AND date = $2 AND type = $3 ORDER BY time DESC LIMIT 1",
        [tid, date, type]
      );

      if (lastMark.rows.length > 0) {
        const lastTimeStr = lastMark.rows[0].time;

        // Convertimos HH:mm:ss a segundos totales para una comparación exacta
        const toSeconds = (tStr: string) => {
          const [h, m, s] = tStr.split(':').map(Number);
          return h * 3600 + m * 60 + s;
        };

        const diffSeconds = toSeconds(time) - toSeconds(lastTimeStr);
        const COOLDOWN_MINS = parseInt(process.env.ATTENDANCE_COOLDOWN || "5");

        if (diffSeconds < (COOLDOWN_MINS * 60) && diffSeconds >= 0) {
          const wait = Math.ceil((COOLDOWN_MINS * 60 - diffSeconds) / 60);
          return res.status(400).json({ 
            error: `Ya marcaste tu ${type}. Por favor, espera ${wait} minuto(s) para volver a registrar.` 
          });
        }
      }
      // --------------------------------

      await pool.query(
        "INSERT INTO attendance (teacher_id, type, date, time, status) VALUES ($1, $2, $3, $4, $5)",
        [tid, type, date, time, status]
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
        SELECT (t.first_name || ' ' || t.last_name) as teacher_name, a.teacher_id, a.type, a.date, a.time 
        FROM attendance a 
        JOIN teachers t ON a.teacher_id = t.id
        WHERE a.date LIKE $1
        ORDER BY a.date DESC, a.time DESC
      `, [`${monthPrefix}%`]);

      // 2. Obtener faltas del mes pasado
      const absences = await pool.query(`
        SELECT (t.first_name || ' ' || t.last_name) as teacher_name, ab.teacher_id, ab.status, ab.date, ab.reason 
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
      console.error("❌ Error generando reporte automático:", error?.message || "Error desconocido");
      res.status(500).json({ error: "Error al generar o enviar el reporte mensual." });
    }
  });

  app.get("/api/report", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT a.id, (t.first_name || ' ' || t.last_name) as teacher_name, a.teacher_id, a.type, a.date, a.time 
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
    const { first_name, last_name, specialty, photo_url, schedule } = req.body;
    try {
      await pool.query(
        "UPDATE teachers SET first_name = $1, last_name = $2, specialty = $3, photo_url = $4, schedule = $5 WHERE id = $6", 
        [first_name, last_name, specialty, photo_url, JSON.stringify(schedule), id]
      );
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
    const { id, first_name, last_name, specialty, photo_url, schedule } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO teachers (id, first_name, last_name, specialty, photo_url, schedule) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", 
        [id, first_name, last_name, specialty, photo_url, JSON.stringify(schedule)]
      );
      res.json({ success: true, teacher: result.rows[0] });
    } catch (e: any) {
      console.error("❌ Error al agregar docente:", e.message);
      const isUniqueError = e.message.includes('unique') || e.code === '23505';
      res.status(400).json({ error: isUniqueError ? 'El DNI ya está registrado' : 'Error en la base de datos' });
    }
  });

  // Absences API
  app.get("/api/absences", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT a.*, (t.first_name || ' ' || t.last_name) as teacher_name 
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
    // En producción, server.js está DENTRO de dist. 
    // Intentamos buscar la carpeta dist en el directorio actual o uno arriba.
    const distPath = fs.existsSync(path.join(process.cwd(), "dist")) 
      ? path.join(process.cwd(), "dist")
      : process.cwd();

    console.log(`📁 Sirviendo archivos estáticos desde: ${distPath}`);

    app.use(express.static(distPath, { 
      maxAge: '1d',
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));
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
