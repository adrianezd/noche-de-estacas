# Noche de estacas

Juego de fiesta sin narrador para 5 a 14 jugadores: cazadores contra vampiros que se conocen entre ellos. De noche los vampiros muerden; de día se vota a quién clavar la estaca. Quien cae sigue como fantasma: vota de día y de noche vela por alguien para salvarlo.

🔗 **Jugar ahora:** https://adrianezd.github.io/noche-de-estacas/

## Dos modos

- **Mismo móvil:** el móvil se pasa de mano en mano para las fases secretas y hace de narrador. Funciona sin conexión.
- **Con código de sala:** uno crea la sala y elige los ajustes; el resto entra con el código y cada uno juega en su móvil. Los móviles se comunican por [ntfy.sh](https://ntfy.sh) (sin cuentas), así que hace falta internet.

## Reglas

- Modo básico (cazadores y vampiros) o avanzado (rastreadora, herbolario, veterano, conde y sombra).
- Ganan los cazadores si no queda ningún vampiro vivo; ganan los vampiros si igualan a los vivos del otro equipo.

## Stack técnico

Sitio estático sin dependencias ni build: HTML, CSS y JavaScript vanilla servidos por GitHub Pages.

- `script.js`: el juego. Un único motor (`act`, `privateTurn`, `render`) para los dos modos.
- `mesa.js`: modo «Mismo móvil», igual en los juegos de fiesta por fases.
- `sala.js` y `sala.css`: modo con código de sala, iguales en todos los juegos de fiesta.
- `kit.js` y `style.css`: piezas y estilos comunes. `juego.css`: lo propio de este juego.
- `sw.js`: caché para jugar sin conexión.

## Aviso

Juego de fiesta **original**, no afiliado a ninguna marca, producto o juego comercial.
