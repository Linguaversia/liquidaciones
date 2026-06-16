// descargar.js
// Reutiliza la sesión guardada por login.js y descarga el .zip
// del período "ÚLTIMA" de cada local.
//
// Uso:
//   node descargar.js argentina prueba    -> solo los primeros 3 locales (para probar)
//   node descargar.js argentina           -> todos los locales
//
// Los archivos caen en ./descargas/<PAIS>/<fecha_de_hoy>/

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CARPETA_DESCARGAS } = require('./config');

const pais = process.argv[2];
const modo = process.argv[3]; // "prueba" o vacío

if (!pais) {
  console.log('Falta el país. Ejemplo:  node descargar.js argentina prueba');
  process.exit(1);
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

  let locales = capturado.map((c) => ({
    id: c.id,
    nombre: c.referenceName || c.companyName || c.name || String(c.id),
  }));

  console.log(`Se encontraron ${locales.length} locales.`);

  if (modo === 'prueba') {
    locales = locales.slice(0, 3);
    console.log(`MODO PRUEBA: solo los primeros ${locales.length} locales.`);
  }

  // --- Paso 2: recorrer cada local y descargar el ZIP de "ÚLTIMA" ---
  let ok = 0;
  const fallos = [];
  let screenshotFalloTomado = false;

  for (let i = 0; i < locales.length; i++) {
    const local = locales[i];
    const etiqueta = `[${i + 1}/${locales.length}] ${local.nombre} (${local.id})`;
    try {
      await page.goto(
        `https://portal-app.pedidosya.com/finance-py/contracts/${local.id}/account-statuses?page=1`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );

      // Esperar a que aparezca el badge ÚLTIMA
      const badgeUltima = page.locator(':text("ÚLTIMA")').first();
      await badgeUltima.waitFor({ timeout: 30000 });

      // El botón de descarga del estado de cuenta está en la misma fila (tr)
      const filaUltima = badgeUltima.locator('xpath=ancestor::tr[1]');
      const botonDescarga = filaUltima.locator('[aria-label="downloadAccountStatus"]');

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
        const screenshotPath = './diagnostico-fallo-ultima.png';
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  Screenshot del primer fallo: ${screenshotPath}`);
        screenshotFalloTomado = true;
      }
      fallos.push(local);
    }
  }

  console.log(`\nListo. Descargados: ${ok}. Fallos: ${fallos.length}.`);
  if (fallos.length) {
    console.log('Locales con error:', fallos.map((f) => f.id).join(', '));
  }
  console.log(`Archivos en: ${carpetaDescargas}`);

  await browser.close();
  process.exit(0);
})();
