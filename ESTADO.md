# Estado del Proyecto — Liquidaciones

**Fecha de última actualización:** 2026-06-16 (rango de fechas por parámetros en Uber y MercadoPago)

---

## 1. Estado actual

### PedidosYa — FUNCIONA

- El motor descarga el ZIP de la liquidación "ÚLTIMA" de cada local activo de la cuenta.
- La lista de locales se obtiene automáticamente del endpoint `/contracts`: varía día a día según las nuevas captaciones del equipo comercial. No es necesario mantener ninguna lista manual.
- Probado con ~142 locales. Corre sin intervención una vez que la sesión está guardada.
- Sesión guardada en: `./sesiones/argentina.json`

### Uber Eats — FUNCIONA

- El motor navega a `merchants.ubereats.com/manager/reports`, crea un informe "Detalles del pago" para la semana anterior (lunes–domingo), selecciona todos los negocios (13), y descarga el archivo resultante.
- Acepta rango de fechas opcional: `node descargar-uber.js 2026-06-01 2026-06-07`. Sin parámetros usa la semana anterior automáticamente.
- El portal entrega el archivo en formato `.csv` (no XLSX). Ver sección de pendientes.
- Sesión guardada en: `./sesiones/uber-argentina/sesion.json`
- Para detalles técnicos del debugging y resolución de problemas, ver `UBER-DEBUGGING-LOG.md`.

### MercadoPago — FUNCIONA

- El motor navega a `mercadopago.com.ar/balance/reports/settlement_v2`, detecta si ya existe un reporte XLSX para el período y lo descarga directamente. Si no existe, lo genera (Crear reporte → Manual → calendario → XLSX → Generar) y hace polling cada 15 s hasta que esté disponible (máx. 5 min).
- Acepta rango de fechas opcional: `node descargar-mercadopago.js 2026-06-01 2026-06-07`. Sin parámetros usa la semana anterior automáticamente.
- Descarga en formato `.xlsx` nativo (~2 MB por reporte).
- Sesión guardada en: `./sesiones/mercadopago-argentina/sesion.json`

### Rappi — DESCARGA CORRECTA (falta prueba multi-marca)

- El motor navega a Financiero, amplía el período a "Últimos 30 días", captura los pagos vía el endpoint `paid-lot/by-stores`, genera los reportes XLS en Fase 1 y los descarga interceptando la red en Fase 2.
- Probado con una sola marca activa: descarga funciona correctamente (~19-21 KB por archivo XLS).
- **Pendiente:** verificar el flujo completo cuando la cuenta tiene múltiples marcas (el selector de marcas está implementado pero no se ha podido probar en producción con una cuenta multi-marca real).
- Sesión guardada en: `./sesiones/rappi-argentina.json`

---

## 2. Cómo ejecutar cada motor

### PedidosYa

**Paso A — Login (solo la primera vez o si la sesión expira)**

```
node login.js argentina
```

Abre un navegador real. Hacé login a mano (correo + contraseña + 2FA si lo pide). Cuando veas el Tablero cargado, presioná **ENTER** en la terminal. La sesión queda en `./sesiones/argentina.json`.

**Paso B — Descargar liquidaciones**

```
# Prueba: solo los primeros 3 locales
node descargar.js argentina prueba

# Producción: todos los locales
node descargar.js argentina
```

El script:
1. Carga `/finance-py` para disparar el fetch de `/contracts` y obtener la lista de locales.
2. Recorre cada local, navega a su página de estados de cuenta y descarga el ZIP de la fila "ÚLTIMA".
3. Guarda los archivos en `./descargas/argentina/<fecha-de-hoy>/`.

---

### Uber Eats

**Paso A — Login (solo la primera vez o si la sesión expira)**

```
node login-uber.js
```

Abre el navegador en `merchants.ubereats.com`. Hacé login a mano. Cuando el panel cargue, **cerrá el navegador**. La sesión se guarda automáticamente en `./sesiones/uber-argentina/sesion.json`.

**Paso B — Descargar liquidaciones**

```
# Semana anterior (default)
node descargar-uber.js

# Rango de fechas específico
node descargar-uber.js 2026-06-01 2026-06-07
```

Si se pasan fechas, ambas son obligatorias y deben tener formato `YYYY-MM-DD`. Si una fecha es inválida el script lo indica y no continúa.

