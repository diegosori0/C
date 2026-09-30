/**
 * Dashboard de Herrajes - Google Apps Script
 *
 * Este archivo es el "servidor" de la app. Solo hace dos cosas:
 *   1. Muestra la página (Index.html) cuando alguien abre la app.
 *   2. Le entrega a la página la lista de herrajes.
 *
 * Los datos de abajo son FICTICIOS. Para cambiarlos, edita la lista HERRAJES:
 * cada renglón es un producto. "stock" es lo que hay y "minimo" es la cantidad
 * a partir de la cual se considera que ya queda poco.
 */

var HERRAJES = [
  // codigo,     nombre,                              categoria,     material,          acabado,       stock, minimo, precio, ubicacion
  ['BIS-001', 'Bisagra de cazoleta 35 mm recta',      'Bisagras',    'Acero',           'Niquelado',     420,   100,   18.50, 'A-01'],
  ['BIS-002', 'Bisagra de cazoleta 35 mm codo',       'Bisagras',    'Acero',           'Niquelado',      85,   100,   19.90, 'A-01'],
  ['BIS-003', 'Bisagra cierre suave 110°',            'Bisagras',    'Acero',           'Niquelado',     260,    80,   42.00, 'A-02'],
  ['BIS-004', 'Bisagra de piano 1 m',                 'Bisagras',    'Acero',           'Latonado',        0,    20,   65.00, 'A-03'],
  ['JAL-001', 'Jaladera barra 128 mm',                'Jaladeras',   'Aluminio',        'Negro mate',    150,    50,   35.00, 'B-01'],
  ['JAL-002', 'Jaladera barra 192 mm',                'Jaladeras',   'Aluminio',        'Negro mate',     40,    50,   48.00, 'B-01'],
  ['JAL-003', 'Jaladera botón redonda',               'Jaladeras',   'Zamak',           'Cromo',         600,   150,   12.00, 'B-02'],
  ['JAL-004', 'Jaladera de embutir 96 mm',            'Jaladeras',   'Zamak',           'Satinado',        0,    40,   55.00, 'B-03'],
  ['JAL-005', 'Jaladera perfil gola 3 m',             'Jaladeras',   'Aluminio',        'Anodizado',      22,    15,  320.00, 'B-04'],
  ['COR-001', 'Corredera telescópica 45 cm',          'Correderas',  'Acero',           'Zincado',       190,    60,   89.00, 'C-01'],
  ['COR-002', 'Corredera telescópica 50 cm',          'Correderas',  'Acero',           'Zincado',        55,    60,   95.00, 'C-01'],
  ['COR-003', 'Corredera cierre suave 45 cm',         'Correderas',  'Acero',           'Zincado',       110,    40,  185.00, 'C-02'],
  ['COR-004', 'Corredera de rodillo 35 cm',           'Correderas',  'Acero',           'Blanco',          0,    30,   38.00, 'C-03'],
  ['CER-001', 'Cerradura para cajón',                 'Cerraduras',  'Zamak',           'Niquelado',      75,    30,   58.00, 'D-01'],
  ['CER-002', 'Cerradura de embutir para puerta',     'Cerraduras',  'Acero',           'Satinado',       18,    20,  240.00, 'D-02'],
  ['CER-003', 'Cerradura digital con código',         'Cerraduras',  'Acero',           'Negro',          12,     5, 1450.00, 'D-03'],
  ['MAN-001', 'Manija de palanca para puerta',        'Manijas',     'Acero inoxidable','Satinado',       64,    25,  310.00, 'E-01'],
  ['MAN-002', 'Manija de pomo',                       'Manijas',     'Latón',           'Latón antiguo',   9,    15,  265.00, 'E-01'],
  ['SOP-001', 'Soporte para repisa 20 cm',            'Soportes',    'Acero',           'Blanco',        340,   100,   22.00, 'F-01'],
  ['SOP-002', 'Soporte invisible para repisa',        'Soportes',    'Acero',           'Zincado',        95,    50,   68.00, 'F-02'],
  ['SOP-003', 'Pata niveladora para mueble 10 cm',    'Soportes',    'Plástico',        'Negro',         800,   200,    9.50, 'F-03'],
  ['TOR-001', 'Tornillo para aglomerado 4x30 (100)',  'Tornillería', 'Acero',           'Zincado',       250,    80,   45.00, 'G-01'],
  ['TOR-002', 'Tornillo minifix con excéntrico (50)', 'Tornillería', 'Zamak',           'Natural',        30,    40,   79.00, 'G-02'],
  ['TOR-003', 'Taquete de madera 8 mm (100)',         'Tornillería', 'Madera',          'Natural',         0,    50,   32.00, 'G-03']
];

/** Se ejecuta cuando alguien abre la URL de la app web. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Dashboard de Herrajes')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** La página llama a esta función para obtener los herrajes. */
function getHerrajes() {
  return HERRAJES.map(function (h) {
    var stock = h[5];
    var minimo = h[6];
    var estado = stock === 0 ? 'Agotado' : (stock <= minimo ? 'Bajo stock' : 'Disponible');
    return {
      codigo: h[0],
      nombre: h[1],
      categoria: h[2],
      material: h[3],
      acabado: h[4],
      stock: stock,
      minimo: minimo,
      precio: h[7],
      ubicacion: h[8],
      estado: estado
    };
  });
}
