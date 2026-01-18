CONTROL DE GASTOS — v1 (Economía doméstica)

Qué incluye
- Ingresos y gastos con categorías.
- Tres cuentas: Efectivo / Tarjeta / Banco, con saldo inicial.
- Transferencias entre cuentas (no cuentan como ingreso/gasto).
- Presupuesto (topes) por categoría desde el primer día.
- Periodo configurable:
  - Mes natural (día 1 a 30/31)
  - De cobro a cobro (día de inicio configurable; si un mes no tiene ese día, se usa el último día del mes)
- Ajustes: apariencia (claro suave por defecto, oscuro, alto contraste), gestión de categorías, saldos iniciales.
- Copia de seguridad completa en JSON (exportar/importar).
- Impresión y exportación a Excel (.XLSX) en:
  - Panel (Resumen + varias hojas)
  - Movimientos
  - Presupuesto
  - Cuentas y extractos

Cómo usar
1) Abre index.html en tu móvil o PC.
2) Ve a AJUSTES:
   - Elige el modo de periodo (mes natural o cobro a cobro).
   - Ajusta el día de inicio si usas cobro a cobro.
   - Configura saldos iniciales en Efectivo/Tarjeta/Banco (si corresponde).
   - Define categorías (opcional).
3) Ve a PRESUPUESTO y asigna topes por categoría.
4) Añade movimientos desde el botón + de la cabecera o desde "Movimientos".
5) En cualquier pantalla, usa:
   - Imprimir (crea una vista limpia y lanza la impresora/Guardar PDF)
   - Exportar XLSX (genera un Excel real con tablas claras)

Notas técnicas
- Los datos se guardan en IndexedDB en el navegador/dispositivo (uso offline).
- Se incluye un Service Worker para cachear los ficheros y poder abrir la app sin conexión.
- Para máxima seguridad de datos: Exporta un JSON de backup de forma periódica.

Archivos principales
- index.html
- assets/css/styles.css
- assets/js/app.js (lógica y pantallas)
- assets/js/db.js (IndexedDB)
- assets/js/xlsx-mini.js (exportación XLSX)
- assets/js/print.js (impresión)
- sw.js (offline cache)
- manifest.json

