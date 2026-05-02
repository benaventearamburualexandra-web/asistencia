import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { 
  QrCode, Camera, Keyboard, UserCheck, LogOut, LogIn, Loader2, 
  CheckCircle2, AlertCircle, Settings, Download, UserPlus, X, 
  Users, LayoutDashboard, FileText, Printer, Trash2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, getISOWeek, getISOWeekYear } from 'date-fns';
import { registerAttendance, syncOfflineData, registerTeacher, registerAbsence } from '../offlineSync';

interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
  specialty: string;
  photo_url?: string;
  schedule?: Record<string, { enabled: boolean; slots?: { start: string, end: string }[] }>;
}

interface AttendanceRecord {
  id: number | string;
  teacher_name: string;
  teacher_id: string;
  type: string;
  date: string;
  time: string;
  status: string;
}

interface AbsenceRecord {
  id: number | string;
  teacher_id: string;
  teacher_name: string;
  date: string;
  status: 'JUSTIFICADA' | 'INJUSTIFICADA';
  reason: string;
  offline?: boolean;
}

const INITIAL_SCHEDULE = {
  monday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  tuesday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  wednesday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  thursday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  friday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  saturday: { enabled: false, slots: [] },
  sunday: { enabled: false, slots: [] },
};

const DAY_LABELS: Record<string, string> = {
  monday: 'Lun', tuesday: 'Mar', wednesday: 'Mié', thursday: 'Jue', friday: 'Vie', saturday: 'Sáb', sunday: 'Dom',
};

