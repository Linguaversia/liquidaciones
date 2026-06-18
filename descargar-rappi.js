// descargar-rappi.js
// Fase 1: Genera los reportes XLS para cada pago "Pagado" en Financiero > Resumen.
// Fase 2: Descarga cada XLS con la URL directa usando el paid_lot_id.
//
// Uso:
//   node descargar-rappi.js argentina prueba    -> solo los primeros 3 pagos
//   node descargar-rappi.js argentina           -> todos los pagos del período
//
// Los archivos caen en ./descargas/rappi-<PAIS>/<fecha>/

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CARPETA_DESCARGAS } = require('./config');

const pais = process.argv[2];
const modo = process.argv[3]; // 'prueba' o vacío

if (!pais) {
  console.log('Falta el país. Ejemplo:  node descargar-rappi.js argentina prueba');
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

  // ─── DIAGNÓSTICO TEMPORAL ─────────────────────────────────
  // Objetivo: confirmar qué campo del JSON es "Valor a transferir" y en qué
  // formato viene "Fecha del pago" (paid_date), ANTES de cambiar el filtro.
  // Quitar este bloque una vez confirmados los nombres/formatos reales.
  {
    console.log('\n═══ DIAGNÓSTICO DE CAMPOS (muestra por marca) ═══');
    const marcasVistas = new Set();
    for (const p of pagosCapturados) {
      const marca = p.brand_name ?? '?';
      if (marcasVistas.has(marca)) continue;
      marcasVistas.add(marca);
      const numericos = Object.entries(p)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k}=${v}`);
      const fechas = Object.entries(p)
        .filter(([k]) => /date|fecha/i.test(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)} (typeof ${typeof v})`);
      console.log(`\n── Marca: ${marca} ──`);
      console.log('  Campos numéricos:', numericos.join('  |  ') || '(ninguno)');
      console.log('  Campos fecha:    ', fechas.join('  |  ') || '(ninguno)');
    }
    console.log('\n  Objeto completo de la primera fila (todos los campos y tipos):');
    console.log(JSON.stringify(pagosCapturados[0], null, 2));
    console.log('\n═══ FIN DIAGNÓSTICO — no se descargó nada. ═══');
    await browser.close();
    process.exit(0);
  }

  // ─── Detectar campos clave ────────────────────────────────
  const primera = pagosCapturados[0];
  console.log('Claves del primer ítem:', Object.keys(primera).join(', '));

  const campoId =
    Object.keys(primera).find(k => /paid_lot_id/i.test(k))
    ?? Object.keys(primera).find(k => /^lot_id$/i.test(k))
    ?? Object.keys(primera).find(k => /^id$/i.test(k));

  const campoEstado =
    Object.keys(primera).find(k => /^status$/i.test(k))
    ?? Object.keys(primera).find(k => /^estado$/i.test(k))
    ?? Object.keys(primera).find(k => /status|estado|state/i.test(k));

  if (!campoId || !campoEstado) {
    console.log('No se pudo detectar campo ID o estado. Claves:', Object.keys(primera));
    await browser.close();
    process.exit(1);
  }

  console.log(`Campo ID: "${campoId}"  |  Campo estado: "${campoEstado}"`);
  console.log('Estados únicos:', [...new Set(pagosCapturados.map(p => p[campoEstado]))].join(', '));

  let pagados = pagosCapturados.filter(p => {
    const estado = String(p[campoEstado] ?? '').toLowerCase();
    return estado.includes('pagado') || estado.includes('paid') || estado.includes('completed');
  });

  console.log(`Pagos "Pagado": ${pagados.length} de ${pagosCapturados.length} totales`);

  if (modo === 'prueba') {
    pagados = pagados.slice(0, 3);
    console.log(`MODO PRUEBA: solo los primeros ${pagados.length} pagos.`);
  }

  if (pagados.length === 0) {
    console.log('No hay pagos con estado "Pagado". Revisá los estados únicos arriba.');
    await browser.close();
    process.exit(0);
  }

  // ─── FASE 1: Generar los reportes XLS ────────────────────
  console.log('\n─── FASE 1: Generando reportes XLS ───');

  // Volver a la vista Financiero > Resumen con la primera marca activa
  await clickFinanciero();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: './fase1-antes.png', fullPage: false });
  console.log('  Screenshot: ./fase1-antes.png');

  for (let i = 0; i < pagados.length; i++) {
    const pago = pagados[i];
    const id = pago[campoId];
    const etiqueta = `[${i + 1}/${pagados.length}] ID ${id} (${pago.brand_name ?? ''})`;

    try {
      // Si la marca de este pago es distinta a la visible, cambiarla
      // (solo si tenemos marcas conocidas y la UI lo soporta)
      if (marcasEncontradas.length > 0 && pago.brand_name) {
        const brandActualUI = await page.locator('[class*="brand"], [class*="selector"]')
          .filter({ visible: true }).first().textContent({ timeout: 2000 }).catch(() => '');
        if (brandActualUI && !brandActualUI.includes(pago.brand_name)) {
          console.log(`  Cambiando a marca "${pago.brand_name}" para Fase 1...`);
          try {
            const dropBtn = page.getByText(brandActualUI.trim(), { exact: true }).filter({ visible: true }).first();
            await dropBtn.click({ timeout: 3000 });
            await page.waitForTimeout(800);
            const opcion = page.getByText(pago.brand_name, { exact: true }).filter({ visible: true }).first();
            await opcion.click({ timeout: 3000 });
            await page.waitForTimeout(500);
            const btnAp = page.getByRole('button', { name: /^aplicar$/i }).first();
            if (await btnAp.isVisible({ timeout: 1500 })) await btnAp.click();
            await page.waitForTimeout(2000);
          } catch {}
        }
      }

      if (!page.url().includes('financial')) {
        await clickFinanciero();
        await page.waitForTimeout(2000);
      }

      const celda = page.locator('td, [role="cell"]')
        .filter({ hasText: new RegExp(`^\\s*${id}\\s*$`) }).first();

      if (await celda.count() === 0) {
        console.log(`  No visible en tabla: ${etiqueta}`);
        if (i === 0) await page.screenshot({ path: './fase1-no-fila.png', fullPage: false });
        continue;
      }

      const fila = celda.locator('xpath=ancestor::tr[1]').or(
        celda.locator('xpath=ancestor::*[@role="row"][1]')
      );
      const btnDetalle = fila.locator('button, a[href], [role="button"]').last();
      await btnDetalle.click({ timeout: 5000 });
      await page.waitForTimeout(2000);

      if (i === 0) {
        await page.screenshot({ path: './fase1-detalle.png', fullPage: false });
        console.log('  Screenshot detalle: ./fase1-detalle.png');
      }

      const candidatos = [
        page.getByText('Descargar relación de ventas', { exact: false }),
        page.getByRole('button', { name: /descargar relaci/i }),
        page.getByRole('button', { name: /descargar/i }),
        page.locator('button').filter({ hasText: /descargar/i }),
      ];

      let clickOk = false;
      for (const loc of candidatos) {
        try {
          const el = loc.first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click();
            clickOk = true;
            break;
          }
        } catch {}
      }

      if (clickOk) {
        await page.waitForTimeout(1000);
        console.log(`  Solicitado ${etiqueta}`);
      } else {
        console.log(`  Sin botón "Descargar relación de ventas" — ${etiqueta}`);
      }

      const urlDetalle = page.url();
      if (urlDetalle.includes('paid-lot/detalle') || !urlDetalle.includes('financial')) {
        try { await page.goBack({ waitUntil: 'networkidle', timeout: 10000 }); } catch {}
      } else {
        try {
          const btnCerrar = page.getByRole('button', { name: /cerrar|close|volver|back/i }).first();
          if (await btnCerrar.isVisible({ timeout: 1500 })) await btnCerrar.click();
        } catch {}
      }
      await page.waitForTimeout(1000);

    } catch (err) {
      console.log(`  Error ${etiqueta}: ${err.message.split('\n')[0]}`);
    }
  }

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
