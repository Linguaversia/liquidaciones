// descargar-rappi.js
// Fase 1: Genera los reportes XLS para cada pago "Pagado" en Financiero > Resumen.
// Fase 2: Descarga cada XLS con la URL directa usando el paid_lot_id.
//
// Uso:
//   node descargar-rappi.js argentina 2026-06-01 2026-06-17                 -> genera + descarga el rango
//   node descargar-rappi.js argentina 2026-06-01 2026-06-17 prueba          -> solo los primeros 10 pagos
//   node descargar-rappi.js argentina 2026-06-01 2026-06-17 solo-descarga   -> NO regenera; solo descarga por ID
//
// Ambas fechas (desde y hasta) son obligatorias, en formato YYYY-MM-DD.
// Flags (en cualquier posición): "prueba"/"--prueba", "solo-descarga"/"--descarga".
//
// Los archivos caen en ./descargas/rappi-<PAIS>/<fecha>/

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CARPETA_DESCARGAS } = require('./config');

const pais = process.argv[2];
const args = process.argv.slice(3);

// Las fechas se reconocen por su formato YYYY-MM-DD (en cualquier posición).
// El flag de prueba se acepta como 'prueba' o '--prueba', también en cualquier posición.
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const modoPrueba = args.some(a => /^-{0,2}prueba$/i.test(a));
const modoSoloDescarga = args.some(a => /^-{0,2}(solo-?descarga|descarga)$/i.test(a));
const fechas = args.filter(esFecha);
const desde = fechas[0];
const hasta = fechas[1];

if (!pais) {
  console.log('Falta el país. Ejemplo:  node descargar-rappi.js argentina 2026-06-01 2026-06-17 [prueba]');
  process.exit(1);
}

if (!desde || !hasta) {
  console.log('Faltan fechas. Hay que indicar AMBAS en formato YYYY-MM-DD (desde y hasta).');
  console.log('Ejemplo:  node descargar-rappi.js argentina 2026-06-01 2026-06-17 [prueba]');
  process.exit(1);
}

if (desde > hasta) {
  console.log(`Rango inválido: "desde" (${desde}) es posterior a "hasta" (${hasta}).`);
  process.exit(1);
}

const archivoSesion = path.resolve(`./sesiones/rappi-${pais}.json`);
if (!fs.existsSync(archivoSesion)) {
  console.log(`No existe sesión. Corre primero: node login-rappi.js ${pais}`);
  process.exit(1);
}

if (!fs.existsSync(CARPETA_DESCARGAS)) {
  console.log(`ERROR: la carpeta de descargas no existe: "${CARPETA_DESCARGAS}"`);
  console.log('Verificá que Google Drive esté sincronizado y la carpeta exista.');
  process.exit(1);
}

const hoy = new Date().toISOString().slice(0, 10);
const codigoPais = { argentina: 'AR', chile: 'CL', uruguay: 'UY', colombia: 'CO', peru: 'PE' }[pais]
  ?? pais.toUpperCase().slice(0, 2);

