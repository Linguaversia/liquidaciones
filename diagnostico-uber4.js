// diagnostico-uber4.js - Expande el acordeón Pagos con el selector exacto
// y muestra los sub-tipos disponibles.

const { chromium } = require('playwright');
const fs = require('fs');

const archivoSesion = './sesiones/uber-argentina/sesion.json';
if (!fs.existsSync(archivoSesion)) { process.exit(1); }

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, storageState: archivoSesion });
  const page = await context.newPage();

  await page.goto('https://merchants.ubereats.com/manager/reports', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /crear informe/i }).click();
  await page.waitForTimeout(3000);

  // Expandir Pagos con el data-testid exacto del chevron
  console.log('Expandiendo acordeón Pagos...');
  await page.locator('[data-testid="category-icon-wrapper-pagos"]').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: './diag4-uber-1-pagos-abierto.png', fullPage: true });
  console.log('  >> diag4-uber-1-pagos-abierto.png');

  // Obtener el HTML del área de tipo de informe para ver sub-tipos
  const subtipos = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="reports-menu-wrapper"]');
    if (!wrapper) return 'no wrapper';
    return wrapper.innerText;
  });
  console.log('\n--- Contenido del selector de tipo ---');
  console.log(subtipos);

  // También imprimir el HTML del wrapper para ver la estructura
  const htmlWrapper = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="reports-menu-wrapper"]');
    return wrapper ? wrapper.innerHTML.substring(0, 5000) : 'no wrapper';
  });
  console.log('\n--- HTML del wrapper (primeros 3000 chars) ---');
  console.log(htmlWrapper.substring(0, 3000));

  await browser.close();
})();
