import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
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
    try {
      const saved = localStorage.getItem('admin_session');
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  });
  
  const [activeTab, setActiveTab] = useState<'asistencia' | 'docentes' | 'reportes' | 'faltas'>('asistencia');
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [attendanceType, setAttendanceType] = useState<'ENTRADA' | 'SALIDA'>('ENTRADA');
  const attendanceTypeRef = useRef(attendanceType);
  const [teacherId, setTeacherId] = useState('');
  const [offlineTrigger, setOfflineTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Estados con carga de Caché Local inmediata
  const [teachers, setTeachers] = useState<Teacher[]>(() => {
    try { return JSON.parse(localStorage.getItem('cache_teachers') || '[]'); } catch (e) { return []; }
  });
  const [records, setRecords] = useState<AttendanceRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('cache_records') || '[]'); } catch (e) { return []; }
  });
  const [absences, setAbsences] = useState<AbsenceRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('cache_absences') || '[]'); } catch (e) { return []; }
  });
  const [admins, setAdmins] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('cache_admins') || '[]'); } catch (e) { return []; }
  });

  const [isWrongPort, setIsWrongPort] = useState(false);

  const [showLogin, setShowLogin] = useState(false);
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [showEditTeacher, setShowEditTeacher] = useState(false);
  const [showAddAbsence, setShowAddAbsence] = useState(false);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [newTeacher, setNewTeacher] = useState({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [newAbsence, setNewAbsence] = useState({ teacherId: '', date: new Date().toISOString().split('T')[0], status: 'INJUSTIFICADA', reason: '' });
  const [selectedTeacherQR, setSelectedTeacherQR] = useState<Teacher | null>(null);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reportWeek, setReportWeek] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const scannerRef = useRef<any>(null);
  const isInitializingRef = useRef<boolean>(false);
  const lastScannedRef = useRef<{ id: string, time: number }>({ id: '', time: 0 });
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'checking' | 'reconnecting'>('checking');
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    attendanceTypeRef.current = attendanceType;
  }, [attendanceType]);

  useEffect(() => {
    const handleStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);

    if (window.location.port === '5173') setIsWrongPort(true);

    // Capturar el evento de instalación de PWA
    const handleBeforeInstall = (e: any) => {
      console.log('✅ PWA: Evento beforeinstallprompt capturado.');
      e.preventDefault();
      setDeferredPrompt(e);
    };

    // Escuchamos el evento inmediatamente
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          // Forzar actualización si hay un nuevo SW
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  toast("Nueva versión disponible. Cierra y abre la app.", { icon: '🔄' });
                }
              };
            }
          };
        })
        .catch(err => console.error('SW error:', err));
    }

    // Diferimos la sincronización para liberar el hilo principal durante la carga inicial
    const syncAndFetch = async () => {
      setIsSyncing(true);
      await syncOfflineData();
      await fetchData(false);
      setIsSyncing(false);
    };

    const initTimeout = setTimeout(syncAndFetch, 2500); // Dar más tiempo al navegador para estabilizarse

    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      clearTimeout(initTimeout);
    };
  }, []);

  // --- FUNCIONES DE QR (CARGA DINÁMICA) ---
  const startScanner = async () => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;
    const element = document.getElementById("reader");
    if (!element) { isInitializingRef.current = false; return; }
    setScannerError(null);

    try {
      if (scannerRef.current) { try { await scannerRef.current.stop(); } catch (e) {} }
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      
      // Si el usuario ya cambió de pestaña mientras cargaba el módulo, abortamos
      if (activeTab !== 'asistencia') return;

      scannerRef.current = new Html5Qrcode("reader");

      const config = {
        fps: 30, // Aumentamos a 30 FPS para detección ultra rápida
        qrbox: { width: 250, height: 250 }, // Caja fija para evitar cálculos costosos
        aspectRatio: 1.0,
        formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ], // Solo buscar QRs
        experimentalFeatures: { useBarCodeDetectorIfSupported: true } // Usa aceleración nativa si existe
      };

      await scannerRef.current.start(
        { facingMode: "environment" },
        config,
        (text) => {
          const now = Date.now();
          // Reducido a 2 segundos de cooldown para mayor agilidad
          if (lastScannedRef.current.id === text && (now - lastScannedRef.current.time) < 2000) return;
          lastScannedRef.current = { id: text, time: now };
          
          if ('vibrate' in navigator) navigator.vibrate(200);
          handleAttendance(text);
        },
        () => {}
      );
      setIsCameraActive(true);
    } catch (err) {
      setScannerError("Error al iniciar cámara. Verifica los permisos del navegador.");
      setIsCameraActive(false);
      toast.error("No se pudo acceder a la cámara", {
        icon: '📷',
        style: { borderRadius: '15px', background: '#333', color: '#fff' }
      });
    } finally { isInitializingRef.current = false; }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    console.log('✅ PWA: Prompt de instalación mostrado al usuario.');
    setDeferredPrompt(null); // Limpiamos el prompt sin importar el resultado
  };

  const deleteAbsence = async (id: number | string) => {
    if (!confirm('¿Eliminar este registro de falta?')) return;
    try {
      const res = await fetch(`/api/absences/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Registro eliminado');
        fetchData();
      }
    } catch (e) { toast.error('Error al eliminar'); }
  };

  const handleDeleteTeacher = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar a este docente? Se borrarán también sus registros de asistencia.')) return;
    try {
      const res = await fetch(`/api/teachers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Docente eliminado correctamente');
        fetchData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Error al eliminar');
      }
    } catch (e) { toast.error('Error de conexión'); }
  };

  const handleUpdateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;
    const loading = toast.loading('Actualizando docente...');
    try {
      const res = await fetch(`/api/teachers/${editingTeacher.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTeacher),
      });
      if (res.ok) { toast.success('Datos actualizados', { id: loading }); setShowEditTeacher(false); fetchData(); }
      else { toast.error('Error al actualizar', { id: loading }); }
    } catch (e) { toast.error('Fallo de conexión', { id: loading }); }
  };

  const downloadQRCode = () => {
    if (!selectedTeacherQR) return;
    const svg = document.getElementById("teacher-qr-code");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    
    img.onload = () => {
      canvas.width = 400;
      canvas.height = 450;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 400, 450);
        ctx.drawImage(img, 50, 50, 300, 300);
        
        ctx.fillStyle = "black";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${selectedTeacherQR.first_name} ${selectedTeacherQR.last_name}`, 200, 380);
        ctx.font = "14px monospace";
        ctx.fillText(`ID: ${selectedTeacherQR.id}`, 200, 410);
      }
      const pngUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = `QR_${selectedTeacherQR.last_name}_${selectedTeacherQR.first_name}.png`;
      link.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  useEffect(() => {
    // Si no estamos en asistencia/scan, apagamos la cámara inmediatamente
    if (activeTab !== 'asistencia' || mode !== 'scan') {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      setIsCameraActive(false);
      return;
    }

    const timer = setTimeout(() => startScanner(), 100);
    return () => clearTimeout(timer);
  }, [activeTab, mode]);

  const fetchData = async (showLoader = false) => {
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

      const hResPromise = responses[3];
      if (hResPromise.status === 'fulfilled' && hResPromise.value.ok) {
        const health = await safeJson(hResPromise);
        if (health && (health.status === 'ok' || health.db === 'connected')) {
          setDbStatus('connected');
          setDbErrorMessage(null);
        }
      }

      const [tData, rData, aData, admData] = await Promise.all([
        safeJson(responses[0]), safeJson(responses[1]), safeJson(responses[2]), safeJson(responses[4])
      ]);

      if (Array.isArray(tData)) { setTeachers(tData); localStorage.setItem('cache_teachers', JSON.stringify(tData)); }
      if (Array.isArray(rData)) { setRecords(rData); localStorage.setItem('cache_records', JSON.stringify(rData)); }
      if (Array.isArray(aData)) { setAbsences(aData); localStorage.setItem('cache_absences', JSON.stringify(aData)); }
      if (Array.isArray(admData)) { 
        setAdmins(admData); 
        localStorage.setItem('cache_admins', JSON.stringify(admData)); 
      } else {
        setAdmins([]);
      }
    } catch (error) {
      setDbStatus('connected');
    } finally {
      clearTimeout(wakeupTimer);
      setIsWakingUp(false);
      setIsLoading(false);
    }
  };

  // --- EXPORTAR EXCEL (DINÁMICO) ---
  const downloadExcel = async () => {
    const loading = toast.loading('Generando reporte Excel...');
    try {
      const safeRecords = Array.isArray(combinedRecords) ? combinedRecords : [];
      const safeAbsences = Array.isArray(combinedAbsences) ? combinedAbsences : [];

      const data = [
        ...safeRecords.map((r: any) => ({
          'Tipo': 'ASISTENCIA', 
          'Docente': (r.teacher_name || 'DESCONOCIDO').toUpperCase(), 
          'DNI': r.teacher_id || '-', 
          'Estado': r.type === 'ENTRADA' ? (r.status === 'TARDE' ? 'TARDE' : 'ASISTIÓ') : (r.type || 'S/D'), 
          'Fecha': r.date || '-', 
          'Hora': r.time || '-', 
          'Detalle': r.status || 'PUNTUAL'
        })),
        ...safeAbsences.map((a: any) => ({
          'Tipo': 'FALTA', 
          'Docente': a.teacher_name || 'Desconocido', 
          'DNI': a.teacher_id || '-', 
          'Estado': 'FALTA', 
          'Fecha': a.date || '-', 
          'Hora': '-', 
          'Detalle': a.reason || 'Sin motivo',
          'Sincronización': a.offline ? 'PENDIENTE' : 'OK'
        }))
      ].sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reporte");
      XLSX.writeFile(wb, `Reporte_Asistencia_${reportMonth || 'General'}.xlsx`);
      toast.success('Excel descargado', { id: loading });
    } catch (error) {
      toast.error('Error al generar Excel', { id: loading });
    }
  };

  // --- LÓGICA DE DATOS COMBINADOS (OFFLINE + ONLINE) ---
  const combinedRecords = useMemo(() => {
    try {
      if (!Array.isArray(teachers)) return [];
      let pending = [];
      try {
        const raw = localStorage.getItem('pending_attendance');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) pending = parsed;
        }
      } catch (e) { pending = []; }

      const teacherMap = new Map(teachers.filter(t => t && t?.id).map(t => [t.id.toString(), t]));

      const mappedPending = pending.map((item: any) => {
        if (!item) return null;
        const tId = item.teacherId?.toString() || '';
        const tObj = teacherMap.get(tId);
        return {
          id: item.offlineId || Math.random().toString(),
          teacher_name: tObj ? `${tObj.first_name} ${tObj.last_name}` : (tId || 'Desconocido'),
          teacher_id: tId,
          type: item.type || 'S/D',
          date: item.manualDate || '',
          time: item.manualTime || '',
          status: item.status || 'PENDIENTE'
        };
      }).filter((r): r is AttendanceRecord => r !== null && !!r.teacher_id);

      const allRecords = [...(Array.isArray(records) ? records : []), ...mappedPending];
      return allRecords
        .filter(r => r && r.date && (reportWeek ? isDateInWeek(r.date, reportWeek) : (reportMonth ? r.date.startsWith(reportMonth) : true)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''))
        .slice(0, 100);
    } catch (err) {
      console.error("Error en combinedRecords:", err);
      return [];
    }
  }, [records, teachers, reportMonth, reportWeek, offlineTrigger]);

  const combinedAbsences = useMemo(() => {
    try {
      if (!Array.isArray(teachers)) return [];
      let pending = [];
      try {
        const raw = localStorage.getItem('pending_absences');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) pending = parsed;
        }
      } catch (e) { pending = []; }

      const teacherMap = new Map(teachers.filter(t => t && t?.id).map(t => [t.id.toString(), t]));

      const mappedPending = pending.map((item: any) => {
        if (!item) return null;
        const tId = item.teacherId?.toString() || '';
        const tObj = teacherMap.get(tId);
        return {
          id: 'pending-' + Math.random(),
          teacher_id: tId,
          teacher_name: tObj ? `${tObj.first_name} ${tObj.last_name}` : (tId || 'Desconocido'),
          date: item.date || '',
          status: item.status || 'INJUSTIFICADA',
          reason: item.reason || '',
          offline: true
        };
      }).filter((a): a is AbsenceRecord => a !== null && !!a.teacher_id);

      const allAbsences = [...(Array.isArray(absences) ? absences : []), ...mappedPending];
      return allAbsences
        .filter(a => a && a.date && (reportWeek ? isDateInWeek(a.date, reportWeek) : (reportMonth ? a.date.startsWith(reportMonth) : true)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } catch (err) {
      console.error("Error en combinedAbsences:", err);
      return [];
    }
  }, [absences, teachers, reportMonth, reportWeek, offlineTrigger]);

  // --- ACCIONES ---
  const handleAttendance = async (id: string) => {
    const tid = id.trim();
    if (isSubmitting || !tid) return;
    setIsSubmitting(true);
    
    // --- LÓGICA DE TARDANZA INTEGRADA ---
    let calculatedStatus = 'PUNTUAL';
    if (attendanceTypeRef.current === 'ENTRADA') {
      // 1. Buscamos en los docentes ya sincronizados
      let teacher = teachers.find(t => t.id === tid);
      
      // 2. MEJORA OFFLINE: Si no existe, buscamos en los docentes agregados offline 
      // que aún no se han subido al servidor.
      if (!teacher) {
        try {
          const pending = JSON.parse(localStorage.getItem('pending_teachers') || '[]');
          teacher = pending.find((t: any) => t.id === tid);
        } catch (e) {
          console.warn("No se pudo acceder a los docentes pendientes offline");
        }
      }

      if (teacher?.schedule) {
        const now = new Date();
        const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Lima' }).format(now).toLowerCase();
        const daySchedule = teacher.schedule[dayName];
        
        if (daySchedule?.enabled) {
          const peruTimeStr = new Intl.DateTimeFormat('en-GB', { 
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' 
          }).format(now);
          const [currH, currM] = peruTimeStr.split(':').map(Number);
          const currentTime = currH * 60 + currM;

          let referenceStartMins = null;
          let minDiff = Infinity;

          if (daySchedule.slots && daySchedule.slots.length > 0) {
            daySchedule.slots.forEach((slot: any) => {
              const [h, m] = slot.start.split(':').map(Number);
              const slotMins = h * 60 + m;
              const diff = Math.abs(currentTime - slotMins);
              if (diff < minDiff) {
                minDiff = diff;
                referenceStartMins = slotMins;
              }
            });
          } else if (daySchedule.start) {
            const [h, m] = daySchedule.start.split(':').map(Number);
            referenceStartMins = h * 60 + m;
          }

          // Si pasa aunque sea 1 minuto de la hora de inicio, es TARDE
          if (referenceStartMins !== null && currentTime > referenceStartMins) {
            calculatedStatus = 'TARDE';
          }
        }
      }
    }

    const loading = toast.loading(`Registrando ${attendanceTypeRef.current}...`);
    try {
      const data = await registerAttendance(tid, attendanceTypeRef.current, calculatedStatus);
      if (data.success) {
        const msg = `${attendanceTypeRef.current} ${calculatedStatus} ${data.offline ? '(Modo Offline)' : ''}`;
        toast.success(msg, { id: loading, duration: 4000 });
        setTeacherId('');
        setOfflineTrigger(prev => prev + 1);
        fetchData();
      } else throw new Error(data.error);
    } catch (error: any) {
      toast.error(error.message || 'Error de conexión', { id: loading });
    } finally { setIsSubmitting(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Verificando...');
    
    const tryOfflineLogin = () => {
      const found = admins.find((a: any) => a.username === loginUsername && a.password === password);
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
    try {
      const data = await registerTeacher(newTeacher);
      if (data.success) {
        toast.success(data.offline ? 'Guardado en memoria (Offline)' : 'Docente registrado', { id: loading });
        setSelectedTeacherQR({ ...newTeacher, schedule: newTeacher.schedule }); // Visualizar QR inmediatamente
        setNewTeacher({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
        setShowAddTeacher(false);
        setOfflineTrigger(prev => prev + 1);
        fetchData();
      }
    } catch (e) { toast.error('Error al guardar', { id: loading }); }
  };

  const onAddAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Registrando...');
    try {
      const data = await registerAbsence(newAbsence);
      if (data.success) {
        toast.success(data.offline ? 'Guardado localmente' : 'Registrado', { id: loading });
        setShowAddAbsence(false);
        setNewAbsence({ teacherId: '', date: new Date().toISOString().split('T')[0], status: 'INJUSTIFICADA', reason: '' });
        setOfflineTrigger(prev => prev + 1);
        fetchData();
      }
    } catch (e) { toast.error('Error', { id: loading }); }
  };

  const isDateInWeek = (dateStr: string, weekStr: string) => {
    try {
      const [y, w] = weekStr.split('-W');
      const d = parseISO(dateStr);
      return getISOWeek(d) === parseInt(w) && getISOWeekYear(d) === parseInt(y);
    } catch (e) {
      return false;
    }
  };
  const handleLogout = () => { setAdminUser(null); localStorage.removeItem('admin_session'); setActiveTab('asistencia'); toast.success('Sesión cerrada'); };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans flex flex-col md:flex-row overflow-hidden">
      <Toaster position="top-center" />
      
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[150] bg-amber-500 text-white text-[10px] font-black uppercase py-1 text-center shadow-lg">
          ⚠️ MODO OFFLINE ACTIVO: Los datos se guardan en el dispositivo y se subirán al detectar internet.
        </div>
      )}

      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-white border-r border-gray-200 flex flex-col h-auto md:h-screen sticky top-0 z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <UserCheck size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-800">EduControl</h1>
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-orange-500'}`}></div>
              <p className="text-[10px] text-slate-900 font-black uppercase tracking-tighter">{isOnline ? 'En línea' : 'Modo Offline'}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 py-2 space-y-1 flex md:flex-col overflow-x-auto custom-scrollbar">
          <button onClick={() => setActiveTab('asistencia')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'asistencia' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-800 hover:bg-gray-50'}`} aria-label="Ver escáner de asistencia"><LayoutDashboard size={20} /><span>Escáner</span></button>
          {adminUser ? (
            <>
              <button onClick={() => setActiveTab('docentes')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'docentes' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-800 hover:bg-slate-50'}`} aria-label="Gestionar docentes"><Users size={20} /><span>Docentes</span></button>
              <button onClick={() => setActiveTab('reportes')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'reportes' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-800 hover:bg-slate-50'}`} aria-label="Ver reportes"><FileText size={20} /><span>Reportes</span></button>
              <button onClick={() => setActiveTab('faltas')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'faltas' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-800 hover:bg-slate-50'}`} aria-label="Control de inasistencias"><AlertCircle size={20} /><span>Faltas</span></button>
            </>
          ) : null}
        </div>

        <div className="p-4 border-t border-gray-100">
          {deferredPrompt && (
            <button onClick={handleInstallClick} className="w-full mb-2 flex items-center gap-3 px-4 py-3 rounded-xl font-black bg-orange-500 text-white hover:bg-orange-600 transition-all shadow-lg" aria-label="Instalar aplicación">
              <Download size={20} />
              <span>Instalar App</span>
            </button>
          )}
          {adminUser ? (
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-rose-700 hover:bg-rose-50 hover:text-rose-800" aria-label="Cerrar sesión de administrador"><LogOut size={20} /><span>Cerrar Sesión</span></button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900" aria-label="Acceder como administrador"><Settings size={20} /><span>Admin Login</span></button>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-y-auto p-4 md:p-8 bg-[#F8F9FA]">
        <div className="flex justify-between items-center mb-6 md:hidden">
           <h1 className="font-black text-xl text-indigo-600">EduControl</h1>
           {isSyncing && <Loader2 className="animate-spin text-indigo-600" size={20} />}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'asistencia' && (
            <motion.div key="asistencia" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-black text-slate-800 tracking-tight">Registro Diario</h2>
                  <p className="text-slate-700 font-medium">Escanea tu código QR o ingresa tu DNI</p>
                </div>
                <div className="bg-white p-1 rounded-2xl border border-gray-200 flex shadow-sm">
                  <button onClick={() => setAttendanceType('ENTRADA')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'ENTRADA' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-600 hover:text-slate-900'}`}>ENTRADA</button>
                  <button onClick={() => setAttendanceType('SALIDA')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'SALIDA' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-600 hover:text-slate-900'}`}>SALIDA</button>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-gray-100 overflow-hidden max-w-2xl mx-auto">
                <div className="flex border-b border-gray-100">
                  <button onClick={() => setMode('scan')} className={`flex-1 py-4 font-bold flex items-center justify-center gap-2 ${mode === 'scan' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`} aria-label="Activar escáner QR">
                    <QrCode size={18} /> Escáner
                  </button>
                  <button onClick={() => setMode('manual')} className={`flex-1 py-4 font-bold flex items-center justify-center gap-2 ${mode === 'manual' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`} aria-label="Ingresar DNI manualmente">
                    <Keyboard size={18} /> Manual
                  </button>
                </div>

                <div className="p-10">
                  {mode === 'scan' ? (
                    <div className="flex flex-col items-center">
                      <div className="w-full max-w-xs aspect-square bg-slate-50 rounded-[2.5rem] border-4 border-dashed border-slate-200 overflow-hidden relative">
                        <div id="reader" className="w-full h-full"></div>
                        {!isCameraActive && (
                          <button onClick={startScanner} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 hover:bg-white transition-colors" aria-label="Activar cámara para escanear QR">
                            <Camera size={40} className="text-indigo-600" />
                            <span className="font-bold text-gray-700">Activar Cámara</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={(e) => { e.preventDefault(); handleAttendance(teacherId); }} className="space-y-6">
                      <div className="text-center space-y-2">
                        <label htmlFor="teacher-dni-input" className="text-xs font-bold text-slate-700 uppercase tracking-widest">Ingrese DNI del Docente</label>
                        <input type="text" value={teacherId} onChange={(e) => setTeacherId(e.target.value.replace(/\D/g, ''))} className="w-full px-8 py-5 bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-indigo-500 outline-none text-2xl font-mono text-center shadow-inner" placeholder="00000000" autoFocus />
                      </div>
                      <button type="submit" disabled={isSubmitting || !teacherId} className="w-full bg-indigo-600 text-white py-5 rounded-3xl font-black text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-3" aria-label={`Registrar ${attendanceType}`}>
                        {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={24} />} REGISTRAR {attendanceType}
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
                <h2 className="text-3xl font-black text-slate-800">Gestión Docente</h2>
                <button onClick={() => setShowAddTeacher(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all" aria-label="Agregar nuevo docente"> 
                  <UserPlus size={20} /> Nuevo
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.isArray(teachers) && teachers.filter(t => t && t.id).map(t => (
                  <div key={t.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all group relative overflow-hidden">
                    <div className="flex justify-between items-start mb-5 relative z-10">
                      <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                        <Users size={24} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setSelectedTeacherQR(t)} className="p-2 bg-slate-50 rounded-xl text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition-all" title="Ver QR">
                          <QrCode size={18} />
                        </button>
                        <button onClick={() => { setEditingTeacher(t); setShowEditTeacher(true); }} className="p-2 bg-slate-50 rounded-xl text-slate-600 hover:text-amber-600 hover:bg-amber-50 transition-all" title="Editar">
                          <Settings size={18} />
                        </button>
                        <button onClick={() => handleDeleteTeacher(t.id)} className="p-2 bg-slate-50 rounded-xl text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-all" title="Eliminar">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                    <h3 className="font-black text-slate-800 text-lg leading-tight">{t.first_name} {t.last_name}</h3>
                    <p className="text-sm text-indigo-600 font-semibold">{t.specialty}</p>
                    <p className="text-xs font-mono text-slate-600 mt-3 tracking-widest bg-slate-100 p-2 rounded-lg inline-block">{t.id}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'faltas' && (
            <motion.div key="faltas" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-black text-slate-800">Inasistencias</h2>
                <button onClick={() => setShowAddAbsence(true)} className="bg-rose-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-rose-100 hover:bg-rose-700 transition-all" aria-label="Registrar nueva falta"> 
                  <AlertCircle size={20} /> Registrar Falta
                </button>
              </div>
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 uppercase">Docente</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 uppercase">Fecha</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 uppercase">Estado</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 uppercase">Motivo</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Array.isArray(combinedAbsences) && combinedAbsences.map((a, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="px-6 py-4 font-bold">{a.teacher_name}</td>
                        <td className="px-6 py-4 text-sm">{a.date}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black ${String(a.status).includes('JUSTIFICADA') ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-700 max-w-[200px] truncate">{a.reason || 'Sin motivo'}</td>
                        <td className="px-6 py-4 text-right">
                           {!a.offline && <button onClick={() => deleteAbsence(a.id)} className="text-slate-400 hover:text-rose-600 transition-colors" aria-label={`Eliminar falta de ${a.teacher_name} el ${a.date}`}><Trash2 size={18} /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'reportes' && (
            <motion.div key="reportes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-black text-slate-800">Reportes</h2>
                  <p className="text-slate-600 font-medium text-sm">Visualiza y exporta la asistencia mensual</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <label htmlFor="report-month-select" className="text-[10px] font-bold text-slate-500 uppercase ml-1 mb-1">Seleccionar Mes</label>
                    <input 
                      id="report-month-select"
                      type="month" 
                      value={reportMonth} 
                      onChange={(e) => {
                        setReportMonth(e.target.value);
                        setReportWeek(''); // Limpiar semana si se selecciona mes
                      }}
                      className="bg-white border border-gray-200 px-4 py-2 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                    />
                  </div>
                  <button onClick={downloadExcel} className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all self-end" aria-label="Exportar reporte a Excel">
                    <Download size={18} /> 
                    <span className="hidden sm:inline">Exportar Excel</span>
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead><tr className="bg-gray-50"><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Docente</th><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Evento</th><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Hora</th><th className="px-6 py-4 text-xs font-bold text-gray-600 uppercase">Estado</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {Array.isArray(combinedRecords) && combinedRecords.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4"><div className="font-black text-slate-800 uppercase text-sm">{r.teacher_name}</div><div className="text-[10px] font-mono text-slate-600">{r.teacher_id}</div></td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-lg text-[10px] font-black border ${r.type === 'ENTRADA' ? (r.status === 'TARDE' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200') : 'bg-blue-50 text-blue-700 border-blue-200'}`} aria-label={`Evento: ${r.type === 'ENTRADA' ? (r.status === 'TARDE' ? 'Tarde' : 'Asistió') : r.type}`}>
                            {r.type === 'ENTRADA' ? (r.status === 'TARDE' ? 'TARDE' : 'ASISTIÓ') : r.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">{r.date} {r.time}</td>
                        <td className="px-6 py-4">
                          {r.status === 'PENDIENTE' ? (
                            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-bold text-[10px] animate-pulse" aria-label="Estado: Pendiente de sincronizar">SIN SUBIR</span>
                          ) : r.status === 'TARDE' ? (
                            <span className="bg-rose-100 text-rose-700 px-2 py-1 rounded font-bold text-[10px]" aria-label="Estado: Tarde">⚠️ TARDE</span>
                          ) : (
                            <span className="text-emerald-700 font-bold text-[10px]" aria-label="Estado: Puntual">✓ PUNTUAL</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals Login */}
      <AnimatePresence>
        {showLogin && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2.5rem] p-10 w-full max-w-sm shadow-2xl">
              <h2 className="text-2xl font-extrabold mb-6 text-center text-gray-900">Admin Access</h2>
              <form onSubmit={handleLogin} className="space-y-6">
                <label htmlFor="login-username" className="sr-only">Usuario</label>
                <input id="login-username" type="text" required value={loginUsername} onChange={e => setLoginUsername(e.target.value)} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500" placeholder="Usuario" aria-label="Campo de usuario" />
                <label htmlFor="login-password" className="sr-only">Contraseña</label>
                <input id="login-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500" placeholder="Contraseña" aria-label="Campo de contraseña" />
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-lg hover:bg-indigo-700 transition-colors" aria-label="Iniciar sesión">ENTRAR</button>
                <button type="button" onClick={() => setShowLogin(false)} className="w-full text-slate-600 font-bold text-sm hover:text-slate-800 transition-colors" aria-label="Cancelar inicio de sesión">Cancelar</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Registrar Falta (Restaurado) */}
      <AnimatePresence>
        {showAddAbsence && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2.5rem] p-10 w-full max-w-md shadow-2xl relative">
              <button onClick={() => setShowAddAbsence(false)} className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full" aria-label="Cerrar formulario de falta"><X size={20} /></button>
              <h2 className="text-2xl font-extrabold mb-6">Registrar Falta</h2>
              <form onSubmit={onAddAbsence} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="absence-teacher" className="text-xs font-bold text-slate-700 uppercase">Docente</label>
                  <select id="absence-teacher" required value={newAbsence.teacherId} onChange={e => setNewAbsence({...newAbsence, teacherId: e.target.value})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500" aria-label="Seleccionar docente para la falta">
                    <option value="">Seleccionar...</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor="absence-date" className="text-xs font-bold text-slate-700 uppercase">Fecha</label>
                    <input id="absence-date" type="date" required value={newAbsence.date} onChange={e => setNewAbsence({...newAbsence, date: e.target.value})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500" aria-label="Fecha de la falta" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="absence-status" className="text-xs font-bold text-slate-700 uppercase">Tipo</label>
                    <select id="absence-status" value={newAbsence.status} onChange={e => setNewAbsence({...newAbsence, status: e.target.value as any})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-indigo-500" aria-label="Estado de la falta">
                      <option value="INJUSTIFICADA">Injustificada</option>
                      <option value="JUSTIFICADA">Justificada</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="absence-reason" className="text-xs font-bold text-slate-700 uppercase">Motivo</label>
                  <textarea id="absence-reason" value={newAbsence.reason} onChange={e => setNewAbsence({...newAbsence, reason: e.target.value})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none h-24 resize-none focus:border-indigo-500" placeholder="Opcional..." aria-label="Motivo de la falta" />
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-colors" aria-label="Guardar registro de falta">GUARDAR FALTA</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Nuevo Docente (Optimizado) */}
      <AnimatePresence>
        {showAddTeacher && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setShowAddTeacher(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} className="bg-white rounded-[2.5rem] w-full max-w-md relative z-10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <form onSubmit={onAddTeacher} className="flex flex-col h-full overflow-hidden">
                <div className="p-8 pb-4 flex justify-between items-center border-b border-gray-50 bg-white">
                  <h2 className="text-2xl font-extrabold">Nuevo Docente</h2>
                  <button type="button" onClick={() => setShowAddTeacher(false)} className="p-2 hover:bg-gray-100 rounded-full" aria-label="Cerrar formulario de nuevo docente"><X size={24} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="new-teacher-first-name" className="text-xs font-bold text-slate-700 uppercase tracking-widest px-1">Nombres</label>
                    <input id="new-teacher-first-name" type="text" required value={newTeacher.first_name} onChange={e => setNewTeacher({ ...newTeacher, first_name: e.target.value })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none" placeholder="Nombres del docente" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-teacher-last-name" className="text-xs font-bold text-slate-700 uppercase tracking-widest px-1">Apellidos</label>
                    <input id="new-teacher-last-name" type="text" required value={newTeacher.last_name} onChange={e => setNewTeacher({ ...newTeacher, last_name: e.target.value })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none" placeholder="Apellidos del docente" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-teacher-id" className="text-xs font-bold text-slate-700 uppercase tracking-widest px-1">DNI / ID</label>
                    <input id="new-teacher-id" type="text" required value={newTeacher.id} onChange={e => setNewTeacher({ ...newTeacher, id: e.target.value.replace(/\D/g, '') })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none font-mono" maxLength={12} placeholder="Número de DNI" />
                  </div>
                  
                  {/* Gestión de Horarios Complejos */}
                  <div className="space-y-4 bg-gray-50 p-6 rounded-3xl border border-gray-100">
                    <label className="text-xs font-bold text-indigo-600 uppercase tracking-widest block mb-2">Horario de Trabajo por Día</label>
                    {Object.entries(newTeacher.schedule).map(([day, data]: [string, any]) => (
                      <div key={day} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <input id={`schedule-${day}-enabled`} type="checkbox" checked={data.enabled} onChange={e => setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, enabled: e.target.checked } } })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500" aria-label={`Habilitar horario para ${DAY_LABELS[day]}`} />
                            <label htmlFor={`schedule-${day}-enabled`} className="font-bold text-slate-700 uppercase text-xs">{DAY_LABELS[day]}</label>
                          </div>
                          {data.enabled && (
                            <button type="button" onClick={() => { 
                              const currentSlots = data.slots || [];
                              setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: [...currentSlots, { start: '07:45', end: '14:05' }] } } });
                            }} className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-colors" aria-label={`Agregar bloque de horario para ${DAY_LABELS[day]}`}>+ Bloque</button>
                          )}
                        </div>

                        {data.enabled && (data.slots || []).map((slot: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 pt-2 border-t border-gray-50">
                            <div className="grid grid-cols-2 gap-2 flex-1">
                              <label htmlFor={`slot-${day}-${idx}-start`} className="sr-only">Hora de inicio</label>
                              <input id={`slot-${day}-${idx}-start`} type="time" value={slot.start} onChange={e => {
                                const newSlots = [...data.slots]; newSlots[idx].start = e.target.value;
                                setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                              }} className="text-xs p-2 bg-gray-50 rounded-lg border-none focus:ring-2 focus:ring-indigo-500" aria-label="Hora de inicio del bloque" />
                              <label htmlFor={`slot-${day}-${idx}-end`} className="sr-only">Hora de fin</label>
                              <input id={`slot-${day}-${idx}-end`} type="time" value={slot.end} onChange={e => {
                                const newSlots = [...data.slots]; newSlots[idx].end = e.target.value;
                                setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                              }} className="text-xs p-2 bg-gray-50 rounded-lg border-none focus:ring-2 focus:ring-indigo-500" aria-label="Hora de fin del bloque" />
                            </div>
                            <button type="button" onClick={() => { 
                              const newSlots = data.slots.filter((_: any, i: number) => i !== idx);
                              setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                            }} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors" aria-label={`Eliminar bloque de horario ${idx + 1}`}><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="new-teacher-specialty" className="text-xs font-bold text-slate-700 uppercase tracking-widest px-1">Especialidad o Cargo</label>
                    <input id="new-teacher-specialty" type="text" required value={newTeacher.specialty} onChange={e => setNewTeacher({ ...newTeacher, specialty: e.target.value })} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none" placeholder="Ej: Docente de Primaria" />
                  </div>
                </div>

                <div className="p-8 pt-4 border-t border-gray-50 bg-white">
                  <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all" aria-label="Guardar nuevo docente">Guardar Docente</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showEditTeacher && editingTeacher && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setShowEditTeacher(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2.5rem] w-full max-w-md relative z-10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <form onSubmit={handleUpdateTeacher} className="flex flex-col h-full overflow-hidden">
                <div className="p-8 pb-4 flex justify-between items-center border-b border-gray-50 bg-white">
                  <h2 className="text-2xl font-extrabold">Editar Docente</h2>
                  <button type="button" onClick={() => setShowEditTeacher(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 uppercase px-1">Nombres</label>
                    <input type="text" required value={editingTeacher.first_name} onChange={e => setEditingTeacher({...editingTeacher, first_name: e.target.value})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 uppercase px-1">Apellidos</label>
                    <input type="text" required value={editingTeacher.last_name} onChange={e => setEditingTeacher({...editingTeacher, last_name: e.target.value})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 uppercase px-1">Cargo o Especialidad</label>
                    <input type="text" required value={editingTeacher.specialty} onChange={e => setEditingTeacher({...editingTeacher, specialty: e.target.value})} className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none" />
                  </div>
                  <div className="space-y-4 bg-gray-50 p-6 rounded-3xl border border-gray-100">
                    <label className="text-xs font-bold text-indigo-600 uppercase tracking-widest block mb-2">Horario de Trabajo</label>
                    {Object.entries(editingTeacher.schedule || INITIAL_SCHEDULE).map(([day, data]: [string, any]) => (
                      <div key={day} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 mb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <input type="checkbox" checked={data.enabled} onChange={e => setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, enabled: e.target.checked } } })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500" />
                            <span className="font-bold text-slate-700 uppercase text-xs">{DAY_LABELS[day]}</span>
                          </div>
                          {data.enabled && (
                            <button type="button" onClick={() => {
                              const currentSlots = data.slots || [];
                              setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: [...currentSlots, { start: '07:45', end: '14:05' }] } } });
                            }} className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg">+ Bloque</button>
                          )}
                        </div>
                        {data.enabled && (data.slots || []).map((slot: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 pt-2 border-t border-gray-50">
                            <div className="grid grid-cols-2 gap-2 flex-1">
                              <input type="time" value={slot.start} onChange={e => {
                                const newSlots = [...data.slots]; newSlots[idx].start = e.target.value;
                                setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: newSlots } } });
                              }} className="text-xs p-2 bg-gray-50 rounded-lg" />
                              <input type="time" value={slot.end} onChange={e => {
                                const newSlots = [...data.slots]; newSlots[idx].end = e.target.value;
                                setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: newSlots } } });
                              }} className="text-xs p-2 bg-gray-50 rounded-lg" />
                            </div>
                            <button type="button" onClick={() => {
                              const newSlots = data.slots.filter((_: any, i: number) => i !== idx);
                              setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: newSlots } } });
                            }} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg"><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-8 pt-4 border-t border-gray-50 bg-white">
                  <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">Guardar Cambios</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {selectedTeacherQR && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedTeacherQR(null)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} className="bg-white rounded-[3rem] p-12 w-full max-w-sm relative z-10 shadow-2xl text-center">
              <button onClick={() => setSelectedTeacherQR(null)} className="absolute top-8 right-8 p-2 hover:bg-gray-100 rounded-full transition-colors text-slate-400"><X size={24} /></button>
              <div className="mb-8">
                <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl shadow-indigo-200">
                  <QrCode size={40} />
                </div>
                <h2 className="text-2xl font-black text-slate-800 leading-tight">{selectedTeacherQR.first_name}<br/>{selectedTeacherQR.last_name}</h2>
                <p className="text-sm font-bold text-indigo-600 mt-2">{selectedTeacherQR.specialty}</p>
                <p className="text-xs font-mono text-slate-400 mt-1 uppercase tracking-widest">{selectedTeacherQR.id}</p>
              </div>
              <div className="bg-white p-6 rounded-[2.5rem] border-4 border-slate-50 inline-block mb-10 shadow-inner">
                <QRCodeSVG id="teacher-qr-code" value={selectedTeacherQR.id} size={200} level="H" includeMargin={true} />
              </div>
              <div className="flex flex-col gap-3">
                <button onClick={() => window.print()} className="w-full bg-slate-100 text-slate-900 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-200 transition-all shadow-sm">
                  <Printer size={20} /> Imprimir Código
                </button>
                <button onClick={downloadQRCode} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg">
                  <Download size={20} /> Descargar Imagen
                </button>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-4">
                  Este código es personal e intransferible
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
