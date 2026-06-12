# UBER-DEBUGGING-LOG.md

Registro de problemas encontrados durante el desarrollo de `descargar-uber.js`.

---

## 1. Problemas Encontrados

### 1.1 Botón "Crear informe" no encontrado
El portal usa alternativamente "Crear un reporte", "Crear un informe" y "Crear informe" según el contexto. El selector inicial usaba texto exacto y fallaba.

### 1.2 Acordeón "Pagos" no expandía
`getByText(/^pagos$/i)` encontraba el ítem del sidebar de navegación lateral, no el acordeón dentro del formulario. El click ocurría en el lugar equivocado y el acordeón nunca se expandía.

### 1.3 Click del checkbox aterrizaba en el ícono ⓘ
El selector del checkbox apuntaba al div contenedor de toda la fila, que tenía el ícono de información como elemento centrado. El click clickeaba el ícono en vez del checkbox.

### 1.4 Checkbox incorrecto seleccionado ("Resumen de pagos")
La navegación DOM era incorrecta: el locator encontraba un contenedor con múltiples labels. El código seleccionaba el último checkbox visible en vez del primero.

### 1.5 Nombres del tipo de informe inconsistentes
El portal mostró distintos nombres en distintas sesiones:
- "Detalles del pago"
- "Detalles de pago"
- "Detalles de ganancias"
- "Detalles del pago (nivel de artículo)"
- "Resumen de pagos"

El nombre objetivo varía según la cuenta/región/versión del portal.

### 1.6 Date picker: asumido como `<button>`, era `<input>`
Se usó XPath `following::button[1]` y `[aria-haspopup]` para encontrar el date picker. Ambos fallaron porque el campo de fechas es un `<input type="text" placeholder="YYYY/MM/DD">`, no un botón ni un div con aria-haspopup.

### 1.7 `hasText: /YYYY/i` no matcheaba el input
`filter({ hasText: /YYYY/i })` de Playwright comprueba `textContent`. Un `<input placeholder="YYYY/MM/DD">` tiene `textContent` vacío — el placeholder NO es textContent. Por eso todos los selectores con `hasText: /YYYY/` devolvían 0 resultados.

### 1.8 Calendario abierto pero no detectado
Cuando el calendario sí abrió (diagnostico-uber2.js), el código de detección buscaba `[role="gridcell"]`, `[role="grid"]`, `[data-baseweb="popover"]`. El calendario de BaseWeb usa `role="gridcell"` para las celdas pero el screenshot era `fullPage: false` y el calendario abría fuera del viewport. Los checks del DOM sí encontraban celdas, pero el código interpretaba que no había calendario porque el check de opciones de "período predefinido" devolvía solo `["Una vez", "De forma periódica"]`.

### 1.9 Click de coordenadas aterrizaba en lugar equivocado
Intento de click via `labelBox.y + 22` para apuntar al campo debajo del label. En realidad, Playwright's `page.locator('text=...')` puede resolver a un contenedor padre con bounding box grande, poniendo el click 100+ px abajo del campo real.

### 1.10 `page.reload()` fallaba con ERR_CONNECTION_CLOSED
En el loop de polling del paso 7, `page.reload()` crasheaba el script. El browser chromium de Playwright se desconecta si el servidor cierra la conexión durante el reload.

### 1.11 Botón "Descargar" es `<button>`, no `<a>`
El paso 8 buscaba `a[href*=".xlsx"]` y `getByRole('link', { name: /descarg/ })`. El botón en la lista de informes es `<button>` sin href, por lo que nunca era encontrado y el informe se marcaba como "no disponible" en todos los intentos.

---

## 2. Cómo se Resolvieron

### Botón "Crear informe"
```js
page.getByRole('button', { name: /crear informe/i })
// regex en vez de texto exacto, cubre variantes
```

### Acordeón Pagos
Se descubrió el `data-testid` único con un script de diagnóstico que volcaba todos los `data-testid` de la página:
```js
page.locator('[data-testid="category-icon-wrapper-pagos"]').click()
// data-testid estable, no afectado por el sidebar
```

### Checkbox correcto
Navegación DOM explícita desde el texto del label:
```js
// texto_label → div padre → div abuelo (la fila) → querySelector('label[data-baseweb="checkbox"]')
function clickCheckboxDeP(el) {
  const divRow = el.parentElement?.parentElement;
  const label = divRow?.querySelector('label[data-baseweb="checkbox"]') || divRow?.querySelector('label');
  if (label) { label.click(); return true; }
}
```

### Nombres variables del tipo de informe
Lista de prioridades con fallback al primer checkbox visible:
```js
const NOMBRES_TIPO = ['Detalles de ganancias', 'Detalles de pagos', 'Detalles del pago', 'Pagos', 'Ganancias'];
// busca en p, div, span con childElementCount===0 e innerText exacto
```

### Date picker: input con placeholder
```js
page.locator('input[placeholder*="YYYY"]').first()
// selectora directa del input, no del contenedor
```

### Detección del calendario
El calendario usa `[data-baseweb="calendar"]` y celdas con `role="gridcell"`. Para encontrarlas tras el click:
```js
const cal = document.querySelector('[data-baseweb="calendar"]');
const cells = [...cal.querySelectorAll('[role="gridcell"]')]
  .filter(el => el.offsetParent !== null && el.innerText?.trim() === String(dia));
cells[0].click();
```

### Click de día en calendario
Las celdas tienen `aria-label` en español con formato BaseWeb:
```
"Choose lunes, junio 1º 2026. It's available."
```
El fallback por texto exacto (`innerText === "1"`) también funciona.

