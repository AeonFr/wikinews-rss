# wikipedia-noticias

Un portal para **explorar las noticias de Wikipedia**, con un feed RSS como alternativa para quien prefiera un lector.

Las noticias salen de [Portal:Current events](https://en.wikipedia.org/wiki/Portal:Current_events) de la Wikipedia en inglés (solo en inglés): un item por cada entrada de las páginas diarias de los últimos 7 días. Un generador en Python (3.12, la versión de los workflows; solo biblioteca estándar) las recoge dos veces al día y escribe:

| Archivo | Qué es |
| --- | --- |
| `feeds/en.xml` | El feed RSS 2.0 (los 50 items más recientes). |
| `data/news.json` | Todas las noticias de los últimos 6 meses (183 días), para la web. |
| `state/en.json` | El estado (qué se vio y cuándo); evita duplicados entre ejecuciones. |
| `state/articles.json` | Mapa y ubicación del infobox de los artículos (ver *Mapa y ubicación del artículo*). |

La web es un sitio estático hecho con [Astro](https://astro.build) (carpeta [`web/`](web/), TypeScript, CSS Modules, tests con vitest) que **no necesita JavaScript** para leerse (solo un script mínimo que muestra la hora de "última actualización" en la zona horaria del visitante). Lo construye y lo publica en GitHub Pages el workflow (ver *Despliegue con GitHub Actions + Pages*):

- `/`: la portada, con aspecto de periódico: primero *Topics in the news* y debajo las noticias día a día, solo de los últimos 30 días; el historial completo de `data/news.json` se usa en la sección *Related articles* de cada noticia (las noticias del mismo artículo de la semana anterior y posterior, y la anterior y la posterior más cercanas si no hay ninguna en esa semana, para poder recorrer todo el historial con "anterior" y "siguiente").
- `/articles/<id>/`: la **página de una noticia**: todos sus titulares completos, con sus fuentes, y una tarjeta que enlaza al artículo de Wikipedia. Es a donde llevan los enlaces del feed RSS (ver *La página de cada noticia*).
- `/feeds/en.xml`: el feed RSS.

La interfaz de la web está solo en inglés, igual que las noticias.

## Uso local

```sh
python3 wikipedia_rss.py                    # -> feeds/, data/ y state/
python3 wikipedia_rss.py --dry-run -v       # no escribe nada, muestra los 10 primeros items
python3 wikipedia_rss.py --cache .cache     # caché HTTP en disco (30 min), útil al desarrollar
python3 wikipedia_rss.py --site-url http://localhost:4321   # los items del feed enlazan a la web local
python3 -m unittest discover -s tests       # tests del generador (sin red)
```

### La web (`web/`)

Hace falta Node 22.23.4 o superior (la última 22.x, como en los workflows). Se construye a partir de lo que escribe el generador: lee `../data/news.json`, `../data/sources.json` y `../feeds/en.xml` (que copia a `public/feeds/`, ignorado por git), así que hay que haber generado los datos antes (o usar los que hay en el repositorio).

```sh
cd web
npm ci                                  # instala las dependencias
npm run dev                             # servidor de desarrollo en http://localhost:4321
npm test                                # tests (vitest)
npx astro check                         # tipos
SITE_URL=https://usuario.github.io/repo npm run build   # sitio estático en web/dist/
npm run preview                         # sirve web/dist/
```

`SITE_URL` es la URL pública completa, con su ruta si la tiene (sin ella, `http://localhost:4321`); todos los enlaces internos respetan esa ruta base. Más detalles en [`web/README.md`](web/README.md). Los datos que lee la web (`data/news.json`, `data/sources.json`) están descritos en la sección 2 de [`docs/site-spec.md`](docs/site-spec.md), que es el contrato entre el generador y la web: si cambia el formato, hay que cambiar los dos lados. La caché de los archivos generados la resuelve Astro con nombres con hash; no hay nada que sellar a mano.

Otras opciones (`python3 wikipedia_rss.py --help`): `--days N` (páginas diarias a leer, 7 por defecto), `--out DIR` (feed), `--data DIR` (datos de la web), `--state DIR`, `--max-items N` (items del feed RSS, 50), `--site-url URL` (URL pública de la web, ver abajo), `--retention-days N` (183, ver *Retención*), `--max-group N` (6, ver *Agrupación*). También funciona `python3 -m wikipedia_rss`.

`--site-url` es la raíz de la web (URL completa, con su ruta si la tiene, sin barra final). Con ella, cada item del feed enlaza a su página en la web y el feed lleva `atom:link rel="self"`; sin ella, los items enlazan directamente al artículo de Wikipedia. El workflow la calcula solo.

El código de salida es 1 si la generación falla; en ese caso no se escribe nada.

## La página de cada noticia

Un item del feed es una **noticia**: un titular, o varios sobre el mismo artículo (el más cercano) y el mismo día (ver *Agrupación*). Cuando se añade un titular a una noticia ya publicada, el item cambia de título pero conserva su `guid`, y muchos lectores de RSS no actualizan los títulos de items que ya tienen: ven el título "truncado", sin los últimos titulares.

Por eso el enlace de cada item del feed lleva a `/articles/<id>/` en la web, la **página del artículo**: **todos sus titulares, completos**, con sus fuentes y la página del portal de origen, una **tarjeta** que enlaza al artículo de Wikipedia (y una por cada artículo mayor bajo el que está anidado), las tarjetas de las fuentes y los otros artículos del día y del mismo artículo en otros días.

La descripción de cada item del feed sigue llevando el texto completo, las fuentes y los enlaces, para quien lo lea sin salir del lector.

### Tarjetas de las fuentes

Debajo de la tarjeta del artículo, la página de cada noticia muestra una tarjeta por cada fuente citada con su **título, descripción e imagen** (la etiqueta `og:*`/`twitter:*` de la página, o `<title>` y `meta description` si faltan), **solo si se pudieron obtener**: las webs de noticias no se pueden rastrear de forma uniforme y muchas bloquean a los bots, así que una fuente sin vista previa simplemente no tiene tarjeta.

- Las obtiene el generador ([`wikipedia_rss/sources.py`](wikipedia_rss/sources.py)), no el navegador, y **una sola vez por URL**: un fallo se reintenta como mucho 3 veces en total, con un día de separación. Máximo 150 descargas por ejecución (las más recientes primero), 8 sitios en paralelo pero una petición por sitio cada segundo, 10 s de espera y solo se lee el principio de la página. Se respeta `robots.txt`. Un fallo nunca hace fallar la ejecución.
- `state/sources.json` guarda todo lo sabido por URL (incluidos los fallos y su motivo); `data/sources.json` es lo que lee la web: solo las vistas previas encontradas de las URL que siguen en `data/news.json`.
- Las imágenes **no se descargan**: la web enlaza la imagen de la fuente (`loading="lazy"`, sin enviar el referrer) y la oculta si no carga.
- Se identifica con un User-Agent genérico **sin datos de contacto** (los datos de contacto son solo para Wikipedia); se cambia con `WIKIPEDIA_RSS_SOURCES_USER_AGENT`. `--no-source-previews` lo desactiva.

### Mapa y ubicación del artículo

Si el infobox del artículo de una noticia tiene un **mapa de Kartographer** (`<a data-mw-kartographer="mapframe"><img src="https://maps.wikimedia.org/...">`) y/o una fila **Location**, la página de la noticia los muestra en la columna *About the article*, debajo del resumen. Otros mapas del infobox (imágenes normales, `{{location map}}`) se ignoran.

- Los lee el generador ([`wikipedia_rss/infobox.py`](wikipedia_rss/infobox.py)): **una petición por artículo** (`action=parse&section=0`, solo la sección inicial), de los artículos de las noticias que se conservan (el de cada noticia y los de sus líneas de tema, porque la página describe el artículo más cercano, y los enlaces destacados de las entradas sin artículo, ver *Agrupación por artículo*; estos van al final de la lista, después de todos los demás, y comparten el mismo tope por ejecución). Se piden de uno en uno, 1 s entre peticiones (`ARTICLE_FETCH_DELAY` en [`wikipedia_rss/limits.py`](wikipedia_rss/limits.py)), **como máximo 25 por ejecución** (`MAX_ARTICLE_FETCHES`) y **como mucho 90 s en total** (`ARTICLE_FETCH_BUDGET`, tiempo real; al agotarse la fase termina sin más): lo que falta se completa en las ejecuciones siguientes (con dos ejecuciones al día, el atraso inicial de unos 270 artículos se cubre en una semana, y luego solo hacen falta unos pocos al día), las noticias más recientes primero y los artículos nunca consultados antes que los reconsultas. Estas peticiones **no se reintentan** (a diferencia del resto, que espera y reintenta) y llevan un **cortacircuitos**: a la primera respuesta HTTP 429 o 503 o error `maxlag` de Wikipedia la fase se detiene en el acto (un solo aviso en el log, con lo ya obtenido guardado y sin marcar ese artículo como "sin mapa"), y tras 3 fallos seguidos de otro tipo también. La fase va **después** de escribir el feed, `data/news.json` y el estado: si algo falla o tarda en ella, no se pierde nada de lo esencial (solo se vuelve a escribir `data/news.json` y `state/articles.json` si se obtuvo algo).
- `state/articles.json` guarda por URL de artículo lo que se encontró (`map`, `location`) y cuándo se miró (`checked`). Un artículo se vuelve a mirar a los **14 días** si no tenía mapa (alguien puede añadirlo) y a los **60** si lo tenía (`ARTICLE_RECHECK_DAYS_*`). Un artículo que ya no está en ninguna noticia se borra de la caché. Un error al pedirlo **no** se guarda como "sin mapa": se avisa en el log y se reintenta en otra ejecución (tras 3 fallos seguidos la ejecución deja de pedir); nunca hace fallar la ejecución. Un artículo que no existe sí se guarda como "sin nada".
- Solo se aceptan imágenes `https://maps.wikimedia.org/` (la URL se pasa a absoluta y se decodifican las entidades HTML); de la ubicación se guarda el texto plano (los elementos de lista se unen con "; ", sin referencias, como mucho ~200 caracteres).
- Va a `data/news.json` como `article.map` (`{url, url2x?, width, height}`) y `article.location` (también en `more_articles`); el feed RSS no cambia. La **imagen no se descarga**: la web la enlaza directamente (con la política de referrer por defecto) y no hay JavaScript.
- `--no-article-maps` lo desactiva (lo ya guardado se conserva).

## Topics in the news

La página principal del portal (`Portal:Current events`) tiene una caja **Topics in the news** con unos pocos titulares destacados que no son de ningún día. El generador la lee en cada ejecución (`feed.collect_topics`, `parsers.parse_topics_html`): cada elemento de la lista de la caja es una noticia (no el pie de la caja, con *Ongoing* y *Recent deaths*), y su artículo es el primer enlace en negrita.

- **Fecha**: no tienen día; se les da el **momento en que se vieron por primera vez** (`pub_date` = `first_seen`, que no cambia). El feed las fecha así y la página del artículo dice *Added on <fecha> to the Current events portal*. Su guid lleva `topic` donde las demás llevan la fecha (`wikipedia:en:topic:<hash>`).
- **Nunca se agrupan**: no tienen `group_key`, así que no se unen a las entradas de un día sobre el mismo artículo, y su `group` en `news.json` es el suyo propio. Llevan `"kind": "topic"` y la categoría *Topics in the news*.
- **En la portada** forman **una sola sección encima de todos los días** (no dentro de ninguno), bajo el título *Topics in the news* y una regla gruesa de color; cada una enlaza a la página de su artículo. Solo salen las que la caja del portal tiene ahora.
- **Cuando el portal las quita** de la caja, **se retiran**: no se borran, se marcan `"retired": true` (`state.retire_topics`). Dejan de salir en la portada y en el feed, pero su **página sigue existiendo** (están en `news.json`) para no romper enlaces, hasta que las borra la retención de 6 meses. Si vuelven a la caja, dejan de estar retiradas y conservan su fecha. Una página sin la caja (su diseño cambió) no retira nada; una caja vacía las retira todas.
- **No tienen historial**: en la página del artículo no hay lista de noticias del mismo artículo en *Related articles* (solo sus artículos superiores y relacionados, si los hay), igual que las entradas del portal sin artículo, y tampoco aparecen en la de otros artículos: suelen repetir una noticia que ya tiene su entrada del día.
- La salvaguarda contra páginas vacías (ver *Titulares que ya no están en la página*) solo vale para páginas de 8 titulares o más, porque la caja puede cambiar casi todo de una vez, y no afecta a los topics.
- Si la página principal no se puede leer, no hay topics en esa ejecución y no falla nada.

## Fechas de los items

No se usa la fecha del infobox del artículo ni la de Wikidata: las fechas de infobox son texto libre, a menudo faltan o se refieren a otra cosa (inicio de un conflicto, fecha de nacimiento...). En su lugar, la fecha de un item es la de la página diaria en la que aparece la entrada (`page_date`), a las 00:00 UTC; si el item se ve por primera vez ese mismo día, su `pub_date` es el momento en que el generador lo vio.

## Deduplicación y estado

Cada titular (una entrada del portal) tiene un `guid` estable: `wikipedia:en:<fecha>:<hash del texto>`. Si alguien edita el texto, el item se reconoce por fecha + primera URL de fuente y conserva su guid.

`state/en.json` guarda en `items` cada titular con `first_seen` y `pub_date`. Un titular ya conocido conserva su `pub_date` aunque se actualice su contenido, así los lectores no lo marcan como nuevo. El feed muestra los `--max-items` items más recientes y la web, todos los que hay en el estado. `state/`, `feeds/` y `data/` se versionan en git: el estado es lo que evita duplicados entre ejecuciones.

### Retención: las noticias de más de 6 meses se borran

Para que el repositorio y la web no crezcan indefinidamente, **las noticias con más de 183 días (unos 6 meses) se borran**: del estado (`state/en.json`), del feed RSS y de la web (`data/news.json`). El valor está en `RETENTION_DAYS` de [`wikipedia_rss/config.py`](wikipedia_rss/config.py) y se cambia con `--retention-days`.

- La antigüedad es la `pub_date` del titular (la fecha de su página diaria), no cuándo dejó de aparecer en el portal (los que dejan de aparecer en una página que se sigue leyendo se borran antes: ver *Titulares que ya no están en la página*). Una noticia de más de 183 días se borra aunque siga en el portal, y si el portal la volviera a mostrar se ignora (como el generador solo lee 7 días, en la práctica no ocurre).
- Un grupo (ver *Agrupación*) se borra entero cuando lo hace su fundador: todos sus titulares son del mismo día.
- Lo que se borra del estado no vuelve. Tras borrarla, la página de una noticia (`/articles/<id>/`) muestra un aviso con un enlace al portal de Wikipedia; un enlace del feed a una noticia de más de 6 meses ya no abre contenido.
- La web lo indica al pie de cada página ("News older than 6 months is removed from this site").

### Agrupación por artículo

Varios titulares **del mismo día** sobre el mismo artículo principal (mismo `pageid`; o mismo título si el artículo no existe) se publican como **un solo item**. Las entradas sin artículo principal (enlazan a la página diaria) no se agrupan nunca.

- **Artículo principal = el del tema de nivel superior**: el portal anida las entradas bajo líneas de tema (categoría > tema > subtema > entrada). El artículo principal es el primer enlace del tema **más externo** (p. ej. *APEC China 2026*), no el del más interno, así que las entradas de distintos subtemas (*Chile–Philippines relations*, *China–Russia relations, China–United States relations, Russia–United States relations*) forman una sola noticia. Una entrada de primer nivel (directamente bajo la categoría) no tiene tema ni artículo: sigue enlazando a la página diaria del portal y la web la titula con su categoría (p. ej. *Armed conflicts and attacks*).
- **Todos los artículos del tema**: de cada línea de tema se guardan **todos** sus enlaces (`topics[].links`) y, de los que existen, el extracto (`topic_articles`). La página de la noticia muestra la tarjeta del artículo principal y una tarjeta por cada uno de los demás (`more_articles` en `data/news.json`, en el orden del portal); la descripción del item RSS enlaza todos los de cada línea y, en un grupo, lista la ruta de temas de cada titular.
- **Enlaces destacados de una entrada sin artículo**: si una entrada sin artículo propio (primer nivel, sin tema; no los *Topics in the news*) tiene en su texto un enlace a un artículo de Wikipedia que los editores han puesto en *cursiva* o **negrita** (un `<a>` directamente dentro de `<i>` o `<b>`, p. ej. `<i><a href=".../wiki/Voyager_1">Voyager 1</a></i>`), ese artículo pasa a `more_articles` de la noticia (en orden de aparición, sin repetir, solo los que existen, con su extracto y, cuando se conozcan, `location` y `map`), y la página de la noticia lo describe en la columna *About the article* (su nombre como enlace bajo la etiqueta, resumen, mapa, *Read on Wikipedia*); el título de la página sigue oculto (solo sería la categoría). No cuentan: otros espacios de nombres (`File:`, `Category:`, `Portal:`, `Wikipedia:`, `Help:`, `Special:`, `Template:`...), los enlaces solo a una sección, los enlaces rojos (`redlink=1`) y los enlaces cuyo texto es el nombre de una fuente citada por la entrada (p. ej. *The Guardian* en cursiva como medio). La noticia sigue sin `article` (`null`): su id, su `group`, la portada, el feed y el agrupamiento **no cambian**; el artículo implícito solo lo usa la página de la noticia (no es un "artículo más cercano", así que no aparece en *Related articles*). El generador guarda estos artículos en el estado como `highlighted_articles` (`{title, url, extract}`) de cada titular afectado: los obtiene con la misma consulta de títulos y extractos de la ejecución, y a los titulares ya guardados que no los tienen se los añade `feed.backfill_highlighted` una sola vez (una petición por cada 20 títulos). Los titulares sin enlaces destacados no cambian en el estado.
- **Dos vistas: la portada anida, la página de un artículo agrupa por el artículo más cercano**: una **noticia** (`stories` de `data/news.json`, y un item del feed) son las entradas de un día sobre el **artículo más cercano** a ellas (la línea de tema más interna que enlaza un artículo): *2026 Yemen offensives* con sus dos entradas, *Houthi–Saudi conflict* con una, o una entrada del portal sin artículo. El feed titula cada item con ese artículo como **prefijo** (`Houthi–Saudi conflict: <titular>`; varios titulares: `2026 Lebanon war: <titular> / <titular>`); una entrada de primer nivel (sin tema) no lleva prefijo. Las noticias de un mismo día anidadas bajo el mismo artículo de nivel superior comparten `group` (id del grupo): la **portada** las muestra juntas como una caja con la jerarquía del portal (los subtemas con varias entradas son grupos sin caja propia, con su título una vez y, si tienen 3 o más entradas, el comienzo de su artículo como primera columna), hasta 3 niveles (la raíz y 2 niveles debajo: `MAX_LEVELS` en `web/src/model/box.ts`; lo más profundo cuenta como el último). Un subtema con una sola entrada no es un grupo: su entrada pasa al grupo superior con el subtema como contexto, y un subtema que solo contiene otro se muestra como uno, con los dos títulos. **No hay página para un grupo grande**: solo la portada y la página de cada artículo, a la que enlaza cada entrada de la portada y cada item del feed (`/articles/<noticia>/`). Esa página muestra dónde está el artículo (migas con los artículos mayores bajo los que está anidado), las entradas, la tarjeta de su artículo y las de los demás de sus líneas de tema, y los **otros artículos del mismo día** bajo el mismo artículo de nivel superior (*Also on <día> › …*). El guid, la pubDate y el `first_seen` de una noticia son los de su titular más antiguo, así que no cambian al añadirse titulares. (`state.rss_items`.)

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

## Despliegue con GitHub Actions + Pages

El workflow [`.github/workflows/update-feeds.yml`](.github/workflows/update-feeds.yml) tiene dos jobs:

- **`update`**: genera el feed y los datos de la web y hace commit de `state/`, `feeds/` y `data/` solo si hubo cambios reales (ver *Salida estable*); si Wikipedia no cambió, no hay commit. Se leen las páginas diarias de los últimos 7 días (`--days`), lo que cubre de sobra el medio día entre ejecuciones, las ediciones tardías de las páginas de días anteriores y alguna ejecución que GitHub se salte.
- **`deploy`**: con los datos recién commiteados, construye la web con Astro (`npm ci && npm run build` en `web/`, Node 22) y la publica en GitHub Pages (`web/dist`). Se ejecuta siempre, haya habido commit o no.

Se ejecuta **dos veces al día** (06:17 y 18:17 UTC), a mano (`workflow_dispatch`) y en cada push a `main` que toque `web/`, `wikipedia_rss/`, `wikipedia_rss.py` o el propio workflow (los commits del bot, que solo tocan `state/`, `feeds/` y `data/`, no lo disparan, y un push hecho con `GITHUB_TOKEN` tampoco dispara otros workflows: por eso la web se despliega en esta misma ejecución). Los tests corren aparte ([`tests.yml`](.github/workflows/tests.yml), en pull request y a mano: los de Python y los de la web con `npm test`, `astro check` y una construcción de prueba) para que un test roto nunca impida actualizar ni publicar.

1. Crea un repositorio en GitHub y sube el código a la rama `main`.
2. **Settings > Actions > General > Workflow permissions**: marca *Read and write permissions* (el workflow necesita hacer push). Comprueba también que Actions está permitido en el repositorio.
3. **Settings > Pages > Build and deployment > Source: GitHub Actions** (ajuste único; ya no se sirve la rama `main`).
4. Opcional, en **Settings > Secrets and variables > Actions > Variables**:
   - `WIKIPEDIA_RSS_USER_AGENT`: tu User-Agent con contacto (ver abajo).
   - `SITE_URL`: si usas dominio propio, la URL completa de la web, con su ruta si la tiene (p. ej. `https://noticias.example.org`). Por defecto se usa `https://<usuario>.github.io/<repo>` (o `https://<usuario>.github.io` si el repositorio se llama `<usuario>.github.io`). La usan tanto el generador (`--site-url`, para los enlaces del feed) como la construcción de la web.
5. **Actions > Actualizar feeds > Run workflow** para la primera ejecución (hasta entonces no existe `data/news.json` y la web no tiene noticias que mostrar). La web queda en `https://<usuario>.github.io/<repo>/` y el feed en `https://<usuario>.github.io/<repo>/feeds/en.xml`.

Si la generación falla, no se escribe nada, pero el job `deploy` se ejecuta igualmente con los datos del último commit y termina en rojo para que lo veas. El push reintenta con `git pull --rebase` si alguien ha empujado a la vez; `concurrency` impide dos ejecuciones simultáneas. El cron de GitHub no es puntual: con carga, las ejecuciones pueden retrasarse o saltarse alguna.

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
