# Sistema de Asistencia Docente QR

Este proyecto es una aplicación full-stack (React + Express + SQLite) para el control de asistencia de docentes mediante códigos QR.

## Requisitos Previos

- **Node.js**: Versión 18 o superior.
- **Visual Studio Code**: Recomendado.

## Cómo usar el sistema SIN Visual Studio Code (Cualquier dispositivo)

Si no tienes Visual Studio Code o quieres que otros docentes usen el sistema desde sus propios dispositivos (laptops, tablets o celulares), tienes estas opciones:

### Opción 1: Usar el Enlace Compartido (La más fácil)
Cualquier persona con este enlace puede entrar al sistema desde su navegador (Chrome, Safari, etc.) sin instalar nada:
*   **Enlace del Sistema:** `https://ais-pre-uwpftcz27yzx53jdabbi7p-412233095815.us-east1.run.app`
*   *Nota: Este enlace funciona mientras el servidor en la nube esté activo.*

### Opción 2: Ejecutar en Windows con un solo clic (Offline)
Si ya descargaste el código a tu laptop pero no quieres abrir VS Code:
1.  Asegúrate de tener instalado **Node.js** (descárgalo en [nodejs.org](https://nodejs.org/)).
2.  Busca el archivo llamado `iniciar_sistema.bat` en la carpeta del proyecto.
3.  Haz **doble clic** sobre él. Se abrirá una ventana negra (terminal) y el sistema se iniciará solo.
4.  Abre tu navegador y escribe: `http://localhost:3000`.

### Opción 3: Acceder desde otros dispositivos en la misma red Wi-Fi
Si tienes el sistema corriendo en una laptop (la "Laptop Servidor"), otros dispositivos en la misma red pueden entrar:
1.  En la Laptop Servidor, abre la terminal y escribe `ipconfig` para ver tu dirección IP (ejemplo: `192.168.1.15`).
2.  En cualquier otro celular o tablet conectado al mismo Wi-Fi, abre el navegador.
3.  Escribe la IP seguida de `:3000` (ejemplo: `http://192.168.1.15:3000`).
4.  ¡Listo! Podrán escanear QRs desde sus propios dispositivos.

## Despliegue Permanente (24/7 Gratis)

Si quieres que el sistema funcione siempre sin depender de tu laptop, puedes subirlo a **Render.com**.

### Paso 1: Subir a GitHub (Correctamente)
1. Crea una cuenta en [GitHub](https://github.com).
2. Crea un nuevo repositorio llamado `asistencia-docente`.
3. **IMPORTANTE**: No arrastres solo algunos archivos. Debes subir **TODOS** los archivos del proyecto.
4. Tu repositorio en GitHub debe verse **EXACTAMENTE ASÍ** en la lista principal:
   *   📁 `src` (Carpeta con `App.tsx`, `main.tsx`, etc.)
   *   📄 `.env.example`
   *   📄 `.gitignore`
   *   📄 `index.html`
   *   📄 `package.json`
   *   📄 `render.yaml`
   *   📄 `server.ts`
   *   📄 `tsconfig.json`
   *   📄 `vite.config.ts`

**Si no ves la carpeta `src` o el archivo `server.ts` en la lista principal de GitHub, el sistema NO funcionará.**

### Paso 2: Desplegar en Render
1. Crea una cuenta en [Render.com](https://render.com) conectándola con tu GitHub.
2. Haz clic en **"New +"** y selecciona **"Blueprint"**.
3. Selecciona tu repositorio `asistencia-docente`.
4. Render leerá el archivo `render.yaml` que he incluido y configurará todo automáticamente:
   *   Creará el servidor web.
   *   Creará un **Disco (Volume)** de 1GB para que la base de datos no se borre.
   *   Te dará un enlace permanente (ejemplo: `asistencia-docente.onrender.com`).

## Estructura del Proyecto

- `server.ts`: Servidor backend (Express + SQLite).
- `src/App.tsx`: Aplicación frontend (React).
- `src/index.css`: Estilos globales (Tailwind CSS).
- `asistencia.db`: Archivo de base de datos (se crea automáticamente al iniciar).

## Notas Importantes

- **Cámara**: Para que el escáner QR funcione, debes acceder mediante `https` o usar `localhost`.
- **Admin**: La contraseña por defecto para el panel de administración es `admin123`.
- **Excel**: Los reportes se descargan en formato `.xlsx` real, compatible con Microsoft Excel.
