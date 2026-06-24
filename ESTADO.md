# Estado del Proyecto — Liquidaciones

**Fecha de última actualización:** 2026-06-24 (Rappi: blindaje de país en 3 capas —autocorrección del selector + guardia dura `country=` + coherencia de URL, exit 3— validado en corrida real con autocorrección Colombia→Argentina, 192/192. Panel: verificación de arranque país-config —args ↔ sección— que aborta si descalzan, cerrando el riesgo de mantenimiento panel→script)

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

### Rappi — FUNCIONA (Argentina), captura completa multi-marca

- Flujo: navega a Financiero, amplía a "Últimos 30 días", **selecciona "Todas" las marcas**, **captura todos los pagos paginando el endpoint `paid-lot/by-stores`** (~1715), filtra localmente, **genera los reportes por POST directo (Fase 1)** y los **descarga por GET directo por ID (Fase 2)**.
- **Criterios de Finanzas:** se descarga una fila **si y solo si** `paid_date` ∈ `[desde, hasta]` (inclusive) **Y** `total` (Valor a transferir) ≠ 0 exacto (positivos y negativos sí; solo se saltea el 0).
- **Validado end-to-end (2026-06-18):** corrida real del 17/06 → **1715 pagos capturados (575 tiendas), 194 pasan el filtro, 194/194 descargados** sin duplicados. La descarga completa por GET directo tarda **~3 min**.
- **Cadencia:** correr **cada miércoles** (día de pago de Rappi).
- Sesión guardada en: `./sesiones/rappi-argentina.json`

#### Modos de uso

```
# Normal: genera (Fase 1) + descarga (Fase 2) todo el rango
node descargar-rappi.js argentina <desde> <hasta>

# Prueba: igual pero limita a los primeros 10 pagos
node descargar-rappi.js argentina <desde> <hasta> prueba

# Solo descarga: saltea Fase 1 (NO regenera), baja directo por ID los ya generados
node descargar-rappi.js argentina <desde> <hasta> solo-descarga
```

Ambas fechas son obligatorias (`YYYY-MM-DD`); sin ellas aborta con error (no asume período — hay dinero de por medio). Los flags `prueba`/`--prueba` y `solo-descarga`/`--descarga` se detectan en cualquier posición. **Modo solo-descarga** sirve para recuperar descargas faltantes sin volver a generar los reportes en Rappi.

#### Selector "Todas las marcas"

El selector de marca por defecto muestra solo la marca activa (ej. "Baku"), y el endpoint devuelve solo ese grupo. El script abre el chip "Marca:", **tilda "Todas" y aplica** para que el endpoint devuelva las 575 tiendas. Detecta el dropdown por el **texto "Todas" visible** (no por la clase del contenedor). Si no encuentra el chip / "Todas" / "Aplicar", **aborta ruidosamente** (mejor que descargar incompleto).

#### Paginación del endpoint `paid-lot/by-stores`

Es un **POST paginado**: el body lleva `stores_ids`, `page`, `size`, `start_date`, `end_date`; el total real viene en **`total_elements_without_pagination`** (no en `total_elements`, que es por-página). El script toma el body de la llamada de "Todas" (la de más `stores_ids` = 575), y **replica el POST paginando con `size` 100** (fallback a 15 si hay error HTTP) hasta juntar el total (~1715), con pausa de 400ms entre páginas.

- **Fechas:** se deja la **ventana amplia del portal**; solo se *ensancha* para cubrir `[desde, hasta]`, **nunca se recorta**. El filtro local por `paid_date` es el decisor final (evita el riesgo de que `start_date`/`end_date` filtren por período de venta y se pierdan pagos).

#### Fase 1 — Generación por POST directo

Genera cada reporte con `POST .../partner-report/v1/report?country=AR` body `{ paid_lot_id, type:"RESTAURANT" }`, usando los IDs ya capturados. No depende de la tabla visual (que tiene hasta 115 páginas). Pausa de 700ms entre POSTs. **Compuerta dura:** prueba 1 POST y solo sigue si da 2xx.

#### Fase 2 — Descarga por GET directo por ID

