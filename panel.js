// panel.js — servidor web para ejecutar descargas y ver historial
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CARPETA_DESCARGAS } = require('./config');

const app = express();
const PORT = 3000;

app.use(express.json());

// ── Configuración de plataformas ────────────────────────────────────────────
const PLATAFORMAS = {
  pedidosya: {
    label: 'PedidosYa',
    cmd: 'node',
    args: ['descargar.js', 'argentina'],
    carpeta: 'argentina',
    color: '#FF6900',
  },
  rappi: {
    label: 'Rappi',
    cmd: 'node',
    args: ['descargar-rappi.js', 'argentina'],
    carpeta: 'rappi-argentina',
    color: '#FF441F',
  },
  uber: {
    label: 'Uber Eats',
    cmd: 'node',
    args: ['descargar-uber.js', 'argentina'],
    carpeta: 'uber-argentina',
    color: '#000000',
    fechasOpcionales: true,
  },
  mercadopago: {
    label: 'Mercado Pago',
    cmd: 'node',
    args: ['descargar-mercadopago.js'],
    carpeta: 'mercadopago-argentina',
    color: '#009EE3',
    fechasOpcionales: true,
  },
  'pedidosya-chile': {
    label: 'PedidosYa',
    cmd: 'node',
    args: ['descargar.js', 'chile'],
    carpeta: 'chile',
    color: '#FF6900',
  },
};

const SECCIONES = [
  { titulo: 'Argentina', ids: ['pedidosya', 'rappi', 'uber', 'mercadopago'] },
  { titulo: 'Chile',     ids: ['pedidosya-chile'] },
];

// Mapa id-plataforma → país, derivado de SECCIONES. Se actualiza solo al agregar países.
const PLATAFORMA_PAIS = Object.fromEntries(
  SECCIONES.flatMap(({ titulo, ids }) => ids.map(id => [id, titulo.toLowerCase()]))
);

// ── Helpers ─────────────────────────────────────────────────────────────────
const EXTS_VALIDAS = new Set(['.zip', '.xlsx', '.csv', '.xls']);

