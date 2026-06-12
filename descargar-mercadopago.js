// descargar-mercadopago.js
// Descarga el reporte de liquidaciones (settlement) de la semana anterior
// desde MercadoPago Argentina en formato XLSX.
//
// Flujo:
//   1. Navega a la página de reportes.
//   2. Si ya existe un reporte XLSX para el período → lo descarga directamente.
//   3. Si no → crea uno nuevo (Crear reporte → Manual → fechas → XLSX → Generar).
//   4. Polling cada 15 s hasta que el reporte esté disponible.
//   5. Descarga a ./descargas/mercadopago-argentina/YYYY-MM-DD/
//
// Uso: node descargar-mercadopago.js

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const archivoSesion = path.resolve('./sesiones/mercadopago-argentina/sesion.json');
if (!fs.existsSync(archivoSesion)) {
  console.log('No existe sesión. Corre primero: node login-mercadopago.js');
  process.exit(1);
}

const hoyStr = new Date().toISOString().slice(0, 10);
const carpetaDescargas = path.resolve(`./descargas/mercadopago-argentina/${hoyStr}`);
fs.mkdirSync(carpetaDescargas, { recursive: true });

// ── Helpers de fecha ──────────────────────────────────────────────────────────
function semanaAnterior() {
  const hoy = new Date();
  const diasDesdeMonday = (hoy.getDay() + 6) % 7;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diasDesdeMonday - 7);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return { lunes, domingo };
}

// Formato DD/MM/YYYY para inputs de MP
function fechaDDMMYYYY(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// Formato D/mes/YYYY que usa MP en la tabla (ej: "1/jun/2026")
function fechaMPTabla(d) {
  const m = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
  return `${d.getDate()}/${m}/${d.getFullYear()}`;
}

// ── Helpers de Playwright ────────────────────────────────────────────────────
async function shot(page, nombre) {
  await page.screenshot({ path: `./${nombre}.png`, fullPage: false });
  console.log(`  Screenshot: ./${nombre}.png`);
}

async function tryClick(locator, descripcion, timeout = 4000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    await locator.first().click();
    console.log(`  OK: ${descripcion}`);
    return true;
  } catch (e) {
    console.log(`  No encontrado: ${descripcion} — ${e.message.split('\n')[0]}`);
    return false;
  }
}

