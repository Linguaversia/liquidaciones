# Descargador de liquidaciones — PedidosYa

Motor para descargar automáticamente los .zip de liquidación ("ÚLTIMA")
de todos los locales de una cuenta de PedidosYa.

## Qué hace
1. `login.js` — abres el navegador y haces login UNA vez (con 2FA). La sesión queda guardada.
2. `descargar.js` — reutiliza esa sesión y baja el .zip del período más reciente de cada local.

## Instalación (una sola vez)

Necesitas Node.js instalado. Luego, dentro de la carpeta del proyecto:

```
npm init -y
npm install playwright
npx playwright install chromium
```

## Uso

### Paso 1 — Login (una vez por país, o cuando caduque la sesión)
```
node login.js argentina
```
Se abre el navegador. Haz login normal (correo, contraseña, código 2FA).
Cuando veas el Tablero cargado, vuelve a la terminal y presiona ENTER.

### Paso 2 — Descargar EN MODO PRUEBA (solo 3 locales)
```
node descargar.js argentina prueba
```
Revisa que los 3 .zip caigan bien en `descargas/argentina/<fecha>/`.

### Paso 3 — Descargar TODO
```
node descargar.js argentina
```

## Notas
- Cada país usa su propia sesión: `node login.js chile`, `node descargar.js chile`, etc.
- Los archivos vienen autoidentificados: `inicio_fin_estado-de-cuenta_ID.zip`.
- Los selectores de la página (botón de descarga, fila "ÚLTIMA") quizá haya
  que ajustarlos al ver la página real. Eso lo hacemos juntos en Claude Code.