El script:
1. Navega a Informes y abre el formulario de creación.
2. Selecciona tipo "Detalles del pago" bajo el acordeón "Pagos".
3. Selecciona todos los negocios (13).
4. Selecciona el intervalo de fechas indicado (o la semana anterior si no se pasan parámetros).
5. Envía el formulario y espera a que el informe esté disponible (polling cada 15 s, hasta 5 min).
6. Descarga el archivo en `./descargas/uber-argentina/<fecha-de-hoy>/`.

---

### MercadoPago

**Paso A — Login (solo la primera vez o si la sesión expira)**

```
node login-mercadopago.js
```

Abre el navegador en `mercadopago.com.ar`. Hacé login a mano (DNI o email → contraseña → reCAPTCHA si lo pide). Cuando veas el panel cargado, **cerrá el navegador**. La sesión se guarda automáticamente en `./sesiones/mercadopago-argentina/sesion.json`.

**Paso B — Descargar liquidaciones**

```
# Semana anterior (default)
node descargar-mercadopago.js

# Rango de fechas específico
node descargar-mercadopago.js 2026-06-01 2026-06-07
```

Si se pasan fechas, ambas son obligatorias y deben tener formato `YYYY-MM-DD`. Si una fecha es inválida el script lo indica y no continúa.

El script:
1. Navega a Reportes de liquidaciones.
2. Busca si ya existe un reporte XLSX para el período indicado.
3. Si existe → lo descarga directamente.
4. Si no existe → abre el calendario, navega al mes correcto, selecciona inicio y fin, elige formato XLSX y genera el reporte. Hace polling cada 15 s (hasta 5 min) hasta que esté disponible y lo descarga.
5. Guarda el archivo en `./descargas/mercadopago-argentina/<fecha-de-hoy>/`.

---

### Rappi

**Paso A — Login (solo la primera vez o si la sesión expira)**

```
node login-rappi.js argentina
```

Abre el navegador en `partners.rappi.com/login`. Hacé login (correo + contraseña + código SMS). Cuando veas el panel principal, **cerrá el navegador**. La sesión se guarda automáticamente al cerrar.

**Paso B — Descargar liquidaciones**

```
# Prueba: solo los primeros 3 pagos
node descargar-rappi.js argentina prueba

# Producción: todos los pagos del período
node descargar-rappi.js argentina
```

El script ejecuta dos fases:
- **Fase 1:** Navega a Financiero > Resumen, amplía el período a "Últimos 30 días", localiza cada pago "PAID" en la tabla, abre su detalle y cliquea "Descargar relación de ventas" para que el servidor genere el XLS.
- **Fase 2:** Va a la pestaña Reportes, intercepta la descarga del XLS via `page.route()` y guarda cada archivo.
- Guarda los archivos en `./descargas/rappi-argentina/<fecha-de-hoy>/`.

---

## 3. Estructura de carpetas y archivos clave

```
C:\liquidaciones\
│
├── login.js              # Login PedidosYa (guarda sesión al presionar ENTER)
├── descargar.js          # Descarga liquidaciones PedidosYa (todos los locales)
├── login-rappi.js        # Login Rappi (guarda sesión al cerrar el navegador)
├── descargar-rappi.js    # Descarga liquidaciones Rappi (Fase 1 + Fase 2)
├── login-uber.js              # Login Uber Eats (guarda sesión al cerrar el navegador)
├── descargar-uber.js          # Descarga liquidaciones Uber Eats (crea informe + descarga)
├── login-mercadopago.js       # Login MercadoPago (guarda sesión al cerrar el navegador)
├── descargar-mercadopago.js   # Descarga liquidaciones MercadoPago (detecta existente o crea nuevo)
├── UBER-DEBUGGING-LOG.md      # Registro técnico del proceso de debugging de Uber
│
├── package.json          # Dependencia: playwright ^1.60.0
├── package-lock.json
│
├── sesiones/
│   ├── argentina.json              # Sesión activa PedidosYa
│   ├── rappi-argentina.json        # Sesión activa Rappi
│   ├── argentina/                  # Carpeta de perfil del navegador (Chromium)
│   ├── uber-argentina/
│   │   └── sesion.json             # Sesión activa Uber Eats
│   └── mercadopago-argentina/
│       └── sesion.json             # Sesión activa MercadoPago
│
├── descargas/            # Se crea automáticamente al correr los scripts
│   ├── argentina/
│   │   └── YYYY-MM-DD/   # ZIPs de PedidosYa (uno por local)
│   ├── rappi-argentina/
│   │   └── YYYY-MM-DD/   # XLS de Rappi (Rappi_ID_Pago_<id>.xls por pago)
│   ├── uber-argentina/
│   │   └── YYYY-MM-DD/   # CSV de Uber Eats (nombre generado por el portal)
│   └── mercadopago-argentina/
│       └── YYYY-MM-DD/   # XLSX de MercadoPago (settlement-<id>-manual-<fecha>.xlsx)
│
└── node_modules/         # Playwright instalado
```

