# ⚽ Pronósticos de fútbol (Google Apps Script)

Busca los próximos partidos (Liga MX, Champions, LaLiga, Premier, Serie A, Bundesliga, Ligue 1,
Europa League, Concachampions, Libertadores, MLS, etc.) y estima **la mejor apuesta** de cada uno.

## Instalación
1. Crea una Hoja de cálculo de Google → **Extensiones → Apps Script**.
2. Pega `Codigo.gs` (y opcionalmente `appsscript.json` desde *Configuración → Mostrar manifiesto*).
3. Ejecuta `actualizarPronosticos` y acepta permisos.
4. Recarga la hoja: menú **⚽ Apuestas** → *Actualizar pronósticos* / *Programar actualización diaria*.

## Panel web (Index.html)
1. En el editor de Apps Script: **+ → HTML**, nómbralo `Index` y pega `Index.html`.
2. Ábrelo desde la hoja con **⚽ Apuestas → Abrir panel**, o publícalo como página web:
   **Implementar → Nueva implementación → Aplicación web** y abre la URL (también desde el celular).
3. Si abres `Index.html` directo en el navegador, muestra datos de ejemplo.

## Cómo calcula
- **Nivel actual:** últimos 10 partidos de cada equipo (los más recientes pesan más):
  goles a favor, en contra y puntos por partido. En copas internacionales suma también su liga local.
- **Fuerza ataque/defensa** relativa a la media de goles de la liga, suavizada si hay pocos datos.
- **Ventaja de local**, **diferencia de forma** y **enfrentamientos directos (H2H)**.
- **Modelo Poisson + Dixon-Coles** → probabilidades de 1/X/2, doble oportunidad, más/menos goles,
  ambos anotan y marcador más probable.
- **Mejor apuesta:** si ESPN trae cuotas y alguna tiene valor esperado positivo → `VALOR`;
  si no, el mercado más probable con cuota justa ≥ 1.25 → `PROBABLE`.
- **Confianza** (0-100) = probabilidad × peso de la liga × cantidad de datos. Ordena el ranking.

Hojas generadas: **Pronósticos** (todos) y **Top Apuestas** (los 10 mejores).
Ajusta ligas, pesos y parámetros en el objeto `CONFIG`. Pon tu correo en `EMAIL_TOP` para recibir el Top.

> Modelo estadístico, no garantía. Apuesta con responsabilidad.
