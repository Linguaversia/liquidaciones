// diagnostico-uber3.js - Inspecciona el DOM del formulario para obtener
// selectores exactos del acordeón Pagos y el dropdown de establecimientos.

const { chromium } = require('playwright');
const fs = require('fs');

const archivoSesion = './sesiones/uber-argentina/sesion.json';
if (!fs.existsSync(archivoSesion)) { process.exit(1); }

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
  await page.getByRole('button', { name: /crear informe/i }).click();
  await page.waitForTimeout(3000);

  // ── Obtener HTML del área "Selecciona un tipo de informe" ──────────────────
  const htmlSeccion = await page.evaluate(() => {
    // Buscar el contenedor h2/h3 que diga "Selecciona un tipo"
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div')]
      .filter(el => el.innerText?.trim().startsWith('1. Selecciona'));
    if (!headings.length) return 'NO ENCONTRADO';
    // Tomar el padre que contenga los acordeones
    let container = headings[0].parentElement;
    for (let i = 0; i < 4; i++) {
      if (container.querySelectorAll('button, [role="button"]').length > 1) break;
      container = container.parentElement;
    }
    return container.innerHTML.substring(0, 4000);
  });
  console.log('\n=== HTML sección tipo de informe ===');
  console.log(htmlSeccion.substring(0, 3000));

  // ── Intentar click con JS directamente en el botón Pagos del formulario ───
  console.log('\nIntentando click JS en acordeón Pagos...');
  const clicked = await page.evaluate(() => {
    // Buscar todos los botones/elementos clickeables con texto "Pagos"
    const candidates = [...document.querySelectorAll('button, [role="button"], summary, li, div[tabindex]')]
      .filter(el => {
        const txt = el.innerText?.trim();
        return txt === 'Pagos' || txt?.startsWith('Pagos');
      });
    console.log('Candidatos Pagos:', candidates.length);
    candidates.forEach((el, i) => {
      console.log(`  [${i}] tag=${el.tagName} class="${el.className.substring(0,80)}" role="${el.getAttribute('role')}" aria-expanded="${el.getAttribute('aria-expanded')}"`);
    });
    // Clickear el que tenga aria-expanded o el que no sea el sidebar
    const notSidebar = candidates.find(el => {
      // El sidebar suele estar en nav, aside o tener clase que incluya "nav" o "sidebar"
      let p = el.parentElement;
      for (let i = 0; i < 6; i++) {
        if (!p) break;
        const tag = p.tagName?.toLowerCase();
        const cls = p.className?.toLowerCase() || '';
        if (tag === 'nav' || tag === 'aside' || cls.includes('nav') || cls.includes('sidebar') || cls.includes('menu')) return false;
        p = p.parentElement;
      }
      return true;
    });
    if (notSidebar) {
      notSidebar.click();
      return `clicked: ${notSidebar.tagName} class="${notSidebar.className.substring(0,80)}"`;
    }
    return 'no non-sidebar candidate found';
  });
  console.log('Resultado click JS:', clicked);
  await page.waitForTimeout(2000);
  await shot(page, 'diag3-uber-1-pagos-js');

  // ── Obtener HTML del dropdown Establecimientos ─────────────────────────────
  const htmlEstab = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label, p, span, div')]
      .filter(el => el.innerText?.trim() === 'Seleccionar negocios o grupos');
    if (!labels.length) return 'NO ENCONTRADO';
    let container = labels[0].parentElement;
    for (let i = 0; i < 3; i++) {
      if (container.querySelector('button, select, [role="combobox"], [role="listbox"]')) break;
      container = container.parentElement;
    }
    return container.innerHTML.substring(0, 2000);
  });
  console.log('\n=== HTML sección establecimientos ===');
  console.log(htmlEstab);

  // ── Click JS en el dropdown de Establecimientos dentro del formulario ─────
  console.log('\nIntentando click JS en dropdown Establecimientos...');
  const clickedEstab = await page.evaluate(() => {
    const label = [...document.querySelectorAll('*')]
      .find(el => el.innerText?.trim() === 'Seleccionar negocios o grupos');
    if (!label) return 'label not found';
    let container = label.parentElement;
    for (let i = 0; i < 5; i++) {
      const btn = container.querySelector('button, [role="combobox"], [role="button"], select');
      if (btn) { btn.click(); return `clicked ${btn.tagName} class="${btn.className.substring(0,60)}"`; }
      container = container.parentElement;
    }
    return 'no clickable found';
  });
  console.log('Resultado:', clickedEstab);
  await page.waitForTimeout(1500);
  await shot(page, 'diag3-uber-2-estab-dropdown');

  // Listar opciones visibles
  const opcionesEstab = await page.evaluate(() => {
    return [...document.querySelectorAll('[role="option"], [role="listitem"], li')]
      .map(el => el.innerText?.trim()).filter(Boolean).slice(0, 30);
  });
  console.log('\n--- Opciones de establecimientos ---');
  opcionesEstab.forEach(o => console.log(' ', o));

  console.log('\nDiagnóstico 3 completo.');
  await browser.close();
})();