function leerHistorial() {
  if (!fs.existsSync(CARPETA_DESCARGAS)) return [];

  const resultados = [];

  for (const [id, cfg] of Object.entries(PLATAFORMAS)) {
    const carpetaPlataforma = path.join(CARPETA_DESCARGAS, cfg.carpeta);
    if (!fs.existsSync(carpetaPlataforma)) continue;

    const fechas = fs.readdirSync(carpetaPlataforma)
      .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f))
      .sort()
      .reverse();

    for (const fecha of fechas) {
      const carpetaFecha = path.join(carpetaPlataforma, fecha);
      try {
        const archivos = fs.readdirSync(carpetaFecha)
          .filter(f => EXTS_VALIDAS.has(path.extname(f).toLowerCase()));
        for (const archivo of archivos) {
          const stat = fs.statSync(path.join(carpetaFecha, archivo));
          resultados.push({
            plataforma: cfg.label,
            plataformaId: id,
            fecha,
            archivo,
            tamano: stat.size,
            mtimeMs: stat.mtimeMs,
            ruta: path.join(cfg.carpeta, fecha, archivo),
          });
        }
      } catch (_) {}
    }
  }

  resultados.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return resultados;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── GET / ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const historial = leerHistorial();

  const filasHistorial = historial.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:#888;padding:20px">Sin descargas aún</td></tr>'
    : historial.map(h => {
        // Filas con plataforma desconocida reciben data-pais="" y quedan ocultas al filtrar
        const pais = PLATAFORMA_PAIS[h.plataformaId] || '';
        return `
        <tr data-pais="${pais}">
          <td><span class="badge" style="background:${PLATAFORMAS[h.plataformaId]?.color || '#888'}">${h.plataforma}</span></td>
          <td>${h.fecha}</td>
          <td style="font-family:monospace;font-size:12px">${h.archivo}</td>
          <td>${formatBytes(h.tamano)}</td>
          <td><a href="/descargas/${h.ruta.replace(/\\/g, '/')}" download>${h.archivo}</a></td>
        </tr>`;
      }).join('');

  const seccionesHTML = SECCIONES.map(({ titulo, ids }) => {
    const cards = ids.map(id => {
      const cfg = PLATAFORMAS[id];
      return `
    <div class="card">
      <div class="platform-header" style="border-left: 4px solid ${cfg.color}">
        <strong>${cfg.label}</strong>
      </div>
      ${cfg.fechasOpcionales ? `
      <div class="date-range">
        <label>Desde <input type="date" class="input-desde" data-plataforma="${id}"></label>
        <label>Hasta  <input type="date" class="input-hasta" data-plataforma="${id}"></label>
      </div>` : ''}
      <button class="btn-descargar" data-plataforma="${id}" style="border-color:${cfg.color};color:${cfg.color}">
        ▶ Descargar ahora
      </button>
      <div class="log" id="log-${id}"></div>
    </div>`;
    }).join('');
    return `
  <div class="seccion" data-pais="${titulo.toLowerCase()}">
    <h2 class="pais-titulo">${titulo}</h2>
    <div class="grid">${cards}</div>
  </div>`;
  }).join('');

  // Selector generado desde SECCIONES — al agregar países futuros aparece solo aquí.
  // Base para cuando el país venga del usuario logueado en vez de elegirse a mano.
  const opcionesSelector = SECCIONES
    .map(({ titulo }) => `<option value="${titulo.toLowerCase()}">${titulo}</option>`)
    .join('');
  const selectorHTML = `
  <div class="filtro-pais">
    <label for="selector-pais">País:</label>
    <select id="selector-pais">${opcionesSelector}</select>
  </div>`;

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Panel de Liquidaciones</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
    header { background: #1a1a2e; color: white; padding: 16px 24px; }
    header h1 { font-size: 20px; font-weight: 600; }
    main { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .05em; color: #666; margin-bottom: 12px; }
    .seccion { margin-bottom: 36px; }
    .pais-titulo {
      font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
      color: #444; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #ddd;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .platform-header { padding: 6px 10px; margin-bottom: 12px; background: #fafafa; border-radius: 4px; }
    .btn-descargar {
      width: 100%; padding: 9px; border-radius: 6px; border: 1.5px solid; background: white;
      cursor: pointer; font-size: 14px; font-weight: 500; transition: .15s;
    }
    .btn-descargar:hover { opacity: .8; }
    .btn-descargar:disabled { opacity: .5; cursor: not-allowed; }
    .log {
      margin-top: 10px; font-size: 12px; font-family: monospace; background: #1e1e1e;
      color: #d4d4d4; border-radius: 4px; padding: 8px; min-height: 0; max-height: 120px;
      overflow-y: auto; white-space: pre-wrap; display: none;
    }
    .log.visible { display: block; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    th { background: #f0f0f0; padding: 10px 14px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #555; }
    td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
    .badge { color: white; font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .status-ok { color: #22863a; }
    .status-err { color: #cb2431; }
    .filtro-pais { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
    .filtro-pais label { font-size: 13px; color: #555; font-weight: 500; }
    .filtro-pais select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; background: white; cursor: pointer; }
    .date-range { margin-bottom: 10px; display: flex; flex-direction: column; gap: 5px; }
    .date-range label { font-size: 11px; color: #666; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .date-range input[type="date"] { flex: 1; padding: 3px 5px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <header><h1>Panel de Liquidaciones</h1></header>
  <main>
    ${selectorHTML}
    ${seccionesHTML}

    <h2>Historial de descargas</h2>
    <table>
      <thead>
        <tr>
          <th>Plataforma</th><th>Fecha</th><th>Archivo</th><th>Tamaño</th><th>Descargar</th>
        </tr>
      </thead>
      <tbody id="tabla-historial">${filasHistorial}</tbody>
    </table>
  </main>

  <script>
    // Filtrado por país — a futuro el país vendría del usuario logueado en vez de elegirse a mano.
    const selectorPais = document.getElementById('selector-pais');
    const todasSecciones = document.querySelectorAll('.seccion');

    function filtrarPais(pais) {
      todasSecciones.forEach(sec => {
        sec.style.display = sec.dataset.pais === pais ? '' : 'none';
      });
      // Filas con data-pais desconocido ('') no coinciden con ningún país → siempre ocultas
      document.querySelectorAll('#tabla-historial tr[data-pais]').forEach(tr => {
        tr.style.display = tr.dataset.pais === pais ? '' : 'none';
      });
    }

    filtrarPais(selectorPais.value); // Argentina por defecto (primera opción de SECCIONES)
    selectorPais.addEventListener('change', () => filtrarPais(selectorPais.value));

    document.querySelectorAll('.btn-descargar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const plataforma = btn.dataset.plataforma;
        const log = document.getElementById('log-' + plataforma);

        // Leer fechas opcionales (solo uber y mercadopago tienen estos campos)
        const inputDesde = document.querySelector('.input-desde[data-plataforma="' + plataforma + '"]');
        const inputHasta = document.querySelector('.input-hasta[data-plataforma="' + plataforma + '"]');
        const desde = inputDesde ? inputDesde.value : '';
        const hasta  = inputHasta ? inputHasta.value  : '';

        // Validación: ambas fechas o ninguna
        if ((desde && !hasta) || (!desde && hasta)) {
          log.textContent = '⚠ Completá ambas fechas (desde y hasta) o dejá las dos vacías.';
          log.style.color = '#f48771';
          log.classList.add('visible');
          return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Ejecutando…';
        log.textContent = '';
        log.classList.add('visible');

        const body = {};
        if (desde && hasta) { body.desde = desde; body.hasta = hasta; }

        try {
          const res = await fetch('/api/descargar/' + plataforma, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();

          if (data.ok) {
            log.textContent = '✓ Completado\\n' + (data.archivos?.join('\\n') || '') + (data.stdout ? '\\n' + data.stdout : '');
            log.style.color = '#4ec9b0';
            setTimeout(() => location.reload(), 1500);
          } else {
            log.textContent = '✗ Error\\n' + (data.error || '') + (data.stderr ? '\\n' + data.stderr : '');
            log.style.color = '#f48771';
          }
        } catch (e) {
          log.textContent = '✗ Error de red: ' + e.message;
          log.style.color = '#f48771';
        }

        btn.disabled = false;
        btn.textContent = '▶ Descargar ahora';
      });
    });
  </script>
</body>
</html>`);
});

// ── POST /api/descargar/:plataforma ─────────────────────────────────────────
app.post('/api/descargar/:plataforma', (req, res) => {
  const { plataforma } = req.params;
  const cfg = PLATAFORMAS[plataforma];

  if (!cfg) {
    return res.status(400).json({ ok: false, error: `Plataforma desconocida: ${plataforma}` });
  }

  const inicio = Date.now();
  let stdout = '';
  let stderr = '';

  // Añadir fechas al comando si la plataforma las soporta y el usuario las proporcionó
  let cmdArgs = [...cfg.args];
  if (cfg.fechasOpcionales) {
    const { desde, hasta } = req.body || {};
    if (desde && hasta) cmdArgs = [...cmdArgs, desde, hasta];
  }

  const proc = spawn(cfg.cmd, cmdArgs, {
    cwd: path.resolve('.'),
    shell: true,
  });

  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', code => {
    const duracion = ((Date.now() - inicio) / 1000).toFixed(1) + 's';

    // Listar archivos nuevos descargados por la carpeta de hoy
    const hoy = new Date().toISOString().slice(0, 10);
    const carpetaHoy = path.join(CARPETA_DESCARGAS, cfg.carpeta, hoy);
    let archivos = [];
    try {
      if (fs.existsSync(carpetaHoy)) {
        archivos = fs.readdirSync(carpetaHoy);
      }
    } catch (_) {}

    if (code === 0) {
      res.json({ ok: true, plataforma: cfg.label, duracion, archivos, stdout: stdout.slice(-2000) });
    } else {
      res.json({ ok: false, plataforma: cfg.label, duracion, codigo: code, error: stderr.slice(-2000) || stdout.slice(-2000), archivos });
    }
  });

  proc.on('error', err => {
    res.status(500).json({ ok: false, error: err.message });
  });
});

// ── Servir archivos descargados ──────────────────────────────────────────────
app.use('/descargas', express.static(CARPETA_DESCARGAS));

// ── Iniciar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Panel listo en http://localhost:${PORT}`);
});