const carpetaDescargas = path.join(CARPETA_DESCARGAS, `rappi-${pais}`, hoy);
fs.mkdirSync(carpetaDescargas, { recursive: true });

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
let browser;
(async () => {
  browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    storageState: archivoSesion,
    acceptDownloads: true,
  });

  const page = await context.newPage();

  // ─── Listener acumulador — captura paid-lot/by-stores de TODAS las marcas ─
  // No tiene early-return: acumula cada respuesta. Se deduplica por id al final.
  const todosLosPagos = [];
  // Registra cada llamada al endpoint (url + body). De acá tomamos el body de
  // "Todas" (el de más stores_ids) para replicar el POST paginado nosotros.
  const llamadasEndpoint = [];

  page.on('response', async (response) => {
    if (!response.url().includes('paid-lot/by-stores')) return;
    if (response.status() < 200 || response.status() >= 300) return;
    try {
      const json = await response.json();
      const lista = Array.isArray(json?.content) ? json.content : [];
      const req = response.request();
      let post = null; try { post = req.postData(); } catch {}
      llamadasEndpoint.push({ url: response.url(), post });
      if (lista.length > 0) {
        const marca = lista[0]?.brand_name ?? '?';
        console.log(`  Endpoint: ${lista.length} ítems (marca: ${marca})`);
        todosLosPagos.push(...lista);
      }
    } catch {}
  });

  // ─── Paso 1: Navegar a Financiero ────────────────────────
  console.log('Navegando a Financiero > Resumen...');
  try {
    await page.goto('https://partners.rappi.com', { waitUntil: 'networkidle' });
  } catch (err) {
    console.log(`  (page.goto no llegó a networkidle: ${err.message.split('\n')[0]})`);
  }
  await page.waitForTimeout(2000);

  // Determina el estado de la sesión por CARRERA: la primera señal que aparezca
  // decide. Login (sesión vencida) — Rappi NO redirige a /login, muestra el
  // formulario en la misma raíz — vs. panel (sesión OK). Con sesión válida nunca
  // aparece el password → gana el panel; con vencida nunca aparece "Financiero"
  // → gana el login. Sin penalizar ninguna rama (no hay espera fija larga).
  const estadoSesion = async () => {
    const TIMEOUT = 15000;
    const visible = (loc, resultado) =>
      loc.first().waitFor({ state: 'visible', timeout: TIMEOUT }).then(() => resultado);

    const señales = [
      // Login → sesión vencida
      visible(page.locator('input[type="password"]'), 'vencida'),
      visible(page.getByRole('button', { name: /ingresar|iniciar sesi[oó]n/i }), 'vencida'),
      visible(page.getByText(/accede a tu cuenta/i), 'vencida'),
      // Panel → sesión válida
      visible(page.getByRole('link', { name: /financiero/i }), 'valida'),
      visible(page.getByText(/^financiero$/i), 'valida'),
    ];

    try {
      return await Promise.any(señales);   // gana la primera señal visible
    } catch {
      return 'desconocido';                // ninguna apareció dentro del timeout
    }
  };

  // ─── Detección de sesión (fail-fast, antes de capturar) ──────────────────
  const estado = await estadoSesion();
  if (estado === 'vencida') {
    console.log('\n⚠ Sesión de Rappi vencida. Renová con: node login-rappi.js ' + pais);
    await browser.close();
    process.exit(2);
  }
  if (estado === 'desconocido') {
    console.log('  (No se pudo confirmar el estado de sesión en 15s; continúo igual.)');
  }

  const clickFinanciero = async () => {
    try {
      const link = page.getByRole('link', { name: /financiero/i })
        .or(page.locator('a').filter({ hasText: /^financiero$/i }))
        .or(page.getByText(/^financiero$/i))
        .first();
      await link.scrollIntoViewIfNeeded({ timeout: 8000 });
      await link.click();
      await page.waitForTimeout(4000);
      console.log('  Sidebar: clic en "Financiero"');
    } catch {
      console.log('  (no se encontró link "Financiero" en sidebar)');
    }
  };

  await clickFinanciero();

  // Clic en pestaña "Resumen" si no llegaron datos todavía
  if (todosLosPagos.length === 0) {
    try {
      const tabResumen = page.getByRole('tab', { name: /resumen/i })
        .or(page.getByText(/^resumen$/i)).first();
      if (await tabResumen.isVisible({ timeout: 4000 })) {
        await tabResumen.click();
        await page.waitForTimeout(4000);
        console.log('  Pestaña "Resumen" seleccionada.');
      }
    } catch {}
  }

  if (todosLosPagos.length === 0) await page.waitForTimeout(4000);

  if (todosLosPagos.length === 0) {
    console.log('No se capturó el endpoint paid-lot/by-stores.');
    await page.screenshot({ path: './diagnostico-rappi.png', fullPage: false });
    console.log('Screenshot guardado en ./diagnostico-rappi.png');
    await browser.close();
    process.exit(1);
  }

  // ─── Paso 2: Ampliar el período a "Últimos 30 días" ──────
  try {
    const periodoDropdown = page.getByText('Últimos 7 días').first();
    if (await periodoDropdown.isVisible({ timeout: 4000 })) {
      await periodoDropdown.click();
      await page.waitForTimeout(1000);
      for (const texto of ['Últimos 30 días', 'Último mes', 'Este mes', 'Últimos 90 días']) {
        const opcion = page.getByText(texto, { exact: true }).first();
        if (await opcion.isVisible({ timeout: 1500 })) {
          await opcion.click();
          await page.waitForTimeout(500);
          const btnAplicarPeriodo = page.getByRole('button', { name: /aplicar/i }).first();
          if (await btnAplicarPeriodo.isVisible({ timeout: 2000 })) {
            await btnAplicarPeriodo.click();
          }
          await page.waitForTimeout(3000);
          console.log(`  Período ampliado a: "${texto}"`);
          break;
        }
      }
    }
  } catch { console.log('  (no se pudo ampliar el período)'); }

  // ─── Paso 3: Seleccionar "Todas" las marcas antes de capturar ──────────
  // El endpoint paid-lot/by-stores devuelve solo el grupo/marca activo. Para
  // capturar las 575 tiendas hay que abrir el chip "Marca:", tildar "Todas" y
  // Aplicar. Falla RUIDOSAMENTE si no encuentra el selector (mejor abortar que
  // descargar incompleto — hay dinero de por medio).
  const seleccionarTodasLasMarcas = async () => {
    // (1) Chip "Marca: ..." — anclado en "Marca:" al inicio para no agarrar
    //     contenedores padres (lo que rompía el .first() anterior).
    let chip = page.getByText(/^\s*Marca\s*:/i).filter({ visible: true }).first();
    if (!await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      chip = page.locator('button, [role="button"], [class*="chip"]')
        .filter({ hasText: /^\s*Marca\s*:/i }).filter({ visible: true }).first();
    }
    if (!await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error('No se encontró el chip "Marca:" en la barra de filtros');
    }
    try {
      await chip.click({ timeout: 5000 });
    } catch {
      // si el texto no es clickeable, clic en su ancestro botón/role=button
      await chip.locator('xpath=ancestor-or-self::*[self::button or @role="button"][1]')
        .first().click({ timeout: 5000 });
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: './diag-marcas-dropdown.png', fullPage: false });

    // (2) Detectar que el dropdown ABRIÓ por la opción "Todas" VISIBLE en la
    //     página (NO por la clase del contenedor, que no matcheaba).
    const todasTexto = page.getByText(/^\s*todas\s*$/i).filter({ visible: true }).first();
    if (!await todasTexto.isVisible({ timeout: 4000 }).catch(() => false)) {
      throw new Error('El chip "Marca:" no abrió el dropdown (no apareció la opción "Todas")');
    }

    // (3) Tildar "Todas" (marca todas las marcas automáticamente). Verificamos
    //     el estado del checkbox para NO destildar si ya estaba tildado.
    const todasCheckbox = page.getByRole('checkbox', { name: /^todas$|seleccionar todas|^todos$/i }).first();
    const estaTildado = async () => {
      try { return await todasCheckbox.isChecked({ timeout: 1000 }); } catch { return null; }
    };
    for (let intento = 0; intento < 2; intento++) {
      if (await estaTildado() === true) break;            // ya está todo seleccionado
      if (await todasCheckbox.isVisible({ timeout: 1500 }).catch(() => false)) {
        await todasCheckbox.click({ timeout: 3000 }).catch(() => {});
      } else {
        await todasTexto.click({ timeout: 3000 }).catch(() => {});   // clic en el label togglea
      }
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: './diag-marcas-todas.png', fullPage: false });

    // (4) Botón "Aplicar" visible (el del filtro de período ya está cerrado acá).
    const aplicar = page.getByRole('button', { name: /^aplicar$/i }).filter({ visible: true }).last();
    if (!await aplicar.isVisible({ timeout: 2000 }).catch(() => false)) {
      throw new Error('No se encontró el botón "Aplicar" del selector de marcas');
    }

    // (5) Aplicar y esperar el endpoint (mejor que un timeout ciego).
    const esperaResp = page.waitForResponse(
      r => r.url().includes('paid-lot/by-stores') && r.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await aplicar.click({ timeout: 5000 });
    await esperaResp;
    await page.waitForTimeout(3000);   // aterrizar respuestas adicionales (posible paginación)
  };

  try {
    await seleccionarTodasLasMarcas();
    console.log('  Selector: "Todas" + Aplicar OK.');
  } catch (err) {
    console.log(`\nERROR seleccionando "Todas" las marcas: ${err.message.split('\n')[0]}`);
    console.log('ABORTANDO para no descargar incompleto (faltarían marcas).');
    await page.screenshot({ path: './diag-marcas-error.png', fullPage: false });
    await browser.close();
    process.exit(1);
  }

  // ─── Auth: access_token + headers (los usan la captura paginada Y la Fase 1) ──
  // La API espera el ACCESS TOKEN (localStorage "access_token", ~2364 chars), NO
  // el id_token (~1572, da 403). Fallback: cualquier JWT salvo id_token.
  const token = await page.evaluate(() => {
    const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return o; };
    const todas = { ...dump(localStorage), ...dump(sessionStorage) };
    for (const clave of ['access_token', 'accessToken']) {
      if (typeof todas[clave] === 'string' && todas[clave]) return todas[clave];
    }
    for (const [clave, v] of Object.entries(todas)) {
      if (/id[_-]?token/i.test(clave)) continue;
      if (typeof v === 'string') {
        const m = v.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) return m[0];
      }
    }
    return null;
  });
  if (!token) {
    console.log('ERROR: no se pudo extraer el access_token de storage.');
    await browser.close();
    process.exit(1);
  }
  console.log(`  Token access_token OK (len ${token.length}, ${token.slice(0, 18)}...)`);

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const headersPost = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es',
    'Origin': 'https://partners.rappi.com',
    'Referer': 'https://partners.rappi.com/',
    'User-Agent': userAgent,
    'sec-ch-ua': '"Not/A)Brand";v="99", "Chromium";v="148"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
  const urlGenerar = `https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/v1/report?country=${codigoPais}`;

  // ─── Captura paginada: tomar el body de "Todas" y paginar TODO el endpoint ──
  // Tomamos la llamada interceptada con MÁS stores_ids (la de "Todas" = 575) y
  // replicamos el POST nosotros, page 0..N, hasta juntar total_elements_without_pagination.
  const parseBody = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const candidatas = llamadasEndpoint
    .map(c => ({ url: c.url, body: parseBody(c.post) }))
    .filter(x => x.body && Array.isArray(x.body.stores_ids) && x.body.stores_ids.length > 0);
  const llamadaTodas = candidatas.sort((a, b) => b.body.stores_ids.length - a.body.stores_ids.length)[0];
  if (!llamadaTodas) {
    console.log('ERROR: no se capturó el body de "Todas" con stores_ids. Abortando.');
    await browser.close();
    process.exit(1);
  }

  const bodyBase = { ...llamadaTodas.body };
  delete bodyBase.page; delete bodyBase.size;   // los seteamos por página
  // Fechas: ventana amplia del portal; SOLO ensanchar para cubrir [desde,hasta],
  // nunca recortar (el filtro local por paid_date es el decisor final).
  const esYMD = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
  if (esYMD(bodyBase.start_date) && bodyBase.start_date.slice(0, 10) > desde) bodyBase.start_date = desde;
  if (esYMD(bodyBase.end_date)   && bodyBase.end_date.slice(0, 10)   < hasta) bodyBase.end_date   = hasta;
  console.log(`\nCaptura paginada: ${llamadaTodas.body.stores_ids.length} stores, ventana ${bodyBase.start_date}…${bodyBase.end_date}`);

  const capturarTodasLasPaginas = async (size) => {
    const items = [];
    let total = null;
    for (let page = 0; page <= 500; page++) {              // tope de seguridad
      const resp = await context.request.post(llamadaTodas.url, {
        headers: headersPost,
        data: { ...bodyBase, page, size },
      });
      if (!resp.ok()) return { ok: false, status: resp.status(), items, total };
      const json = await resp.json();
      const lista = Array.isArray(json?.content) ? json.content : [];
      if (total == null) total = json.total_elements_without_pagination ?? json.total_elements ?? null;
      items.push(...lista);
      console.log(`  page ${page} (size ${size}): +${lista.length} → ${items.length}/${total ?? '?'}`);
      if (lista.length === 0) break;                       // guarda: página vacía
      if (total != null && items.length >= total) break;   // completo
      await new Promise(r => setTimeout(r, 400));           // ritmo entre páginas
    }
    return { ok: true, items, total };
  };

  let cap = await capturarTodasLasPaginas(100);   // size grande primero (~17 reqs)
  if (!cap.ok) {
    console.log(`  size 100 dio HTTP ${cap.status}; reintento con size 15...`);
    cap = await capturarTodasLasPaginas(15);
  }
  if (!cap.ok) {
    console.log(`ERROR paginando el endpoint (HTTP ${cap.status}). Abortando.`);
    await browser.close();
    process.exit(1);
  }

  const pagosCapturados = [
    ...new Map(cap.items.map(p => [String(p.id ?? p.paid_lot_id), p])).values()
  ];
  console.log(`\nCapturados: ${cap.items.length} ítems → ${pagosCapturados.length} únicos (esperado ${cap.total ?? '?'}).`);
  if (cap.total != null && pagosCapturados.length < cap.total) {
    console.log(`  ⚠ capturados (${pagosCapturados.length}) < total (${cap.total}) — faltarían páginas, revisar.`);
  }

  if (pagosCapturados.length === 0) {
    console.log('No hay ítems capturados.');
    await browser.close();
    process.exit(1);
  }

  // ─── Detectar campo ID (necesario para la descarga) ──────
  const primera = pagosCapturados[0];
  console.log('Claves del primer ítem:', Object.keys(primera).join(', '));

  const campoId =
    Object.keys(primera).find(k => /paid_lot_id/i.test(k))
    ?? Object.keys(primera).find(k => /^lot_id$/i.test(k))
    ?? Object.keys(primera).find(k => /^id$/i.test(k));

  if (!campoId) {
    console.log('No se pudo detectar campo ID. Claves:', Object.keys(primera));
    await browser.close();
    process.exit(1);
  }

  console.log(`Campo ID: "${campoId}"`);

  // ─── Filtro: paid_date dentro de [desde, hasta] y total !== 0 ──────
  // paid_date viene como "YYYY-MM-DD" (sin hora ni zona horaria), así que la
  // comparación lexicográfica de strings coincide con el orden cronológico.
  // total = "Valor a transferir": se incluyen positivos Y negativos; solo se
  // excluye total exactamente 0.
  console.log(`\nFiltrando: paid_date entre ${desde} y ${hasta} (inclusive) y total !== 0`);

  // Resumen por contadores (con 1715 filas, el log por-fila sería ilegible).
  const motivos = { fueraRango: 0, totalCero: 0, sinFecha: 0, sinTotal: 0 };
  let pagados = pagosCapturados.filter(p => {
    const paidDate = typeof p.paid_date === 'string' ? p.paid_date.slice(0, 10) : null;
    const total = Number(p.total);
    if (!paidDate) { motivos.sinFecha++; return false; }
    if (!Number.isFinite(total)) { motivos.sinTotal++; return false; }
    if (paidDate < desde || paidDate > hasta) { motivos.fueraRango++; return false; }
    if (total === 0) { motivos.totalCero++; return false; }
    return true;
  });

  console.log(`\nIncluidos: ${pagados.length} de ${pagosCapturados.length} capturados.`);
  console.log(`  saltados → fuera de rango: ${motivos.fueraRango} | total=0: ${motivos.totalCero} | sin fecha: ${motivos.sinFecha} | sin total: ${motivos.sinTotal}`);
  console.log(`  IDs a descargar (${pagados.length}): ${pagados.map(p => p[campoId]).join(', ')}`);

  if (modoPrueba) {
    pagados = pagados.slice(0, 10);
    console.log(`MODO PRUEBA: solo los primeros ${pagados.length} pagos.`);
  }

  if (pagados.length === 0) {
    console.log('No hay pagos que cumplan el filtro (rango de fechas + total !== 0).');
    await browser.close();
    process.exit(0);
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));   // usado por Fase 1 y Fase 2

  // ─── FASE 1: Generar los reportes por POST directo (se saltea en solo-descarga) ──
  // POST .../partner-report/v1/report?country=<PAIS>  body { paid_lot_id, type:"RESTAURANT" }
  // Ya tenemos todos los IDs en "pagados", así que no hace falta la tabla.
  if (modoSoloDescarga) {
    console.log('\nMODO SOLO-DESCARGA: salteando Fase 1 (los reportes ya están generados).');
    await page.waitForTimeout(2000);   // breve respiro; no la espera larga entre fases
  } else {
    console.log('\n─── FASE 1: Generando reportes por POST directo ───');
    // Reusa token / headersPost / urlGenerar ya extraídos arriba (antes de la captura).

    // Dispara la generación de un pago. Devuelve { ok, status, body }.
    const generarReporte = async (id) => {
      const idNum = Number(id);
      const resp = await context.request.post(urlGenerar, {
        headers: headersPost,
        data: { paid_lot_id: Number.isFinite(idNum) ? idNum : id, type: 'RESTAURANT' },
      });
      const status = resp.status();
      let body = '';
      try { body = (await resp.body()).toString('utf8').slice(0, 300); } catch {}
      return { ok: status >= 200 && status < 300, status, body };
    };

    const PAUSA_GEN_MS = 700;   // pausa entre POSTs de generación (no martillar a Rappi)
    const tGen0 = Date.now();   // inicio de generación (compuerta incluida)

    // ── COMPUERTA: verificar con UN pago antes del loop completo ──
    const primerPago = pagados[0];
    const primerId = primerPago[campoId];
    console.log(`  Verificando POST con 1 pago: ID ${primerId} (${primerPago.brand_name ?? '?'})...`);
    const prueba1 = await generarReporte(primerId);
    if (!prueba1.ok) {
      console.log(`  ✗ POST de prueba FALLÓ: HTTP ${prueba1.status}`);
      console.log(`    body: ${prueba1.body}`);
      console.log('  ABORTANDO: el POST directo no funcionó (falta auth/header o cambió el endpoint).');
      console.log('  No se generó nada más. Revisá el status/body de arriba antes de seguir.');
      await browser.close();
      process.exit(1);
    }
    console.log(`  ✓ POST de prueba OK: HTTP ${prueba1.status}. Sigo con el resto.`);

    // ── Loop por el resto de los IDs ──
    let generados = 1; // el primero ya se generó en la compuerta
    const fallosGen = [];
    for (let i = 1; i < pagados.length; i++) {
      const pago = pagados[i];
      const id = pago[campoId];
      const etiqueta = `[${i + 1}/${pagados.length}] ID ${id} (${pago.brand_name ?? ''})`;
      try {
        const r = await generarReporte(id);
        if (r.ok) {
          generados++;
          console.log(`  OK    ${etiqueta} -> HTTP ${r.status}`);
        } else {
          fallosGen.push(id);
          console.log(`  FALLO ${etiqueta} -> HTTP ${r.status} ${r.body}`);
        }
      } catch (err) {
        fallosGen.push(id);
        console.log(`  ERROR ${etiqueta}: ${err.message.split('\n')[0]}`);
      }
      await sleep(PAUSA_GEN_MS);   // ritmo entre generaciones
    }

    const genMs = Date.now() - tGen0;
    console.log(`\n  Reportes solicitados: ${generados}/${pagados.length}.`);
    console.log(`  ⏱ Fase 1 (generación): ${(genMs / 1000).toFixed(1)}s para ${pagados.length} pagos (~${Math.round(genMs / pagados.length)} ms/pago).`);
    if (fallosGen.length) console.log('  IDs que fallaron la generación:', fallosGen.join(', '));

    // El reporte es asíncrono: esperar a que se procese antes de descargar.
    const esperaSegundos = Math.max(20, pagados.length * 4);
    console.log(`\nEsperando ${esperaSegundos}s para que los reportes se procesen...`);
    await page.waitForTimeout(esperaSegundos * 1000);
  }

  // ─── FASE 2: Descargar por GET directo por ID (sin tabla ni paginación) ──
  console.log('\n─── FASE 2: Descargando por GET directo por ID ───');
  const tF20 = Date.now();
  const PAUSA_DESC_MS = 400;

  const urlReporte = (id) =>
    `https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/v1/report?country=${codigoPais}&paid_lot_id=${id}`;

  // ¿El buffer es un XLS real y no un JSON/HTML de error?
  const pareceXls = (buf, ct) => {
    ct = ct || '';
    if (/json|text\/html/i.test(ct)) return false;
    if (!buf || buf.length < 100) return false;
    const ole = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0; // .xls (OLE2)
    const zip = buf[0] === 0x50 && buf[1] === 0x4B;                                       // .xlsx (ZIP)
    if (ole || zip) return true;
    return /excel|spreadsheet|octet-stream|vnd\.ms/i.test(ct);
  };

  // Descarga un reporte por ID. Sobrescribe si ya existe (sin "(1).xls").
  const descargarReporte = async (id) => {
    const resp = await context.request.get(urlReporte(id), { headers: headersPost });
    const status = resp.status();
    const ct = resp.headers()['content-type'] || '';
    let buf = null; try { buf = await resp.body(); } catch {}
    if (status < 200 || status >= 300) return { ok: false, motivo: `HTTP ${status}` };
    if (!pareceXls(buf, ct)) {
      return { ok: false, motivo: `no es XLS (ct=${ct}, ${buf ? buf.length : 0} bytes)`, muestra: buf ? buf.toString('utf8').slice(0, 160) : '' };
    }
    const dest = path.join(carpetaDescargas, `Rappi_ID_Pago_${id}.xls`);
    fs.writeFileSync(dest, buf);   // sobrescribe → un pago = un archivo
    return { ok: true, bytes: buf.length };
  };

  // ── COMPUERTA: probar 1 descarga antes del loop completo ──
  const idGate = String(pagados[0][campoId]);
  console.log(`  Verificando descarga con 1 ID: ${idGate}...`);
  const gate = await descargarReporte(idGate);
  if (!gate.ok) {
    console.log(`  ✗ Descarga de prueba FALLÓ: ${gate.motivo}${gate.muestra ? ` | body: ${gate.muestra}` : ''}`);
    console.log('  ABORTANDO antes de bajar el resto. Revisá el detalle.');
    await browser.close();
    process.exit(1);
  }
  console.log(`  ✓ Descarga de prueba OK: ${gate.bytes} bytes → Rappi_ID_Pago_${idGate}.xls`);

  // ── Loop por el resto de los IDs ──
  let ok = 1;                 // el primero ya se bajó en la compuerta
  const fallos = [];
  for (let i = 1; i < pagados.length; i++) {
    const id = String(pagados[i][campoId]);
    try {
      const r = await descargarReporte(id);
      if (r.ok) { ok++; console.log(`  OK    [${i + 1}/${pagados.length}] ${id} (${r.bytes} bytes)`); }
      else { fallos.push(id); console.log(`  FALLO [${i + 1}/${pagados.length}] ${id}: ${r.motivo}`); }
    } catch (err) {
      fallos.push(id);
      console.log(`  ERROR [${i + 1}/${pagados.length}] ${id}: ${err.message.split('\n')[0]}`);
    }
    await sleep(PAUSA_DESC_MS);
  }

  const f2Ms = Date.now() - tF20;
  console.log(`\nListo. Descargados: ${ok}/${pagados.length}.`);
  console.log(`  ⏱ Fase 2 (descarga): ${(f2Ms / 1000).toFixed(1)}s (~${(f2Ms / 1000 / pagados.length).toFixed(2)} s/pago).`);
  if (fallos.length) console.log('IDs con error:', fallos.join(', '));
  console.log(`Archivos en: ${carpetaDescargas}`);

  await browser.close();
  process.exit(0);
})().catch(async (err) => {
  // Red de seguridad: cualquier rejection no contemplada sale como UNA línea
  // legible (no el stack crudo de Node) y cierra el navegador.
  console.log('✗ Error inesperado: ' + (err?.message?.split('\n')[0] || err));
  try { if (browser) await browser.close(); } catch {}
  process.exit(1);
});
