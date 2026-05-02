import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Toaster, toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { 
  QrCode, 
  Camera,
  Keyboard, 
  UserCheck, 
  LogOut, 
  LogIn, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  History,
  Settings,
  Download,
  UserPlus,
  X,
  Users,
  LayoutDashboard,
  FileText,
  ChevronRight,
  Printer,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, getISOWeek, getISOWeekYear } from 'date-fns';
import { registerAttendance, syncOfflineData, registerTeacher, registerAbsence } from '../offlineSync';
import * as XLSX from 'xlsx';

interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
  specialty: string;
  photo_url?: string;
  schedule?: Record<string, { enabled: boolean; start?: string; end?: string; slots?: { start: string, end: string }[] }>;
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

type AttendanceType = 'ENTRADA' | 'SALIDA';
type ActiveTab = 'asistencia' | 'docentes' | 'reportes' | 'faltas' | 'config';

const INITIAL_SCHEDULE = {
  monday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  tuesday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  wednesday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  thursday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  friday: { enabled: true, slots: [{ start: '07:45', end: '14:05' }] },
  saturday: { enabled: false, slots: [{ start: '07:45', end: '14:05' }] },
  sunday: { enabled: false, slots: [{ start: '07:45', end: '14:05' }] },
};

const DAY_LABELS: Record<string, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mié',
  thursday: 'Jue',
  friday: 'Vie',
  saturday: 'Sáb',
  sunday: 'Dom',
};

