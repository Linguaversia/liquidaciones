// login-rappi.js
// Se corre UNA sola vez. Abre el navegador, hacés login a mano
// (correo + contraseña + código SMS), y la sesión se guarda automáticamente
// en ./sesiones/rappi-<PAIS>.json cuando cerrás el navegador.
//
// Uso:  node login-rappi.js argentina

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const pais = process.argv[2];
if (!pais) {
  console.log('Falta el país. Ejemplo:  node login-rappi.js argentina');
  process.exit(1);
}

const carpetaSesiones = './sesiones';
fs.mkdirSync(carpetaSesiones, { recursive: true });
const archivoSesion = path.resolve(`${carpetaSesiones}/rappi-${pais}.json`);

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
  await page.goto('https://partners.rappi.com/login');

  console.log('\n========================================================');
  console.log(`  Login Rappi: ${pais.toUpperCase()}`);
  console.log('  1. Ingresá correo y contraseña.');
  console.log('  2. Ingresá el código SMS cuando lo pida.');
  console.log('  3. Cuando veas el panel principal, CERRÁ el navegador.');
  console.log('     La sesión se guarda automáticamente al cerrar.');
  console.log('========================================================\n');

  let guardado = false;

  const guardarSesion = async () => {
    if (guardado) return;
    guardado = true;
    try {
      await context.storageState({ path: archivoSesion });
      console.log(`\nSesión de rappi-${pais} guardada en ${archivoSesion}`);
    } catch {
      console.log('\nNo se pudo guardar la sesión (navegador ya cerrado).');
    }
  };

  // Guardar cuando el usuario cierra el navegador (antes de que se desconecte)
  page.on('close', guardarSesion);

  // Mantener el proceso vivo hasta que el browser se cierre
  await new Promise((resolve) => browser.once('disconnected', resolve));
  await guardarSesion();
  process.exit(0);
})();