const URL_REPORTES = 'https://www.mercadopago.com.ar/balance/reports/settlement_v2';

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const { lunes, domingo } = semanaAnterior();
  const labelPeriodo = `${fechaMPTabla(lunes)} a ${fechaMPTabla(domingo)}`; // "1/jun/2026 a 7/jun/2026"
  const inicioDD = fechaDDMMYYYY(lunes);
  const finDD    = fechaDDMMYYYY(domingo);
  console.log(`Período: ${lunes.toISOString().slice(0,10)} → ${domingo.toISOString().slice(0,10)}`);
  console.log(`  Tabla MP: "${labelPeriodo}"  |  Inputs: ${inicioDD} → ${finDD}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: null,
    storageState: archivoSesion,
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // ── 1. Navegar a reportes ──────────────────────────────────────────────────
  console.log('\n[1] Navegando a Reportes...');
  await page.goto(URL_REPORTES, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(3500);
  await shot(page, 'mp-1-reportes');

  // ── 2. Buscar reporte existente para el período ────────────────────────────
  console.log('\n[2] Buscando reporte existente para el período...');

  // Busca en las filas de la tabla si ya hay un reporte con el período correcto y .xlsx listo
  const reporteExistente = await page.evaluate((label) => {
    const filas = [...document.querySelectorAll('tr, [role="row"]')];
    for (const fila of filas) {
      const texto = fila.innerText || '';
      if (!texto.includes(label)) continue;
      // Buscar botón/link .xlsx dentro de la fila
      const btn = fila.querySelector('button, a');
      if (btn && !btn.disabled && !btn.hasAttribute('disabled')) {
        return { encontrado: true, texto: texto.trim().substring(0, 100) };
      }
    }
    return { encontrado: false };
  }, labelPeriodo);

  console.log(`  Reporte existente: ${JSON.stringify(reporteExistente)}`);

  if (!reporteExistente.encontrado) {
    // ── 3. Crear reporte nuevo ───────────────────────────────────────────────
    console.log('\n[3] Creando reporte nuevo...');

    // 3a. Click en "Crear reporte" (split-button)
    const btnCrear = page.getByRole('button', { name: /crear reporte/i })
      .or(page.locator('button').filter({ hasText: /crear reporte/i }));
    if (!await tryClick(btnCrear, '"Crear reporte"', 8000)) {
      await shot(page, 'mp-error-crear'); await browser.close(); process.exit(1);
    }
    await page.waitForTimeout(800);

    // 3b. Click en "Manual" del dropdown
    const btnManual = page.getByRole('menuitem', { name: /^manual$/i })
      .or(page.locator('[role="option"], li, button').filter({ hasText: /^manual$/i }))
      .or(page.getByText(/^manual$/i).first());
    if (!await tryClick(btnManual, '"Manual"', 4000)) {
      await shot(page, 'mp-error-manual'); await browser.close(); process.exit(1);
    }
    await page.waitForTimeout(2500);
    await shot(page, 'mp-3-modal');

    // Dump del modal para diagnóstico
    const modalDump = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"], [role="alertdialog"], .modal, [data-testid*="modal"], [class*="modal"], [class*="drawer"]')
        || document.querySelector('[aria-modal="true"]');
      const html = modal?.innerHTML?.substring(0, 1500) ?? 'no modal encontrado';
      const inputs = [...document.querySelectorAll('input:not([type="hidden"])')]
        .filter(el => el.offsetParent !== null)
        .map(el => `type=${el.type} ph="${el.placeholder}" name="${el.name}" aria="${el.getAttribute('aria-label')}"`);
      const btns = [...document.querySelectorAll('button')]
        .filter(el => el.offsetParent !== null)
        .map(el => `"${el.innerText?.trim()}" disabled=${el.disabled}`);
      return { html: html.substring(0, 600), inputs, btns };
    });
    console.log('  Modal inputs:', modalDump.inputs);
    console.log('  Modal buttons:', modalDump.btns.slice(0, 10));
    if (!modalDump.inputs.length) console.log('  Modal HTML snippet:', modalDump.html.substring(0, 300));

    // ── 4. Seleccionar período ───────────────────────────────────────────────
    console.log('\n[4] Seleccionando período...');

    // 4a. Intentar preset "Semana pasada" / "Personalizado" + manual dates
    const PRESETS = [/semana pasada/i, /última semana/i, /semana anterior/i];
    let periodoOk = false;
    for (const re of PRESETS) {
      const el = page.locator('button, [role="option"], [role="radio"], li, label').filter({ hasText: re }).first();
      if (await tryClick(el, `preset "${re.source}"`, 2000)) { periodoOk = true; break; }
    }

    if (!periodoOk) {
      // Intentar click en "Personalizado" y luego setear los inputs de fecha
      await tryClick(
        page.locator('button, [role="option"], li, label').filter({ hasText: /personaliz/i }).first(),
        '"Personalizado"', 2000,
      );
      await page.waitForTimeout(600);

      // Setear inputs de fecha (triple-click para seleccionar todo, luego type)
      for (const [selector, valor, desc] of [
        [
          [
            'input[placeholder*="Inicio"]', 'input[placeholder*="inicio"]',
            'input[placeholder*="Desde"]', 'input[placeholder*="desde"]',
            'input[name*="from"]', 'input[name*="start"]', 'input[name*="desde"]',
            '[aria-label*="Inicio"]', '[aria-label*="Desde"]',
          ].join(', '),
          inicioDD, 'inicio',
        ],
        [
          [
            'input[placeholder*="Fin"]', 'input[placeholder*="fin"]',
            'input[placeholder*="Hasta"]', 'input[placeholder*="hasta"]',
            'input[name*="to"]', 'input[name*="end"]', 'input[name*="hasta"]',
            '[aria-label*="Fin"]', '[aria-label*="Hasta"]',
          ].join(', '),
          finDD, 'fin',
        ],
      ]) {
        try {
          const inp = page.locator(selector).first();
          await inp.waitFor({ state: 'visible', timeout: 3000 });
          await inp.click({ clickCount: 3 });
          await inp.fill(valor);
          await page.keyboard.press('Tab');
          console.log(`  Fecha ${desc}: ${valor}`);
          periodoOk = true;
        } catch (e) {
          console.log(`  Input fecha ${desc} no encontrado: ${e.message.split('\n')[0]}`);
        }
        await page.waitForTimeout(300);
      }
    }

    await page.waitForTimeout(600);
    await shot(page, 'mp-4-periodo');

    // ── 5. Seleccionar formato XLSX ──────────────────────────────────────────
    console.log('\n[5] Seleccionando formato XLSX...');
    let xlsxOk = false;
    const xlsxCandidatos = [
      page.locator('label').filter({ hasText: /^xlsx$/i }),
      page.locator('[role="radio"]').filter({ hasText: /xlsx/i }),
      page.locator('input[type="radio"][value*="xlsx" i]'),
      page.locator('input[type="radio"][value*="excel" i]'),
      page.locator('label').filter({ hasText: /excel/i }),
      page.locator('button, li, [role="option"]').filter({ hasText: /^xlsx$/i }),
    ];
    for (const c of xlsxCandidatos) {
      if (await tryClick(c, 'XLSX', 1500)) { xlsxOk = true; break; }
    }
    if (!xlsxOk) {
      const fmtDump = await page.evaluate(() =>
        [...document.querySelectorAll('input[type="radio"], label, [role="radio"], [role="option"]')]
          .filter(el => el.offsetParent !== null)
          .map(el => el.innerText?.trim() || el.value || '').filter(Boolean)
      );
      console.log('  Opciones formato:', fmtDump);
    }
    await page.waitForTimeout(400);
    await shot(page, 'mp-5-formato');

    // ── 6. Generar ───────────────────────────────────────────────────────────
    console.log('\n[6] Generando reporte...');
    const btnGenerar = page.getByRole('button', { name: /^generar$/i })
      .or(page.getByRole('button', { name: /generar reporte/i }))
      .or(page.getByRole('button', { name: /^crear$/i }))
      .or(page.locator('button[type="submit"]').last());

    if (!await tryClick(btnGenerar, '"Generar"', 8000)) {
      // Dump botones disponibles en el modal
      const btns = await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .filter(el => el.offsetParent !== null)
          .map(el => `"${el.innerText?.trim()}" disabled=${el.disabled}`)
          .slice(0, 15)
      );
      console.log('  Botones disponibles:', btns);
      await shot(page, 'mp-error-generar');
      await browser.close(); process.exit(1);
    }
    await page.waitForTimeout(3000);
    await shot(page, 'mp-6-generando');
  }

  // ── 7. Polling: esperar reporte disponible ─────────────────────────────────
  console.log('\n[7] Esperando reporte disponible...');
  if (!page.url().includes('/reports')) {
    await page.goto(URL_REPORTES, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  const MAX_INTENTOS = 20;
  const INTERVALO_MS = 15000;
  let reporteListo = false;

  for (let i = 1; i <= MAX_INTENTOS; i++) {
    console.log(`  Intento ${i}/${MAX_INTENTOS}...`);

    const estado = await page.evaluate((label) => {
      // Buscar fila de la tabla que corresponde al período
      const filas = [...document.querySelectorAll('tr, [role="row"]')];
      for (const fila of filas) {
        const texto = fila.innerText || '';
        if (!texto.includes(label)) continue;
        // Botón de descarga habilitado en la fila
        const btn = [...fila.querySelectorAll('button, a')]
          .find(el => !el.disabled && !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (btn) return { listo: true, fila: texto.trim().substring(0, 100) };
        return { listo: false, fila: texto.trim().substring(0, 100) };
      }
      // Fallback: cualquier botón .xlsx habilitado en la página
      const xlsxBtn = [...document.querySelectorAll('button, a')]
        .find(el => {
          const txt = el.innerText?.trim();
          return (txt === '.xlsx' || txt === 'Descargar' || txt === 'descargar')
            && !el.disabled && !el.hasAttribute('disabled') && el.offsetParent !== null;
        });
      if (xlsxBtn) return { listo: true, fila: `fallback: ${xlsxBtn.innerText?.trim()}` };
      return { listo: false, fila: null };
    }, labelPeriodo);

    console.log(`  Estado: ${JSON.stringify(estado)}`);
    if (estado.listo) { reporteListo = true; break; }

    if (i < MAX_INTENTOS) {
      await page.waitForTimeout(INTERVALO_MS);
      await page.goto(URL_REPORTES, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch(e => console.log(`  Reload error: ${e.message.split('\n')[0]}`));
      await page.waitForTimeout(3000);
    }
  }

  await shot(page, 'mp-7-listo');
  if (!reporteListo) {
    console.log('\nTiempo agotado. Revisá mp-7-listo.png');
    await browser.close(); process.exit(1);
  }

  // ── 8. Descargar ──────────────────────────────────────────────────────────
  console.log('\n[8] Descargando...');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate((label) => {
      // 1) Buscar en la fila del período correcto
      const filas = [...document.querySelectorAll('tr, [role="row"]')];
      for (const fila of filas) {
        if (!(fila.innerText || '').includes(label)) continue;
        const btn = [...fila.querySelectorAll('button, a')]
          .find(el => !el.disabled && !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (btn) { btn.click(); return `fila: "${btn.innerText?.trim()}"` }
      }
      // 2) Fallback: primer .xlsx habilitado en la página
      const btn = [...document.querySelectorAll('button, a')]
        .find(el => {
          const t = el.innerText?.trim();
          return (t === '.xlsx' || t === 'Descargar')
            && !el.disabled && !el.hasAttribute('disabled') && el.offsetParent !== null;
        });
      if (btn) { btn.click(); return `fallback: "${btn.innerText?.trim()}"` }
      return 'nada clickeable';
    }, labelPeriodo),
  ]).catch(async (e) => {
    console.log(`  Download no capturado: ${e.message.split('\n')[0]}`);
    await shot(page, 'mp-error-descarga');
    return [null];
  });

  if (download?.suggestedFilename) {
    const nombre  = download.suggestedFilename() || `mercadopago-argentina-${hoyStr}.xlsx`;
    const destino = path.join(carpetaDescargas, nombre);
    await download.saveAs(destino);
    const { size } = fs.statSync(destino);
    console.log(`\nDescargado: ${nombre} (${size} bytes)`);
    console.log(`Guardado en: ${destino}`);
  } else {
    await shot(page, 'mp-error-descarga');
    console.log('\nNo se pudo descargar. Revisá mp-error-descarga.png');
    await browser.close(); process.exit(1);
  }

  await shot(page, 'mp-8-final');
  console.log(`\nListo. Carpeta: ${carpetaDescargas}`);
  await browser.close();
  process.exit(0);
})();