### Polling del paso 7
Reemplazado `page.reload()` por `page.goto(url)` que es más resiliente. La detección ahora usa JS directo en vez de locators de Playwright:
```js
const candidates = [...document.querySelectorAll('button, a')]
  .filter(el => el.innerText?.trim().toLowerCase() === 'descargar' && !el.disabled);
```

### Descarga paso 8
`page.waitForEvent('download')` combinado con JS click en el botón habilitado:
```js
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 120000 }),
  page.evaluate(() => { /* click en button:not(disabled) */ }),
]);
```

---

## 3. Selectores Finales que Funcionan

| Elemento | Selector |
|----------|----------|
| Botón "Crear informe" | `page.getByRole('button', { name: /crear informe/i })` |
| Acordeón Pagos | `page.locator('[data-testid="category-icon-wrapper-pagos"]')` |
| Dropdown establecimientos | `page.locator('[aria-haspopup="true"]').filter({ has: page.locator('[data-testid="page-level-store-selector-dropdown-label"]') })` |
| "Seleccionar todos" | `page.getByText(/seleccionar todos/i).first()` |
| Botón "Solicitar" | `page.getByRole('button', { name: /^solicitar$/i })` |
| Input fecha inicio | `page.locator('input[placeholder*="YYYY"]').first()` |
| Celdas del calendario | `[data-baseweb="calendar"] [role="gridcell"]` con `innerText === String(dia)` |
| Botón submit | `page.getByRole('button', { name: /^(generar\|crear informe\|generate\|create\|enviar)$/i }).last()` |
| Botón Descargar (paso 7) | JS: `button, a` con `innerText.toLowerCase() === 'descargar'` y `!el.disabled` |

---

## 4. Comportamientos Variables de Uber

### Nombres que cambian según sesión/cuenta
- **"Crear un reporte"** vs **"Crear un informe"** vs **"Crear informe"** — mismo botón, distintos textos
- **"Detalles del pago"** vs **"Detalles de pago"** vs **"Detalles de ganancias"** — mismo tipo de informe, distinto nombre
- **"Ganancias"** vs **"Pagos"** — el acordeón principal puede aparecer con cualquiera

### Nombres en español con variaciones regionales
Los `aria-label` del calendario usan español con formato peculiar:
```
"Choose lunes, junio 1º 2026. It's available."
```
Mezcla español (día, mes) con inglés ("Choose", "It's available"). El sufijo ordinal usa "º" (1º, 2º).

### Estructura del formulario puede scrollear
Después de seleccionar tipo + establecimientos, el formulario puede quedar scrolleado. El date picker queda fuera del viewport inicial. Siempre usar `scrollIntoViewIfNeeded()` antes de interactuar.

### El informe "en generación" muestra botón Descargar deshabilitado
En la lista de informes, tanto el informe nuevo (generando) como informes históricos tienen el texto "Descargar". La diferencia es `button[disabled]`. Siempre filtrar por `!el.disabled`.

---

## 5. Problemas Pendientes

### CSV en vez de XLSX
El portal descarga por defecto en `.csv`. El formulario tiene una sección "¿Dónde te gustaría recibir el informe?" que muestra "Gerente de Uber Eats" pero no se ha encontrado un selector de formato XLSX en la sesión actual. Es posible que:
- El formato se configure en el perfil de la cuenta (no en el formulario)
- Exista un paso de selección de formato que no aparece para este tipo de informe
- El CSV sea el único formato disponible para "Detalles del pago"

**Para investigar:** Crear manualmente un informe en el portal y observar si aparece un selector de formato.

### Un informe previo puede descargarse en vez del nuevo
En el paso 7, el código busca el primer `button:not([disabled])` con texto "Descargar". Si ya hay informes anteriores disponibles, puede descargar uno previo en vez de esperar al nuevo.

**Para mejorar:** Registrar el número de fila del informe recién creado (por timestamp) y esperar específicamente que ese botón se habilite.

---

## 6. Notas para Futuros Desarrolladores

### Metodología de debugging recomendada
1. Crear scripts `diagnostico-uberN.js` separados del script principal
2. Usar `fullPage: true` en todos los screenshots de diagnóstico
3. Volcar HTML con `page.evaluate()` — `el.outerHTML.substring(0, 800)` es suficiente para la mayoría de casos
4. Siempre verificar si el elemento es `<button>`, `<a>`, `<input>` o `<div>` antes de asumir el selector
5. Para BaseWeb (UI de Uber): los `data-baseweb="..."` atributos son los más estables; los class names (`_af _cy ...`) son ofuscados y cambian entre deploys

### Sesión
La sesión se guarda en `./sesiones/uber-argentina/sesion.json`. Si expira:
```
node login-uber.js
# Loguear manualmente, cerrar el browser, el archivo se guarda automáticamente
```

### Timing crítico
- Después de abrir el formulario: esperar 3000ms
- Después de expandir el acordeón: esperar 1500ms  
- Después de seleccionar tipo: esperar 800ms
- Después de click en date picker: esperar 1800ms (el calendario tarda en renderizar)
- Después del submit: esperar 4000ms antes del polling

### Estructura del DOM del calendar (BaseWeb DateRangePicker)
```
[data-baseweb="popover"]
  [data-baseweb="calendar"] role="dialog"
    button aria-label="Previous month."
    button aria-label="Next month."
    [role="gridcell"] aria-label="Choose lunes, junio 1º 2026. It's available."
    ...
```
No usar `role="grid"` ni `role="dialog"` como detector principal — usar `[data-baseweb="calendar"]`.
