# Estado del Proyecto — Liquidaciones

**Fecha de última actualización:** 2026-06-17 (PedidosYa: modo reintentar por IDs + clasificación de locales sin liquidaciones; Rappi: nuevos criterios de Finanzas + diagnóstico de campos en progreso)

---

## 1. Estado actual

### PedidosYa — FUNCIONA (Argentina y Chile)

- El motor descarga el ZIP de la liquidación más reciente de cada local activo, con **detección automática de formato por portal**:
  - **Argentina:** la página muestra una fila etiquetada "ÚLTIMA". El script la detecta en los primeros 3 segundos y descarga esa fila.
  - **Chile:** la página no tiene etiqueta "ÚLTIMA"; las filas solo muestran el período de venta ordenadas de más reciente a más antigua. El script detecta la ausencia (timeout corto de 3 s) y descarga automáticamente la primera fila (la más reciente).
- La lista de locales se obtiene automáticamente del endpoint `/contracts`: varía día a día según las nuevas captaciones del equipo comercial. No es necesario mantener ninguna lista manual.
- Probado con ~142 locales (Argentina) y 108 locales (Chile, 3/3 en prueba de validación). Corre sin intervención una vez que la sesión está guardada.
- Sesión guardada en: `./sesiones/argentina.json` (Argentina) · `./sesiones/chile.json` (Chile).

**Clasificación de tres estados por local (resumen final separado):**

Al recorrer cada local, el script ahora distingue tres resultados en vez de OK/error binario:

- **Descargado:** el local tiene liquidaciones y el ZIP se bajó correctamente.
- **Sin liquidaciones:** el portal muestra "Aún no tienes liquidaciones disponibles para este contrato" (locales nuevos, dados de baja o sin movimientos). **Es un caso esperable, NO un error.** Se detecta con una carrera entre el botón de descarga y ese mensaje, así un local vacío se resuelve rápido sin esperar el timeout de 30 s.
- **Fallos reales:** ni el botón ni el mensaje aparecen dentro del timeout → problema genuino (red caída, sesión vencida). Estos sí hay que reintentar.

El resumen final separa las tres categorías con sus IDs:
```
Descargados: 96.
Sin liquidaciones: 12.
  IDs sin liquidaciones: ...
Fallos reales: 0.
```
Así un timeout real no se confunde con un local que simplemente no tiene datos. **Corrida completa de Chile (2026-06-17): 96 descargados, 12 sin liquidaciones, 0 fallos reales.**

**Modo reintentar por IDs:** para reprocesar solo locales puntuales (típicamente los que quedaron en "Fallos reales") sin recorrer los ~108 de nuevo:
```
node descargar.js chile reintentar 127276,414520,140349
```
Saltea la obtención de la lista completa del endpoint `/contracts` y procesa solo los IDs indicados con la misma lógica de descarga (detección ÚLTIMA/primera-fila + clasificación de tres estados). Valida que los IDs sean numéricos y exige al menos uno. Los archivos caen en la misma carpeta del día.

### Uber Eats — FUNCIONA

- El motor navega a `merchants.ubereats.com/manager/reports`, crea un informe "Detalles del pago" para la semana anterior (lunes–domingo), selecciona todos los negocios (13), y descarga el archivo resultante.
- Firma completa: `node descargar-uber.js [pais] [fecha-inicio] [fecha-fin]`
  - Sin parámetros: argentina, semana anterior.
  - `node descargar-uber.js argentina 2026-06-01 2026-06-07` — argentina con rango explícito.
  - `node descargar-uber.js chile` — chile, semana anterior (cuando haya acceso).
  - `node descargar-uber.js 2026-06-01 2026-06-07` — modo compatible (pais = argentina).
- El portal entrega el archivo en formato `.csv` (no XLSX). Ver sección de pendientes.
- Sesión guardada en: `./sesiones/uber-<pais>/sesion.json`
- **Listo para Chile sin más cambios de código.** Solo falta `node login-uber.js` con la cuenta chilena (pendiente: verificar que `login-uber.js` acepte país como argumento).
- Para detalles técnicos del debugging y resolución de problemas, ver `UBER-DEBUGGING-LOG.md`.

### MercadoPago — FUNCIONA

