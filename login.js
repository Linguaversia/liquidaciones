// login.js
// Se corre UNA sola vez por cuenta/país. Abre un navegador real,
// tú haces login a mano (correo, contraseña y el código 2FA),
// y la sesión queda guardada en ./sesiones/<PAIS>.json
//
// Uso:  node login.js argentina
//       node login.js chile

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const pais = process.argv[2];
if (!pais) {
  console.log('Falta el país. Ejemplo:  node login.js argentina');
  process.exit(1);
}

const carpetaSesiones = './sesiones';
fs.mkdirSync(carpetaSesiones, { recursive: true });
const archivoSesion = path.resolve(`${carpetaSesiones}/${pais}.json`);

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
  await page.goto('https://portal-app.pedidosya.com/login');

  console.log('\n========================================================');
  console.log(`  Haz login para: ${pais.toUpperCase()}`);
  console.log('  Ingresa correo, contraseña y el código 2FA si lo pide.');
  console.log('  Cuando veas el Tablero cargado, vuelve aquí y');
  console.log('  presiona ENTER en esta terminal para guardar la sesión.');
  console.log('========================================================\n');

  await new Promise((resolve) => process.stdin.once('data', resolve));

  await context.storageState({ path: archivoSesion });
  await browser.close();

  console.log(`\nSesión de ${pais} guardada en ${archivoSesion}`);
  process.exit(0);
})();
