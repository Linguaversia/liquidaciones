// descargar.js
// Reutiliza la sesión guardada por login.js y descarga el .zip
// del período "ÚLTIMA" de cada local.
//
// Uso:
//   node descargar.js argentina prueba              -> solo los primeros 3 locales (para probar)
//   node descargar.js argentina                     -> todos los locales
//   node descargar.js chile reintentar 127276,414520 -> solo los IDs indicados (reintento puntual)
//
// Los archivos caen en ./descargas/<PAIS>/<fecha_de_hoy>/

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CARPETA_DESCARGAS } = require('./config');

// --- Parseo de argumentos ---
//   argv[2] = pais     (argentina / chile)  [obligatorio]
//   argv[3] = modo     ("prueba" | "reintentar" | vacío)
//   argv[4] = idsArg   (lista de IDs separados por coma; solo para "reintentar")
const pais = process.argv[2];
const modo = process.argv[3]; // "prueba", "reintentar" o vacío
const idsArg = process.argv[4]; // lista de IDs solo si modo === "reintentar"

if (!pais) {
  console.log('Falta el país. Ejemplo:  node descargar.js argentina prueba');
  process.exit(1);
}

// En modo reintentar: validar y parsear la lista de IDs antes de abrir el navegador.
let idsReintentar = null;
if (modo === 'reintentar') {
  if (!idsArg) {
    console.log('Falta la lista de IDs para reintentar.');
    console.log('Ejemplo:  node descargar.js chile reintentar 127276,414520,140349');
    process.exit(1);
  }

  const partes = idsArg.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const invalidos = partes.filter((s) => !/^\d+$/.test(s));
  if (invalidos.length) {
    console.log(`IDs inválidos (deben ser solo números): ${invalidos.join(', ')}`);
    console.log('Ejemplo:  node descargar.js chile reintentar 127276,414520,140349');
    process.exit(1);
  }
  if (partes.length === 0) {
    console.log('No se reconoció ningún ID en la lista. Ejemplo:  node descargar.js chile reintentar 127276,414520');
    process.exit(1);
  }

  // Deduplicar conservando el orden
  idsReintentar = [...new Set(partes)];
}

const archivoSesion = path.resolve(`./sesiones/${pais}.json`);
if (!fs.existsSync(archivoSesion)) {
  console.log(`No existe sesión para "${pais}". Corre primero: node login.js ${pais}`);
  process.exit(1);
}

if (!fs.existsSync(CARPETA_DESCARGAS)) {
  console.log(`ERROR: la carpeta de descargas no existe: "${CARPETA_DESCARGAS}"`);
  console.log('Verificá que Google Drive esté sincronizado y la carpeta exista.');
  process.exit(1);
}