Descarga cada reporte con `GET .../partner-report/v1/report?country=AR&paid_lot_id=<ID>` (con `access_token` + headers de origen). **No depende de la pestaña Reportes** (que está paginada y solo mostraba ~15 → antes fallaban 179/194). Valida que la respuesta sea un **XLS real por magic bytes** (`D0CF11E0` .xls / `50 4B` .xlsx), descartando JSON/HTML de error. **Sobrescribe** el archivo por ID (`fs.writeFileSync`) → un pago = un archivo, **sin duplicados `(1).xls`**. Pausa de 400ms entre descargas. **Compuerta dura:** prueba 1 descarga y solo sigue si es XLS válido.

#### Detección de sesión vencida y códigos de salida

Las sesiones de Rappi caen seguido. **Detalle clave:** cuando la sesión vence, Rappi **NO redirige a `/login`** — la URL sigue siendo la raíz y muestra el **formulario de login en la misma página** (campo `input[type="password"]`, confirmado). Por eso se detecta por **contenido, no por URL**.

Apenas navega (antes de toda la captura), `estadoSesion()` hace una **carrera con `Promise.any`** entre señales de login (password / botón "Ingresar" / texto "Accede a tu cuenta" → `vencida`) y señales del panel (link "Financiero" → `valida`). Gana la primera que aparece, sin penalizar el camino feliz (no espera fija larga). Si la sesión venció:

```
⚠ Sesión de Rappi vencida. Renová con: node login-rappi.js argentina
```
y termina con **exit 2**, en vez del stack crudo de Node. Una **red de seguridad** (`.catch` en la IIFE principal) captura cualquier otra excepción imprevista y la imprime como una línea legible (en vez del stack), cerrando el navegador.

**Códigos de salida:** `0` OK · `1` error genérico (faltan fechas, captura fallida, etc.) · `2` sesión vencida (accionable) · `3` descalce de país (el portal está en un país distinto al pedido). Pensado para que el servidor/panel mapee `2` y `3` a mensajes propios para Finanzas.

#### Blindaje de país (3 capas — previene descargas cruzadas entre países)

**Causa raíz:** la cuenta de Rappi tiene acceso a varios países (Argentina, Colombia, …). Al **renovar la sesión**, el portal puede quedar con **otro país seleccionado** en el selector de arriba a la derecha (ej. Colombia), y `rappi-argentina.json` guarda ese estado **aunque el nombre del archivo diga "argentina"**. Si el portal queda en Colombia pero se pide `country=AR`, se descargarían liquidaciones **cruzadas** sin avisar — inaceptable con dinero. Detectado en una corrida real (aparecieron marcas como "Club Del Poke - Barranquilla").

Tres capas de defensa en profundidad:

- **#2 — Autocorrección del selector** (antes de capturar): lee el selector de país del portal. Si no es el país pedido, lo cambia, **resetea los acumuladores** (`todosLosPagos` / `llamadasEndpoint`, para descartar datos del país viejo), re-entra a Financiero y **re-verifica**. Aborta (exit 3) si detecta país equivocado y **no puede** cambiarlo; si **no logra leer** el selector (p. ej. renderiza solo la bandera) **solo avisa** y se apoya en #1. Deja screenshots `diag-pais-*.png`.
- **#1 — Guardia dura (siempre activa)** (antes de paginar/generar/descargar): compara el `country=` de la request **real** interceptada (`llamadaTodas.url`) contra el país pedido (`codigoPais`); **aborta con exit 3** si descalzan. Es la **red final infalible**: aunque #2 quede ciego o falle en silencio, jamás se baja cruzado. Imprime `✓ País solicitado: Argentina (AR) | País del portal: AR ✓`.
- **#3 — Coherencia de URL:** fuerza `country=codigoPais` en la URL de captura paginada en vez de heredar el del portal, para que captura, generación y descarga hablen **todas el mismo país**.

> **Reseteo de acumuladores (clave):** sin él, el listener acumula las llamadas del país viejo y `llamadaTodas` (elegida por más `stores_ids`) podría quedarse con la del país equivocado.

> **Nota panel/servidor:** el selector de país del panel debe coincidir con el país descargado. El blindaje en el script lo garantiza **venga de donde venga** el pedido (panel, CLI, cron).

