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
import { registerAttendance, syncOfflineData } from '../offlineSync';
import * as XLSX from 'xlsx';

interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
  specialty: string;
  photo_url?: string;
  schedule?: Record<string, { enabled: boolean; start?: string; end?: string; slots?: {start: string, end: string}[] }>;
}

interface AttendanceRecord {
  id: number;
  teacher_name: string;
  teacher_id: string;
  type: string;
  date: string;
  time: string;
  status: string;
}

interface AbsenceRecord {
  id: number;
  teacher_id: string;
  teacher_name: string;
  date: string;
  status: 'JUSTIFICADA' | 'INJUSTIFICADA';
  reason: string;
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
  const [adminUser, setAdminUser] = useState<{username: string, name: string} | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('asistencia');
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [attendanceType, setAttendanceType] = useState<AttendanceType>('ENTRADA');
  // REFERENCIA PARA EL ESCÁNER: Permite que la cámara lea el valor actual sin reiniciarse
  const attendanceTypeRef = useRef<AttendanceType>('ENTRADA');

  useEffect(() => {
    attendanceTypeRef.current = attendanceType;
  }, [attendanceType]);

  const [teacherId, setTeacherId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [absences, setAbsences] = useState<AbsenceRecord[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
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
  const [reportMonth, setReportMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [reportWeek, setReportWeek] = useState<string>(''); // Optional week filter
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'checking' | 'reconnecting'>('checking');
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);
  const [isWrongPort, setIsWongPort] = useState(false);

  useEffect(() => {
    // Verificar si el usuario entró por el puerto de Vite (5173) en lugar del puerto del servidor (3000)
    if (window.location.port === '5173') {
      setIsWongPort(true);
      toast.error('Estás usando el puerto de desarrollo. Cambia a http://localhost:3000', { duration: 10000 });
    }
    // Al cargar la app, intentamos sincronizar datos pendientes
    syncOfflineData();
    fetchData(true);
  }, []);

  const startScanner = async () => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;
    
    const element = document.getElementById("reader");
    if (!element) {
      isInitializingRef.current = false;
      return;
    }

    setScannerError(null);
    setIsCameraActive(false);

    try {
      // 1. Validar Contexto Seguro (HTTPS o localhost)
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!window.isSecureContext && !isLocal) {
        setScannerError("SECURITY_ERROR");
        return;
      }

      // 3. Limpieza profunda
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            await scannerRef.current.stop();
          }
          await scannerRef.current.clear();
        } catch (e) {}
      }

      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: (w: number, h: number) => {
          const size = Math.min(w, h) * 0.75;
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
        rememberLastUsedCamera: true
      };

      // 4. Estrategia de inicio Universal
      try {
        // Intento A: Cámara trasera (Ideal para móviles)
        await html5QrCode.start(
          { facingMode: "environment" }, 
          config, 
          onScanSuccess, 
          onScanFailure
        );
      } catch (err) {
        console.warn("Cámara trasera no disponible, intentando cualquier cámara...", err);
        // Intento B: Cualquier cámara disponible (Ideal para laptops/frontales)
        await html5QrCode.start(
          { facingMode: "user" }, 
          config, 
          onScanSuccess, 
          onScanFailure
        ).catch(async () => {
          // Intento C: Selección manual por ID si el facingMode falla
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            await html5QrCode.start(cameras[0].id, config, onScanSuccess, onScanFailure);
          } else {
            throw new Error("No se detectaron cámaras.");
          }
        });
      }

      setIsCameraActive(true);
      setScannerError(null);
    } catch (err: any) {
      console.error("Error starting scanner:", err);
      let errorMessage = "No se pudo iniciar la cámara.";
      
      const errStr = err.toString().toLowerCase();
      const errName = err.name ? err.name.toLowerCase() : "";
      
      if (errName.includes("notreadable") || errStr.includes("notreadable")) {
        errorMessage = "La cámara está siendo usada por otra aplicación o pestaña.";
      } else if (errStr.includes("security_error") || err.message === "SECURITY_ERROR") {
        errorMessage = "Error de seguridad: La cámara requiere HTTPS o localhost. No funcionará usando la dirección IP directamente (ej. 192.168...).";
      } else if (err.message === "NOT_SUPPORTED") {
        errorMessage = "Tu navegador no soporta el acceso a la cámara o la tiene bloqueada globalmente.";
      } else if (errName.includes("notallowed") || errStr.includes("notallowed") || errStr.includes("permission denied")) {
        errorMessage = "Permiso de cámara denegado. Por favor, permite el acceso a la cámara en la configuración de tu navegador (haz clic en el candado junto a la URL).";
      } else if (errName.includes("notfound") || errStr.includes("notfound")) {
        errorMessage = "No se encontró ninguna cámara en este dispositivo.";
      } else if (errStr.includes("already under transition")) {
        errorMessage = "El escáner se está reiniciando. Por favor, espera un momento.";
      } else {
        errorMessage = `Error: ${err.message || "Permiso denegado o error de hardware"}`;
      }
      
      setScannerError(errorMessage);
      setIsCameraActive(false);
    } finally {
      isInitializingRef.current = false;
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    if (activeTab === 'asistencia' && mode === 'scan') {
      const timer = setTimeout(() => {
        if (isMounted) startScanner();
      }, 500);

      return () => {
        isMounted = false;
        clearTimeout(timer);
        if (scannerRef.current && scannerRef.current.isScanning) {
          isInitializingRef.current = true;
          scannerRef.current.stop().then(() => {
            scannerRef.current?.clear();
          }).catch(err => {
            console.error("Error stopping scanner:", err);
          }).finally(() => {
            isInitializingRef.current = false;
          });
        }
      };
    }
  }, [activeTab, mode]);

  const fetchData = async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    setDbStatus('checking');
    
    const wakeupTimer = setTimeout(() => {
      if (showLoader) setIsWakingUp(true);
    }, 2000);

    try {
      const timestamp = Date.now();
      const responses = await Promise.allSettled([
        fetch(`/api/teachers?t=${timestamp}`),
        fetch(`/api/report?t=${timestamp}`),
        fetch(`/api/absences?t=${timestamp}`),
        fetch(`/api/health?t=${timestamp}`),
        fetch(`/api/admins?t=${timestamp}`)
      ]);

      clearTimeout(wakeupTimer);
      setIsWakingUp(false);
      
      // Helper to safely parse JSON
      const safeJson = async (resPromise: any) => {
        if (resPromise.status === 'fulfilled' && resPromise.value.ok) {
          try {
            return await resPromise.value.json();
          } catch (e) { return null; }
        }
        return null;
      };

      const hResPromise = responses[3];
      if (hResPromise.status === 'fulfilled' && hResPromise.value.ok) {
        const health = await safeJson(hResPromise);
        if (health && (health.status === 'ok' || health.db === 'connected')) {
          setDbStatus('connected');
          setDbErrorMessage(null);
        } else {
          setDbStatus('error');
          setDbErrorMessage(health?.message || 'Error de conexión con la Base de Datos');
        }
      } else {
        setDbStatus('error');
        setDbErrorMessage('Error de conexión con el servidor (Health check fallido)');
      }

      const [tData, rData, aData, admData] = await Promise.all([
        safeJson(responses[0]),
        safeJson(responses[1]),
        safeJson(responses[2]),
        safeJson(responses[4])
      ]);

      if (Array.isArray(tData)) setTeachers([...tData]);
      if (Array.isArray(rData)) setRecords(rData);
      if (Array.isArray(aData)) setAbsences(aData);
      if (Array.isArray(admData)) setAdmins(admData);

      if (responses[0].status === 'rejected' || responses[1].status === 'rejected' || responses[2].status === 'rejected') {
        toast.error('Error parcial al cargar datos');
      } else {
        if (!responses[0].value?.ok || !responses[1].value?.ok || !responses[2].value?.ok) {
          toast.error('Error al cargar algunos datos de la base de datos');
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setDbStatus('error');
      toast.error('Error de conexión con el servidor');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadReport = () => {
    try {
      const safeRecords = Array.isArray(records) ? records : [];
      const safeAbsences = Array.isArray(absences) ? absences : [];

      const data = [
        ...filteredRecords.map(r => ({
          'Tipo de Registro': 'ASISTENCIA',
          'Nombre del Docente': r.teacher_name,
          'ID/Código': r.teacher_id,
          'Evento': r.type,
          'Fecha': r.date,
          'Hora': r.time,
          'Motivo': '-'
        })),
        ...filteredAbsences.map(a => ({
          'Tipo de Registro': 'FALTA',
          'Nombre del Docente': a.teacher_name,
          'ID/Código': a.teacher_id,
          'Evento': a.status,
          'Fecha': a.date,
          'Hora': '-',
          'Motivo': a.reason || 'Sin motivo'
        }))
      ].sort((a, b) => b['Fecha'].localeCompare(a['Fecha']));

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reporte");

      // Generate file and trigger download
      const period = reportWeek ? `semana_${reportWeek}` : (reportMonth ? `mes_${reportMonth}` : 'completo');
      XLSX.writeFile(wb, `reporte_asistencia_${period}.xlsx`);
      
      toast.success('Reporte Excel generado correctamente');
    } catch (error) {
      console.error('Error generating Excel:', error);
      toast.error('Error al generar el archivo Excel');
    }
  };

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    const teacherToSave = { ...newTeacher, id: newTeacher.id.trim() };
    
    if (!teacherToSave.id || !teacherToSave.first_name || !teacherToSave.last_name || !teacherToSave.specialty) {
      toast.error('Por favor, completa todos los campos obligatorios');
      return;
    }

    const loading = toast.loading('Guardando docente...');
    try {
      const response = await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teacherToSave),
      });
      const data = await response.json();
      
      if (response.ok) {
        toast.success(`Docente registrado con éxito`, { id: loading });
        setSelectedTeacherQR(data.teacher || teacherToSave as Teacher);
        setNewTeacher({ id: '', first_name: '', last_name: '', specialty: '', photo_url: '', schedule: INITIAL_SCHEDULE });
        setShowAddTeacher(false);
        await fetchData(false);
      } else {
        toast.error(data.error || 'Error al guardar', { id: loading });
      }
    } catch (error) {
      toast.error('Error de conexión', { id: loading });
    }
  };

  const handleUpdateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;

    try {
      const response = await fetch(`/api/teachers/${editingTeacher.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          first_name: editingTeacher.first_name, 
          last_name: editingTeacher.last_name, 
          specialty: editingTeacher.specialty,
          photo_url: editingTeacher.photo_url,
          schedule: editingTeacher.schedule
        }),
      });
      if (response.ok) {
        toast.success('Docente actualizado');
        setShowEditTeacher(false);
        setEditingTeacher(null);
        await fetchData(false);
      } else {
        toast.error('Error al actualizar');
      }
    } catch (error) {
      toast.error('Error de conexión');
    }
  };

  const handleDeleteTeacher = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar a este docente?')) return;
    try {
      const response = await fetch(`/api/teachers/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (response.ok) {
        toast.success('Docente eliminado');
        fetchData();
      } else {
        toast.error(data.error || 'Error al eliminar');
      }
    } catch (error) {
      toast.error('Error de conexión');
    }
  };

  function onScanSuccess(decodedText: string) {
    try {
      if (isSubmitting) return;

      const now = Date.now();
      // Cooldown local de 10 segundos para el mismo QR
      if (lastScannedRef.current.id === decodedText && (now - lastScannedRef.current.time) < 10000) {
        return;
      }
      
      lastScannedRef.current = { id: decodedText, time: now };
      
      // Vibration feedback (if supported)
      if ('vibrate' in navigator) {
        navigator.vibrate(200);
      }
      
      handleAttendance(decodedText);
    } catch (err) {
      console.error("Error in onScanSuccess:", err);
    }
  }

  function onScanFailure(error: any) {}

  const downloadQRCode = () => {
    if (!selectedTeacherQR) return;
    
    const svg = document.getElementById('qr-svg-to-print');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width + 40;
      canvas.height = img.height + 100;
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        ctx.fillStyle = 'black';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${selectedTeacherQR.first_name} ${selectedTeacherQR.last_name}`, canvas.width / 2, 30);
        ctx.font = '14px monospace';
        ctx.fillText(selectedTeacherQR.id, canvas.width / 2, 55);
        
        // Draw QR
        ctx.drawImage(img, 20, 70);
        
        const pngUrl = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.href = pngUrl;
        downloadLink.download = `QR_${selectedTeacherQR.last_name}_${selectedTeacherQR.first_name}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const printQRCode = () => {
    if (!selectedTeacherQR) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Por favor permite las ventanas emergentes');
      return;
    }

    const qrSvgElement = document.getElementById('qr-svg-to-print');
    if (!qrSvgElement) return;
    
    const svgData = new XMLSerializer().serializeToString(qrSvgElement);
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Imprimir QR - ${selectedTeacherQR.first_name} ${selectedTeacherQR.last_name}</title>
          <style>
            body { 
              display: flex; 
              flex-direction: column; 
              align-items: center; 
              justify-content: center; 
              height: 100vh; 
              margin: 0; 
              font-family: sans-serif;
            }
            .container { 
              text-align: center; 
              border: 2px solid #eee; 
              padding: 40px; 
              border-radius: 20px;
            }
            h1 { margin-bottom: 10px; font-size: 24px; }
            p { color: #666; margin-bottom: 30px; font-size: 18px; }
            svg { width: 300px; height: 300px; }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${selectedTeacherQR.first_name} ${selectedTeacherQR.last_name}</h1>
            <p>ID: ${selectedTeacherQR.id}</p>
            ${svgData}
          </div>
          <script>
            window.onload = () => {
              window.print();
              // window.close(); // Opcional: cerrar después de imprimir
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleAttendance = async (id: string) => {
    if (isSubmitting) return;
    
    // Limpiamos el ID de espacios accidentales (común en QRs)
    const cleanId = id.trim();

    setIsSubmitting(true);
    const loadingToast = toast.loading(`Verificando ID: ${cleanId}...`);

    try {
      // Usamos la función con soporte Offline/LocalStorage
      const data = await registerAttendance(cleanId, attendanceTypeRef.current);

      if (data.success) {
        const statusMsg = data.offline ? " (Modo Offline)" : "";
        toast.success(`${attendanceTypeRef.current} registrada${statusMsg}: ${data.teacherName || cleanId}`, {
          id: loadingToast,
          icon: <CheckCircle2 className="text-green-500" />,
          duration: 4000
        });
        setTeacherId('');
        fetchData(); // Refresh records
      } else {
        throw new Error(data.error || 'Error al registrar');
      }
    } catch (error: any) {
      toast.error(error.message || 'Error de conexión', { id: loadingToast });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAbsence.teacherId || !newAbsence.date) return;

    try {
      const response = await fetch('/api/absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAbsence),
      });
      if (response.ok) {
        toast.success('Falta registrada');
        setNewAbsence({ teacherId: '', date: new Date().toISOString().split('T')[0], status: 'INJUSTIFICADA', reason: '' });
        setShowAddAbsence(false);
        fetchData();
      } else {
        toast.error('Error al registrar falta');
      }
    } catch (error) {
      toast.error('Error de conexión');
    }
  };

  const deleteAbsence = async (id: number) => {
    if (!confirm('¿Eliminar este registro de falta?')) return;
    try {
      const response = await fetch(`/api/absences/${id}`, { method: 'DELETE' });
      if (response.ok) {
        toast.success('Registro eliminado');
        fetchData();
      }
    } catch (error) {
      toast.error('Error al eliminar');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const loading = toast.loading('Autenticando...');
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password }),
      });
      const data = await response.json();
      if (response.ok) {
        setAdminUser(data.user);
        setShowLogin(false);
        setPassword('');
        toast.success(`Bienvenido, ${data.user.name}`, { id: loading });
      } else {
        toast.error(data.error || 'Credenciales inválidas', { id: loading });
      }
    } catch (error) {
      toast.error('Error de conexión', { id: loading });
    }
  };

  const handleSaveAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAdmin),
      });
      if (response.ok) {
        toast.success('Administrador guardado/actualizado');
        setShowAddAdmin(false);
        setNewAdmin({ username: '', password: '', name: '' });
        fetchData();
      }
    } catch (error) {
      toast.error('Error al guardar');
    }
  };

  const handleLogout = () => {
    setAdminUser(null);
    setActiveTab('asistencia');
    toast.success('Sesión cerrada');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacherId.trim()) return;
    handleAttendance(teacherId.trim());
  };

  // Helper function to check if a date string (YYYY-MM-DD) belongs to a week string (YYYY-Www)
  const isDateInWeek = (dateStr: string, weekStr: string) => {
    if (!weekStr) return true;
    try {
      const [yearStr, weekNumStr] = weekStr.split('-W');
      const targetYear = parseInt(yearStr);
      const targetWeek = parseInt(weekNumStr);
      
      const date = parseISO(dateStr);
      const dateWeek = getISOWeek(date);
      const dateWeekYear = getISOWeekYear(date);
      
      return dateWeek === targetWeek && dateWeekYear === targetYear;
    } catch (e) {
      console.error("Error parsing week:", e);
      return false;
    }
  };

  const filteredRecords = useMemo(() => (Array.isArray(records) ? records : []).filter(r => {
    if (reportWeek) return isDateInWeek(r.date, reportWeek);
    if (reportMonth) return r.date.startsWith(reportMonth);
    return true;
  }), [records, reportWeek, reportMonth]);

  const filteredAbsences = useMemo(() => (Array.isArray(absences) ? absences : []).filter(a => {
    if (reportWeek) return isDateInWeek(a.date, reportWeek);
    if (reportMonth) return a.date.startsWith(reportMonth);
    return true;
  }), [absences, reportWeek, reportMonth]);

  return (
    <><div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-indigo-100 flex flex-col md:flex-row overflow-hidden">
      <Toaster position="top-center" />

      {isWakingUp && (dbStatus === 'checking' || dbStatus === 'reconnecting') && (
        <div className="fixed inset-0 z-[200] bg-indigo-600 flex flex-col items-center justify-center text-white p-6">
          <Loader2 className="animate-spin mb-4" size={48} />
          <h2 className="text-2xl font-bold mb-2">Despertando el sistema...</h2>
          <p className="text-indigo-100 text-center">Los servicios gratuitos de Render y Supabase tardan unos segundos en iniciar tras inactividad.</p>
        </div>
      )}

      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-gray-200 flex flex-col h-auto md:h-screen sticky top-0 z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 shrink-0">
            <UserCheck size={24} />
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold text-lg leading-tight truncate">Asistencia</h1>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Institución Educativa</p>
          </div>
        </div>

        <div className="flex-1 px-4 py-2 space-y-1 overflow-x-auto md:overflow-x-visible flex md:flex-col gap-2 md:gap-1">
          <button
            onClick={() => setActiveTab('asistencia')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${activeTab === 'asistencia' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <LayoutDashboard size={20} />
            <span>Asistencia</span>
          </button>

          {adminUser && (
            <>
              <button
                onClick={() => setActiveTab('docentes')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${activeTab === 'docentes' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <Users size={20} />
                <span>Docentes</span>
              </button>
              <button
                onClick={() => setActiveTab('reportes')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${activeTab === 'reportes' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <FileText size={20} />
                <span>Reportes</span>
              </button>
              <button
                onClick={() => setActiveTab('faltas')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${activeTab === 'faltas' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <AlertCircle size={20} />
                <span>Faltas</span>
              </button>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100">
          {adminUser ? (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-red-500 hover:bg-red-50 transition-all"
            >
              <LogOut size={20} />
              <span>Salir Admin</span>
            </button>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-gray-500 hover:bg-gray-50 transition-all"
            >
              <Settings size={20} />
              <span>Admin</span>
            </button>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 hidden md:block">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest">
            <div className={`w-2 h-2 rounded-full ${dbStatus === 'connected' ? 'bg-green-500' :
                dbStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
            {dbStatus === 'connected' ? 'Base de Datos Conectada' :
              dbStatus === 'error' ? (dbErrorMessage || 'Error de Conexión') : 'Verificando...'}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 h-screen overflow-y-auto bg-[#F8F9FA]">
        <div className="max-w-5xl mx-auto p-4 md:p-10">
          <AnimatePresence mode="wait">
            {activeTab === 'asistencia' && (
              <motion.div
                key="asistencia"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Registro de Asistencia</h2>
                    <p className="text-gray-500 font-medium">Escanea tu código o ingresa tu ID manualmente</p>
                  </div>

                  <div className="bg-white p-1 rounded-2xl border border-gray-200 flex shadow-sm">
                    <button
                      onClick={() => setAttendanceType('ENTRADA')}
                      className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'ENTRADA' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      ENTRADA
                    </button>
                    <button
                      onClick={() => setAttendanceType('SALIDA')}
                      className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${attendanceType === 'SALIDA' ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      SALIDA
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                  <div className="flex border-b border-gray-100">
                    <button
                      onClick={() => setMode('scan')}
                      className={`flex-1 py-6 flex items-center justify-center gap-2 font-bold transition-all relative ${mode === 'scan' ? 'text-indigo-600 bg-indigo-50/20' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      <QrCode size={20} />
                      Cámara QR
                      {mode === 'scan' && <motion.div layoutId="modeTab" className="absolute bottom-0 h-1 w-24 bg-indigo-600 rounded-t-full" />}
                    </button>
                    <button
                      onClick={() => setMode('manual')}
                      className={`flex-1 py-6 flex items-center justify-center gap-2 font-bold transition-all relative ${mode === 'manual' ? 'text-indigo-600 bg-indigo-50/20' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      <Keyboard size={20} />
                      Manual
                      {mode === 'manual' && <motion.div layoutId="modeTab" className="absolute bottom-0 h-1 w-24 bg-indigo-600 rounded-t-full" />}
                    </button>
                  </div>

                  <div className="p-10">
                    <AnimatePresence mode="wait">
                      {mode === 'scan' ? (
                        <motion.div
                          key="scan-view"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex flex-col items-center"
                        >
                          <div className="w-full max-w-sm aspect-square bg-gray-50 rounded-[2rem] border-4 border-dashed border-gray-200 overflow-hidden relative group">
                            <div id="reader" className="w-full h-full"></div>

                            {/* Scanning Line Animation */}
                            {isCameraActive && !scannerError && (
                              <motion.div
                                initial={{ top: '10%' }}
                                animate={{ top: '90%' }}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                  repeatType: "reverse",
                                  ease: "linear"
                                }}
                                className="absolute left-[10%] right-[10%] h-0.5 bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)] z-10 pointer-events-none" />
                            )}

                            {scannerError && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-6 text-center z-10">
                                <AlertCircle className="text-red-500 mb-3" size={40} />
                                <p className="text-sm font-bold text-gray-700 mb-1">Error de Cámara</p>
                                <p className="text-xs text-gray-500 mb-5 px-4 leading-relaxed">{scannerError}</p>
                                <div className="flex flex-col gap-2 w-full px-8">
                                  <button
                                    onClick={async () => {
                                      try {
                                        await navigator.mediaDevices.getUserMedia({ video: true });
                                        startScanner();
                                      } catch (e) {
                                        console.error("Manual permission request failed:", e);
                                        startScanner();
                                      }
                                    } }
                                    className="bg-indigo-600 text-white px-6 py-3 rounded-2xl text-xs font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all uppercase tracking-wider"
                                  >
                                    Permitir Acceso
                                  </button>
                                  <button
                                    onClick={startScanner}
                                    className="bg-gray-100 text-gray-600 px-6 py-3 rounded-2xl text-xs font-bold active:scale-95 transition-all uppercase tracking-wider"
                                  >
                                    Reintentar
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="absolute inset-0 border-2 border-indigo-500/30 rounded-[2rem] pointer-events-none" />
                          </div>
                          <div className="mt-8 flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isCameraActive ? 'bg-indigo-500 animate-pulse' : 'bg-gray-300'}`} />
                            <p className={`text-sm font-bold uppercase tracking-widest ${isCameraActive ? 'text-indigo-600' : 'text-gray-400'}`}>
                              {isCameraActive ? 'Cámara Activa - Escaneando' : 'Iniciando Cámara...'}
                            </p>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.form
                          key="manual-view"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          onSubmit={handleManualSubmit}
                          className="max-w-md mx-auto space-y-6"
                        >
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Número de DNI / Documento</label>
                            <input
                              type="text"
                              value={teacherId}
                              onChange={(e) => setTeacherId(e.target.value)}
                              placeholder="Ej: 70654321"
                              className="w-full px-8 py-5 bg-gray-50 border-2 border-gray-100 rounded-3xl focus:border-indigo-500 outline-none transition-all text-2xl font-mono text-center"
                              autoFocus />
                          </div>
                          <button
                            type="submit"
                            disabled={isSubmitting || !teacherId.trim()}
                            className="w-full bg-indigo-600 text-white py-5 rounded-3xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                          >
                            {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={24} />}
                            REGISTRAR {attendanceType}
                          </button>
                        </motion.form>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'docentes' && (
              <motion.div
                key="docentes"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Gestión de Docentes</h2>
                    <p className="text-gray-500 font-medium">Administra el personal y genera sus códigos QR</p>
                  </div>
                  <button
                    onClick={() => setShowAddTeacher(true)}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
                  >
                    <UserPlus size={20} />
                    Nuevo Docente
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(Array.isArray(teachers) ? teachers : []).map((teacher) => (
                    <motion.div
                      layout
                      key={teacher.id}
                      className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all group"
                    >
                      <div className="flex items-start justify-between mb-4">
                        {teacher.photo_url ? (
                          <img
                            src={teacher.photo_url}
                            alt="Foto"
                            className="w-12 h-12 rounded-2xl object-cover border-2 border-indigo-50" />
                        ) : (
                          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                            <Users size={24} />
                          </div>
                        )}
                        <button
                          onClick={() => setSelectedTeacherQR(teacher)}
                          className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                          title="Ver QR"
                        >
                          <QrCode size={20} />
                        </button>
                      </div>
                      <h3 className="font-bold text-lg leading-tight mb-1">{teacher.first_name} {teacher.last_name}</h3>
                      <p className="text-sm text-indigo-600 font-semibold mb-2">{teacher.specialty}</p>
                      {teacher.schedule && (
                        <p className="text-[10px] bg-gray-100 px-2 py-1 rounded-lg inline-block mb-2 font-bold text-gray-600">
                          🕒 Horario Semanal Configurado
                        </p>
                      )}
                      <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">{teacher.id}</p>

                      <div className="mt-6 pt-6 border-t border-gray-50 flex justify-end gap-2">
                        <button
                          onClick={() => { setEditingTeacher(teacher); setShowEditTeacher(true); } }
                          className="text-gray-300 hover:text-indigo-600 transition-colors p-2"
                        >
                          <Settings size={18} />
                        </button>
                        <button onClick={() => handleDeleteTeacher(teacher.id)} className="text-gray-300 hover:text-red-500 transition-colors p-2">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'reportes' && (
              <motion.div
                key="reportes"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Reportes y Estadísticas</h2>
                    <p className="text-gray-500 font-medium">Filtra por mes y semana para ver el rendimiento</p>
                  </div>
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-gray-100 shadow-sm">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Mes:</span>
                      <input
                        type="month"
                        value={reportMonth}
                        onChange={(e) => {
                          setReportMonth(e.target.value);
                          setReportWeek(''); // Clear week when month changes
                        } }
                        className="text-sm font-bold text-gray-700 outline-none" />
                    </div>
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-gray-100 shadow-sm">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Semana:</span>
                      <input
                        type="week"
                        value={reportWeek}
                        onChange={(e) => {
                          setReportWeek(e.target.value);
                          if (e.target.value) setReportMonth(''); // Clear month when week is selected
                        } }
                        className="text-sm font-bold text-gray-700 outline-none" />
                    </div>
                    {(reportMonth || reportWeek) && (
                      <button
                        onClick={() => { setReportMonth(''); setReportWeek(''); } }
                        className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-widest"
                      >
                        Limpiar
                      </button>
                    )}
                    <button
                      onClick={downloadReport}
                      className="bg-emerald-600 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                    >
                      <Download size={20} />
                      Descargar Reporte Excel
                    </button>
                  </div>
                </div>

                {/* Resumen Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                        <UserCheck size={24} />
                      </div>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Asistencias</span>
                    </div>
                    <div className="text-4xl font-black text-gray-800">
                      {filteredRecords.filter(r => r.type === 'ENTRADA').length}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 font-medium">Entradas registradas {reportWeek ? 'esta semana' : 'este mes'}</p>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
                        <AlertCircle size={24} />
                      </div>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Faltas Injust.</span>
                    </div>
                    <div className="text-4xl font-black text-gray-800">
                      {filteredAbsences.filter(a => a.status === 'INJUSTIFICADA').length}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 font-medium">Inasistencias sin justificar</p>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                        <CheckCircle2 size={24} />
                      </div>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Faltas Just.</span>
                    </div>
                    <div className="text-4xl font-black text-gray-800">
                      {filteredAbsences.filter(a => a.status === 'JUSTIFICADA').length}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 font-medium">Inasistencias justificadas</p>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-8 py-6 border-b border-gray-50 flex items-center justify-between">
                    <h3 className="font-bold text-gray-800">Detalle {reportWeek ? 'Semanal' : 'Mensual'}</h3>
                    <div className="flex gap-2">
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> ENTRADAS
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> FALTAS
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50/50">
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Docente</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Evento</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Fecha</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {[
                          ...filteredRecords.map(r => ({ ...r, eventType: 'ASISTENCIA' })),
                          ...filteredAbsences.map(a => ({ ...a, eventType: 'FALTA' }))
                        ]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((item: any, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/30 transition-colors">
                              <td className="px-8 py-5">
                                <div className="font-bold text-gray-800">{item.teacher_name}</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">{item.teacher_id}</div>
                              </td>
                              <td className="px-8 py-5">
                                {item.eventType === 'ASISTENCIA' ? (
                                  <div className="flex flex-col gap-1">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase text-center ${item.type === 'ENTRADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                                      {item.type}
                                    </span>
                                    {item.status === 'TARDE' && (
                                      <span className="bg-red-500 text-white text-[8px] font-black text-center rounded py-0.5">TARDE</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase ${item.status === 'JUSTIFICADA' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                                    FALTA {item.status}
                                  </span>
                                )}
                              </td>
                              <td className="px-8 py-5 text-sm font-medium text-gray-500">{item.date}</td>
                              <td className="px-8 py-5 text-sm font-bold text-gray-700">
                                {item.eventType === 'ASISTENCIA' ? item.time : (item.reason || '-')}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredRecords.length === 0 &&
                    filteredAbsences.length === 0 && (
                      <div className="p-20 text-center text-gray-400 font-medium">
                        No hay registros para este periodo
                      </div>
                    )}
                </div>
              </motion.div>
            )}
            {activeTab === 'faltas' && adminUser && (
              <motion.div
                key="faltas"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight">Control de Faltas</h2>
                    <p className="text-gray-500 font-medium">Gestiona justificaciones e inasistencias</p>
                  </div>
                  <div className="flex gap-3 items-center">
                    <button
                      onClick={() => setShowAddAbsence(true)}
                      className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
                    >
                      <AlertCircle size={20} />
                      Registrar Falta
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50/50">
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Docente</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Estado</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Fecha</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest">Motivo</th>
                          <th className="px-8 py-5 text-xs font-bold text-gray-400 uppercase tracking-widest"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(Array.isArray(absences) ? absences : []).map((abs) => (
                          <tr key={abs.id} className="hover:bg-gray-50/30 transition-colors">
                            <td className="px-8 py-5">
                              <div className="font-bold text-gray-800">{abs.teacher_name}</div>
                              <div className="text-[10px] font-mono text-gray-400 uppercase">{abs.teacher_id}</div>
                            </td>
                            <td className="px-8 py-5">
                              <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase ${abs.status === 'JUSTIFICADA' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                                {abs.status}
                              </span>
                            </td>
                            <td className="px-8 py-5 text-sm font-medium text-gray-500">{abs.date}</td>
                            <td className="px-8 py-5 text-sm text-gray-600 max-w-xs truncate">{abs.reason || '-'}</td>
                            <td className="px-8 py-5 text-right">
                              <button onClick={() => deleteAbsence(abs.id)} className="text-gray-300 hover:text-red-500 transition-colors p-2">
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(Array.isArray(absences) ? absences : []).length === 0 && (
                    <div className="p-20 text-center text-gray-400 font-medium">No hay faltas registradas</div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'config' && adminUser && (
              <motion.div
                key="config"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8"
              >
                <div>
                  <h2 className="text-3xl font-extrabold tracking-tight">Configuración del Sistema</h2>
                  <p className="text-gray-500 font-medium">Gestiona las cuentas de administradores</p>
                </div>

                <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-xl">Administradores</h3>
                    <button
                      onClick={() => setShowAddAdmin(true)}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold"
                    >
                      Añadir/Editar Admin
                    </button>
                  </div>
                  <div className="space-y-4">
                    {admins.map((adm: any) => (
                      <div key={adm.username} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                        <div>
                          <div className="font-bold">{adm.name}</div>
                          <div className="text-xs text-gray-400">Usuario: {adm.username}</div>
                        </div>
                        <button
                          onClick={() => { setNewAdmin({ ...adm, password: '' }); setShowAddAdmin(true); } }
                          className="text-indigo-600 text-sm font-bold"
                        >
                          Editar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showLogin && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowLogin(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] p-10 w-full max-w-sm relative z-10 shadow-2xl"
            >
              <h2 className="text-2xl font-extrabold mb-6">Acceso Administrador</h2>
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Usuario</label>
                  <input
                    type="text" required value={loginUsername}
                    onChange={e => setLoginUsername(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                    placeholder="admin" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Contraseña</label>
                  <input
                    type="password" required value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                    placeholder="••••••••"
                    autoFocus />
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                  Entrar
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showAddAbsence && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAddAbsence(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] p-10 w-full max-w-md relative z-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-extrabold">Registrar Falta</h2>
                <button onClick={() => setShowAddAbsence(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAddAbsence} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Docente</label>
                  <select
                    required value={newAbsence.teacherId}
                    onChange={e => setNewAbsence({ ...newAbsence, teacherId: e.target.value })}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                  >
                    <option value="">Seleccionar Docente</option>
                    {(Array.isArray(teachers) ? teachers : []).map(t => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Fecha</label>
                    <input
                      type="date" required value={newAbsence.date}
                      onChange={e => setNewAbsence({ ...newAbsence, date: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Estado</label>
                    <select
                      required value={newAbsence.status}
                      onChange={e => setNewAbsence({ ...newAbsence, status: e.target.value as any })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                    >
                      <option value="INJUSTIFICADA">Injustificada</option>
                      <option value="JUSTIFICADA">Justificada</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Motivo / Observación</label>
                  <textarea
                    value={newAbsence.reason}
                    onChange={e => setNewAbsence({ ...newAbsence, reason: e.target.value })}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all h-24 resize-none"
                    placeholder="Ej: Cita médica, permiso personal..." />
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                  Guardar Registro
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showAddAdmin && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setShowAddAdmin(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2.5rem] p-10 w-full max-w-md relative z-10 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-extrabold">Gestionar Admin</h2>
                <X onClick={() => setShowAddAdmin(false)} className="cursor-pointer" />
              </div>
              <form onSubmit={handleSaveAdmin} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase">Nombre Completo</label>
                  <input
                    type="text" required value={newAdmin.name}
                    onChange={e => setNewAdmin({ ...newAdmin, name: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                    placeholder="Ej: Nicolle Admin" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase">Usuario</label>
                  <input
                    type="text" required value={newAdmin.username}
                    onChange={e => setNewAdmin({ ...newAdmin, username: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                    placeholder="nicolle.admin" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase">Nueva Contraseña</label>
                  <input
                    type="password" required value={newAdmin.password}
                    onChange={e => setNewAdmin({ ...newAdmin, password: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                    placeholder="••••••••" />
                </div>
                <p className="text-[10px] text-gray-400 italic">* Si el usuario ya existe, se actualizarán sus datos.</p>
                <button type="submit" className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold">
                  Guardar Administrador
                </button>
              </form>
            </motion.div>
          </div>
        )}
        {showAddTeacher && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAddTeacher(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md relative z-10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              <form onSubmit={handleAddTeacher} className="flex flex-col h-full overflow-hidden">
                {/* Cabecera Fija */}
                <div className="p-8 pb-4 flex justify-between items-center border-b border-gray-50 bg-white z-20">
                  <h2 className="text-2xl font-extrabold">Nuevo Docente</h2>
                  <button type="button" onClick={() => setShowAddTeacher(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <X size={24} />
                  </button>
                </div>

                {/* Cuerpo con Desplazamiento (Barra vertical) */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                  <div className="flex justify-center mb-4">
                    <div className="relative group">
                      <div className="w-24 h-24 bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                        {newTeacher.photo_url ? (
                          <img src={newTeacher.photo_url} className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="text-gray-300" size={32} />
                        )}
                      </div>
                      <input
                        type="file" accept="image/*"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setNewTeacher({ ...newTeacher, photo_url: reader.result as string });
                            reader.readAsDataURL(file);
                          }
                        } } />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Nombres</label>
                    <input
                      type="text" required value={newTeacher.first_name}
                      onChange={e => setNewTeacher({ ...newTeacher, first_name: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                      placeholder="Escribe los nombres" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Apellidos</label>
                    <input
                      type="text" required value={newTeacher.last_name}
                      onChange={e => setNewTeacher({ ...newTeacher, last_name: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                      placeholder="Escribe los apellidos" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Número de DNI / Documento de Identidad</label>
                    <input
                      type="text" required value={newTeacher.id}
                      onChange={e => {
                        const val = e.target.value.replace(/[^0-9]/g, ''); // Solo permite números
                        setNewTeacher({ ...newTeacher, id: val });
                      } }
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all font-mono"
                      placeholder="Ej: 70654321"
                      maxLength={12} />
                  </div>
                  <div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100">
                    <label className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-2 block">Horario Semanal</label>
                    {Object.entries(newTeacher.schedule).map(([day, data]: [string, any]) => (
                      <div key={day} className="flex items-center justify-between p-2 bg-white rounded-xl mb-1 border border-gray-100 shadow-sm">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox" checked={data.enabled}
                            className="w-4 h-4 rounded text-indigo-600"
                            onChange={e => setNewTeacher({
                              ...newTeacher,
                              schedule: { ...newTeacher.schedule, [day]: { ...data, enabled: e.target.checked } }
                            })} />
                          <span className="text-xs font-bold w-12 uppercase text-gray-600">{DAY_LABELS[day] || day}</span>
                        </div>

                        {data.enabled ? (
                          <div className="flex flex-col gap-2 flex-1 items-end ml-4">
                            {(data.slots || [{ start: data.start || '07:45', end: data.end || '14:05' }]).map((slot: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                                <div className="flex flex-col">
                                  <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Inicio</span>
                                  <input
                                    type="time" value={slot.start}
                                    onChange={e => {
                                      const newSlots = [...(data.slots || [{ start: data.start, end: data.end }])];
                                      newSlots[idx] = { ...newSlots[idx], start: e.target.value };
                                      setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                                    } }
                                    className="text-[10px] p-1 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-700 outline-none" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Fin</span>
                                  <input
                                    type="time" value={slot.end || '14:05'}
                                    onChange={e => {
                                      const newSlots = [...(data.slots || [{ start: data.start, end: data.end }])];
                                      newSlots[idx] = { ...newSlots[idx], end: e.target.value };
                                      setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                                    } }
                                    className="text-[10px] p-1 bg-white border border-gray-100 rounded-lg font-bold text-gray-600 outline-none" />
                                </div>
                                {idx > 0 && (
                                  <button type="button" onClick={() => {
                                    const newSlots = data.slots.filter((_: any, i: number) => i !== idx);
                                    setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                                  } } className="text-red-400 hover:text-red-600 self-end mb-1 px-1">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                const currentSlots = data.slots || [{ start: data.start || '07:45', end: data.end || '14:05' }];
                                setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: [...currentSlots, { start: '07:45', end: '14:05' }] } } });
                              } }
                              className="text-[9px] font-bold text-indigo-600 hover:underline"
                            >
                              + Agregar Bloque
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300 font-bold uppercase italic">No labora</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Cargo o Especialidad</label>
                    <input
                      type="text" required value={newTeacher.specialty}
                      onChange={e => setNewTeacher({ ...newTeacher, specialty: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                      placeholder="Ej: Docente de Primaria / Cargo administrativo" />
                  </div>
                </div>

                {/* Pie de Página Fijo */}
                <div className="p-8 pt-4 border-t border-gray-50 bg-white z-20">
                  <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                    Guardar Docente
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showEditTeacher && editingTeacher && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setShowEditTeacher(false); setEditingTeacher(null); } }
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md relative z-10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              <form onSubmit={handleUpdateTeacher} className="flex flex-col h-full overflow-hidden">
                {/* Cabecera Fija */}
                <div className="p-8 pb-4 flex justify-between items-center border-b border-gray-50 bg-white z-20">
                  <h2 className="text-2xl font-extrabold">Editar Docente</h2>
                  <button type="button" onClick={() => { setShowEditTeacher(false); setEditingTeacher(null); } } className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                  </button>
                </div>

                {/* Cuerpo con Desplazamiento */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                  <div className="flex justify-center mb-4">
                    <div className="relative group">
                      <div className="w-24 h-24 bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                        {editingTeacher.photo_url ? (
                          <img src={editingTeacher.photo_url} className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="text-gray-300" size={32} />
                        )}
                      </div>
                      <input
                        type="file" accept="image/*"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setEditingTeacher({ ...editingTeacher, photo_url: reader.result as string });
                            reader.readAsDataURL(file);
                          }
                        } } />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Nombres</label>
                    <input
                      type="text" required value={editingTeacher.first_name}
                      onChange={e => setEditingTeacher({ ...editingTeacher, first_name: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Apellidos</label>
                    <input
                      type="text" required value={editingTeacher.last_name}
                      onChange={e => setEditingTeacher({ ...editingTeacher, last_name: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">DNI / Documento</label>
                    <input type="text" disabled value={editingTeacher.id} className="w-full px-6 py-4 bg-gray-100 border-2 border-gray-100 rounded-2xl text-gray-500 font-mono" />
                  </div>
                  <div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100">
                    <label className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-2 block">Horario Semanal</label>
                    {Object.entries(editingTeacher.schedule || INITIAL_SCHEDULE).map(([day, data]: [string, any]) => (
                      <div key={day} className="flex items-center justify-between p-2 bg-white rounded-xl mb-1 border border-gray-100 shadow-sm">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox" checked={data.enabled}
                            className="w-4 h-4 rounded text-indigo-600"
                            onChange={e => setEditingTeacher({
                              ...editingTeacher,
                              schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, enabled: e.target.checked } }
                            })} />
                          <span className="text-xs font-bold w-12 uppercase text-gray-600">{DAY_LABELS[day] || day}</span>
                        </div>

                        {data.enabled ? (
                          <div className="flex flex-col gap-2 flex-1 items-end ml-4">
                            {(data.slots || [{ start: data.start || '07:45', end: data.end || '14:05' }]).map((slot: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                                <div className="flex flex-col">
                                  <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Inicio</span>
                                  <input
                                    type="time" value={slot.start}
                                    onChange={e => {
                                      const newSlots = [...(data.slots || [{ start: data.start, end: data.end }])];
                                      newSlots[idx] = { ...newSlots[idx], start: e.target.value };
                                      setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: newSlots } } });
                                    } }
                                    className="text-[10px] p-1 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-700 outline-none" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Fin</span>
                                  <input
                                    type="time" value={slot.end || '14:05'}
                                    onChange={e => {
                                      const newSlots = [...(data.slots || [{ start: data.start, end: data.end }])];
                                      newSlots[idx] = { ...newSlots[idx], end: e.target.value };
                                      setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: newSlots } } });
                                    } }
                                    className="text-[10px] p-1 bg-white border border-gray-100 rounded-lg font-bold text-gray-600 outline-none" />
                                </div>
                                {idx > 0 && (
                                  <button type="button" onClick={() => {
                                    const newSlots = data.slots.filter((_: any, i: number) => i !== idx);
                                    setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: newSlots } } });
                                  } } className="text-red-400 hover:text-red-600 self-end mb-1 px-1">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                const currentSlots = data.slots || [{ start: data.start || '07:45', end: data.end || '14:05' }];
                                setEditingTeacher({ ...editingTeacher, schedule: { ...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: { ...data, slots: [...currentSlots, { start: '07:45', end: '14:05' }] } } });
                              } }
                              className="text-[9px] font-bold text-indigo-600 hover:underline"
                            >
                              + Agregar Bloque
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300 font-bold uppercase italic">No labora</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Cargo o Especialidad</label>
                    <input
                      type="text" required value={editingTeacher.specialty}
                      onChange={e => setEditingTeacher({ ...editingTeacher, specialty: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all" />
                  </div>
                </div>

                {/* Pie de Página Fijo */}
                <div className="p-8 pt-4 border-t border-gray-50 bg-white z-20">
                  <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                    Actualizar Datos
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {selectedTeacherQR && (
        )} : (
        <Camera className="text-gray-300" size={32} />
        )}
      </></div><input
        type="file" accept="image/*"
        className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setNewTeacher({ ...newTeacher, photo_url: reader.result as string });
            reader.readAsDataURL(file);
          }
        } } /></>
                  </div>
                </div>
                <><div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Nombres</label>
                    <input
                      type="text" required value={newTeacher.first_name}
                      onChange={e => setNewTeacher({ ...newTeacher, first_name: e.target.value })}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                      placeholder="Escribe los nombres" />
                  </div><div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Apellidos</label>
                      <input
                        type="text" required value={newTeacher.last_name}
                        onChange={e => setNewTeacher({ ...newTeacher, last_name: e.target.value })}
                        className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                        placeholder="Escribe los apellidos" />
                    </div><div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Número de DNI / Documento de Identidad</label>
                      <input
                        type="text" required value={newTeacher.id}
                        onChange={e => {
                          const val = e.target.value.replace(/[^0-9]/g, ''); // Solo permite números
                          setNewTeacher({ ...newTeacher, id: val });
                        } }
                        className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all font-mono"
                        placeholder="Ej: 70654321"
                        maxLength={12} />
                    </div><div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100">
                      <label className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-2 block">Horario Semanal de Entrada</label>
                      {Object.entries(newTeacher.schedule).map(([day, data]: [string, any]) => (
                        <div key={day} className="flex items-center justify-between p-2 bg-white rounded-xl mb-1 border border-gray-100 shadow-sm">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox" checked={data.enabled}
                              className="w-4 h-4 rounded text-indigo-600"
                              onChange={e => setNewTeacher({
                                ...newTeacher,
                                schedule: { ...newTeacher.schedule, [day]: { ...data, enabled: e.target.checked } }
                              })} />
                            <span className="text-xs font-bold w-12 uppercase text-gray-600">{DAY_LABELS[day] || day}</span>
                          </div>

                          {data.enabled ? (
                            <div className="flex flex-col gap-2 flex-1 items-end ml-4">
                              {(data.slots || [{ start: data.start || '07:45', end: data.end || '14:05' }]).map((slot: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                                  <div className="flex flex-col">
                                    <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Inicio</span>
                                    <input
                                      type="time" value={slot.start}
                                      onChange={e => {
                                        const newSlots = [...(data.slots || [{ start: data.start, end: data.end }])];
                                        newSlots[idx] = { ...newSlots[idx], start: e.target.value };
                                        setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                                      } }
                                      className="text-[10px] p-1 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-700 outline-none" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Fin</span>
                                    <input
                                      type="time" value={slot.end || '14:05'}
                                      onChange={e => {
                                        const newSlots = [...(data.slots || [{ start: data.start, end: data.end }])];
                                        newSlots[idx] = { ...newSlots[idx], end: e.target.value };
                                        setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                                      } }
                                      className="text-[10px] p-1 bg-white border border-gray-100 rounded-lg font-bold text-gray-600 outline-none" />
                                  </div>
                                  {idx > 0 && (
                                    <button type="button" onClick={() => {
                                      const newSlots = data.slots.filter((_: any, i: number) => i !== idx);
                                      setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: newSlots } } });
                                    } } className="text-red-400 hover:text-red-600 self-end mb-1 px-1">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  const currentSlots = data.slots || [{ start: data.start || '07:45', end: data.end || '14:05' }];
                                  setNewTeacher({ ...newTeacher, schedule: { ...newTeacher.schedule, [day]: { ...data, slots: [...currentSlots, { start: '07:45', end: '14:05' }] } } });
                                } }
                                className="text-[9px] font-bold text-indigo-600 hover:underline"
                              >
                                + Agregar Bloque
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-300 font-bold uppercase italic">No labora</span>
                          )}
                        </div>
                      ))}
                    </div><div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Cargo o Especialidad</label>
                      <input
                        type="text" required value={newTeacher.specialty}
                        onChange={e => setNewTeacher({ ...newTeacher, specialty: e.target.value })}
                        className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                        placeholder="Ej: Docente de Primaria / Cargo administrativo" />
                    </div><button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                      Guardar Docente
                    </button></>
              </form>
            </motion.div>
          </div>
        )}

        {showEditTeacher && editingTeacher && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setShowEditTeacher(false); setEditingTeacher(null); }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-[2.5rem] p-8 w-full max-w-md relative z-10 shadow-2xl max-h-[95vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-extrabold">Editar Docente</h2>
                <button onClick={() => { setShowEditTeacher(false); setEditingTeacher(null); }} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleUpdateTeacher} className="space-y-6">
                <div className="flex justify-center mb-4">
                  <div className="relative group">
                    <div className="w-24 h-24 bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                      {editingTeacher.photo_url ? (
                        <img src={editingTeacher.photo_url} className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="text-gray-300" size={32} />
                      )}
                    </div>
                    <input 
                      type="file" accept="image/*" 
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => setEditingTeacher({...editingTeacher, photo_url: reader.result as string});
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Nombres</label>
                  <input 
                    type="text" required value={editingTeacher.first_name}
                    onChange={e => setEditingTeacher({...editingTeacher, first_name: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Apellidos</label>
                  <input 
                    type="text" required value={editingTeacher.last_name}
                    onChange={e => setEditingTeacher({...editingTeacher, last_name: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Número de DNI / Documento de Identidad</label>
                  <input type="text" disabled value={editingTeacher.id} className="w-full px-6 py-4 bg-gray-100 border-2 border-gray-100 rounded-2xl text-gray-500 font-mono" />
                </div>
                <div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100">
                  <label className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-2 block">Horario Semanal de Entrada</label>
                  {Object.entries(editingTeacher.schedule || INITIAL_SCHEDULE).map(([day, data]: [string, any]) => (
                    <div key={day} className="flex items-center justify-between p-2 bg-white rounded-xl mb-1 border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" checked={data.enabled} 
                          className="w-4 h-4 rounded text-indigo-600"
                          onChange={e => setEditingTeacher({
                            ...editingTeacher, 
                            schedule: {...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: {...data, enabled: e.target.checked}}
                          })}
                        />
                      <span className="text-xs font-bold w-12 uppercase text-gray-600">{DAY_LABELS[day] || day}</span>
                      </div>

                      {data.enabled ? (
                      <div className="flex flex-col gap-2 flex-1 items-end ml-4">
                        {(data.slots || [{start: data.start || '07:45', end: data.end || '14:05'}]).map((slot: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                            <div className="flex flex-col">
                              <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Inicio</span>
                              <input 
                                type="time" value={slot.start}
                                onChange={e => {
                                  const newSlots = [...(data.slots || [{start: data.start, end: data.end}])];
                                  newSlots[idx] = { ...newSlots[idx], start: e.target.value };
                                  setEditingTeacher({...editingTeacher, schedule: {...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: {...data, slots: newSlots}}});
                                }}
                                className="text-[10px] p-1 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-700 outline-none"
                              />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[7px] font-black text-gray-400 uppercase ml-1">Fin</span>
                              <input 
                                type="time" value={slot.end || '14:05'}
                                onChange={e => {
                                  const newSlots = [...(data.slots || [{start: data.start, end: data.end}])];
                                  newSlots[idx] = { ...newSlots[idx], end: e.target.value };
                                  setEditingTeacher({...editingTeacher, schedule: {...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: {...data, slots: newSlots}}});
                                }}
                                className="text-[10px] p-1 bg-white border border-gray-100 rounded-lg font-bold text-gray-600 outline-none"
                              />
                            </div>
                            {idx > 0 && (
                              <button type="button" onClick={() => {
                                const newSlots = data.slots.filter((_: any, i: number) => i !== idx);
                                setEditingTeacher({...editingTeacher, schedule: {...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: {...data, slots: newSlots}}});
                              }} className="text-red-400 hover:text-red-600 self-end mb-1 px-1">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button 
                          type="button"
                          onClick={() => {
                            const currentSlots = data.slots || [{start: data.start || '07:45', end: data.end || '14:05'}];
                            setEditingTeacher({...editingTeacher, schedule: {...(editingTeacher.schedule || INITIAL_SCHEDULE), [day]: {...data, slots: [...currentSlots, {start: '07:45', end: '14:05'}]}}});
                          }}
                          className="text-[9px] font-bold text-indigo-600 hover:underline"
                        >
                          + Agregar Bloque
                        </button>
                      </div>
                      ) : (
                        <span className="text-[10px] text-gray-300 font-bold uppercase italic">No labora</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Cargo o Especialidad</label>
                  <input 
                    type="text" required value={editingTeacher.specialty}
                    onChange={e => setEditingTeacher({...editingTeacher, specialty: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                  Actualizar Datos
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {selectedTeacherQR && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedTeacherQR(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] p-12 w-full max-w-sm relative z-10 shadow-2xl text-center"
            >
              <button onClick={() => setSelectedTeacherQR(null)} className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full">
                <X size={20} />
              </button>
              
              <div className="mb-8">
                <h2 className="text-2xl font-extrabold mb-2">{selectedTeacherQR.first_name} {selectedTeacherQR.last_name}</h2>
                <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">{selectedTeacherQR.id}</p>
              </div>

              <div className="bg-white p-6 rounded-3xl border-4 border-indigo-50 inline-block mb-8 shadow-inner">
                <QRCodeSVG 
                  id="qr-svg-to-print"
                  value={selectedTeacherQR.id} 
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={printQRCode}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all"
                >
                  <Printer size={20} />
                  Imprimir Código
                </button>
                <button 
                  onClick={downloadQRCode}
                  className="w-full bg-white border-2 border-indigo-100 text-indigo-600 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-all"
                >
                  <Download size={20} />
                  Descargar Imagen
                </button>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-4">
                  Este código es personal e intransferible
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
 )
