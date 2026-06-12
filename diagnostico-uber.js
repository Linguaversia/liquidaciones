// diagnostico-uber.js
// Abre el formulario "Crear informe", expande "Pagos" y toma screenshots
// del formulario completo para entender la UI antes de automatizar.
//
// Uso: node diagnostico-uber.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const archivoSesion = path.resolve('./sesiones/uber-argentina/sesion.json');
if (!fs.existsSync(archivoSesion)) {
  console.log('No existe sesión. Corre primero: node login-uber.js');
  process.exit(1);
}

async function shot(page, nombre) {
  const p = `./${nombre}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  Screenshot: ${p}`);
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, storageState: archivoSesion });
  const page = await context.newPage();

  console.log('Navegando a Informes...');
  await page.goto('https://merchants.ubereats.com/manager/reports', {
    waitUntil: 'domcontentloaded', timeout: 40000,
  });
  await page.waitForTimeout(4000);
  await shot(page, 'diag-uber-1-informes');

  console.log('Clic en "Crear informe"...');
  const btnCrear = page.getByRole('button', { name: /crear informe/i });
  await btnCrear.waitFor({ state: 'visible', timeout: 10000 });
  await btnCrear.click();
  await page.waitForTimeout(3000);
  await shot(page, 'diag-uber-2-form-top');

  console.log('Expandiendo "Pagos"...');
  const pagos = page.getByText(/^pagos$/i).first();
  try {
    await pagos.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch {
    console.log('  No se encontró "Pagos" para expandir');
  }
  await shot(page, 'diag-uber-3-pagos-expandido');

  // Scroll por secciones
  console.log('Scrolleando el formulario...');
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(800);
  await shot(page, 'diag-uber-4-scroll1');

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(800);
  await shot(page, 'diag-uber-5-scroll2');

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(800);
  await shot(page, 'diag-uber-6-scroll3');

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(800);
  await shot(page, 'diag-uber-7-scroll4');

  // Imprimir todos los textos visibles de labels, botones, opciones
  console.log('\n--- Textos de botones/opciones visibles ---');
  const textos = await page.evaluate(() => {
    const els = document.querySelectorAll('button, input, label, [role="option"], [role="radio"], [role="checkbox"], h2, h3, h4, li');
    return [...els]
      .map(el => el.innerText?.trim())
      .filter(t => t && t.length > 0 && t.length < 100)
      .filter((t, i, arr) => arr.indexOf(t) === i);
  });
  textos.forEach(t => console.log(' ', t));

  console.log('\nDiagnóstico completo. Revisá los screenshots diag-uber-*.png');
  await browser.close();
})();