const hoy = new Date().toISOString().slice(0, 10);
const carpetaDescargas = path.join(CARPETA_DESCARGAS, pais, hoy);
fs.mkdirSync(carpetaDescargas, { recursive: true });

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

  let locales;

  if (modo === 'reintentar') {
    // --- Modo reintentar: NO se obtiene la lista completa del endpoint /contracts.
    // Se procesan solo los IDs indicados, con la misma lógica de descarga.
    locales = idsReintentar.map((id) => ({ id, nombre: String(id) }));
    console.log(`MODO REINTENTAR: procesando ${locales.length} local(es): ${idsReintentar.join(', ')}`);
  } else {
    // --- Paso 1: cargar /finance-py para que dispare el fetch de contratos ---
    console.log('Obteniendo lista de locales...');

    let capturado = null;
    page.on('response', async (response) => {
      if (capturado) return;
      const url = response.url();
      if (!url.includes('management-api.pedidosya.com/v1/partners/contracts')) return;
      try {
        const json = await response.json();
        const lista = Array.isArray(json) ? json
          : Array.isArray(json?.data) ? json.data
          : Array.isArray(json?.contracts) ? json.contracts
          : null;
        if (lista && lista.length > 0) {
          console.log(`  Contratos: ${url} (${lista.length} items)`);
          capturado = lista;
        }
      } catch {}
    });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('management-api.pedidosya.com/v1/partners/contracts'),
        { timeout: 30000 }
      ).catch(() => {}),
      page.goto('https://portal-app.pedidosya.com/finance-py', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }),
    ]);

    // Dar tiempo a que el listener procese la respuesta si llegó justo al mismo tiempo
    if (!capturado) await page.waitForTimeout(3000);

    if (!capturado) {
      console.log('No se encontró la lista de contratos. ¿La sesión está activa?');
      await browser.close();
      process.exit(1);
    }

    locales = capturado.map((c) => ({
      id: c.id,
      nombre: c.referenceName || c.companyName || c.name || String(c.id),
    }));

    console.log(`Se encontraron ${locales.length} locales.`);

    if (modo === 'prueba') {
      locales = locales.slice(0, 3);
      console.log(`MODO PRUEBA: solo los primeros ${locales.length} locales.`);
    }
  }

  // --- Paso 2: recorrer cada local y descargar el ZIP más reciente ---
  let ok = 0;
  const fallos = [];            // fallos reales (red/sesión caída/timeout)
  const sinLiquidaciones = [];  // contratos sin estados de cuenta (caso esperable, NO es error)
  let screenshotFalloTomado = false;

  for (let i = 0; i < locales.length; i++) {
    const local = locales[i];
    const etiqueta = `[${i + 1}/${locales.length}] ${local.nombre} (${local.id})`;
    try {
      await page.goto(
        `https://portal-app.pedidosya.com/finance-py/contracts/${local.id}/account-statuses?page=1`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );

      // Distinguir tres estados posibles de la página (carrera: gana lo que aparezca primero):
      //   - aparece el botón de descarga          -> el contrato TIENE liquidaciones
      //   - aparece el mensaje "no tienes liquidaciones disponibles" -> contrato SIN estados de cuenta
      //   - no aparece ninguno en el tiempo límite -> fallo real (red caída / sesión vencida)
      // Un contrato vacío se detecta apenas renderiza el mensaje (rápido), sin esperar 30 s.
      const estado = await Promise.race([
        page.locator('[aria-label="downloadAccountStatus"]').first()
          .waitFor({ timeout: 30000 }).then(() => 'con_liquidaciones'),
        page.locator(':text("no tienes liquidaciones disponibles")').first()
          .waitFor({ timeout: 30000 }).then(() => 'sin_liquidaciones'),
      ]).catch(() => null);

      if (estado === 'sin_liquidaciones') {
        console.log(`  SIN LIQUIDACIONES  ${etiqueta}`);
        sinLiquidaciones.push(local);
        continue; // caso esperable: no es error, pasamos al siguiente
      }

      if (estado === null) {
        // Ni botón ni mensaje: esto sí es un problema real (red/sesión).
        throw new Error('Timeout: no apareció el botón de descarga ni el mensaje de "sin liquidaciones"');
      }

      // estado === 'con_liquidaciones' -> continuar con la descarga.
      // Intentar fila "ÚLTIMA" (Argentina); si no existe en 3 s → primera fila (Chile)
      let botonDescarga;
      try {
        const badgeUltima = page.locator(':text("ÚLTIMA")').first();
        await badgeUltima.waitFor({ timeout: 3000 });
        const filaUltima = badgeUltima.locator('xpath=ancestor::tr[1]');
        botonDescarga = filaUltima.locator('[aria-label="downloadAccountStatus"]');
      } catch {
        // Sin etiqueta "ÚLTIMA" (ej. Chile): primera fila = la más reciente
        botonDescarga = page.locator('[aria-label="downloadAccountStatus"]').first();
      }

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        botonDescarga.click(),
      ]);

      const nombreSugerido = download.suggestedFilename();
      await download.saveAs(path.join(carpetaDescargas, nombreSugerido));

      console.log(`  OK  ${etiqueta} -> ${nombreSugerido}`);
      ok++;
    } catch (err) {
      console.log(`  ERROR ${etiqueta}: ${err.message.split('\n')[0]}`);
      if (!screenshotFalloTomado) {
        const screenshotPath = './diagnostico-fallo-descarga.png';
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  Screenshot del primer fallo: ${screenshotPath}`);
        screenshotFalloTomado = true;
      }
      fallos.push(local);
    }
  }

  console.log(`\nListo.`);
  console.log(`Descargados: ${ok}.`);
  console.log(`Sin liquidaciones: ${sinLiquidaciones.length}.`);
  if (sinLiquidaciones.length) {
    console.log('  IDs sin liquidaciones:', sinLiquidaciones.map((f) => f.id).join(', '));
  }
  console.log(`Fallos reales: ${fallos.length}.`);
  if (fallos.length) {
    console.log('  IDs con fallo real (reintentar):', fallos.map((f) => f.id).join(', '));
  }
  console.log(`Archivos en: ${carpetaDescargas}`);

  await browser.close();
  process.exit(0);
})();
