// descargar-rappi.js
// Fase 1: Genera los reportes XLS para cada pago "Pagado" en Financiero > Resumen.
// Fase 2: Descarga cada XLS con la URL directa usando el paid_lot_id.
//
// Uso:
//   node descargar-rappi.js argentina 2026-06-01 2026-06-17           -> rango de fechas
//   node descargar-rappi.js argentina 2026-06-01 2026-06-17 prueba    -> solo los primeros 3 pagos
//
// Ambas fechas (desde y hasta) son obligatorias, en formato YYYY-MM-DD.
// El flag "prueba"/"--prueba" se acepta en cualquier posición.
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
(async () => {
  const browser = await chromium.launch({
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

  page.on('response', async (response) => {
    if (!response.url().includes('paid-lot/by-stores')) return;
    if (response.status() < 200 || response.status() >= 300) return;
    try {
      const json = await response.json();
      const lista = Array.isArray(json?.content) ? json.content : [];
      if (lista.length > 0) {
        const marca = lista[0]?.brand_name ?? '?';
        console.log(`  Endpoint: ${lista.length} ítems (marca: ${marca})`);
        todosLosPagos.push(...lista);
      }
    } catch {}
  });

  // ─── Paso 1: Navegar a Financiero ────────────────────────
  console.log('Navegando a Financiero > Resumen...');
  await page.goto('https://partners.rappi.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

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

  // ─── Paso 3: Iterar sobre todas las marcas ───────────────
  // El endpoint paid-lot/by-stores es brand-filtered: solo devuelve la marca
  // activa. Necesitamos abrir el chip "Marca:" en la barra de filtros y recorrer
  // las opciones del dropdown que aparece (NO buscar texto en celdas de la tabla).
  const brandInicial = todosLosPagos[0]?.brand_name;
  console.log(`\nMarca activa inicial: "${brandInicial}"`);

  // Helper: abre el chip "Marca:" y devuelve el locator del dropdown visible.
  // Si no hay dropdown (solo una marca), devuelve null.
  const abrirDropdownMarca = async () => {
    const chipMarca = page
      .locator('button, [role="button"], [class*="chip"], [class*="filter-item"], span')
      .filter({ hasText: /marca/i })
      .filter({ visible: true })
      .first();
    if (!await chipMarca.isVisible({ timeout: 5000 })) return null;
    await chipMarca.click();
    await page.waitForTimeout(1500);
    // El dropdown aparece como listbox, dialog o menú flotante
    const dropdown = page
      .locator('[role="listbox"], [role="dialog"], [class*="dropdown__menu"], [class*="select__menu"], [class*="options-list"]')
      .filter({ visible: true })
      .last();
    try {
      await dropdown.waitFor({ state: 'visible', timeout: 3000 });
      return dropdown;
    } catch {
      await page.keyboard.press('Escape');
      return null;
    }
  };

  await page.screenshot({ path: './diagnostico-marcas.png', fullPage: false });
  console.log('  Screenshot del selector de marcas: ./diagnostico-marcas.png');

  let marcasEncontradas = [];
  try {
    const dropdown = await abrirDropdownMarca();
    await page.screenshot({ path: './diagnostico-marcas-dropdown.png', fullPage: false });
    console.log('  Screenshot del dropdown de marcas: ./diagnostico-marcas-dropdown.png');

    if (dropdown) {
      const textos = (await dropdown.locator('[role="option"], li, label').filter({ visible: true }).allTextContents())
        .map(t => t.trim())
        .filter(t => t.length > 1 && !/^todas$/i.test(t));
      console.log(`  Marcas en dropdown (${textos.length}): ${textos.join(', ')}`);
      marcasEncontradas = textos;
    } else {
      console.log('  No se encontró dropdown de marcas (posiblemente solo hay una marca activa).');
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch (err) {
    console.log(`  Error buscando dropdown de marcas: ${err.message.split('\n')[0]}`);
    await page.screenshot({ path: './diagnostico-marcas-error.png', fullPage: false });
  }

  // Iterar por las marcas que NO tienen datos aún
  for (const marca of marcasEncontradas) {
    const yaTenemos = todosLosPagos.some(p => p.brand_name === marca);
    if (yaTenemos) {
      console.log(`  Ya capturada: "${marca}"`);
      continue;
    }

    console.log(`  Cambiando a marca: "${marca}"...`);
    const prevCount = todosLosPagos.length;

    try {
      const dropdown = await abrirDropdownMarca();
      if (!dropdown) throw new Error('No se pudo abrir el dropdown de marcas');

      const opcion = dropdown.locator('[role="option"], li, label')
        .filter({ hasText: marca })
        .first();
      await opcion.click({ timeout: 5000 });
      await page.waitForTimeout(500);

      // Aplicar si hay botón de confirmación
      const btnAplicar = page.getByRole('button', { name: /^aplicar$/i }).first();
      if (await btnAplicar.isVisible({ timeout: 2000 })) {
        await btnAplicar.click();
      }

      // Esperar la respuesta del API para esta marca
      await page.waitForTimeout(4000);

      if (todosLosPagos.length > prevCount) {
        console.log(`    → ${todosLosPagos.length - prevCount} ítems capturados.`);
      } else {
        console.log(`    → Sin nuevos ítems (puede no tener pagos en el período).`);
      }
    } catch (err) {
      console.log(`    Error cambiando a "${marca}": ${err.message.split('\n')[0]}`);
    }
  }

  // Deduplicar por id (cada marca puede tener el mismo id si hubo doble captura)
  const pagosCapturados = [
    ...new Map(todosLosPagos.map(p => [String(p.id ?? p.paid_lot_id), p])).values()
  ];

  console.log(`\nTotal acumulado: ${todosLosPagos.length} ítems → ${pagosCapturados.length} únicos.`);
  console.log('Marcas únicas:', [...new Set(pagosCapturados.map(p => p.brand_name))].join(', '));

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

  let pagados = pagosCapturados.filter(p => {
    const id = p[campoId];
    const marca = p.brand_name ?? '?';
    const paidDate = typeof p.paid_date === 'string' ? p.paid_date.slice(0, 10) : null;
    const total = Number(p.total);

    if (!paidDate) {
      console.log(`  SALTEADA ${id} ${marca} sin paid_date`);
      return false;
    }
    if (!Number.isFinite(total)) {
      console.log(`  SALTEADA ${id} ${marca} sin total numérico (total=${JSON.stringify(p.total)})`);
      return false;
    }
    if (paidDate < desde || paidDate > hasta) {
      console.log(`  SALTEADA ${id} ${marca} paid_date=${paidDate} fuera de rango`);
      return false;
    }
    if (total === 0) {
      console.log(`  SALTEADA ${id} ${marca} total=0`);
      return false;
    }
    console.log(`  INCLUIDA ${id} ${marca} paid_date=${paidDate} total=${total}`);
    return true;
  });

  console.log(`\nIncluidos: ${pagados.length} de ${pagosCapturados.length} pagos capturados.`);

  if (modoPrueba) {
    pagados = pagados.slice(0, 3);
    console.log(`MODO PRUEBA: solo los primeros ${pagados.length} pagos.`);
  }

  if (pagados.length === 0) {
    console.log('No hay pagos que cumplan el filtro (rango de fechas + total !== 0).');
    await browser.close();
    process.exit(0);
  }

  // ─── FASE 1: Generar los reportes por POST directo (sin tabla) ──────────
  // La generación se dispara con:
  //   POST .../partner-report/v1/report?country=<PAIS>
  //   body JSON: { paid_lot_id: <id>, type: "RESTAURANT" }
  // Ya tenemos todos los IDs en "pagados" (del endpoint paid-lot/by-stores),
  // así que NO hace falta la tabla paginada, ni navegar al detalle, ni clicks.
  console.log('\n─── FASE 1: Generando reportes por POST directo ───');

  // Auth: el SPA usa Bearer desde storage (no cookie). La API espera el
  // ACCESS TOKEN (clave directa "access_token" en localStorage), NO el id_token
  // (que dio 403). Preferimos access_token; fallback a otras claves conocidas y,
  // por último, cualquier JWT (eyJ...).
  const token = await page.evaluate(() => {
    const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return o; };
    const todas = { ...dump(localStorage), ...dump(sessionStorage) };
    for (const clave of ['access_token', 'accessToken']) {
      if (typeof todas[clave] === 'string' && todas[clave]) return todas[clave];
    }
    // Fallback: cualquier JWT, PERO nunca el id_token (es el que da 403).
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
    console.log('ERROR: no se pudo extraer el access_token de storage. No se puede generar por POST.');
    await browser.close();
    process.exit(1);
  }
  console.log(`  Token access_token OK (len ${token.length}, ${token.slice(0, 18)}...)`);

  // User-agent real del navegador en uso (para que coincida con la sesión,
  // en vez de hardcodear uno que podría no matchear la versión de Chromium).
  const userAgent = await page.evaluate(() => navigator.userAgent);

  const urlGenerar = `https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/v1/report?country=${codigoPais}`;
  const headersPost = {
    // Auth + formato (lo que ya teníamos)
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    // Negociación de contenido
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es',
    // Origen — los sospechosos nº1 del 403
    'Origin': 'https://partners.rappi.com',
    'Referer': 'https://partners.rappi.com/',
    // Identidad del cliente (UA real del navegador en ejecución)
    'User-Agent': userAgent,
    // Client hints + fetch metadata (tal como se capturaron; no molestan)
    'sec-ch-ua': '"Not/A)Brand";v="99", "Chromium";v="148"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };

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
  }

  console.log(`\n  Reportes solicitados: ${generados}/${pagados.length}.`);
  if (fallosGen.length) console.log('  IDs que fallaron la generación:', fallosGen.join(', '));

  // El reporte sigue siendo asíncrono: hay que esperar a que se procese antes
  // de que aparezca para descargar en Fase 2.
  const esperaSegundos = Math.max(20, pagados.length * 4);
  console.log(`\nEsperando ${esperaSegundos}s para que los reportes se procesen...`);
  await page.waitForTimeout(esperaSegundos * 1000);

  // ─── FASE 2: Interceptar la descarga al clickear el link en Reportes ─
  console.log('\n─── FASE 2: Descargando desde pestaña Reportes ───');

  const idsDescargados = new Set();

  await page.route((url) => {
    try {
      const u = new URL(url);
      return u.pathname.includes('partner-report/v1/report')
        && u.searchParams.has('paid_lot_id');
    } catch { return false; }
  }, async (route) => {
    const urlObj = new URL(route.request().url());
    const idParam = urlObj.searchParams.get('paid_lot_id');

    try {
      const response = await route.fetch();
      const status = response.status();

      if (status === 200) {
        const body = await response.body();
        const dest = path.join(carpetaDescargas, `Rappi_ID_Pago_${idParam}.xls`);
        fs.writeFileSync(dest, body);
        idsDescargados.add(String(idParam));
        console.log(`  Interceptado: Rappi_ID_Pago_${idParam}.xls (${body.length} bytes)`);
      } else {
        console.log(`  HTTP ${status} al intentar descargar ID ${idParam}`);
      }
    } catch (err) {
      console.log(`  Error en intercept ID ${idParam}: ${err.message.split('\n')[0]}`);
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<html><body>ok</body></html>`,
    });
  });

  // Navegar a Financiero > Reportes
  await clickFinanciero();

  const irAReportes = async () => {
    const tab = page.getByRole('tab', { name: /reportes/i })
      .or(page.getByText('Reportes', { exact: true })).first();
    await tab.waitFor({ timeout: 8000 });
    await tab.click();
    await page.waitForTimeout(2000);
  };

  await irAReportes();
  console.log('  Pestaña "Reportes" abierta.');

  let ok = 0;
  const fallos = [];

  for (const pago of pagados) {
    const id = String(pago[campoId]);
    const etiqueta = `ID ${id}`;

    if (!page.url().includes('financial')) {
      try {
        await clickFinanciero();
        await irAReportes();
      } catch {}
    }

    const filaReporte = page.locator('tr, [role="row"]').filter({
      hasText: `Rappi_ID_Pago_${id}`,
    }).first();

    if (await filaReporte.count() === 0) {
      console.log(`  ERROR ${etiqueta}: no encontrado en pestaña Reportes`);
      await page.screenshot({ path: `./fase2-no-encontrado-${id}.png`, fullPage: false });
      fallos.push(id);
      continue;
    }

    if (ok === 0 && fallos.length === 0) {
      await page.screenshot({ path: './fase2-tabla.png', fullPage: false });
      console.log('  Screenshot tabla Reportes: ./fase2-tabla.png');
    }

    const linkArchivo = page.getByText(`Rappi_ID_Pago_${id}`, { exact: true })
      .or(page.getByRole('link', { name: new RegExp(`Rappi_ID_Pago_${id}`) }))
      .first();
    try {
      await linkArchivo.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await linkArchivo.click({ timeout: 8000 });
    } catch (err) {
      console.log(`  Error clickeando ${etiqueta}: ${err.message.split('\n')[0]}`);
      await page.screenshot({ path: `./fase2-error-click-${id}.png`, fullPage: false });
      fallos.push(id);
      continue;
    }

    await page.waitForTimeout(5000);

    if (idsDescargados.has(id)) {
      console.log(`  OK  ${etiqueta} -> Rappi_ID_Pago_${id}.xls`);
      ok++;
    } else {
      await page.screenshot({ path: `./fase2-error-${id}.png`, fullPage: false });
      console.log(`  ERROR ${etiqueta}: descarga no interceptada — ./fase2-error-${id}.png`);
      fallos.push(id);
    }
  }

  await page.unrouteAll();

  console.log(`\nListo. Descargados: ${ok}/${pagados.length}.`);
  if (fallos.length) console.log('IDs con error:', fallos.join(', '));
  console.log(`Archivos en: ${carpetaDescargas}`);

  await browser.close();
  process.exit(0);
})();
