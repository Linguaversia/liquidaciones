# Rappi — motor de descarga de liquidaciones (notas para construir en Claude Code)

Reutilizar la misma arquitectura del motor de PedidosYa (login persistente + descarga),
pero adaptada al flujo de Rappi, que es DISTINTO y tiene DOS FASES.

## Login
- URL: https://partners.rappi.com/login
- Correo + contraseña + código SMS (una sola vez; sesión persistente en ./sesiones/rappi-argentina).
- Reusar el patrón de login.js de PedidosYa (guardar sesión al cerrar el navegador).

## Estructura
- Una cuenta, muchos locales (como PedidosYa). País se elige arriba a la derecha.
- Selector de Marca con opción "Todas" + botón "Aplicar".
- Sección: sidebar "Financiero".

## Flujo de descarga (DOS FASES)

### Fase 1 — Generar los reportes (hay que pedirlos cada semana)
1. En "Financiero" > pestaña "Resumen", seleccionar "Todas" las marcas y Aplicar.
2. Scroll a la tabla "Pagos en el periodo".
3. Para cada fila con estado "Pagado" (saltar "Balance 0 o negativo"):
   - Abrir el detalle (flecha ">" a la derecha).
   - Clic en "Descargar relación de ventas" (genera el reporte en segundo plano, formato .xls).
   - Volver a la lista y repetir.
- IMPORTANTE: necesitamos la lista de "ID Pago" con estado "Pagado".
  Buscar en F12 > Network un endpoint JSON (tipo "payments"/"summary") al cargar
  la pestaña Resumen, que devuelva las filas con su ID Pago y estado.
  El ID Pago de la tabla == paid_lot_id de la URL de descarga.

### Fase 2 — Descargar (URL DIRECTA, la gran ventaja)
- Los reportes generados aparecen en pestaña "Reportes" como "Rappi_ID_Pago_<id>", estado "Completado".
- La descarga es una URL DIRECTA:
  https://services.rappi.com/rests-partners-gateway/cauth/api/partner-report/v1/report?country=AR&paid_lot_id=<ID_PAGO>
- Es decir: con la lista de ID Pago "Pagados", el script puede bajar cada .xls
  llamando esa URL directamente (dentro de la sesión autenticada), sin clicar el historial.
- Hay que esperar a que el reporte esté "Completado" antes de descargar
  (puede tardar unos segundos tras pedirlo en Fase 1).

## Plan de construcción
1. login.js para Rappi (adaptar el de PedidosYa).
2. Cazar el endpoint JSON de pagos para obtener los ID Pago "Pagados".
3. Modo prueba: generar + descargar 2-3 pagos.
4. Escalar a todos los pagos del período.
5. Guardar en descargas/rappi-argentina/<fecha>/Rappi_ID_Pago_<id>.xls

## Pendiente de verificar en construcción
- El endpoint exacto que lista los pagos (URL + cómo viene el estado "Pagado").
- Tiempo de espera entre generar (Fase 1) y que aparezca "Completado".
- Si la URL directa de descarga funciona llamándola sola con la sesión activa.
