// login-uber.js
// Se corre UNA sola vez. Abre el navegador, hacés login a mano
// (correo → contraseña → código SMS), y la sesión se guarda automáticamente
// en ./sesiones/uber-argentina/sesion.json cuando cerrás el navegador.
//
// Uso:  node login-uber.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const carpetaSesion = './sesiones/uber-argentina';
fs.mkdirSync(carpetaSesion, { recursive: true });
const archivoSesion = path.resolve(`${carpetaSesion}/sesion.json`);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    acceptDownloads: true,
  });

  const page = await context.newPage();
  await page.goto('https://auth.uber.com/v2/');

  console.log('\n========================================================');
  console.log('  Login Uber Eats — Argentina');
  console.log('  1. Ingresá el correo y hacé clic en "Siguiente".');
  console.log('  2. Ingresá la contraseña y hacé clic en "Siguiente".');
  console.log('  3. Ingresá el código SMS cuando lo pida.');
  console.log('  4. Cuando veas el panel de Uber Eats cargado,');
  console.log('     CERRÁ el navegador.');
  console.log('     La sesión se guarda automáticamente al cerrar.');
  console.log('========================================================\n');

  let guardado = false;

  const guardarSesion = async () => {
    if (guardado) return;
    guardado = true;
    try {
      await context.storageState({ path: archivoSesion });
      console.log(`\nSesión guardada en: ${archivoSesion}`);
    } catch {
      console.log('\nNo se pudo guardar la sesión (navegador ya cerrado).');
    }
  };

  page.on('close', guardarSesion);

  await new Promise((resolve) => browser.once('disconnected', resolve));
  await guardarSesion();
  process.exit(0);
})();
