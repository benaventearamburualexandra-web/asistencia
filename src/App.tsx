import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Toaster, toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { 
  QrCode, 
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
import * as XLSX from 'xlsx';

interface Teacher {
  id: string;
  name: string;
}

interface AttendanceRecord {
  id: number;
  teacher_name: string;
  teacher_id: string;
  type: string;
  date: string;
  time: string;
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
  const [newTeacher, setNewTeacher] = useState({ id: '', name: '' });
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
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'checking'>('checking');
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
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
      // First, try to get cameras to trigger permission prompt if not already granted
      let cameras: any[] = [];
      try {
        cameras = await Html5Qrcode.getCameras();
      } catch (camErr: any) {
        console.warn("Error getting cameras, might be permission issue:", camErr);
        const camErrStr = camErr.toString().toLowerCase();
        if (camErrStr.includes("notallowed") || camErr.name === "NotAllowedError" || camErrStr.includes("permission denied")) {
          throw camErr;
        }
      }

      // If there's an existing scanner, try to stop it first
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            await scannerRef.current.stop();
          }
          await scannerRef.current.clear();
        } catch (e) {
          console.warn("Error cleaning up previous scanner:", e);
        }
      }

      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;

      // Dynamic qrbox size based on container width
      const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number) => {
        const minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
        // The library requires a minimum of 50px for qrbox.
        // We take 70% of the viewfinder but never go below 50px.
        const qrboxSize = Math.max(50, Math.floor(minEdgeSize * 0.7));
        return {
          width: qrboxSize,
          height: qrboxSize
        };
      };

      const config = { 
        fps: 20, // Increased FPS for smoother detection
        qrbox: qrboxFunction,
        aspectRatio: 1.0,
        disableFlip: false, // Ensure it works correctly on both front/back cameras
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      };
      
      try {
        // Try environment camera first
        await html5QrCode.start(
          { facingMode: "environment" }, 
          config,
          onScanSuccess,
          onScanFailure
        );
        setIsCameraActive(true);
      } catch (err: any) {
        // If facingMode fails, try to use the first camera from the list
        console.warn("Facing mode environment failed, trying first available camera:", err);
        if (cameras && cameras.length > 0) {
          await html5QrCode.start(
            cameras[0].id,
            config,
            onScanSuccess,
            onScanFailure
          );
          setIsCameraActive(true);
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("Error starting scanner:", err);
      let errorMessage = "No se pudo iniciar la cámara.";
      
      const errStr = err.toString().toLowerCase();
      const errName = err.name ? err.name.toLowerCase() : "";
      
      if (errName.includes("notreadable") || errStr.includes("notreadable")) {
        errorMessage = "La cámara está siendo usada por otra aplicación o pestaña.";
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

  const fetchData = async () => {
    setIsLoading(true);
    setDbStatus('checking');
    
    // Si el servidor tarda más de 2 segundos, asumimos que está "despertando"
    const wakeupTimer = setTimeout(() => {
      setIsWakingUp(true);
    }, 2000);

    try {
      const [tRes, rRes, aRes, hRes, admRes] = await Promise.all([
        fetch('/api/teachers'),
        fetch('/api/report'),
        fetch('/api/absences'),
        fetch('/api/health'),
        fetch('/api/admins')
      ]);
      
      // Helper to safely parse JSON
      const safeJson = async (res: Response) => {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            return await res.json();
          } catch (e) {
            console.error('Error parsing JSON:', e);
            return null;
          }
        }
        return null;
      };

      if (hRes.ok) {
        const health = await safeJson(hRes);
        setDbStatus(health && health.status === 'ok' ? 'connected' : 'error');
        setDbErrorMessage(null);
      } else {
        const health = await safeJson(hRes);
        setDbStatus('error');
        setDbErrorMessage(health && health.message ? health.message : 'Error de conexión con el servidor');
      }

      const [tData, rData, aData, admData] = await Promise.all([
        safeJson(tRes),
        safeJson(rRes),
        safeJson(aRes),
        safeJson(admRes)
      ]);

      setTeachers(Array.isArray(tData) ? tData : []);
      setRecords(Array.isArray(rData) ? rData : []);
      setAbsences(Array.isArray(aData) ? aData : []);
      setAdmins(Array.isArray(admData) ? admData : []);

      if (!tRes.ok || !rRes.ok || !aRes.ok) {
        toast.error('Error al cargar algunos datos de la base de datos');
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
    const teacherToSave = { ...newTeacher };
    if (!teacherToSave.id || !teacherToSave.name) return;

    try {
      const response = await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teacherToSave),
      });
      if (response.ok) {
        toast.success(`Docente ${teacherToSave.name} registrado con éxito`);
        setSelectedTeacherQR(teacherToSave); // Muestra el QR inmediatamente después de guardar
        setNewTeacher({ id: '', name: '' });
        setShowAddTeacher(false);
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Error');
      }
    } catch (error) {
      toast.error('Error de conexión');
    }
  };

  const handleUpdateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;

    try {
      const response = await fetch(`/api/teachers/${editingTeacher.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingTeacher.name }),
      });
      if (response.ok) {
        toast.success('Docente actualizado');
        setShowEditTeacher(false);
        setEditingTeacher(null);
        fetchData();
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
      const now = Date.now();
      // Cooldown de 5 segundos para el mismo ID para evitar escaneos duplicados accidentales
      if (lastScannedRef.current.id === decodedText && (now - lastScannedRef.current.time) < 5000) {
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
        ctx.fillText(selectedTeacherQR.name, canvas.width / 2, 30);
        ctx.font = '14px monospace';
        ctx.fillText(selectedTeacherQR.id, canvas.width / 2, 55);
        
        // Draw QR
        ctx.drawImage(img, 20, 70);
        
        const pngUrl = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.href = pngUrl;
        downloadLink.download = `QR_${selectedTeacherQR.name.replace(/\s+/g, '_')}.png`;
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
      toast.error('Por favor permite las ventanas emergentes para imprimir');
      return;
    }

    const qrSvgElement = document.getElementById('qr-svg-to-print');
    if (!qrSvgElement) return;
    
    const svgData = new XMLSerializer().serializeToString(qrSvgElement);
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Imprimir QR - ${selectedTeacherQR.name}</title>
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
            <h1>${selectedTeacherQR.name}</h1>
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
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: cleanId,
          type: attendanceTypeRef.current // USA LA REFERENCIA ACTUALIZADA
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // El servidor nos confirma el nombre real del docente
        toast.success(`${attendanceTypeRef.current} registrada: ${data.teacherName || cleanId}`, {
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
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-indigo-100 flex flex-col md:flex-row overflow-hidden">
      <Toaster position="top-center" />
      
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
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
                activeTab === 'asistencia' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <LayoutDashboard size={20} />
              <span>Asistencia</span>
            </button>
            
            {adminUser && (
              <>
                <button
                  onClick={() => setActiveTab('docentes')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
                    activeTab === 'docentes' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Users size={20} />
                  <span>Docentes</span>
                </button>
                <button
                  onClick={() => setActiveTab('reportes')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
                    activeTab === 'reportes' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <FileText size={20} />
                  <span>Reportes</span>
                </button>
                <button
                  onClick={() => setActiveTab('faltas')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
                    activeTab === 'faltas' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'
                  }`}
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
            <div className={`w-2 h-2 rounded-full ${
              dbStatus === 'connected' ? 'bg-green-500' : 
              dbStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
            }`} />
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
                      className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                        attendanceType === 'ENTRADA' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      ENTRADA
                    </button>
                    <button
                      onClick={() => setAttendanceType('SALIDA')}
                      className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                        attendanceType === 'SALIDA' ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      SALIDA
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                  <div className="flex border-b border-gray-100">
                    <button
                      onClick={() => setMode('scan')}
                      className={`flex-1 py-6 flex items-center justify-center gap-2 font-bold transition-all relative ${
                        mode === 'scan' ? 'text-indigo-600 bg-indigo-50/20' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <QrCode size={20} />
                      Cámara QR
                      {mode === 'scan' && <motion.div layoutId="modeTab" className="absolute bottom-0 h-1 w-24 bg-indigo-600 rounded-t-full" />}
                    </button>
                    <button
                      onClick={() => setMode('manual')}
                      className={`flex-1 py-6 flex items-center justify-center gap-2 font-bold transition-all relative ${
                        mode === 'manual' ? 'text-indigo-600 bg-indigo-50/20' : 'text-gray-400 hover:text-gray-600'
                      }`}
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
                                className="absolute left-[10%] right-[10%] h-0.5 bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)] z-10 pointer-events-none"
                              />
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
                                    }}
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
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Identificación del Docente</label>
                            <input
                              type="text"
                              value={teacherId}
                              onChange={(e) => setTeacherId(e.target.value)}
                              placeholder="Ej: DOC-001"
                              className="w-full px-8 py-5 bg-gray-50 border-2 border-gray-100 rounded-3xl focus:border-indigo-500 outline-none transition-all text-2xl font-mono text-center"
                              autoFocus
                            />
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
                        <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                          <Users size={24} />
                        </div>
                        <button
                          onClick={() => setSelectedTeacherQR(teacher)}
                          className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                          title="Ver QR"
                        >
                          <QrCode size={20} />
                        </button>
                      </div>
                      <h3 className="font-bold text-lg leading-tight mb-1">{teacher.name}</h3>
                      <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">{teacher.id}</p>
                      
                      <div className="mt-6 pt-6 border-t border-gray-50 flex justify-end gap-2">
                        <button 
                          onClick={() => { setEditingTeacher(teacher); setShowEditTeacher(true); }}
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
                        }}
                        className="text-sm font-bold text-gray-700 outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-gray-100 shadow-sm">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Semana:</span>
                      <input 
                        type="week" 
                        value={reportWeek}
                        onChange={(e) => {
                          setReportWeek(e.target.value);
                          if (e.target.value) setReportMonth(''); // Clear month when week is selected
                        }}
                        className="text-sm font-bold text-gray-700 outline-none"
                      />
                    </div>
                    {(reportMonth || reportWeek) && (
                      <button 
                        onClick={() => { setReportMonth(''); setReportWeek(''); }}
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
                                <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase ${
                                  item.type === 'ENTRADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'
                                }`}>
                                  {item.type}
                                </span>
                              ) : (
                                <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase ${
                                  item.status === 'JUSTIFICADA' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                                }`}>
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
                              <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase ${
                                abs.status === 'JUSTIFICADA' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                              }`}>
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
                          onClick={() => { setNewAdmin({...adm, password: ''}); setShowAddAdmin(true); }}
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
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
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
                    placeholder="admin"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Contraseña</label>
                  <input 
                    type="password" required value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                    placeholder="••••••••"
                    autoFocus
                  />
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
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
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
                    onChange={e => setNewAbsence({...newAbsence, teacherId: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                  >
                    <option value="">Seleccionar Docente</option>
                    {(Array.isArray(teachers) ? teachers : []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Fecha</label>
                    <input 
                      type="date" required value={newAbsence.date}
                      onChange={e => setNewAbsence({...newAbsence, date: e.target.value})}
                      className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Estado</label>
                    <select 
                      required value={newAbsence.status}
                      onChange={e => setNewAbsence({...newAbsence, status: e.target.value as any})}
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
                    onChange={e => setNewAbsence({...newAbsence, reason: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all h-24 resize-none"
                    placeholder="Ej: Cita médica, permiso personal..."
                  />
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
                    onChange={e => setNewAdmin({...newAdmin, name: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                    placeholder="Ej: Nicolle Admin"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase">Usuario</label>
                  <input 
                    type="text" required value={newAdmin.username}
                    onChange={e => setNewAdmin({...newAdmin, username: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                    placeholder="nicolle.admin"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase">Nueva Contraseña</label>
                  <input 
                    type="password" required value={newAdmin.password}
                    onChange={e => setNewAdmin({...newAdmin, password: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                    placeholder="••••••••"
                  />
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
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] p-10 w-full max-w-md relative z-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-extrabold">Nuevo Docente</h2>
                <button onClick={() => setShowAddTeacher(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAddTeacher} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">ID Único (DNI/Código)</label>
                  <input 
                    type="text" required value={newTeacher.id}
                    onChange={e => setNewTeacher({...newTeacher, id: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all font-mono"
                    placeholder="DOC-001"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Nombre Completo</label>
                  <input 
                    type="text" required value={newTeacher.name}
                    onChange={e => setNewTeacher({...newTeacher, name: e.target.value})}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                    placeholder="Ej: Juan Pérez"
                  />
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-extrabold text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all">
                  Guardar Docente
                </button>
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
              className="bg-white rounded-[2.5rem] p-10 w-full max-w-md relative z-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-extrabold">Editar Docente</h2>
                <button onClick={() => { setShowEditTeacher(false); setEditingTeacher(null); }} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleUpdateTeacher} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">ID (No se puede cambiar)</label>
                  <input type="text" disabled value={editingTeacher.id} className="w-full px-6 py-4 bg-gray-100 border-2 border-gray-100 rounded-2xl text-gray-500 font-mono" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Nombre Completo</label>
                  <input 
                    type="text" required value={editingTeacher.name}
                    onChange={e => setEditingTeacher({...editingTeacher, name: e.target.value})}
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
                <h2 className="text-2xl font-extrabold mb-2">{selectedTeacherQR.name}</h2>
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
}