**Validado end-to-end (2026-06-24):** corrida real con el portal en **Colombia** → #2 lo detectó, lo cambió a **Argentina** solo, #1 confirmó, **192/192 descargados**.

### Panel web — FUNCIONA

- Servidor Express en `localhost:3000` (`node panel.js`) para ejecutar descargas sin abrir terminales.
- Muestra historial de archivos descargados ordenado por fecha de modificación.
- **Fechas por plataforma:** Uber Eats y Mercado Pago tienen `desde`/`hasta` **opcionales** (`fechasOpcionales`); **Rappi** las tiene **obligatorias** (`fechasRequeridas`) con aviso visual "Fechas obligatorias". El frontend exige ambas antes de mandar el POST; el backend responde 400 si faltan. Esto **arregló el botón de Rappi, que estaba roto** (el script ahora exige dos fechas y el botón las mandaba vacías). PedidosYa no usa fechas.
- **Seguridad:** validación de formato estricto `YYYY-MM-DD` (regex `ES_FECHA`) en el backend antes del `spawn`, **compartida por todas las plataformas** → cierra la superficie de inyección del `shell:true` (las fechas del date-picker siempre pasan; solo se rechazan valores malformados). 400 si el formato no matchea.
- **Verificación de arranque país-config (`validarConfigPaises()`):** al levantar el panel valida, por cada plataforma, que el país horneado en sus `args` coincida con el país de su sección (`SECCIONES`/`PLATAFORMA_PAIS`), con match exacto contra un set de países conocidos. Si alguno descalza (o una sección referencia un ID inexistente), **el panel NO arranca**: lista todos los errores y aborta (`exit 1`). Cierra el **riesgo de mantenimiento del descalce panel→script**: una edición futura de la config que ponga una plataforma bajo el país equivocado se detecta al arrancar, no en silencio. MercadoPago (sin arg de país, mono-país) pasa por diseño. Esto **completa las tres capas de blindaje de país**: (1) selector visual del panel + (2) verificación de arranque del panel + (3) guardia dura del script (`country=` del portal ↔ argumento recibido, exit 3).
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

Ambas fechas (`<desde>` `<hasta>`) son **obligatorias** en formato `YYYY-MM-DD`. Sin ellas el script aborta con error (no asume período por defecto).

```
# Producción: genera + descarga todos los pagos del rango
node descargar-rappi.js argentina 2026-06-17 2026-06-17

# Prueba: solo los primeros 10 pagos del rango
node descargar-rappi.js argentina 2026-06-17 2026-06-17 prueba

# Solo descarga: NO regenera; baja por ID los reportes ya generados
node descargar-rappi.js argentina 2026-06-17 2026-06-17 solo-descarga

# Un rango de varios días
node descargar-rappi.js argentina 2026-06-11 2026-06-17
```

