# wikipedia-noticias

Un portal para **explorar las noticias de Wikipedia**, con un feed RSS como alternativa para quien prefiera un lector.

Las noticias salen de [Portal:Current events](https://en.wikipedia.org/wiki/Portal:Current_events) de la Wikipedia en inglés (solo en inglés): un item por cada entrada de las páginas diarias de los últimos 7 días. Un generador en Python (3.12, la versión de los workflows; solo biblioteca estándar) las recoge dos veces al día y escribe:

| Archivo | Qué es |
| --- | --- |
| `feeds/en.xml` | El feed RSS 2.0 (los 50 items más recientes). |
| `data/news.json` | Todas las noticias de los últimos 6 meses (183 días), para la web. |
| `state/en.json` | El estado (qué se vio y cuándo); evita duplicados entre ejecuciones. |

La web es estática (HTML + JS sin dependencias) y la sirve GitHub Pages:

- [`index.html`](index.html): la portada, con aspecto de periódico: las noticias día a día en una cuadrícula cuyo tamaño depende de la longitud del texto, solo de los últimos 30 días (`HOME_DAYS` en `assets/site.js`); el historial completo de `data/news.json` se usa en los enlaces "More on…" de cada noticia.
- [`story.html`](story.html)`?id=...`: la **página de una noticia**: todos sus titulares completos, con sus fuentes, y una tarjeta que enlaza al artículo de Wikipedia. Es a donde llevan los enlaces del feed RSS (ver *La página de cada noticia*).

La interfaz de la web está solo en inglés, igual que las noticias.

## Uso local

```sh
python3 wikipedia_rss.py                    # -> feeds/, data/ y state/
python3 wikipedia_rss.py --dry-run -v       # no escribe nada, muestra los 10 primeros items
python3 wikipedia_rss.py --cache .cache     # caché HTTP en disco (30 min), útil al desarrollar
python3 wikipedia_rss.py --site-url http://localhost:8000   # los items del feed enlazan a la web local
python3 -m unittest discover -s tests       # tests (sin red)
python3 -m http.server 8000                 # la web local, en http://localhost:8000
```

Otras opciones (`python3 wikipedia_rss.py --help`): `--days N` (páginas diarias a leer, 7 por defecto), `--out DIR` (feed), `--data DIR` (datos de la web), `--state DIR`, `--max-items N` (items del feed RSS, 50), `--site-url URL` (URL pública de la web, ver abajo), `--retention-days N` (183, ver *Retención*), `--max-group N` (6, ver *Agrupación*). También funciona `python3 -m wikipedia_rss`.

`--site-url` es la raíz de la web (la que sirve `index.html`, sin barra final). Con ella, cada item del feed enlaza a su página en la web y el feed lleva `atom:link rel="self"`; sin ella, los items enlazan directamente al artículo de Wikipedia. El workflow la calcula solo.

El código de salida es 1 si la generación falla; en ese caso no se escribe nada.

## La página de cada noticia

Un item del feed es una **noticia**: un titular, o varios sobre el mismo artículo (el más cercano) y el mismo día (ver *Agrupación*). Cuando se añade un titular a una noticia ya publicada, el item cambia de título pero conserva su `guid`, y muchos lectores de RSS no actualizan los títulos de items que ya tienen: ven el título "truncado", sin los últimos titulares.

Por eso el enlace de cada item del feed lleva a `story.html?id=<id>` en la web, la **página del artículo**: **todos sus titulares, completos**, con sus fuentes y la página del portal de origen, una **tarjeta** que enlaza al artículo de Wikipedia (y una por cada artículo mayor bajo el que está anidado), las tarjetas de las fuentes y los otros artículos del día y del mismo artículo en otros días.

La descripción de cada item del feed sigue llevando el texto completo, las fuentes y los enlaces, para quien lo lea sin salir del lector.

### Tarjetas de las fuentes

Debajo de la tarjeta del artículo, la página de cada noticia muestra una tarjeta por cada fuente citada con su **título, descripción e imagen** (la etiqueta `og:*`/`twitter:*` de la página, o `<title>` y `meta description` si faltan), **solo si se pudieron obtener**: las webs de noticias no se pueden rastrear de forma uniforme y muchas bloquean a los bots, así que una fuente sin vista previa simplemente no tiene tarjeta.

- Las obtiene el generador ([`wikipedia_rss/sources.py`](wikipedia_rss/sources.py)), no el navegador, y **una sola vez por URL**: un fallo se reintenta como mucho 3 veces en total, con un día de separación. Máximo 150 descargas por ejecución (las más recientes primero), 8 sitios en paralelo pero una petición por sitio cada segundo, 10 s de espera y solo se lee el principio de la página. Se respeta `robots.txt`. Un fallo nunca hace fallar la ejecución.
- `state/sources.json` guarda todo lo sabido por URL (incluidos los fallos y su motivo); `data/sources.json` es lo que lee la web: solo las vistas previas encontradas de las URL que siguen en `data/news.json`.
- Las imágenes **no se descargan**: la web enlaza la imagen de la fuente (`loading="lazy"`, sin enviar el referrer) y la oculta si no carga.
- Se identifica con un User-Agent genérico **sin datos de contacto** (los datos de contacto son solo para Wikipedia); se cambia con `WIKIPEDIA_RSS_SOURCES_USER_AGENT`. `--no-source-previews` lo desactiva.

## Fechas de los items

No se usa la fecha del infobox del artículo ni la de Wikidata: las fechas de infobox son texto libre, a menudo faltan o se refieren a otra cosa (inicio de un conflicto, fecha de nacimiento...). En su lugar, la fecha de un item es la de la página diaria en la que aparece la entrada (`page_date`), a las 00:00 UTC; si el item se ve por primera vez ese mismo día, su `pub_date` es el momento en que el generador lo vio.

## Deduplicación y estado

Cada titular (una entrada del portal) tiene un `guid` estable: `wikipedia:en:<fecha>:<hash del texto>`. Si alguien edita el texto, el item se reconoce por fecha + primera URL de fuente y conserva su guid.

`state/en.json` guarda en `items` cada titular con `first_seen` y `pub_date`. Un titular ya conocido conserva su `pub_date` aunque se actualice su contenido, así los lectores no lo marcan como nuevo. El feed muestra los `--max-items` items más recientes y la web, todos los que hay en el estado. `state/`, `feeds/` y `data/` se versionan en git: el estado es lo que evita duplicados entre ejecuciones.

### Retención: las noticias de más de 6 meses se borran

Para que el repositorio y la web no crezcan indefinidamente, **las noticias con más de 183 días (unos 6 meses) se borran**: del estado (`state/en.json`), del feed RSS y de la web (`data/news.json`). El valor está en `RETENTION_DAYS` de [`wikipedia_rss/config.py`](wikipedia_rss/config.py) y se cambia con `--retention-days`.

- La antigüedad es la `pub_date` del titular (la fecha de su página diaria), no cuándo dejó de aparecer en el portal (los que dejan de aparecer en una página que se sigue leyendo se borran antes: ver *Titulares que ya no están en la página*). Una noticia de más de 183 días se borra aunque siga en el portal, y si el portal la volviera a mostrar se ignora (como el generador solo lee 7 días, en la práctica no ocurre).
- Un grupo (ver *Agrupación*) se borra entero cuando lo hace su fundador: todos sus titulares son del mismo día.
- Lo que se borra del estado no vuelve. Tras borrarla, la página de una noticia (`story.html?id=...`) muestra un aviso con un enlace al portal de Wikipedia; un enlace del feed a una noticia de más de 6 meses ya no abre contenido.
- La web lo indica al pie de cada página ("News older than 6 months is removed from this site").

### Agrupación por artículo

Varios titulares **del mismo día** sobre el mismo artículo principal (mismo `pageid`; o mismo título si el artículo no existe) se publican como **un solo item**. Las entradas sin artículo principal (enlazan a la página diaria) no se agrupan nunca.

- **Artículo principal = el del tema de nivel superior**: el portal anida las entradas bajo líneas de tema (categoría > tema > subtema > entrada). El artículo principal es el primer enlace del tema **más externo** (p. ej. *APEC China 2026*), no el del más interno, así que las entradas de distintos subtemas (*Chile–Philippines relations*, *China–Russia relations, China–United States relations, Russia–United States relations*) forman una sola noticia. Una entrada de primer nivel (directamente bajo la categoría) no tiene tema ni artículo: sigue enlazando a la página diaria del portal y la web la titula con su categoría (p. ej. *Armed conflicts and attacks*).
- **Todos los artículos del tema**: de cada línea de tema se guardan **todos** sus enlaces (`topics[].links`) y, de los que existen, el extracto (`topic_articles`). La página de la noticia muestra la tarjeta del artículo principal y una tarjeta por cada uno de los demás (`more_articles` en `data/news.json`, en el orden del portal); la descripción del item RSS enlaza todos los de cada línea y, en un grupo, lista la ruta de temas de cada titular.
- **Dos vistas: la portada anida, la página de un artículo agrupa por el artículo más cercano**: una **noticia** (`stories` de `data/news.json`, y un item del feed) son las entradas de un día sobre el **artículo más cercano** a ellas (la línea de tema más interna que enlaza un artículo): *2026 Yemen offensives* con sus dos entradas, *Houthi–Saudi conflict* con una, o una entrada del portal sin artículo. El feed titula cada item con ese artículo como **prefijo** (`Houthi–Saudi conflict: <titular>`; varios titulares: `2026 Lebanon war: <titular> / <titular>`); una entrada de primer nivel (sin tema) no lleva prefijo. Las noticias de un mismo día anidadas bajo el mismo artículo de nivel superior comparten `group` (id del grupo): la **portada** las muestra juntas como una caja con la jerarquía del portal (los subtemas con varias entradas son grupos sin caja propia, con su título una vez y, si tienen 3 o más entradas, el comienzo de su artículo como primera columna), hasta 3 niveles (`MAX_LEVELS` en `assets/site.js`; lo más profundo cuenta como el último). Un subtema con una sola entrada no es un grupo: su entrada pasa al grupo superior con el subtema como contexto, y un subtema que solo contiene otro se muestra como uno, con los dos títulos. **No hay página para un grupo grande**: solo la portada y la página de cada artículo, a la que enlaza cada entrada de la portada y cada item del feed (`story.html?id=<noticia>`). Esa página muestra dónde está el artículo (migas con los artículos mayores bajo los que está anidado), las entradas, la tarjeta de su artículo y las de los demás de sus líneas de tema, y los **otros artículos del mismo día** bajo el mismo artículo de nivel superior (*Also on <día> › …*). El guid, la pubDate y el `first_seen` de una noticia son los de su titular más antiguo, así que no cambian al añadirse titulares. (`state.rss_items`.)

- **Día**: el día (UTC) de la `pub_date` del titular, es decir, la fecha de su página diaria. El día de un grupo es el de su fundador (el titular más antiguo, cuya `pub_date` guarda el grupo), y un titular nuevo se compara siempre con él.
- **Desarrollos posteriores**: un titular de un día posterior al del grupo no se une a él, sino que abre un **item nuevo** (con su propio guid y pubDate), que a su vez agrupa a los titulares de ese día. Así una historia que se desarrolla vuelve a aparecer como nueva en el lector. P. ej. *2026 West Bank lockdown* el 23 y el 24 de octubre son dos items.
- **Título** (de la noticia en la web, y de un item del feed sin el prefijo): los titulares unidos con ` / ` del más antiguo al más reciente, en lo posible: el orden **inverso** al del portal. Se toma la página diaria más antigua primero y, dentro de una página, de abajo arriba del documento. Se invierte porque el portal pone las páginas más recientes arriba y a veces el seguimiento de una noticia encima de la principal. Dentro de una misma página diaria el documento no es estrictamente cronológico (se ordena por temas y a menudo el seguimiento va debajo), así que esto es una aproximación. Si hay más de 3, solo los 3 primeros y `… (+N more)`.
- **Descripción**: cada titular con sus fuentes, en el orden del título; después los temas una sola vez, y una línea de atribución por cada página del portal usada. **Categorías**: unión sin duplicados, en el orden del título.
- **guid y pubDate** son los del fundador y no cambian al añadirse titulares: el item cambia de contenido, pero los lectores no lo ven como nuevo. El fundador no depende del orden de visualización: es el primero según (`pub_date`, `first_seen`, posición en el portal); entre titulares nuevos de una misma página, el primero del documento (que en el título sale el último). Se guardan en `groups` del estado: `{guid del grupo: {members: [guids de titulares], first_seen, pub_date}}`. Las asignaciones no se revisan nunca, lo que mantiene los guids estables; un titular agrupado sigue en `items` (no reaparece como item suelto).
- **Ventana**: un titular nuevo solo se une a un item que siga *vigente*, es decir, con algún titular presente en el portal en esta ejecución.
- **Tope**: como mucho `--max-group` titulares por item (100: en la práctica todos los de un artículo y un día; un tope bajo partía una noticia grande en varias). Al llenarse, el siguiente titular del mismo día empieza otro item (que a su vez agrupa a los siguientes). No se descarta ningún titular. `--max-group 1` desactiva la agrupación.

**Migración**:

- Un estado sin la marca `grouping` de la versión actual (`GROUPING_VERSION` en `wikipedia_rss/state.py`; 3 = artículo del tema más externo y sin partir las noticias grandes, 2 = el mismo con tope de 6, 1 = el del tema más interno) se reagrupa **una vez**: los grupos con algún titular aún en el portal se deshacen y esos titulares se agrupan con la regla nueva. Los grupos más antiguos (que ya no están en el portal) se dejan como estaban. Los guids de los items cuyo grupo cambia cambian una vez; un lector de RSS puede mostrarlos como nuevos.
- Un estado sin la clave `groups` (de versiones anteriores a la agrupación) se reagrupa en la primera ejecución: los titulares presentes en el portal se agrupan con las reglas anteriores (mismo artículo y mismo día), cada grupo reutiliza el guid y la pubDate del miembro más antiguo (así no aparece como item nuevo) y los guids absorbidos desaparecen del feed, aunque siguen en `items` para no volver a salir sueltos.
- Los grupos creados por la versión que agrupaba entre días se deshacen en cada ejecución (es idempotente): los miembros cuyo día no es el del grupo vuelven a ser items propios con su guid de titular (`wikipedia:en:<fecha>:<hash>`), con su `pub_date` y `first_seen` de siempre; no se reagrupan entre sí. El grupo conserva su guid, su pubDate y los miembros de su día; si solo le queda el fundador, desaparece el registro del grupo y el fundador sigue publicándose con el mismo guid. Ningún titular se pierde ni cambia de guid.
- Las marcas `gone_since` y `last_seen` de versiones anteriores se eliminan del estado (la retención ya no depende de ellas).

### Titulares que ya no están en la página

Un titular que **desaparece de una página diaria que se ha leído en esta ejecución** se borra del estado, del feed y de la web: los editores lo quitaron, o lo reescribieron. Una entrada editada solo se reconoce como la misma si conserva la fecha y la primera fuente (así conserva su guid); si cambian el texto **y** la fuente (p. ej. *Two Salvadoran soldiers are killed…* pasó a *Three Salvadoran soldiers are killed…* con otra fuente), es un titular nuevo y el viejo es el que ya no está en la página.

- Solo cuentan las páginas leídas en esta ejecución (las de los últimos `--days`, 7): si una página no se pudo leer, no se borra nada de ella, y los titulares de páginas más antiguas se quedan hasta que los borra la retención.
- **Salvaguarda**: si una página pierde de golpe más de la mitad de sus titulares (y más de 2), probablemente está vacía o mal leída, no editada; no se borra ninguno de ella y se avisa en el log (`state.removed_from_pages`). Si no, volverían como titulares nuevos.
- Un grupo sigue existiendo mientras le quede algún titular, aunque se borre el que lo fundó (el grupo conserva su guid); si se borran todos, desaparece.

### Salida estable

Una ejecución sin cambios reales deja `feeds/`, `data/` y `state/` idénticos byte a byte (y no reescribe los archivos). Cambio real es un item nuevo, uno que se borra por retención, un titular que se une a un grupo (o sale de él por la migración), o un cambio en el contenido de un item (título, descripción, enlaces, categoría, fecha, extracto del artículo). Que un titular desaparezca de una página diaria **sí** es un cambio (se borra, ver *Titulares que ya no están en la página*); los de páginas que no se leyeron en la ejecución se quedan hasta que los borra la retención. No se guardan marcas de tiempo por ejecución:

- `updated` en el estado es el momento del último cambio real, y es también el `lastBuildDate` del feed y el "última actualización" de la web.

Las claves de los JSON van ordenadas y los items en orden estable (`pub_date`, `first_seen`, posición en el portal).

## Caché de los assets

El navegador guarda `assets/site.css` y `assets/site.js` en caché, así que sin más un cambio en ellos no se vería hasta que caducase. Por eso cada referencia a un asset en `index.html` y `story.html` lleva `?v=<hash del contenido del archivo>` (`assets/site.css?v=a1dcb48e37`): la URL cambia exactamente cuando cambia el archivo.

```sh
python3 -m wikipedia_rss.stamp          # sella las referencias desactualizadas
python3 -m wikipedia_rss.stamp --check  # solo avisa (código de salida 1 si alguna lo está)
```

**Tras cambiar `assets/site.css` o `assets/site.js`, ejecuta el comando antes de hacer commit.** Hay un test que falla si se olvida (`tests/test_stamp.py`), y el workflow programado sella antes de hacer commit por si acaso. Los datos se tratan aparte (ver abajo).

### Caché de los datos

`data/news.json` y `data/sources.json` cambian dos veces al día, y el navegador no debe servir una copia vieja ni volver a descargarlas si no han cambiado. El generador escribe al final `data/version.json` con un hash de cada uno (`{"news": "7354ab25f3", "sources": "f4d9aed1b1"}`). Las páginas piden ese archivo pequeño **sin caché** (`cache: "no-store"`) y después `data/news.json?v=<hash>` y `data/sources.json?v=<hash>`: mientras el archivo no cambia, la URL es la misma y el navegador la guarda; cuando cambia, la URL es otra. Si `version.json` no existe o falla, se piden los archivos sin `?v=` (`site.data_version`, `loadVersions` en `assets/site.js`). No hay que hacer nada a mano: lo escribe cada ejecución del generador.

## Despliegue con GitHub Actions + Pages

El workflow [`.github/workflows/update-feeds.yml`](.github/workflows/update-feeds.yml) se ejecuta **dos veces al día** (06:17 y 18:17 UTC) y a mano (`workflow_dispatch`): genera el feed y los datos de la web y hace commit de `state/`, `feeds/` y `data/` solo si hubo cambios reales (ver *Salida estable*); si Wikipedia no cambió, no hay commit. Se leen las páginas diarias de los últimos 7 días (`--days`), lo que cubre de sobra el medio día entre ejecuciones, las ediciones tardías de las páginas de días anteriores y alguna ejecución que GitHub se salte. Los tests corren aparte ([`tests.yml`](.github/workflows/tests.yml), en push y pull request) para que un test roto nunca impida actualizar. Pages sirve la rama `main` tal cual (`index.html` en la raíz, `.nojekyll` para saltarse Jekyll).

1. Crea un repositorio en GitHub y sube el código a la rama `main`.
2. **Settings > Actions > General > Workflow permissions**: marca *Read and write permissions* (el workflow necesita hacer push). Comprueba también que Actions está permitido en el repositorio.
3. **Settings > Pages**: *Source: Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. Opcional, en **Settings > Secrets and variables > Actions > Variables**:
   - `WIKIPEDIA_RSS_USER_AGENT`: tu User-Agent con contacto (ver abajo).
   - `SITE_URL`: si usas dominio propio, la raíz de la web (p. ej. `https://noticias.example.org`). Por defecto se usa `https://<usuario>.github.io/<repo>`.
5. **Actions > Actualizar feeds > Run workflow** para la primera ejecución (hasta entonces no existe `data/news.json` y la web no tiene noticias que mostrar). La web queda en `https://<usuario>.github.io/<repo>/` y el feed en `https://<usuario>.github.io/<repo>/feeds/en.xml`.

Si la generación falla, el job termina en rojo para que lo veas (no se escribe nada). El push reintenta con `git pull --rebase` si alguien ha empujado a la vez; `concurrency` impide dos ejecuciones simultáneas. El cron de GitHub no es puntual: con carga, las ejecuciones pueden retrasarse o saltarse alguna.

### Desactivación por inactividad

GitHub desactiva los workflows programados de repositorios públicos tras 60 días sin actividad en el repo. Los commits que hace el propio workflow cuentan como actividad, pero solo se hacen cuando hay cambios reales (en la práctica casi todos los días: el portal añade entradas a diario). Por si Wikipedia no cambiara durante mucho tiempo, el paso *Keepalive* escribe la fecha en `state/.keepalive` si el último commit tiene 45 días o más, lo que fuerza un commit antes de llegar a los 60 días.

No está documentado con precisión qué cuenta como "actividad" ni si los commits del bot bastan siempre, así que **conviene mirar la pestaña Actions de vez en cuando**. Si el workflow aparece desactivado, se reactiva con *Enable workflow*.

## Alternativas de ejecución

**launchd en macOS**: [`deploy/launchd/org.example.wikipedia-noticias.plist`](deploy/launchd/org.example.wikipedia-noticias.plist) es un agente de ejemplo comentado que ejecuta el script cada hora (`StartInterval`; puedes subirlo a 43200 para igualar el workflow de dos veces al día). Como las ejecuciones sin cambios no tocan los archivos, ejecutarlo más a menudo no genera ruido. Sustituye las rutas `/RUTA/AL/REPO` y sigue las instrucciones del comentario. Solo genera los archivos; publicarlos (push, rsync...) corre de tu cuenta.

**Cloudflare Workers** (posible migración futura): con un Cron Trigger se evitaría depender de Actions, pero requeriría portar el código a JavaScript/TypeScript (el parser HTML incluido) y guardar el estado en KV o D1 en lugar de en git.

## Licencia, atribución y User-Agent

El texto de la web y del feed procede de colaboradores de Wikipedia y está bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es). El feed lo indica en `<copyright>`, la web en su pie, y cada noticia enlaza al artículo y al historial de la página de origen; si redistribuyes el contenido, mantén esa atribución y la misma licencia. Proyecto no oficial, sin relación con la Fundación Wikimedia.

La [política de User-Agent de Wikimedia](https://meta.wikimedia.org/wiki/User-Agent_policy) pide un User-Agent identificable con forma de contacto. Se configura con la variable de entorno `WIKIPEDIA_RSS_USER_AGENT` (por defecto, el de `DEFAULT_USER_AGENT` en `config.py`):

```sh
WIKIPEDIA_RSS_USER_AGENT="wikipedia-noticias-rss/0.1 (https://github.com/<usuario>/<repo>; tu@email)" python3 wikipedia_rss.py
```

El generador hace pocas peticiones por ejecución (las imprime en el log) y de forma secuencial.