- El motor navega a `mercadopago.com.ar/balance/reports/settlement_v2`, detecta si ya existe un reporte XLSX para el período y lo descarga directamente. Si no existe, lo genera (Crear reporte → Manual → calendario → XLSX → Generar) y hace polling cada 15 s hasta que esté disponible (máx. 5 min).
- Acepta rango de fechas opcional: `node descargar-mercadopago.js 2026-06-01 2026-06-07`. Sin parámetros usa la semana anterior automáticamente.
- Descarga en formato `.xlsx` nativo (~2 MB por reporte).
- Sesión guardada en: `./sesiones/mercadopago-argentina/sesion.json`
- MercadoPago no aplica para Chile (solo argentina por ahora).

### Rappi — DESCARGA CORRECTA · CAMBIO DE CRITERIOS EN PROGRESO

- El motor navega a Financiero, amplía el período a "Últimos 30 días", captura los pagos vía el endpoint `paid-lot/by-stores`, genera los reportes XLS en Fase 1 y los descarga interceptando la red en Fase 2.
- Probado con una sola marca activa: descarga funciona correctamente (~19-21 KB por archivo XLS).
- **Pendiente:** verificar el flujo completo cuando la cuenta tiene múltiples marcas (el selector de marcas está implementado pero no se ha podido probar en producción con una cuenta multi-marca real).
- Sesión guardada en: `./sesiones/rappi-argentina.json`

#### 🚧 Trabajo en curso — nuevos criterios de descarga (Finanzas, Argentina)

Finanzas **redefinió** qué filas se descargan. El criterio nuevo reemplaza al actual de Estado "Pagado":

- **Descargar una fila si y solo si** se cumplen AMBAS condiciones:
  1. La columna **"Fecha del pago"** (`paid_date`) cae dentro de un **rango desde/hasta** (inclusive ambos extremos) que el usuario indica al correr el script.
  2. La columna **"Valor a transferir"** es **distinta de exactamente $0** (se descargan montos positivos Y negativos; solo se saltea el $0 exacto).
- **Se ELIMINA** el filtro por columna "Estado" (ya no se usa "Pagado" para nada).
- **NO** se usa "Periodo de venta" como criterio (varía entre tiendas).
- **Se mantiene** sin cambios: iteración por todas las marcas, ampliar la vista a "Últimos 30 días", y todo el mecanismo de descarga (Fase 1 generar + Fase 2 interceptar).
- **Cadencia:** correr **cada miércoles** (día de pago de Rappi).
- **Parámetros nuevos:** dos fechas obligatorias en formato `YYYY-MM-DD`. Ej: `node descargar-rappi.js argentina 2026-06-17 2026-06-18` (un solo día: ambas iguales). Sin las fechas debe abortar con error claro (no asumir período por defecto — error grave con dinero de por medio). El flag `prueba` se detectará en cualquier posición.

**Estado actual de la implementación:**

- ⚠️ Hay un bloque de **DIAGNÓSTICO TEMPORAL** agregado en `descargar-rappi.js` (vuelca los campos del JSON del endpoint y termina sin descargar nada). **Todavía NO se pudo correr** porque la sesión de Rappi expiró.
- El **filtro nuevo aún NO está implementado**. El script sigue con el filtro viejo de Estado "Pagado" (que quedará reemplazado).

**PENDIENTE (en orden):**

1. Renovar sesión: `node login-rappi.js argentina`.
2. Correr el diagnóstico: `node descargar-rappi.js argentina`.
3. Identificar **contra la pantalla de Rappi** cuál campo del JSON corresponde a "Valor a transferir" (hay varios montos posibles; `total` es solo la hipótesis) y confirmar el **formato de `paid_date`** (ISO/timestamp vs. DD/MM/YYYY de pantalla).
4. Recién después: implementar el filtro nuevo (rango de `paid_date` + valor ≠ 0) y **quitar el bloque de diagnóstico temporal**.

### Panel web — FUNCIONA

- Servidor Express en `localhost:3000` (`node panel.js`) para ejecutar descargas sin abrir terminales.
- Muestra historial de archivos descargados ordenado por fecha de modificación.
- Uber Eats y Mercado Pago tienen campos opcionales `desde` / `hasta`; PedidosYa y Rappi no.
- Descarga de archivos desde el historial vía `/descargas/...`.

---

## 2. Dónde se guardan los archivos

Todos los scripts guardan en la carpeta de Google Drive sincronizada en esta máquina:

```
G:\Mi unidad\Liquidaciones\
├── argentina\          ← PedidosYa
├── rappi-argentina\    ← Rappi
├── uber-argentina\     ← Uber Eats
└── mercadopago-argentina\  ← MercadoPago
```

