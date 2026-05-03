const STORAGE_KEY = 'pending_attendance';
const TEACHERS_KEY = 'pending_teachers';
const ABSENCES_KEY = 'pending_absences';

/**
 * Intenta registrar la asistencia. Si falla (sin red), la guarda en LocalStorage.
 */
export async function registerAttendance(teacherId: string, type: 'ENTRADA' | 'SALIDA', status: string = 'PUNTUAL') {
  const now = new Date();
  const attendanceData = {
    teacherId,
    type,
    manualDate: new Intl.DateTimeFormat('en-CA', { 
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Lima' 
    }).format(now),
    manualTime: new Intl.DateTimeFormat('en-GB', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Lima' 
    }).format(now),
    status,
    offlineId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
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
 * Guarda un nuevo docente localmente si no hay red.
 */
export async function registerTeacher(teacherData: any) {
  try {
    const res = await fetch('/api/teachers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teacherData),
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch (error) {
    const pending = JSON.parse(localStorage.getItem(TEACHERS_KEY) || '[]');
    pending.push(teacherData);
    localStorage.setItem(TEACHERS_KEY, JSON.stringify(pending));
    return { success: true, offline: true };
  }
}

/**
 * Guarda una falta localmente si no hay red.
 */
export async function registerAbsence(absenceData: any) {
  try {
    const res = await fetch('/api/absences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(absenceData),
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch (error) {
    const pending = JSON.parse(localStorage.getItem(ABSENCES_KEY) || '[]');
    pending.push(absenceData);
    localStorage.setItem(ABSENCES_KEY, JSON.stringify(pending));
    return { success: true, offline: true };
  }
}

/**
 * Envía los registros pendientes al servidor cuando vuelve la conexión.
 */
export async function syncOfflineData() {
  if (!navigator.onLine) return;
  
  const pending = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const pendingTeachers = JSON.parse(localStorage.getItem(TEACHERS_KEY) || '[]');
  const pendingAbsences = JSON.parse(localStorage.getItem(ABSENCES_KEY) || '[]');

  if (pending.length === 0 && pendingTeachers.length === 0 && pendingAbsences.length === 0) return;

  // Sincronizar Asistencias
  const attendanceResults = await Promise.allSettled(pending.map(async (item: any) => {
    const res = await fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    if (res.ok) return item.offlineId;
    throw new Error();
  }));
  const syncedAttendanceIds = attendanceResults.filter(r => r.status === 'fulfilled').map(r => (r as any).value);
  if (syncedAttendanceIds.length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending.filter((i: any) => !syncedAttendanceIds.includes(i.offlineId))));
  }

  // Sincronizar Docentes
  const teacherResults = await Promise.allSettled(pendingTeachers.map(async (teacher: any) => {
    const res = await fetch('/api/teachers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(teacher) });
    if (res.ok) return teacher.id;
    throw new Error();
  }));
  const syncedTeacherIds = teacherResults.filter(r => r.status === 'fulfilled').map(r => (r as any).value);
  if (syncedTeacherIds.length > 0) {
    localStorage.setItem(TEACHERS_KEY, JSON.stringify(pendingTeachers.filter((t: any) => !syncedTeacherIds.includes(t.id))));
  }

  // Sincronizar Faltas
  const absenceResults = await Promise.allSettled(pendingAbsences.map(async (abs: any) => {
    const res = await fetch('/api/absences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(abs) });
    if (res.ok) return abs;
    throw new Error();
  }));
  const syncedAbsences = absenceResults.filter(r => r.status === 'fulfilled').map(r => (r as any).value);
  if (syncedAbsences.length > 0) {
    localStorage.setItem(ABSENCES_KEY, JSON.stringify(pendingAbsences.filter((a: any) => !syncedAbsences.some((s: any) => s.teacherId === a.teacherId && s.date === a.date))));
  }
}

// Sincronizar automáticamente cuando el navegador detecta internet
if (typeof window !== 'undefined') {
  window.addEventListener('online', syncOfflineData);
}