// descargar-uber.js
// Genera y descarga el informe "Resumen de pagos" de la semana anterior
// para todos los establecimientos de Uber Eats Argentina.
//
// Uso: node descargar-uber.js [YYYY-MM-DD YYYY-MM-DD]
//   Sin parámetros: semana anterior (lunes–domingo).
//   Con dos fechas:  usa el rango indicado.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const archivoSesion = path.resolve('./sesiones/uber-argentina/sesion.json');
if (!fs.existsSync(archivoSesion)) {
  console.log('No existe sesión. Corre primero: node login-uber.js');
  process.exit(1);
}

const hoyStr = new Date().toISOString().slice(0, 10);
const carpetaDescargas = path.resolve(`./descargas/uber-argentina/${hoyStr}`);
fs.mkdirSync(carpetaDescargas, { recursive: true });

// Semana anterior: lunes a domingo
function semanaAnterior() {
  const hoy = new Date();
  const diasDesdeMonday = (hoy.getDay() + 6) % 7;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diasDesdeMonday - 7);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return { lunes, domingo };
}

function parsearFecha(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [anio, mes, dia] = str.split('-').map(Number);
  const d = new Date(anio, mes - 1, dia);
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

const [argInicio, argFin] = [process.argv[2], process.argv[3]];
if ((argInicio && !argFin) || (!argInicio && argFin)) {
  console.log('Error: debés pasar ambas fechas o ninguna.\nEjemplo: node descargar-uber.js 2026-06-01 2026-06-07');
  process.exit(1);
}

let fechaInicio, fechaFin, origenFechas;
if (argInicio) {
  fechaInicio = parsearFecha(argInicio);
  fechaFin    = parsearFecha(argFin);
  if (!fechaInicio) { console.log(`Error: fecha de inicio inválida: "${argInicio}". Formato esperado: YYYY-MM-DD`); process.exit(1); }
  if (!fechaFin)    { console.log(`Error: fecha de fin inválida: "${argFin}". Formato esperado: YYYY-MM-DD`);    process.exit(1); }
  origenFechas = 'parámetros';
} else {
  const sa = semanaAnterior();
  fechaInicio  = sa.lunes;
  fechaFin     = sa.domingo;
  origenFechas = 'semana anterior calculada';
}

async function shot(page, nombre) {
  await page.screenshot({ path: `./${nombre}.png`, fullPage: false });
  console.log(`  Screenshot: ./${nombre}.png`);
}

// Clickea un elemento si es visible; retorna true si lo encontró
async function tryClick(locator, descripcion, timeout = 3000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    await locator.first().click();
    console.log(`  OK: ${descripcion}`);
    return true;
  } catch {
    console.log(`  No encontrado: ${descripcion}`);
    return false;
  }
}