**La ruta está centralizada en `config.js`** — es el único archivo a modificar si la carpeta cambia (por ejemplo, al migrar a un servidor o cambiar la cuenta de Drive).

La carpeta de Drive está **compartida con el equipo de Atomic** con permiso de edición, restringido al dominio.

---

## 3. Cómo ejecutar cada motor

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

# Reintentar solo IDs puntuales (ej. los que quedaron en "Fallos reales")
node descargar.js chile reintentar 127276,414520,140349
```

El script:
1. Carga `/finance-py` para disparar el fetch de `/contracts` y obtener la lista de locales.
2. Recorre cada local, navega a su página de estados de cuenta y descarga el ZIP más reciente. En Argentina detecta la fila "ÚLTIMA"; en Chile (sin esa etiqueta) descarga automáticamente la primera fila de la lista. Clasifica cada local en descargado / sin liquidaciones / fallo real (ver arriba).
3. Guarda los archivos en `G:\Mi unidad\Liquidaciones\<pais>\<fecha-de-hoy>\`.

En **modo reintentar** (`node descargar.js <pais> reintentar <id1,id2,...>`) saltea el paso 1 y procesa solo los IDs dados con la misma lógica de los pasos 2-3.

---

### Uber Eats

**Paso A — Login (solo la primera vez o si la sesión expira)**

```
node login-uber.js
```

Abre el navegador en `merchants.ubereats.com`. Hacé login a mano. Cuando el panel cargue, **cerrá el navegador**. La sesión se guarda automáticamente en `./sesiones/uber-argentina/sesion.json`.

**Paso B — Descargar liquidaciones**

```
# Semana anterior (default, argentina)
node descargar-uber.js

# Rango de fechas específico
node descargar-uber.js argentina 2026-06-01 2026-06-07

# Modo compatible (sin país explícito, asume argentina)
node descargar-uber.js 2026-06-01 2026-06-07
```

Si se pasan fechas, ambas son obligatorias y deben tener formato `YYYY-MM-DD`. Si una fecha es inválida el script lo indica y no continúa.

El script:
1. Navega a Informes y abre el formulario de creación.
2. Selecciona tipo "Detalles del pago" bajo el acordeón "Pagos".
3. Selecciona todos los negocios (13).
4. Selecciona el intervalo de fechas indicado (o la semana anterior si no se pasan parámetros).
5. Envía el formulario y espera a que el informe esté disponible (polling cada 15 s, hasta 5 min).
6. Descarga el archivo en `G:\Mi unidad\Liquidaciones\uber-argentina\<fecha-de-hoy>\`.

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
5. Guarda el archivo en `G:\Mi unidad\Liquidaciones\mercadopago-argentina\<fecha-de-hoy>\`.

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
- Guarda los archivos en `G:\Mi unidad\Liquidaciones\rappi-argentina\<fecha-de-hoy>\`.

---

## 4. Estructura de carpetas y archivos clave

```
C:\liquidaciones\
│
├── config.js             # Ruta raíz de descargas (único lugar a cambiar si se mueve)
├── panel.js              # Servidor web panel (puerto 3000)
│
├── login.js              # Login PedidosYa (guarda sesión al presionar ENTER)
├── descargar.js          # Descarga liquidaciones PedidosYa (todos los locales)
├── login-rappi.js        # Login Rappi (guarda sesión al cerrar el navegador)
├── descargar-rappi.js    # Descarga liquidaciones Rappi (Fase 1 + Fase 2)
├── login-uber.js         # Login Uber Eats (guarda sesión al cerrar el navegador)
├── descargar-uber.js     # Descarga liquidaciones Uber Eats (parametrizado por país)
├── login-mercadopago.js  # Login MercadoPago (guarda sesión al cerrar el navegador)
├── descargar-mercadopago.js  # Descarga liquidaciones MercadoPago
├── UBER-DEBUGGING-LOG.md     # Registro técnico del proceso de debugging de Uber
│
├── package.json          # Dependencia: playwright ^1.60.0
├── package-lock.json
│
├── sesiones/
│   ├── argentina.json              # Sesión activa PedidosYa Argentina
│   ├── rappi-argentina.json        # Sesión activa Rappi
│   ├── argentina/                  # Carpeta de perfil del navegador (Chromium)
│   ├── uber-argentina/
│   │   └── sesion.json             # Sesión activa Uber Eats Argentina
│   └── mercadopago-argentina/
│       └── sesion.json             # Sesión activa MercadoPago
│
└── node_modules/         # Playwright instalado

