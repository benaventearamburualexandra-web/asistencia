const STORAGE_KEY = 'pending_attendance';

/**
 * Intenta registrar la asistencia. Si falla (sin red), la guarda en LocalStorage.
 */
export async function registerAttendance(teacherId: string, type: 'ENTRADA' | 'SALIDA') {
  const now = new Date();
  const attendanceData = {
    teacherId,
    type,
    manualDate: now.toISOString().split('T')[0], // YYYY-MM-DD
    manualTime: now.toLocaleTimeString('en-GB'),   // HH:mm:ss
    offlineId: crypto.randomUUID() // Identificador único para evitar duplicados al sincronizar
  };

  try {
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attendanceData),
    });

    if (!response.ok) throw new Error('Error en el servidor');
    return await response.json();
  } catch (error) {
    console.warn("⚠️ Sin conexión. Guardando en LocalStorage...");
    const pending = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    pending.push(attendanceData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    return { success: true, offline: true, teacherName: "Guardado localmente (sin internet)" };
  }
}

/**
 * Envía los registros pendientes al servidor cuando vuelve la conexión.
 */
export async function syncOfflineData() {
  if (!navigator.onLine) return;
  const pending = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (pending.length === 0) return;

  console.log(`🔄 Sincronizando ${pending.length} registros...`);
  for (const item of [...pending]) {
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (res.ok) {
        const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((i: any) => i.offlineId !== item.offlineId)));
      }
    } catch (e) { break; } // Detener si el servidor sigue caído
  }
}

// Sincronizar automáticamente cuando el navegador detecta internet
if (typeof window !== 'undefined') {
  window.addEventListener('online', syncOfflineData);
}