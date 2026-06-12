// diagnostico-uber2.js - Expande el acordeón "Pagos" dentro del formulario
// y abre los dropdowns de negocios y fechas para ver las opciones reales.

const { chromium } = require('playwright');
const fs = require('fs');

const archivoSesion = './sesiones/uber-argentina/sesion.json';
if (!fs.existsSync(archivoSesion)) { console.log('Sin sesión.'); process.exit(1); }

async function shot(page, nombre) {
  await page.screenshot({ path: `./${nombre}.png`, fullPage: true });
  console.log(`  >> ${nombre}.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, storageState: archivoSesion });
  const page = await context.newPage();

  await page.goto('https://merchants.ubereats.com/manager/reports', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(4000);

  // Ir directamente a la URL de crear informe si existe
  const btnCrear = page.getByRole('button', { name: /crear informe/i });
  await btnCrear.waitFor({ state: 'visible', timeout: 10000 });
  await btnCrear.click();
  await page.waitForTimeout(3000);

  // Expandir "Pagos" dentro de la sección del formulario (no el sidebar)
  // Buscar dentro del contenido principal, no el nav lateral
  console.log('Expandiendo acordeón "Pagos" en el formulario...');
  const seccionTipo = page.locator('main, [role="main"], .main-content, #root').first();
  const acordeonPagos = seccionTipo.getByText(/^pagos$/i).first();
  try {
    await acordeonPagos.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
  } catch {
    // fallback: buscar el button con "Pagos"
    const btnPagos = page.locator('button, [role="button"]').filter({ hasText: /^pagos$/i }).first();
    await btnPagos.click({ timeout: 5000 }).catch(() => console.log('  No encontrado'));
    await page.waitForTimeout(2000);
  }
  await shot(page, 'diag2-uber-1-pagos');

  // Listar todo lo visible dentro de la sección de tipo de informe
  const opcionesTipo = await page.evaluate(() => {
    const els = document.querySelectorAll('input[type="radio"], label, [role="radio"], [role="option"]');
    return [...els].map(el => ({
      tag: el.tagName,
      text: el.innerText?.trim(),
      value: el.value,
      id: el.id,
    })).filter(e => e.text);
  });
  console.log('\n--- Opciones de tipo de informe ---');
  opcionesTipo.forEach(o => console.log(JSON.stringify(o)));

  // Abrir dropdown de negocios
  console.log('\nAbriendo dropdown "Establecimientos"...');
  const dropNegocios = page.getByText(/establecimientos/i).first();
  await dropNegocios.click({ timeout: 5000 }).catch(() => console.log('  No encontrado'));
  await page.waitForTimeout(1500);
  await shot(page, 'diag2-uber-2-negocios');

  const opcionesNegocios = await page.evaluate(() => {
    const els = document.querySelectorAll('[role="option"], [role="listbox"] li, [role="menu"] li');
    return [...els].map(el => el.innerText?.trim()).filter(Boolean);
  });
  console.log('\n--- Opciones de negocios ---');
  opcionesNegocios.forEach(o => console.log(' ', o));

  // Cerrar y abrir dropdown de fechas
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  console.log('\nAbriendo dropdown "Intervalo de fechas"...');
  const dropFechas = page.locator('button, [role="button"], div[aria-haspopup]')
    .filter({ hasText: /intervalo|fecha|YYYY/i }).first();
  await dropFechas.click({ timeout: 5000 }).catch(async () => {
    // try clicking the date field directly
    await page.locator('input[placeholder*="YYYY"], [placeholder*="fecha"]').first()
      .click({ timeout: 3000 }).catch(() => console.log('  Fecha no encontrada'));
  });
  await page.waitForTimeout(1500);
  await shot(page, 'diag2-uber-3-fechas');

  const opcionesFechas = await page.evaluate(() => {
    const els = document.querySelectorAll('[role="option"], [role="listbox"] li, [role="menuitem"]');
    return [...els].map(el => el.innerText?.trim()).filter(Boolean);
  });
  console.log('\n--- Opciones de fechas ---');
  opcionesFechas.forEach(o => console.log(' ', o));

  console.log('\nDiagnóstico 2 completo.');
  await browser.close();
})();