G:\Mi unidad\Liquidaciones\          ← Google Drive (sincronizado, compartido con Atomic)
├── argentina\                        # ZIPs PedidosYa (uno por local)
│   └── YYYY-MM-DD\
├── rappi-argentina\                  # XLS Rappi (Rappi_ID_Pago_<id>.xls)
│   └── YYYY-MM-DD\
├── uber-argentina\                   # CSV Uber Eats
│   └── YYYY-MM-DD\
└── mercadopago-argentina\            # XLSX MercadoPago (settlement-<id>-manual-<fecha>.xlsx)
    └── YYYY-MM-DD\
```

### Archivos de diagnóstico (Rappi)

Cuando algo falla, `descargar-rappi.js` genera screenshots automáticos en la raíz:
- `diagnostico-rappi.png` — estado de la pantalla si no se captura el endpoint
- `diagnostico-marcas.png` / `diagnostico-marcas-dropdown.png` — selector de marcas
- `fase1-antes.png`, `fase1-detalle.png`, `fase1-no-fila.png` — Fase 1
- `fase2-tabla.png`, `fase2-no-encontrado-<id>.png`, `fase2-error-<id>.png` — Fase 2

---

## 5. Preparación para Chile

| Motor | Estado | Qué falta |
|---|---|---|
| PedidosYa | ✅ **FUNCIONA** | Listo para producción. Detección automática activa (probado 108 locales Chile) |
| Uber Eats | ✅ Parametrizado (`descargar-uber.js chile`) | Login con cuenta chilena; verificar que `login-uber.js` acepte país como argumento |
| Rappi | — | No aplica por ahora |
| MercadoPago | — | No aplica para Chile |

**Nota PedidosYa:** El script navega directo a la URL `/finance-py` sin tocar el sidebar, por lo que la diferencia de menú (Argentina tiene dos links, Chile tiene uno solo llamado "Finanzas") no afecta la automatización. La diferencia en el portal (etiqueta "ÚLTIMA" vs. orden por fecha) se resuelve automáticamente sin configuración.

---

## 6. Qué falta por hacer

### Prioritario

- [ ] **Uber — formato XLSX:** el portal entrega CSV por defecto. Investigar si el formulario tiene selector de formato o si se configura en el perfil de la cuenta. Ver `UBER-DEBUGGING-LOG.md` sección 5.
- [ ] **Prueba multi-marca Rappi:** correr `descargar-rappi.js` con una cuenta que tenga 2+ marcas y verificar que el selector de marcas funciona (el código está escrito pero nunca se ejecutó ese camino en producción).
- [ ] **Manejo de sesión expirada:** si alguna sesión expira, el script falla silenciosamente (navega pero no encuentra los datos). Habría que detectarlo y avisar claramente.
- [ ] **Chile — verificar `login-uber.js`:** confirmar que acepta país como argumento (o adaptarlo) antes de tener el acceso chileno.

### Revisión antes de producción compartida

- [ ] **`shell: true` en `panel.js`:** el `spawn` usa `shell: true` para simplificar la ejecución de comandos. Antes de exponer el panel a usuarios no técnicos, revisar que los argumentos (fechas ingresadas desde el browser) no puedan inyectar comandos. Las fechas se validan por formato en el script receptor, pero conviene agregar sanitización también en el backend del panel.
- [ ] **Estandarización de formatos:** PedidosYa entrega ZIP, Rappi XLS, Uber CSV, MercadoPago XLSX. Evaluar con el equipo si conviene unificar (ej. todo XLSX) o si los formatos actuales son aceptables para el flujo contable.

### Mejoras deseables

- [ ] **Modo headless:** todos los motores abren el navegador visible (`headless: false`). En producción sería útil tener una opción para correr sin ventana.
- [ ] **Log a archivo:** actualmente todo va a consola. Un log por ejecución facilita auditorías.
- [ ] **Reintento automático de fallos:** si un local o un pago falla, el script lo lista al final pero no reintenta. Se podría agregar un segundo pasaje solo sobre los fallos.
- [ ] **Alertas si no hay archivos nuevos:** detectar si el día de hoy ya tiene descargas y saltar, o alertar si la cantidad de archivos es inusualmente baja.

---

## 7. Notas técnicas rápidas

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
