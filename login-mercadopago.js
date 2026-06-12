// login-mercadopago.js
// Se corre UNA sola vez. Abre el navegador, hacés login a mano
// (DNI o email → contraseña → reCAPTCHA si lo pide), y la sesión
// se guarda automáticamente en ./sesiones/mercadopago-argentina/sesion.json
// cuando cerrás el navegador.
//
// Uso:  node login-mercadopago.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const carpetaSesion = './sesiones/mercadopago-argentina';
fs.mkdirSync(carpetaSesion, { recursive: true });
const archivoSesion = path.resolve(`${carpetaSesion}/sesion.json`);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',
      // Evita que MercadoPago detecte el navegador como bot
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: null,
    acceptDownloads: true,
    // User agent de Chrome real para pasar el reCAPTCHA con menos fricción
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.goto('https://www.mercadopago.com.ar/');

  console.log('\n========================================================');
  console.log('  Login MercadoPago — Argentina');
  console.log('  1. Ingresá tu DNI o email y hacé clic en "Continuar".');
  console.log('  2. Ingresá tu contraseña.');
  console.log('  3. Si aparece reCAPTCHA, resolvelo manualmente.');
  console.log('  4. Completá el código de verificación si lo pide.');
  console.log('  5. Cuando veas el panel de MercadoPago cargado,');
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