(async () => {
  const inicioStr = fechaInicio.toISOString().slice(0, 10);
  const finStr    = fechaFin.toISOString().slice(0, 10);
  console.log(`Rango: ${inicioStr} → ${finStr} (${origenFechas})`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({
    viewport: null,
    storageState: archivoSesion,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // ── 1. Ir a Informes ──────────────────────────────────────────────────────
  console.log('\n[1] Navegando a Informes...');
  await page.goto('https://merchants.ubereats.com/manager/reports', {
    waitUntil: 'domcontentloaded', timeout: 40000,
  });
  await page.waitForTimeout(4000);
  await shot(page, 'uber-1-informes');

  // ── 2. Crear informe ──────────────────────────────────────────────────────
  console.log('\n[2] Clic en "Crear informe"...');
  const btnCrear = page.getByRole('button', { name: /crear informe/i });
  await btnCrear.waitFor({ state: 'visible', timeout: 10000 });
  await btnCrear.click();
  await page.waitForTimeout(3000);
  await shot(page, 'uber-2-formulario');

  // ── 3. Tipo de informe: primer checkbox visible en la sección ───────────────
  console.log('\n[3] Seleccionando tipo de informe...');
  // Expandir el acordeón Pagos para que aparezcan los checkboxes
  await page.locator('[data-testid="category-icon-wrapper-pagos"]').click();
  await page.waitForTimeout(1500);

  // Buscar por nombre en orden de prioridad; fallback al primer checkbox visible
  const NOMBRES_TIPO = [
    'Detalles de ganancias',
    'Detalles de pagos',
    'Detalles del pago',
    'Pagos',
    'Ganancias',
  ];

  const clickedTipo = await page.evaluate((nombres) => {
    // Función helper: dado un <p> con texto, navega al label/input del mismo row
    function clickCheckboxDeP(p) {
      const divTexto = p.parentElement;        // div hermano del label
      const divRow   = divTexto?.parentElement; // div fila que contiene [label, divTexto]
      const label = divRow?.querySelector('label[data-baseweb="checkbox"]')
                 || divRow?.querySelector('label');
      if (label) { label.click(); return true; }
      const inp = divRow?.querySelector('input[type="checkbox"]');
      if (inp)   { inp.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
      return false;
    }

    // 1) Buscar por nombres prioritarios (en p, div, span)
    for (const nombre of nombres) {
      const el = [...document.querySelectorAll('p, div, span')]
        .find(e => e.childElementCount === 0 &&
                   e.innerText?.trim().toLowerCase() === nombre.toLowerCase());
      if (el && clickCheckboxDeP(el)) return `OK: "${nombre}"`;
    }

    // 2) Fallback: primer checkbox visible dentro del wrapper del tipo de informe
    const wrapper = document.querySelector('[data-testid="reports-menu-wrapper"]');
    if (wrapper) {
      const checks = [...wrapper.querySelectorAll('input[type="checkbox"]')]
        .filter(el => el.offsetParent !== null); // solo visibles
      if (checks.length > 0) {
        checks[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        // También hacer clic en el label padre si existe
        const lbl = checks[0].closest('label');
        if (lbl) lbl.click();
        const textoP = checks[0].closest('div')?.parentElement?.querySelector('p');
        return `OK fallback: "${textoP?.innerText?.trim() || 'primer checkbox'}"`;
      }
    }

    // Debug: listar todos los <p> disponibles
    const ps = [...document.querySelectorAll('p')].map(e => e.innerText?.trim()).filter(Boolean);
    return `no encontrado. p[] = ${JSON.stringify(ps.slice(0, 8))}`;
  }, NOMBRES_TIPO);

  console.log(`  Tipo seleccionado: ${clickedTipo}`);
  if (!clickedTipo.startsWith('OK')) {
    await shot(page, 'uber-error-tipo');
    await browser.close(); process.exit(1);
  }
  await page.waitForTimeout(800);
  await shot(page, 'uber-3-tipo');

  // ── 4. Establecimientos: Seleccionar todos ────────────────────────────────
  console.log('\n[4] Seleccionando establecimientos...');
  // Abrir el dropdown del formulario (tiene aria-haspopup y el span con data-testid)
  const dropEstab = page.locator('[aria-haspopup="true"]').filter({
    has: page.locator('[data-testid="page-level-store-selector-dropdown-label"]'),
  });
  await tryClick(dropEstab, 'Dropdown establecimientos');
  await page.waitForTimeout(1500);
  await shot(page, 'uber-4-estab-abierto');

  await tryClick(page.getByText(/seleccionar todos/i).first(), '"Seleccionar todos"');
  await page.waitForTimeout(600);
  await tryClick(page.getByRole('button', { name: /^solicitar$/i }), '"Solicitar"');
  await page.waitForTimeout(1500);
  await shot(page, 'uber-5-estab-ok');

  // ── 5. Intervalo de fechas ────────────────────────────────────────────────
  console.log('\n[5] Seleccionando intervalo de fechas...');

  // El date picker es un input[placeholder*="YYYY"] que abre un calendario con role="gridcell"
  const inputFechaInicio = page.locator('input[placeholder*="YYYY"]').first();
  await inputFechaInicio.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'uber-5b-antes-fecha');

  await inputFechaInicio.click({ timeout: 6000 });
  console.log('  Click fecha inicio OK');
  await page.waitForTimeout(1800);

  // Screenshot fullPage para ver el calendario abierto
  await page.screenshot({ path: './uber-6-calendario.png', fullPage: true });
  console.log('  Screenshot fullPage: ./uber-6-calendario.png');

  // Verificar que el calendario se abrió
  const calAbierto = await page.evaluate(() => {
    const cal = document.querySelector('[data-baseweb="calendar"]');
    if (!cal) return 'no encontrado';
    const cells = [...cal.querySelectorAll('[role="gridcell"]')].map(e => e.innerText?.trim()).filter(Boolean);
    const ariaLabels = [...cal.querySelectorAll('[role="gridcell"][aria-label]')]
      .map(e => e.getAttribute('aria-label')).filter(Boolean).slice(0, 4);
    return `OK: ${cells.length} celdas. aria-labels: ${JSON.stringify(ariaLabels)}`;
  });
  console.log(`  Calendario: ${calAbierto}`);

  // Función para clickear un día específico en el calendario
  async function clickDia(fecha, descripcion) {
    const dia = fecha.getDate();
    const mes = fecha.getMonth(); // 0-indexed
    const anio = fecha.getFullYear();

    // 1) Por aria-label (formato BaseWeb en es-AR)
    const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio',
                      'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const ariaFormats = [
      `${dia} de ${MESES_ES[mes]} de ${anio}`,
      `${String(mes+1).padStart(2,'0')}/${String(dia).padStart(2,'0')}/${anio}`,
      `${anio}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`,
    ];
    for (const fmt of ariaFormats) {
      const el = page.locator(`[role="gridcell"][aria-label="${fmt}"]`).first();
      if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
        await el.click();
        console.log(`  Clicked ${descripcion} (${dia}) via aria-label "${fmt}"`);
        return true;
      }
    }

    // 2) JS: buscar gridcell con texto exacto del día en el calendario
    const res = await page.evaluate((d) => {
      const cal = document.querySelector('[data-baseweb="calendar"]') || document.body;
      const cells = [...cal.querySelectorAll('[role="gridcell"]')]
        .filter(el => el.offsetParent !== null && el.innerText?.trim() === String(d));
      if (cells.length > 0) {
        cells[0].click();
        return `clicked gridcell "${d}" (${cells.length} found)`;
      }
      // Fallback: cualquier elemento leaf con el número
      const all = [...cal.querySelectorAll('*')]
        .filter(el => el.childElementCount === 0 && el.offsetParent !== null &&
                      el.innerText?.trim() === String(d));
      if (all.length > 0) {
        all[0].click();
        return `clicked leaf "${d}" in ${all[0].tagName}`;
      }
      return `día ${d} no encontrado`;
    }, dia);
    console.log(`  ${descripcion}: ${res}`);
    return res.startsWith('clicked');
  }

  const diaInicioOk = await clickDia(fechaInicio, 'inicio');
  await page.waitForTimeout(800);

  // Después del primer click, el calendario debería seguir abierto para el fin
  const calAun = await page.locator('[data-baseweb="calendar"]').isVisible({ timeout: 1000 }).catch(() => false);
  if (!calAun) {
    // Calendario cerró: abrir el input de fecha fin
    console.log('  Calendario cerró tras lunes. Abriendo fecha fin...');
    const inputFechaFin = page.locator('input[placeholder*="YYYY"]').last();
    await inputFechaFin.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await clickDia(fechaFin, 'fin');
  await page.waitForTimeout(800);
  await shot(page, 'uber-7-fechas');

  // ── 6. Enviar formulario ──────────────────────────────────────────────────
  console.log('\n[6] Enviando formulario...');
  // Buscar "Generar", "Crear informe", o cualquier botón de submit habilitado al final
  const btnSubmit = page.getByRole('button', {
    name: /^(generar|crear informe|generate|create|enviar)$/i,
  }).last();
  const countBtns = await btnSubmit.count();
  console.log(`  Botón submit encontrado: ${countBtns}`);
  await btnSubmit.click({ timeout: 10000 }).catch(async (e) => {
    console.log(`  Submit falló: ${e.message.split('\n')[0]}`);
    await shot(page, 'uber-error-submit');
    await browser.close(); process.exit(1);
  });
  await page.waitForTimeout(4000);
  await shot(page, 'uber-8-enviado');

  // ── 7. Esperar el informe en la pestaña "Disponible" ─────────────────────
  console.log('\n[7] Esperando que el informe esté disponible...');
  // Puede que ya redirigió a la lista; si no, navegar
  const urlActual = page.url();
  if (!urlActual.includes('/reports')) {
    await page.goto('https://merchants.ubereats.com/manager/reports', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(3000);
  }

  const MAX_INTENTOS = 20;   // 20 × 15 s = 5 minutos
  const INTERVALO_MS = 15000;
  let reporteListo = false;

  for (let i = 1; i <= MAX_INTENTOS; i++) {
    console.log(`  Intento ${i}/${MAX_INTENTOS}...`);

    // Buscar botón "Descargar" habilitado (button o link) — el primero de la lista
    const btnDescRaw = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, a')]
        .filter(el => {
          const txt = el.innerText?.trim().toLowerCase();
          return (txt === 'descargar' || txt === 'download') && el.offsetParent !== null;
        });
      if (candidates.length === 0) return null;
      // Preferir el que NO esté deshabilitado
      const enabled = candidates.find(el => !el.disabled && !el.hasAttribute('disabled'));
      const target = enabled || candidates[0];
      return {
        disabled: target.disabled || target.hasAttribute('disabled'),
        tag: target.tagName,
        href: target.href || null,
        count: candidates.length,
      };
    });
    console.log(`  Botones Descargar: ${JSON.stringify(btnDescRaw)}`);

    if (btnDescRaw && !btnDescRaw.disabled) {
      console.log('  Reporte disponible.');
      reporteListo = true;
      break;
    }

    if (i < MAX_INTENTOS) {
      await page.waitForTimeout(INTERVALO_MS);
      await page.goto('https://merchants.ubereats.com/manager/reports', {
        waitUntil: 'domcontentloaded', timeout: 30000,
      }).catch(e => console.log(`  Navegación error: ${e.message.split('\n')[0]}`));
      await page.waitForTimeout(3000);
    }
  }

  if (!reporteListo) {
    await shot(page, 'uber-timeout');
    console.log('\nTiempo agotado. El informe puede tardar más. Revisá uber-timeout.png');
    await browser.close();
    process.exit(1);
  }

  await shot(page, 'uber-9-listo');

  // ── 8. Descargar ──────────────────────────────────────────────────────────
  console.log('\n[8] Descargando...');
  await shot(page, 'uber-9-listo');

  let descargado = false;

  // Click en el primer botón/link "Descargar" habilitado
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, a')]
        .filter(el => {
          const txt = el.innerText?.trim().toLowerCase();
          return (txt === 'descargar' || txt === 'download') && el.offsetParent !== null &&
                 !el.disabled && !el.hasAttribute('disabled');
        });
      if (candidates[0]) { candidates[0].click(); return true; }
      return false;
    }),
  ]).catch(async (e) => {
    console.log(`  Download event timeout: ${e.message.split('\n')[0]}`);
    // Fallback: intentar via link href directo
    const href = await page.evaluate(() => {
      const a = document.querySelector('a[href*=".xlsx"], a[href*=".csv"], a[href*="download"]');
      return a?.href || null;
    });
    if (href) {
      console.log(`  Fallback: navegando a ${href.substring(0, 80)}`);
      await page.goto(href);
    }
    return [null, null];
  });

  if (download && download.suggestedFilename) {
    const nombre = download.suggestedFilename() || `uber-argentina-${hoyStr}.xlsx`;
    const destino = path.join(carpetaDescargas, nombre);
    await download.saveAs(destino);
    const { size } = fs.statSync(destino);
    console.log(`\nDescargado: ${nombre} (${size} bytes)`);
    console.log(`Guardado en: ${destino}`);
    descargado = true;
  } else {
    await shot(page, 'uber-error-descarga');
    console.log('\nNo se pudo descargar automáticamente. Revisá uber-error-descarga.png');
  }

  console.log(`\nListo. Archivo en: ${carpetaDescargas}`);
  await browser.close();
  process.exit(0);
})();
