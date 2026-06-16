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
// Uso: node descargar-mercadopago.js [YYYY-MM-DD YYYY-MM-DD]
//   Sin parámetros: semana anterior (lunes–domingo).
//   Con dos fechas:  usa el rango indicado.

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

function parsearFecha(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [anio, mes, dia] = str.split('-').map(Number);
  const d = new Date(anio, mes - 1, dia);
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

const [argInicio, argFin] = [process.argv[2], process.argv[3]];
if ((argInicio && !argFin) || (!argInicio && argFin)) {
  console.log('Error: debés pasar ambas fechas o ninguna.\nEjemplo: node descargar-mercadopago.js 2026-06-01 2026-06-07');
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
  const labelPeriodo = `${fechaMPTabla(fechaInicio)} a ${fechaMPTabla(fechaFin)}`;
  console.log(`Rango: ${fechaInicio.toISOString().slice(0,10)} → ${fechaFin.toISOString().slice(0,10)} (${origenFechas})`);
  console.log(`  Label MP: "${labelPeriodo}"`);

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

    // ── 4. Seleccionar período en el calendario ──────────────────────────────
    console.log('\n[4] Seleccionando período en el calendario...');
    await shot(page, 'mp-4a-calendario-inicial');

    const MESES_ES_CAL = ['enero','febrero','marzo','abril','mayo','junio',
                          'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const MESES_ABREV  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    // Abre el selector mes/año (clic en cabecera "Junio 2026" / flecha ⌄),
    // ajusta el año con sus flechas ‹ › y elige el mes abreviado.
    async function navegarAMes(targetMes, targetAnio, label) {
      console.log(`  Navegando a ${MESES_ES_CAL[targetMes]} ${targetAnio} (${label})...`);

      // 1. Abrir el selector haciendo clic en la cabecera mes/año o en la flecha ⌄
      const abrioSelector = await page.evaluate((meses) => {
        const visibles = [...document.querySelectorAll('button, [role="button"], span, div, p')]
          .filter(el => el.offsetParent !== null);
        // a) Aria-label que sugiera selector de mes/año
        for (const pat of [/seleccionar mes/i, /select month/i, /abrir selector/i, /month.*year/i]) {
          const b = visibles.find(el => pat.test(el.getAttribute('aria-label') || ''));
          if (b) { b.click(); return `aria: "${b.getAttribute('aria-label')}"` }
        }
        // b) Elemento cuyo texto contenga nombre de mes en español + año de 4 dígitos
        for (const el of visibles) {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (meses.some(m => txt.includes(m)) && /\d{4}/.test(txt)) {
            el.click(); return `cabecera: "${(el.innerText || el.textContent || '').trim()}"`;
          }
        }
        // c) Elemento con ⌄ / ▼ (la flechita al lado del mes)
        for (const ch of ['⌄','▼','∨']) {
          const b = visibles.find(el => el.textContent?.trim() === ch);
          if (b) { b.click(); return `flecha: "${ch}"` }
        }
        // d) Clase que sugiera dropdown / chevron
        const drop = visibles.find(el =>
          /chevron|dropdown|toggle|caret/i.test([...el.classList].join(' '))
        );
        if (drop) { drop.click(); return `clase: "${[...drop.classList].join(' ')}"` }
        return null;
      }, MESES_ES_CAL);

      if (!abrioSelector) {
        console.log('  ERROR: no encontré cómo abrir el selector de mes/año');
        return false;
      }
      console.log(`  Selector abierto via: ${abrioSelector}`);
      await page.waitForTimeout(800);
      await shot(page, `mp-nav-${label}-selector`);

      // 2. Ajustar el año con las flechas ‹ › propias del selector
      for (let i = 0; i < 12; i++) {
        const anioActual = await page.evaluate(() => {
          // MP usa <span aria-hidden="true">2026</span>; buscar por textContent sin filtrar por visibilidad
          for (const el of document.querySelectorAll('span[aria-hidden="true"], span')) {
            const txt = (el.textContent || '').trim();
            if (/^\d{4}$/.test(txt)) return parseInt(txt);
          }
          // Fallback: cualquier elemento cuyo textContent sea exactamente 4 dígitos
          for (const el of document.querySelectorAll('*')) {
            const txt = (el.textContent || '').trim();
            if (/^\d{4}$/.test(txt)) return parseInt(txt);
          }
          return null;
        });
        if (anioActual === null) {
          console.log('  No se pudo leer el año; asumiendo año correcto, continuando al mes...');
          break;
        }
        console.log(`  Año en selector: ${anioActual}`);
        if (anioActual === targetAnio) break;

        const avanzar = targetAnio > anioActual;
        const clickadoAnio = await page.evaluate((av) => {
          const btns = [...document.querySelectorAll('button, [role="button"]')]
            .filter(el => el.offsetParent !== null);
          for (const pat of (av
            ? [/siguiente año/i, /next year/i, /siguiente/i, /next/i]
            : [/año anterior/i, /prev(ious)? year/i, /anterior/i, /prev/i])) {
            const b = btns.find(el => pat.test(el.getAttribute('aria-label') || ''));
            if (b) { b.click(); return `aria: "${b.getAttribute('aria-label')}"` }
          }
          for (const ch of (av ? ['›','»','>','▶','→'] : ['‹','«','<','◀','←'])) {
            const b = btns.find(el => el.textContent?.trim() === ch);
            if (b) { b.click(); return `"${ch}"` }
          }
          return null;
        }, avanzar);
        if (!clickadoAnio) { console.log('  ERROR: no encontré flecha de año'); return false; }
        console.log(`  Año (${avanzar ? '→' : '←'}): ${clickadoAnio}`);
        await page.waitForTimeout(400);
      }
      await shot(page, `mp-nav-${label}-anio`);

      // 3. Hacer clic en el mes abreviado (Ene, Feb, … Dic)
      const mesAbrev = MESES_ABREV[targetMes];
      const clickadoMes = await page.evaluate((abrev) => {
        const candidatos = [...document.querySelectorAll(
          'button, [role="button"], [role="option"], td, span, div, li'
        )].filter(el => el.offsetParent !== null);
        const exacto = candidatos.find(el => el.innerText?.trim() === abrev);
        if (exacto) { exacto.click(); return `exacto: "${abrev}"` }
        const ci = candidatos.find(el => el.innerText?.trim().toLowerCase() === abrev.toLowerCase());
        if (ci) { ci.click(); return `ci: "${ci.innerText?.trim()}"` }
        const cortos = [...new Set(
          candidatos.map(el => el.innerText?.trim()).filter(t => t && t.length <= 5)
        )];
        return `no encontrado. Textos cortos: ${JSON.stringify(cortos.slice(0, 20))}`;
      }, mesAbrev);

      console.log(`  Mes "${mesAbrev}": ${clickadoMes}`);
      if (!clickadoMes.startsWith('exacto') && !clickadoMes.startsWith('ci')) {
        await shot(page, `mp-nav-${label}-error-mes`);
        return false;
      }
      await page.waitForTimeout(800);
      await shot(page, `mp-nav-${label}-mes-clickeado`);

      // 4. Verificar que la grilla de días volvió a mostrarse
      const hayDiasVisibles = async () => {
        const n = await page.evaluate(() =>
          [...document.querySelectorAll('[role="gridcell"], td')]
            .filter(el => el.offsetParent !== null && /^\d+$/.test(el.innerText?.trim() || ''))
            .length
        );
        return n > 0;
      };

      if (!await hayDiasVisibles()) {
        // El selector de meses sigue abierto; cerrarlo con el mismo toggle que lo abrió
        console.log('  Selector de meses sigue visible. Intentando cerrarlo...');
        await page.evaluate((meses) => {
          const visibles = [...document.querySelectorAll('button, [role="button"], span, div, p')]
            .filter(el => el.offsetParent !== null);
          // Aria-label de toggle / cerrar
          for (const pat of [/seleccionar mes/i, /select month/i, /toggle/i, /cerrar/i, /close/i]) {
            const b = visibles.find(el => pat.test(el.getAttribute('aria-label') || ''));
            if (b) { b.click(); return; }
          }
          // Cabecera mes+año (mismo criterio que para abrirlo)
          for (const el of visibles) {
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (meses.some(m => txt.includes(m)) && /\d{4}/.test(txt)) { el.click(); return; }
          }
        }, MESES_ES_CAL);
        await page.waitForTimeout(800);
      }

      await shot(page, `mp-nav-${label}-ok`);
      const diasOk = await hayDiasVisibles();
      console.log(`  Días visibles tras navegar: ${diasOk}`);
      return diasOk;
    }

    // Hace clic en un día específico buscando por aria-label completo (incluye mes y año).
    // Nunca clickea un día disabled. Si el calendario está en el mes equivocado, navega
    // con las flechas ‹ › del calendario hasta encontrar el día correcto habilitado.
    async function clickDiaMP(fecha, descripcion) {
      const dia  = fecha.getDate();
      const mes  = fecha.getMonth();
      const anio = fecha.getFullYear();
      const textoObj = `${dia} de ${MESES_ES_CAL[mes]} de ${anio}`;
      console.log(`  Buscando "${textoObj}" (${descripcion})...`);

      // Busca el día por aria-label en la vista actual; informa si está disabled o ausente
      const buscarDia = () => page.evaluate((obj) => {
        const candidatos = [...document.querySelectorAll(
          'button.andes-datepicker__day, [role="gridcell"] button, [role="gridcell"], td button, td'
        )].filter(el => el.offsetParent !== null);
        for (const btn of candidatos) {
          const aria = btn.getAttribute('aria-label') || '';
          if (!aria.includes(obj)) continue;
          const celda = btn.closest('td') || btn.closest('[role="gridcell"]') || btn;
          const disabled =
            btn.classList.contains('andes-datepicker__cell--disabled') ||
            btn.hasAttribute('disabled') ||
            celda.classList.contains('andes-datepicker__cell--disabled');
          return { encontrado: true, disabled, aria };
        }
        return { encontrado: false, disabled: false, aria: null };
      }, textoObj);

      // Lee el mes/año actual del calendario leyendo aria-labels de celdas de días
      const leerMesCalendario = () => page.evaluate((meses) => {
        const celdas = [...document.querySelectorAll(
          'button.andes-datepicker__day, [role="gridcell"] button, [role="gridcell"], td'
        )].filter(el => el.offsetParent !== null);
        for (const el of celdas) {
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          for (let m = 0; m < 12; m++) {
            if (aria.includes(meses[m])) {
              const y = aria.match(/\d{4}/);
              if (y) return { mes: m, anio: parseInt(y[0]) };
            }
          }
        }
        return null;
      }, MESES_ES_CAL);

      // Navega un mes con las flechas del calendario (no el selector de mes/año)
      const navegarUnMes = (atras) => page.evaluate((at) => {
        const btns = [...document.querySelectorAll('button, [role="button"]')]
          .filter(el => el.offsetParent !== null);
        const pats = at
          ? [/mes anterior/i, /previous month/i, /anterior/i, /prev/i]
          : [/siguiente mes/i, /next month/i, /siguiente/i, /next/i];
        for (const pat of pats) {
          const b = btns.find(el => pat.test(el.getAttribute('aria-label') || ''));
          if (b) { b.click(); return `aria: "${b.getAttribute('aria-label')}"` }
        }
        for (const ch of (at ? ['‹','«','<','◀','←'] : ['›','»','>','▶','→'])) {
          const b = btns.find(el => el.textContent?.trim() === ch);
          if (b) { b.click(); return `"${ch}"` }
        }
        return null;
      }, atras);

      for (let i = 0; i < 24; i++) {
        const r = await buscarDia();

        if (r.encontrado && !r.disabled) {
          // Día habilitado encontrado: hacer clic
          const clickado = await page.evaluate((obj) => {
            const candidatos = [...document.querySelectorAll(
              'button.andes-datepicker__day, [role="gridcell"] button, [role="gridcell"], td button, td'
            )].filter(el => el.offsetParent !== null);
            for (const btn of candidatos) {
              const aria = btn.getAttribute('aria-label') || '';
              if (!aria.includes(obj)) continue;
              const celda = btn.closest('td') || btn.closest('[role="gridcell"]') || btn;
              const disabled =
                btn.classList.contains('andes-datepicker__cell--disabled') ||
                btn.hasAttribute('disabled') ||
                celda.classList.contains('andes-datepicker__cell--disabled');
              if (!disabled) { btn.click(); return aria; }
            }
            return null;
          }, textoObj);
          console.log(`  Clicked ${descripcion}: "${clickado}"`);
          await page.waitForTimeout(400);
          await shot(page, `mp-dia-${descripcion}-${dia}`);
          return true;
        }

        if (r.encontrado && r.disabled) {
          console.log(`  Día encontrado pero DISABLED ("${r.aria}") — calendario en mes equivocado`);
        } else {
          console.log(`  Día "${textoObj}" no visible en el calendario actual`);
        }

        // Determinar dirección de navegación comparando con el mes visible actual
        const mesActual = await leerMesCalendario();
        let atras = true; // default: retroceder (pedimos siempre fechas pasadas)
        if (mesActual) {
          const diff = (anio - mesActual.anio) * 12 + (mes - mesActual.mes);
          atras = diff < 0;
          console.log(`  Calendario en ${MESES_ES_CAL[mesActual.mes]} ${mesActual.anio} → target ${MESES_ES_CAL[mes]} ${anio} → ${atras ? '← atrás' : '→ adelante'}`);
        }

        const navRes = await navegarUnMes(atras);
        if (!navRes) {
          console.log('  ERROR: no encontré flechas de navegación del calendario');
          break;
        }
        console.log(`  Navegando calendario: ${navRes}`);
        await page.waitForTimeout(600);
      }

      await shot(page, `mp-dia-${descripcion}-error`);
      console.log(`  ERROR: no se pudo seleccionar ${descripcion} "${textoObj}"`);
      return false;
    }

    // 4b. Abrir el calendario haciendo clic en el campo "Periodo"
    console.log('\n  Abriendo calendario (clic en campo "Periodo")...');
    const abrioCalendario = await page.evaluate(() => {
      // a) Input / combobox cuyo placeholder o aria-label mencione fecha o período
      for (const el of [...document.querySelectorAll('input, [role="textbox"], [role="combobox"]')]
        .filter(e => e.offsetParent !== null)) {
        const txt = (el.placeholder || el.getAttribute('aria-label') || '').toLowerCase();
        if (/fecha|periodo|período|seleccioná|selecciona/i.test(txt)) {
          el.click(); return `input: "${el.placeholder || el.getAttribute('aria-label')}"`;
        }
      }
      // b) Botón / elemento con aria-label o clase que mencione "calendario" / "calendar"
      for (const el of [...document.querySelectorAll('button, [role="button"], [class*="calendar"], [class*="Calendar"]')]
        .filter(e => e.offsetParent !== null)) {
        const aria = el.getAttribute('aria-label') || '';
        const cls  = [...el.classList].join(' ');
        if (/calendario|calendar|fecha|date|período/i.test(aria + ' ' + cls)) {
          el.click(); return `icono: "${aria || cls}"`;
        }
      }
      // c) Cualquier elemento visible cuyo texto sea el placeholder esperado
      for (const el of [...document.querySelectorAll('*')].filter(e => e.offsetParent !== null)) {
        const txt = el.innerText?.trim() || el.getAttribute('placeholder') || '';
        if (/seleccioná la fecha|selecciona la fecha/i.test(txt)) {
          el.click(); return `texto: "${txt.substring(0, 60)}"`;
        }
      }
      return null;
    });

    if (!abrioCalendario) {
      console.log('  ERROR: no encontré el campo "Periodo" para abrir el calendario');
      await shot(page, 'mp-error-campo-periodo');
      await browser.close(); process.exit(1);
    }
    console.log(`  Campo "Periodo" clickeado via: ${abrioCalendario}`);
    await page.waitForTimeout(1500);
    await shot(page, 'mp-4b-calendario-abierto');

    // Verificar que el calendario de días se desplegó
    const calDiasVisible = await page.evaluate(() =>
      [...document.querySelectorAll('[role="gridcell"], td')]
        .filter(el => el.offsetParent !== null && /^\d+$/.test(el.innerText?.trim() || ''))
        .length > 0
    );
    if (calDiasVisible) {
      console.log('  Calendario de días visible. Continuando...');
    } else {
      console.log('  WARN: no se detectaron celdas de días. Revisá mp-4b-calendario-abierto.png');
    }

    // Navegar al mes de inicio y hacer clic en el día
    if (!await navegarAMes(fechaInicio.getMonth(), fechaInicio.getFullYear(), 'inicio')) {
      await shot(page, 'mp-error-nav-inicio'); await browser.close(); process.exit(1);
    }
    await shot(page, 'mp-4c-mes-inicio');

    await clickDiaMP(fechaInicio, 'inicio');
    await page.waitForTimeout(600);
    await shot(page, 'mp-4d-click-inicio');

    // Si el fin cae en un mes distinto, navegar hasta él
    if (fechaFin.getMonth() !== fechaInicio.getMonth() || fechaFin.getFullYear() !== fechaInicio.getFullYear()) {
      if (!await navegarAMes(fechaFin.getMonth(), fechaFin.getFullYear(), 'fin')) {
        await shot(page, 'mp-error-nav-fin'); await browser.close(); process.exit(1);
      }
    }
    await shot(page, 'mp-4e-mes-fin');

    await clickDiaMP(fechaFin, 'fin');
    await page.waitForTimeout(600);
    await shot(page, 'mp-4f-click-fin');

    // Clic en "Aplicar"
    console.log('\n  Clic en "Aplicar"...');
    const btnAplicar = page.getByRole('button', { name: /^aplicar$/i })
      .or(page.locator('button').filter({ hasText: /^aplicar$/i }));
    if (!await tryClick(btnAplicar, '"Aplicar"', 5000)) {
      const btnsDisp = await page.evaluate(() =>
        [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null)
          .map(el => `"${el.innerText?.trim()}"`)
      );
      console.log('  Botones visibles:', btnsDisp);
      await shot(page, 'mp-error-aplicar');
      await browser.close(); process.exit(1);
    }
    await page.waitForTimeout(1000);
    await shot(page, 'mp-4g-periodo-ok');

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