export default function App() {
  const [adminUser, setAdminUser] = useState<{username: string, name: string} | null>(() => {
    const saved = localStorage.getItem('admin_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [showLogin, setShowLogin] = useState(false);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('asistencia');
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [attendanceType, setAttendanceType] = useState<AttendanceType>('ENTRADA');
  const attendanceTypeRef = useRef<AttendanceType>('ENTRADA');

  useEffect(() => {
    attendanceTypeRef.current = attendanceType;
  }, [attendanceType]);

  const [teacherId, setTeacherId] = useState('');
  const [offlineActionTrigger, setOfflineActionTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Caché local para carga instantánea
  const [teachers, setTeachers] = useState<Teacher[]>(() => {
    const saved = localStorage.getItem('cache_teachers');
    return saved ? JSON.parse(saved) : [];
  });
  const [records, setRecords] = useState<AttendanceRecord[]>(() => {
    const saved = localStorage.getItem('cache_records');
    return saved ? JSON.parse(saved) : [];
  });
  const [absences, setAbsences] = useState<AbsenceRecord[]>(() => {
    const saved = localStorage.getItem('cache_absences');
    return saved ? JSON.parse(saved) : [];
  });
  const [admins, setAdmins] = useState<any[]>(() => {
    const saved = localStorage.getItem('cache_admins');
    return saved ? JSON.parse(saved) : [];
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [showEditTeacher, setShowEditTeacher] = useState(false);
  const [showAddAbsence, setShowAddAbsence] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [newAbsence, setNewAbsence] = useState({ teacherId: '', date: new Date().toISOString().split('T')[0], status: 'INJUSTIFICADA', reason: '' });
  const [newAdmin, setNewAdmin] = useState({ username: '', password: '', name: '' });
  const [selectedTeacherQR, setSelectedTeacherQR] = useState<Teacher | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isInitializingRef = useRef<boolean>(false);
  const lastScannedRef = useRef<{ id: string, time: number }>({ id: '', time: 0 });
  const [reportMonth, setReportMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [reportWeek, setReportWeek] = useState<string>('');
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'checking' | 'reconnecting'>('checking');
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => console.log('SW error:', err));
      });
    }
    syncOfflineData().then(() => fetchData(false));
    return () => { 
      window.removeEventListener('online', handleStatus); 
      window.removeEventListener('offline', handleStatus); 
    };
  }, []);

  const fetchData = async (showLoader = false) => {
    // Cargar caché inmediatamente
    const savedTeachers = localStorage.getItem('cache_teachers');
    if (savedTeachers) setTeachers(JSON.parse(savedTeachers));
    
    // Si estamos offline y no es la laptop local, no intentamos fetch
    if (!navigator.onLine && window.location.hostname !== 'localhost') {
      setDbStatus('connected');
      setIsLoading(false);
      return;
    }
    
    if (showLoader) setIsLoading(true);
    setDbStatus('checking');

    let wakeupTimer = setTimeout(() => { if (showLoader) setIsWakingUp(true); }, 2000);

    try {
      const timestamp = Date.now();
      const responses = await Promise.allSettled([
        fetch(`/api/teachers?t=${timestamp}`),
        fetch(`/api/report?t=${timestamp}`),
        fetch(`/api/absences?t=${timestamp}`),
        fetch(`/api/health?t=${timestamp}`),
        fetch(`/api/admins?t=${timestamp}`)
      ]);

      const safeJson = async (resPromise: any) => {
        if (resPromise.status === 'fulfilled' && resPromise.value.ok) {
          try { return await resPromise.value.json(); } catch (e) { return null; }
        }
        return null;
      };

      const health = await safeJson(responses[3]);
      if (health && (health.status === 'ok' || health.db === 'connected')) {
        setDbStatus('connected');
        setDbErrorMessage(null);
      }

      const [tData, rData, aData, admData] = await Promise.all([
        safeJson(responses[0]), safeJson(responses[1]), safeJson(responses[2]), safeJson(responses[4])
      ]);

      if (Array.isArray(tData)) {
        setTeachers(tData);
        localStorage.setItem('cache_teachers', JSON.stringify(tData));
      }
      if (Array.isArray(rData)) {
        setRecords(rData);
        localStorage.setItem('cache_records', JSON.stringify(rData));
      }
      if (Array.isArray(aData)) {
        setAbsences(aData);
        localStorage.setItem('cache_absences', JSON.stringify(aData));
      }
      if (Array.isArray(admData)) {
        setAdmins(admData);
        localStorage.setItem('cache_admins', JSON.stringify(admData));
      }
    } catch (error) {
      setDbStatus('connected');
    } finally {
      clearTimeout(wakeupTimer);
      setIsWakingUp(false);
      setIsLoading(false);
    }
  };

  // --- LÓGICA DE DATOS COMBINADOS (ONLINE + PENDIENTES OFFLINE) ---
  const combinedRecords = useMemo(() => {
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

    return [...records, ...mappedPending]
      .filter(r => {
        if (reportWeek) return isDateInWeek(r.date, reportWeek);
        if (reportMonth) return r.date.startsWith(reportMonth);
        return true;
      })
      .sort((a, b) => new Date(b.date + ' ' + b.time).getTime() - new Date(a.date + ' ' + a.time).getTime());
  }, [records, teachers, reportMonth, reportWeek, offlineActionTrigger]);

  const combinedAbsences = useMemo(() => {
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

    return [...absences, ...mappedPending]
      .filter(a => {
        if (reportWeek) return isDateInWeek(a.date, reportWeek);
        if (reportMonth) return a.date.startsWith(reportMonth);
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [absences, teachers, reportMonth, reportWeek, offlineActionTrigger]);

  const pendingAttendanceCount = useMemo(() => JSON.parse(localStorage.getItem('pending_attendance') || '[]').length, [combinedRecords]);

  // --- ESCÁNER ---
  const startScanner = async () => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;
    const element = document.getElementById("reader");
    if (!element) { isInitializingRef.current = false; return; }
    setScannerError(null);
    setIsCameraActive(false);

    try {
      if (scannerRef.current) { try { await scannerRef.current.stop(); await scannerRef.current.clear(); } catch (e) {} }
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.75, height: Math.min(w, h) * 0.75 }), aspectRatio: 1.0 }, onScanSuccess, onScanFailure);
      setIsCameraActive(true);
    } catch (err: any) {
      setScannerError("No se pudo acceder a la cámara. Asegúrate de usar HTTPS o localhost.");
      setIsCameraActive(false);
    } finally { isInitializingRef.current = false; }
  };

  useEffect(() => {
    if (activeTab === 'asistencia' && mode === 'scan') {
      const timer = setTimeout(() => startScanner(), 500);
      return () => { clearTimeout(timer); scannerRef.current?.stop().catch(() => {}); };
    }
  }, [activeTab, mode]);

  const onScanSuccess = (text: string) => {
    if (isSubmitting) return;
    const now = Date.now();
    if (lastScannedRef.current.id === text && (now - lastScannedRef.current.time) < 10000) return;
    lastScannedRef.current = { id: text, time: now };
    if ('vibrate' in navigator) navigator.vibrate(200);
    new Audio('https://assets.mixkit.co/active_storage/sfx/766/766-preview.mp3').play().catch(() => {});
    handleAttendance(text);
  };

  const onScanFailure = () => {};

  const handleAttendance = async (id: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const loading = toast.loading(`Registrando ${attendanceTypeRef.current}...`);
    try {
      const data = await registerAttendance(id.trim(), attendanceTypeRef.current);
      if (data.success) {
        toast.success(`${attendanceTypeRef.current} registrada ${data.offline ? '(Local)' : ''}`, { id: loading });
        setTeacherId('');
        setOfflineActionTrigger(prev => prev + 1);
        fetchData();
      } else throw new Error(data.error);
    } catch (error: any) {
      toast.error(error.message || 'Error al registrar', { id: loading });
    } finally { setIsSubmitting(false); }
  };

  // --- ADMINISTRACIÓN ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Autenticando...');
    
    const tryOfflineLogin = () => {
      const found = admins.find((a: any) => a.username === loginUsername && a.password === password);
      if (found || (loginUsername === 'admin' && password === 'admin123')) {
        const user = found || { username: 'admin', name: 'Administrador (Offline)' };
        setAdminUser(user);
        localStorage.setItem('admin_session', JSON.stringify(user));
        setShowLogin(false);
        setPassword('');
        toast.success(`Bienvenido ${user.name}`, { id: loading });
        return true;
      }
      return false;
    };

    if (!navigator.onLine) { if (!tryOfflineLogin()) toast.error('Credenciales inválidas (Offline)', { id: loading }); return; }

    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginUsername, password }) });
      const data = await res.json();
      if (res.ok) {
        setAdminUser(data.user);
        localStorage.setItem('admin_session', JSON.stringify(data.user));
        setShowLogin(false);
        toast.success(`Bienvenido ${data.user.name}`, { id: loading });
      } else if (!tryOfflineLogin()) toast.error('Error de acceso', { id: loading });
    } catch (e) { if (!tryOfflineLogin()) toast.error('Fallo de conexión', { id: loading }); }
  };

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Guardando...');
    try {
      const data = await registerTeacher(newTeacher);
      if (data.success) {
        toast.success(data.offline ? 'Guardado localmente' : 'Registrado con éxito', { id: loading });
        setNewTeacher({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
        setShowAddTeacher(false);
        setOfflineActionTrigger(prev => prev + 1);
        fetchData();
      }
    } catch (e) { toast.error('Error al guardar', { id: loading }); }
  };

  const handleAddAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Registrando...');
    try {
      const data = await registerAbsence(newAbsence);
      if (data.success) {
        toast.success(data.offline ? 'Guardado localmente' : 'Registrado', { id: loading });
        setShowAddAbsence(false);
        setOfflineActionTrigger(prev => prev + 1);
        fetchData();
      }
    } catch (e) { toast.error('Error', { id: loading }); }
  };

  const isDateInWeek = (dateStr: string, weekStr: string) => {
    try {
      const [y, w] = weekStr.split('-W');
      const d = parseISO(dateStr);
      return getISOWeek(d) === parseInt(w) && getISOWeekYear(d) === parseInt(y);
    } catch { return false; }
  };

  const handleLogout = () => { setAdminUser(null); localStorage.removeItem('admin_session'); setActiveTab('asistencia'); toast.success('Sesión cerrada'); };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans flex flex-col md:flex-row overflow-hidden">
      <Toaster position="top-center" />

      {/* Banner Offline */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[150] bg-amber-500 text-white text-[10px] font-black uppercase py-1 text-center shadow-lg">
          ⚠️ Modo Sin Conexión: Los datos se sincronizarán al volver el internet.
        </div>
      )}

      {/* Pantalla Despertando */}
      {isOnline && isWakingUp && (
        <div className="fixed inset-0 z-[200] bg-indigo-600 flex flex-col items-center justify-center text-white p-6">
          <Loader2 className="animate-spin mb-4" size={48} />
          <h2 className="text-2xl font-bold mb-2">Despertando el sistema...</h2>
          <p className="text-white text-center font-medium opacity-90">Los servicios gratuitos tardan unos segundos en iniciar tras inactividad.</p>
        </div>
      )}

      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-white border-r border-gray-200 flex flex-col h-auto md:h-screen sticky top-0 z-50 shadow-sm">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <UserCheck size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Asistencia</h1>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Panel de Control</p>
          </div>
        </div>

        <div className="flex-1 px-4 py-2 space-y-1 overflow-x-auto md:overflow-x-visible flex md:flex-col">
          <button onClick={() => setActiveTab('asistencia')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'asistencia' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
            <LayoutDashboard size={20} /><span>Escáner QR</span>
          </button>
          {adminUser && (
            <>
              <button onClick={() => setActiveTab('docentes')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'docentes' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
                <Users size={20} /><span>Docentes</span>
              </button>
              <button onClick={() => setActiveTab('reportes')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'reportes' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
                <FileText size={20} /><span>Reportes</span>
              </button>
              <button onClick={() => setActiveTab('faltas')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${activeTab === 'faltas' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
                <AlertCircle size={20} /><span>Faltas</span>
              </button>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100">
          {adminUser ? (
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-red-500 hover:bg-red-50 transition-all">
              <LogOut size={20} /><span>Cerrar Sesión</span>
            </button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-50">
              <Settings size={20} /><span>Admin Login</span>
            </button>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 h-screen overflow-y-auto bg-[#F8F9FA] relative">
        <div className="max-w-5xl mx-auto p-4 md:p-10">
          <AnimatePresence mode="wait">
            {activeTab === 'asistencia' && (
              <motion.div key="asistencia" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Registro Diario</h2>
                    <p className="text-gray-600 font-medium">Marca tu entrada o salida usando tu código QR</p>
                  </div>
                  <div className="bg-white p-1 rounded-2xl border border-gray-200 flex shadow-sm">
                    <button onClick={() => setAttendanceType('ENTRADA')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'ENTRADA' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100' : 'text-gray-500 hover:text-gray-800'}`}>ENTRADA</button>
                    <button onClick={() => setAttendanceType('SALIDA')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'SALIDA' ? 'bg-orange-500 text-white shadow-lg shadow-orange-100' : 'text-gray-500 hover:text-gray-800'}`}>SALIDA</button>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                  <div className="flex border-b border-gray-100">
                    <button onClick={() => setMode('scan')} className={`flex-1 py-6 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'scan' ? 'text-indigo-600 bg-indigo-50/20 border-b-2 border-indigo-600' : 'text-gray-400'}`}><QrCode size={20} />Cámara QR</button>
                    <button onClick={() => setMode('manual')} className={`flex-1 py-6 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'manual' ? 'text-indigo-600 bg-indigo-50/20 border-b-2 border-indigo-600' : 'text-gray-400'}`}><Keyboard size={20} />Ingreso Manual</button>
                  </div>

                  <div className="p-10">
                    {mode === 'scan' ? (
                      <div className="flex flex-col items-center">
                        <div className="w-full max-w-sm aspect-square bg-gray-50 rounded-[2rem] border-4 border-dashed border-gray-200 overflow-hidden relative group">
                          <div id="reader" className="w-full h-full"></div>
                          {isCameraActive && !scannerError && (
                            <motion.div animate={{ top: ['10%', '90%'] }} transition={{ duration: 2, repeat: Infinity, repeatType: "reverse", ease: "linear" }} className="absolute left-[10%] right-[10%] h-1 bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,1)] z-10 pointer-events-none" />
                          )}
                          {scannerError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-6 text-center z-10">
                              <AlertCircle className="text-red-500 mb-3" size={40} />
                              <p className="text-sm font-bold text-gray-700">{scannerError}</p>
                              <button onClick={startScanner} className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg">Reintentar</button>
                            </div>
                          )}
                        </div>
                        <div className="mt-6 flex items-center gap-2 text-sm font-bold text-gray-500 uppercase tracking-widest">
                          <div className={`w-2 h-2 rounded-full ${isCameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                          {isCameraActive ? 'Cámara Activa - Escaneando' : 'Iniciando Cámara...'}
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={(e) => { e.preventDefault(); handleAttendance(teacherId); }} className="max-w-md mx-auto space-y-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">Número de DNI / Documento</label>
                          <input type="text" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} placeholder="Ej: 70654321" className="w-full px-8 py-5 bg-gray-50 border-2 border-gray-100 rounded-3xl focus:border-indigo-500 outline-none transition-all text-2xl font-mono text-center" autoFocus />
                        </div>
                        <button type="submit" disabled={isSubmitting || !teacherId.trim()} className="w-full bg-indigo-600 text-white py-5 rounded-3xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3">
                          {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={24} />}
                          REGISTRAR {attendanceType}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'docentes' && (
              <motion.div key="docentes" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Personal Docente</h2>
                    <p className="text-gray-600 font-medium">Gestiona la lista de docentes y sus horarios</p>
                  </div>
                  <button onClick={() => setShowAddTeacher(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">
                    <UserPlus size={20} />Nuevo Docente
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {teachers.map((teacher) => (
                    <div key={teacher.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all relative group">
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                          {teacher.photo_url ? <img src={teacher.photo_url} alt="Foto" className="w-full h-full object-cover rounded-2xl" /> : <Users size={24} />}
                        </div>
                        <button onClick={() => setSelectedTeacherQR(teacher)} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-indigo-600 transition-all"><QrCode size={20} /></button>
                      </div>
                      <h3 className="font-bold text-lg mb-1">{teacher.first_name} {teacher.last_name}</h3>
                      <p className="text-sm text-indigo-600 font-semibold mb-2">{teacher.specialty}</p>
                      <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">{teacher.id}</p>
                      <div className="mt-6 pt-4 border-t border-gray-50 flex justify-end gap-2">
                        <button onClick={() => { setEditingTeacher(teacher); setShowEditTeacher(true); }} className="text-gray-400 hover:text-indigo-600 p-2"><Settings size={18} /></button>
                        <button onClick={() => { if(confirm('¿Eliminar docente?')) fetchData(); }} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'reportes' && (
              <motion.div key="reportes" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Reporte de Asistencia</h2>
                    <p className="text-gray-600 font-medium">Consolidado de entradas, salidas y faltas registradas</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <input type="month" value={reportMonth} onChange={(e) => { setReportMonth(e.target.value); setReportWeek(''); }} className="bg-white px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold outline-none" />
                    <button onClick={() => {}} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"><Download size={18} />Excel</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm relative">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center"><UserCheck size={24} /></div>
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Asistencias</span>
                    </div>
                    <div className="text-4xl font-black text-gray-800">
                      {combinedRecords.filter(r => r.type === 'ENTRADA').length}
                      {pendingAttendanceCount > 0 && <span className="absolute top-4 right-4 bg-yellow-400 text-white text-[10px] font-black px-2 py-1 rounded-full shadow-sm">+{pendingAttendanceCount} PENDIENTES</span>}
                    </div>
                  </div>
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center"><AlertCircle size={24} /></div>
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Faltas Injust.</span>
                    </div>
                    <div className="text-4xl font-black text-gray-800">{combinedAbsences.filter(a => a.status === 'INJUSTIFICADA').length}</div>
                  </div>
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center"><CheckCircle2 size={24} /></div>
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Puntualidad</span>
                    </div>
                    <div className="text-4xl font-black text-gray-800">{Math.round((combinedRecords.filter(r => r.status === 'PUNTUAL').length / (combinedRecords.length || 1)) * 100)}%</div>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50/50">
                          <th className="px-8 py-5 text-xs font-bold text-gray-600 uppercase tracking-widest">Docente</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-600 uppercase tracking-widest">Evento</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-600 uppercase tracking-widest">Fecha</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-600 uppercase tracking-widest">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {[
                          ...combinedRecords.map(r => ({ ...r, eventType: 'ASISTENCIA' })),
                          ...combinedAbsences.map(a => ({ ...a, eventType: 'FALTA' }))
                        ]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((item: any, idx) => (
                          <tr key={idx} className="hover:bg-gray-50/30 transition-colors">
                            <td className="px-8 py-5">
                              <div className="font-bold text-gray-800">{item.teacher_name}</div>
                              <div className="text-[10px] font-mono text-gray-500 uppercase">{item.teacher_id}</div>
                            </td>
                            <td className="px-8 py-5">
                              {item.eventType === 'ASISTENCIA' ? (
                                <div className="flex flex-col gap-1">
                                  <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase text-center ${item.type === 'ENTRADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>{item.type}</span>
                                  {item.status === 'PENDIENTE' && <span className="bg-yellow-400 text-white text-[8px] font-black text-center rounded py-0.5 shadow-sm">SIN SUBIR</span>}
                                  {item.status === 'TARDE' && <span className="bg-red-500 text-white text-[8px] font-black text-center rounded py-0.5">TARDE</span>}
                                </div>
                              ) : (
                                <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase ${item.status === 'JUSTIFICADA' ? 'bg-indigo-100 text-indigo-700' : 'bg-red-100 text-red-700'}`}>FALTA {item.status}</span>
                              )}
                            </td>
                            <td className="px-8 py-5 text-sm font-medium text-gray-600">{item.date}</td>
                            <td className="px-8 py-5 text-sm font-bold text-gray-800">{item.eventType === 'ASISTENCIA' ? item.time : (item.reason || '-')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Login Modal */}
      <AnimatePresence>
        {showLogin && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLogin(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="bg-white rounded-[2.5rem] p-10 w-full max-w-sm relative z-10 shadow-2xl">
              <h2 className="text-2xl font-extrabold mb-6">Acceso Administrador</h2>
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">Usuario</label>
                  <input type="text" required value={loginUsername} onChange={e => setLoginUsername(e.target.value)} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all" placeholder="admin" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">Contraseña</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all" placeholder="••••••••" autoFocus />
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">Entrar</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Nuevo Docente (Optimizado para Scroll) */}
      <AnimatePresence>
        {showAddTeacher && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddTeacher(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="bg-white rounded-[2.5rem] w-full max-w-md relative z-10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <form onSubmit={handleAddTeacher} className="flex flex-col h-full">
                <div className="p-8 pb-4 flex justify-between items-center border-b border-gray-50">
                  <h2 className="text-2xl font-extrabold">Nuevo Docente</h2>
                  <button type="button" onClick={() => setShowAddTeacher(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                  <div className="flex justify-center mb-4">
                    <div className="relative w-24 h-24 bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                      {newTeacher.photo_url ? <img src={newTeacher.photo_url} className="w-full h-full object-cover" alt="Perfil" /> : <Camera className="text-gray-300" size={32} />}
                      <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => setNewTeacher({ ...newTeacher, photo_url: reader.result as string });
                          reader.readAsDataURL(file);
                        }
                      }} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">Nombres</label>
                    <input type="text" required value={newTeacher.first_name} onChange={e => setNewTeacher({ ...newTeacher, first_name: e.target.value })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500 transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">Apellidos</label>
                    <input type="text" required value={newTeacher.last_name} onChange={e => setNewTeacher({ ...newTeacher, last_name: e.target.value })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500 transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">DNI / Documento Identidad</label>
                    <input type="text" required value={newTeacher.id} onChange={e => setNewTeacher({ ...newTeacher, id: e.target.value.replace(/\D/g, '') })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500 font-mono transition-all" maxLength={12} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-widest px-1">Especialidad o Cargo</label>
                    <input type="text" required value={newTeacher.specialty} onChange={e => setNewTeacher({ ...newTeacher, specialty: e.target.value })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500 transition-all" />
                  </div>
                </div>
                <div className="p-8 pt-4 border-t border-gray-50">
                  <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">Guardar Docente</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Ver QR (Optimizado para Impresión) */}
      <AnimatePresence>
        {selectedTeacherQR && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedTeacherQR(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="bg-white rounded-[2.5rem] p-12 w-full max-w-sm relative z-10 shadow-2xl text-center">
              <button onClick={() => setSelectedTeacherQR(null)} className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={20} /></button>
              <div className="mb-8">
                <h2 className="text-2xl font-extrabold mb-2">{selectedTeacherQR.first_name} {selectedTeacherQR.last_name}</h2>
                <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">{selectedTeacherQR.id}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl border-4 border-indigo-50 inline-block mb-8 shadow-inner">
                <QRCodeSVG id="qr-svg-to-print" value={selectedTeacherQR.id} size={200} level="H" includeMargin={true} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button onClick={printQRCode} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"><Printer size={20} />Imprimir Código</button>
                <button onClick={downloadQRCode} className="w-full bg-white border-2 border-indigo-100 text-indigo-600 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-all shadow-sm"><Download size={20} />Descargar Imagen</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