### Archivos de diagnóstico (Rappi)

Cuando algo falla, `descargar-rappi.js` genera screenshots automáticos en la raíz:
- `diagnostico-rappi.png` — estado de la pantalla si no se captura el endpoint
- `diagnostico-marcas.png` / `diagnostico-marcas-dropdown.png` — selector de marcas
- `fase1-antes.png`, `fase1-detalle.png`, `fase1-no-fila.png` — Fase 1
- `fase2-tabla.png`, `fase2-no-encontrado-<id>.png`, `fase2-error-<id>.png` — Fase 2

---

## 4. Qué falta por hacer

### Próximo paso

- [ ] **Panel web:** interfaz para ejecutar todos los motores desde el navegador (sin abrir terminales), ver el estado de cada descarga en tiempo real y acceder al historial de archivos.

### Prioritario

- [ ] **Uber — formato XLSX:** el portal entrega CSV por defecto. Investigar si el formulario tiene selector de formato o si se configura en el perfil de la cuenta. Ver `UBER-DEBUGGING-LOG.md` sección 5.
- [ ] **Prueba multi-marca Rappi:** correr `descargar-rappi.js` con una cuenta que tenga 2+ marcas y verificar que el selector de marcas funciona (el código está escrito pero nunca se ejecutó ese camino en producción).
- [ ] **Manejo de sesión expirada:** si alguna sesión expira, el script falla silenciosamente (navega pero no encuentra los datos). Habría que detectarlo y avisar claramente.

### Mejoras deseables

- [ ] **Modo headless:** ambos motores abren el navegador visible (`headless: false`). En producción sería útil tener una opción `node descargar.js argentina headless` para correr sin ventana.
- [ ] **Log a archivo:** actualmente todo va a consola. Un log por ejecución facilita auditorías.
- [ ] **Reintento automático de fallos:** si un local o un pago falla, el script lo lista al final pero no reintenta. Se podría agregar un segundo pasaje solo sobre los fallos.
- [ ] **Soporte multi-país:** la estructura ya está preparada (`pais = process.argv[2]`) pero solo se probó con `argentina`. Para agregar Chile u otro país se necesita: (a) hacer login con esa cuenta, (b) verificar que la URL de PedidosYa y el código de país de Rappi sean correctos.
- [ ] **Alertas si no hay archivos nuevos:** detectar si el día de hoy ya tiene descargas y saltar, o alertar si la cantidad de archivos es inusualmente baja.

---

## 5. Notas técnicas rápidas

### PedidosYa — endpoint clave
```
GET https://management-api.pedidosya.com/v1/partners/contracts
```
Devuelve el array completo de contratos activos de la cuenta. El script lo captura escuchando el evento `response` al navegar a `/finance-py`. Cada ítem tiene `id`, `referenceName`, `companyName`.

### Rappi — endpoint clave
```
GET https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/paid-lot/by-stores?country=AR
```
Devuelve `{ total_elements, content: [...], in_progress }`. Cada ítem tiene `id` (= `paid_lot_id`), `brand_name`, `status` (`PAID` | `UNPAYABLE`), `start_date`, `end_date`, `paid_date`, `total`.

### Rappi — por qué interceptamos la red en lugar de `page.goto()`
La URL directa del reporte (`/api/partner-report/v1/report?country=AR&paid_lot_id=<ID>`) requiere el Bearer token del browser. `page.goto()` no lo incluye. La solución es ir a la pestaña Reportes, registrar un `page.route()` filtrado por `paid_lot_id`, y clickear el link del archivo — Playwright re-envía la request con todos los headers del browser via `route.fetch()`.