El script ejecuta:
- **Captura:** Financiero > "Últimos 30 días" > **"Todas" las marcas**, pagina el endpoint `paid-lot/by-stores` (~1715 pagos de 575 tiendas), y filtra por `paid_date` en rango + `total ≠ 0`.
- **Fase 1 (generación):** genera cada reporte con `POST partner-report/v1/report` (`access_token` de localStorage). Se saltea en modo `solo-descarga`.
- **Fase 2 (descarga):** baja cada XLS con `GET partner-report/v1/report?country=AR&paid_lot_id=<ID>`, valida que sea XLS real (magic bytes) y sobrescribe por ID (sin duplicados).
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
- `diag-marcas-dropdown.png` / `diag-marcas-todas.png` / `diag-marcas-error.png` — selector "Todas las marcas"
- `diag-pais-selector.png` / `diag-pais-dropdown.png` / `diag-pais-post.png` / `diag-pais-error.png` — blindaje de país (#2): estado del selector, dropdown abierto, post-cambio y error

Nota: Fase 1 (generación) y Fase 2 (descarga) ya no usan la tabla ni la pestaña Reportes (van por POST/GET directo por ID), así que no generan screenshots; los errores se reportan por consola (IDs con fallo) y las compuertas abortan ante el primer fallo.

---

## 5. Preparación para Chile

| Motor | Estado | Qué falta |
|---|---|---|
| PedidosYa | ✅ **FUNCIONA** | Listo para producción. Detección automática activa (probado 108 locales Chile) |
| Uber Eats | ✅ Parametrizado (`descargar-uber.js chile`) | Login con cuenta chilena; verificar que `login-uber.js` acepte país como argumento |
| Rappi | ✅ **FUNCIONA** (Argentina) | Argentina operativo (POST directo + criterios de Finanzas). Chile no aplica por ahora |
| MercadoPago | — | No aplica para Chile |

**Nota PedidosYa:** El script navega directo a la URL `/finance-py` sin tocar el sidebar, por lo que la diferencia de menú (Argentina tiene dos links, Chile tiene uno solo llamado "Finanzas") no afecta la automatización. La diferencia en el portal (etiqueta "ÚLTIMA" vs. orden por fecha) se resuelve automáticamente sin configuración.

---

## 6. Qué falta por hacer

### Prioritario

- [x] **Rappi — camino feliz del detector de sesión:** validado en la corrida del 2026-06-24 (sesión renovada → `estadoSesion()` dejó pasar y la captura corrió completa, 192/192). El caso de sesión vencida ya estaba validado (mensaje claro + exit 2).
- [ ] **Uber — formato XLSX:** el portal entrega CSV por defecto. Investigar si el formulario tiene selector de formato o si se configura en el perfil de la cuenta. Ver `UBER-DEBUGGING-LOG.md` sección 5.
- [ ] **Manejo de sesión expirada (otros motores):** Rappi ya detecta sesión vencida (carrera login-vs-panel + exit 2). PedidosYa / Uber / MercadoPago todavía fallan de forma poco clara si la sesión expira — replicar un detector equivalente en cada uno.
- [ ] **Chile — verificar `login-uber.js`:** confirmar que acepta país como argumento (o adaptarlo) antes de tener el acceso chileno.

> Nota: la **prueba multi-marca de Rappi** quedó resuelta (corrida real con "Todas" → 575 tiendas / 1715 pagos, 194/194 descargados).

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

### Rappi — endpoint de pagos (POST paginado)
```
POST https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/paid-lot/by-stores?country=AR
body: { stores_ids:[...], page, size, start_date, end_date, filter:"paidlot", in_progress:false }
```
Devuelve `{ content:[...], total_elements (por página), total_elements_without_pagination (TOTAL real), ... }`. Cada ítem tiene `id` (= `paid_lot_id`), `brand_name`, `start_date`, `end_date`, `paid_date`, `total`, `stores`. **Es brand-filtered:** con una marca activa devuelve solo ese grupo; con "Todas" tildado, el body trae los `stores_ids` de las 575 tiendas. Se pagina replicando el POST (`page` 0..N, `size` 100) hasta `total_elements_without_pagination` (~1715).

### Rappi — token y headers para las requests directas (clave para el futuro)
Tanto la generación (Fase 1, POST) como la descarga (Fase 2, GET) van por `context.request` con auth manual. Dos detalles que costaron sangre y eran la causa de los 403:

- **Token correcto = `access_token`, NO `id_token`.** La API espera el **access token** (`localStorage`, clave directa `access_token`, ~2364 chars). El `id_token` (~1572) da **403**. Usar siempre el access_token; nunca el id_token.
- **Headers de origen obligatorios:** `Origin: https://partners.rappi.com` + `Referer: https://partners.rappi.com/` (más `Accept`, `Accept-Language`, `User-Agent` real). Sin ellos, 403. No hacen falta headers `x-*` (la request real no manda ninguno).

### Rappi — descarga (Fase 2) por GET directo por ID
```
GET https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/v1/report?country=AR&paid_lot_id=<ID>
```
Con el `access_token` + headers de arriba, `context.request.get` devuelve el XLS directo. **No se usa la pestaña Reportes** (está paginada y solo mostraba ~15 reportes → con 194 fallaban 179). Se valida que la respuesta sea XLS real por **magic bytes** (`D0CF11E0` para .xls / `50 4B` para .xlsx) y se descarta JSON/HTML. Se guarda con `fs.writeFileSync` (sobrescribe → sin duplicados `(1).xls`).