export default function App() {
  const [adminUser, setAdminUser] = useState<{username: string, name: string} | null>(() => {
    const saved = localStorage.getItem('admin_session');
    return saved ? JSON.parse(saved) : null;
  });
  
  const [activeTab, setActiveTab] = useState<'asistencia' | 'docentes' | 'reportes' | 'faltas'>('asistencia');
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [attendanceType, setAttendanceType] = useState<'ENTRADA' | 'SALIDA'>('ENTRADA');
  const attendanceTypeRef = useRef(attendanceType);
  const [teacherId, setTeacherId] = useState('');
  const [offlineTrigger, setOfflineTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Estados con carga de Caché Local inmediata
  const [teachers, setTeachers] = useState<Teacher[]>(() => JSON.parse(localStorage.getItem('cache_teachers') || '[]'));
  const [records, setRecords] = useState<AttendanceRecord[]>(() => JSON.parse(localStorage.getItem('cache_records') || '[]'));
  const [absences, setAbsences] = useState<AbsenceRecord[]>(() => JSON.parse(localStorage.getItem('cache_absences') || '[]'));
  const [admins, setAdmins] = useState<any[]>(() => JSON.parse(localStorage.getItem('cache_admins') || '[]'));

  const [showLogin, setShowLogin] = useState(false);
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [showAddAbsence, setShowAddAbsence] = useState(false);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [newTeacher, setNewTeacher] = useState({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
  const [newAbsence, setNewAbsence] = useState({ teacherId: '', date: new Date().toISOString().split('T')[0], status: 'INJUSTIFICADA', reason: '' });
  const [selectedTeacherQR, setSelectedTeacherQR] = useState<Teacher | null>(null);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    attendanceTypeRef.current = attendanceType;
  }, [attendanceType]);

  useEffect(() => {
    const handleStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    
    // Sincronizar al iniciar
    syncOfflineData().then(() => fetchData(false));

    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
    };
  }, []);

  const fetchData = async (showLoader = false) => {
    // Si estamos offline y no estamos en la laptop local, no hacemos fetch
    if (!navigator.onLine && window.location.hostname !== 'localhost') {
      setIsLoading(false);
      return;
    }

    if (showLoader) setIsLoading(true);
    try {
      const timestamp = Date.now();
      const responses = await Promise.allSettled([
        fetch(`/api/teachers?t=${timestamp}`),
        fetch(`/api/report?t=${timestamp}`),
        fetch(`/api/absences?t=${timestamp}`),
        fetch(`/api/admins?t=${timestamp}`)
      ]);

      const safeJson = async (res: any) => (res.status === 'fulfilled' && res.value.ok) ? res.value.json() : null;
      const [tData, rData, aData, admData] = await Promise.all(responses.map(safeJson));

      if (tData) { setTeachers(tData); localStorage.setItem('cache_teachers', JSON.stringify(tData)); }
      if (rData) { setRecords(rData); localStorage.setItem('cache_records', JSON.stringify(rData)); }
      if (aData) { setAbsences(aData); localStorage.setItem('cache_absences', JSON.stringify(aData)); }
      if (admData) { setAdmins(admData); localStorage.setItem('cache_admins', JSON.stringify(admData)); }
    } catch (e) {
      console.warn("Fallo al conectar con el servidor, usando datos locales.");
    } finally {
      setIsLoading(false);
    }
  };

  // --- LÓGICA DE DATOS COMBINADOS (REMOTO + PENDIENTES) ---
  const allRecords = useMemo(() => {
    const pending = JSON.parse(localStorage.getItem('pending_attendance') || '[]');
    const mappedPending = pending.map((item: any) => ({
      id: item.offlineId,
      teacher_name: teachers.find(t => t.id === item.teacherId)?.first_name + ' ' + teachers.find(t => t.id === item.teacherId)?.last_name || item.teacherId,
      teacher_id: item.teacherId,
      type: item.type,
      date: item.manualDate,
      time: item.manualTime,
      status: 'PENDIENTE'
    }));
    return [...records, ...mappedPending].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  }, [records, teachers, offlineTrigger]);

  const allAbsences = useMemo(() => {
    const pending = JSON.parse(localStorage.getItem('pending_absences') || '[]');
    const mappedPending = pending.map((item: any) => ({
      id: 'pending-' + Math.random(),
      teacher_id: item.teacherId,
      teacher_name: teachers.find(t => t.id === item.teacherId)?.first_name + ' ' + teachers.find(t => t.id === item.teacherId)?.last_name || item.teacherId,
      date: item.date,
      status: item.status,
      reason: item.reason,
      offline: true
    }));
    return [...absences, ...mappedPending].sort((a, b) => b.date.localeCompare(a.date));
  }, [absences, teachers, offlineTrigger]);

  // --- ACCIONES ---
  const handleAttendance = async (id: string) => {
    if (isSubmitting || !id.trim()) return;
    setIsSubmitting(true);
    const loading = toast.loading(`Registrando ${attendanceType}...`);
    try {
      const data = await registerAttendance(id.trim(), attendanceType);
      if (data.success) {
        toast.success(`${attendanceType} registrada ${data.offline ? '(Local)' : ''}`, { id: loading });
        setTeacherId('');
        setOfflineTrigger(prev => prev + 1);
        fetchData();
      }
    } catch (e) { toast.error('Error al registrar', { id: loading }); }
    finally { setIsSubmitting(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Verificando...');
    
    const tryOfflineLogin = () => {
      const found = admins.find(a => a.username === loginUsername && a.password === password);
      if (found || (loginUsername === 'admin' && password === 'admin123')) {
        const user = found || { username: 'admin', name: 'Administrador Local' };
        setAdminUser(user);
        localStorage.setItem('admin_session', JSON.stringify(user));
        setShowLogin(false);
        toast.success(`Acceso Offline: ${user.name}`, { id: loading });
        return true;
      }
      return false;
    };

    if (!navigator.onLine) { if (!tryOfflineLogin()) toast.error('Credenciales incorrectas (Offline)', { id: loading }); return; }

    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginUsername, password }) });
      if (res.ok) {
        const data = await res.json();
        setAdminUser(data.user);
        localStorage.setItem('admin_session', JSON.stringify(data.user));
        setShowLogin(false);
        toast.success(`Bienvenido ${data.user.name}`, { id: loading });
      } else if (!tryOfflineLogin()) toast.error('Error de acceso', { id: loading });
    } catch (e) { if (!tryOfflineLogin()) toast.error('Fallo de conexión', { id: loading }); }
  };

  const onAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Guardando...');
    const data = await registerTeacher(newTeacher);
    if (data.success) {
      toast.success(data.offline ? 'Guardado en memoria (Offline)' : 'Docente registrado', { id: loading });
      setNewTeacher({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
      setShowAddTeacher(false);
      setOfflineTrigger(prev => prev + 1);
      fetchData();
    } else toast.error('Error al guardar', { id: loading });
  };

  const downloadExcel = async () => {
    const XLSX = await import('xlsx');
    const data = allRecords.map(r => ({ 'Docente': r.teacher_name, 'DNI': r.teacher_id, 'Evento': r.type, 'Fecha': r.date, 'Hora': r.time, 'Estado': r.status }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte");
    XLSX.writeFile(wb, `Reporte_Asistencia.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans flex flex-col md:flex-row overflow-hidden">
      <Toaster position="top-center" />
      
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[150] bg-amber-500 text-white text-[10px] font-black uppercase py-1 text-center shadow-lg">
          ⚠️ MODO OFFLINE: Los datos se guardan en el dispositivo y se subirán al detectar internet.
        </div>
      )}

      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-white border-r border-gray-200 flex flex-col h-auto md:h-screen sticky top-0 z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg"><UserCheck size={24} /></div>
          <div><h1 className="font-bold text-lg">Asistencia</h1><p className="text-[10px] text-gray-500 font-bold uppercase">Panel Central</p></div>
        </div>

        <div className="flex-1 px-4 py-2 space-y-1 flex md:flex-col overflow-x-auto">
          <button onClick={() => setActiveTab('asistencia')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'asistencia' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}><LayoutDashboard size={20} /><span>Escáner</span></button>
          {adminUser && (
            <>
              <button onClick={() => setActiveTab('docentes')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'docentes' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}><Users size={20} /><span>Docentes</span></button>
              <button onClick={() => setActiveTab('reportes')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'reportes' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}><FileText size={20} /><span>Reportes</span></button>
              <button onClick={() => setActiveTab('faltas')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'faltas' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}><AlertCircle size={20} /><span>Faltas</span></button>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100">
          {adminUser ? (
            <button onClick={() => { setAdminUser(null); localStorage.removeItem('admin_session'); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-red-500 hover:bg-red-50"><LogOut size={20} /><span>Cerrar Sesión</span></button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-50"><Settings size={20} /><span>Admin Login</span></button>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-y-auto p-4 md:p-10">
        <AnimatePresence mode="wait">
          {activeTab === 'asistencia' && (
            <motion.div key="asistencia" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h2 className="text-3xl font-extrabold text-gray-900">Registro de Asistencia</h2>
                <div className="bg-white p-1 rounded-2xl border border-gray-200 flex shadow-sm">
                  <button onClick={() => setAttendanceType('ENTRADA')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'ENTRADA' ? 'bg-emerald-500 text-white shadow-lg' : 'text-gray-500'}`}>ENTRADA</button>
                  <button onClick={() => setAttendanceType('SALIDA')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'SALIDA' ? 'bg-orange-500 text-white shadow-lg' : 'text-gray-500'}`}>SALIDA</button>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 p-10 max-w-2xl mx-auto">
                <form onSubmit={(e) => { e.preventDefault(); handleAttendance(teacherId); }} className="space-y-6">
                  <div className="text-center space-y-2">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-widest">Ingrese DNI del Docente</label>
                    <input type="text" value={teacherId} onChange={(e) => setTeacherId(e.target.value.replace(/\D/g, ''))} className="w-full px-8 py-5 bg-gray-50 border-2 border-gray-100 rounded-3xl focus:border-indigo-500 outline-none text-2xl font-mono text-center" placeholder="DNI..." autoFocus />
                  </div>
                  <button type="submit" disabled={isSubmitting || !teacherId} className="w-full bg-indigo-600 text-white py-5 rounded-3xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3">
                    {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={24} />} REGISTRAR {attendanceType}
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'reportes' && (
            <motion.div key="reportes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-extrabold text-gray-900">Reporte Diario</h2>
                <button onClick={downloadExcel} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all"><Download size={18} />Excel</button>
              </div>
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead><tr className="bg-gray-50"><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Docente</th><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Evento</th><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Hora</th><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Estado</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {allRecords.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4"><div className="font-bold text-gray-800">{r.teacher_name}</div><div className="text-[10px] text-gray-400">{r.teacher_id}</div></td>
                        <td className="px-6 py-4"><span className={`px-2 py-1 rounded-lg text-[10px] font-black ${r.type === 'ENTRADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>{r.type}</span></td>
                        <td className="px-6 py-4 text-sm text-gray-600">{r.date} {r.time}</td>
                        <td className="px-6 py-4">{r.status === 'PENDIENTE' ? <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-bold text-[10px] animate-pulse">SIN SUBIR</span> : <span className="text-emerald-600 font-bold text-[10px]">✓ OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Login Modal */}
      <AnimatePresence>
        {showLogin && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2.5rem] p-10 w-full max-w-sm shadow-2xl">
              <h2 className="text-2xl font-extrabold mb-6 text-center text-gray-900">Admin Access</h2>
              <form onSubmit={handleLogin} className="space-y-6">
                <input type="text" required value={loginUsername} onChange={e => setLoginUsername(e.target.value)} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none" placeholder="Usuario" />
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none" placeholder="Contraseña" />
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-lg">ENTRAR</button>
                <button type="button" onClick={() => setShowLogin(false)} className="w-full text-gray-400 font-bold text-sm">Cancelar</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
