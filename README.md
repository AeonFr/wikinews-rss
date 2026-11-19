# wikipedia-noticias

Un portal para **explorar las noticias de Wikipedia**, con un feed RSS como alternativa para quien prefiera un lector.

Las noticias salen de [Portal:Current events](https://en.wikipedia.org/wiki/Portal:Current_events) de la Wikipedia en inglés (solo en inglés): un item por cada entrada de las páginas diarias de los últimos 7 días. Un generador en Python (3.9+, solo biblioteca estándar) las recoge dos veces al día y escribe:

| Archivo | Qué es |
| --- | --- |
| `feeds/en.xml` | El feed RSS 2.0 (los 50 items más recientes). |
| `data/news.json` | Todas las noticias de los últimos 30 días, para la web. |
| `state/en.json` | El estado (qué se vio y cuándo); evita duplicados entre ejecuciones. |

La web es estática (HTML + JS sin dependencias) y la sirve GitHub Pages:

- [`index.html`](index.html): **explorar** las noticias día a día, con búsqueda y filtro por categoría.
- [`story.html`](story.html)`?id=...`: la **página de una noticia**: todos sus titulares completos, con sus fuentes, y una tarjeta que enlaza al artículo de Wikipedia. Es a donde llevan los enlaces del feed RSS (ver *La página de cada noticia*).

La interfaz de la web está en español e inglés (selector ES/EN, según el navegador); las noticias son siempre en inglés.

## Uso local

```sh
python3 wikipedia_rss.py                    # -> feeds/, data/ y state/
python3 wikipedia_rss.py --dry-run -v       # no escribe nada, muestra los 10 primeros items
python3 wikipedia_rss.py --cache .cache     # caché HTTP en disco (30 min), útil al desarrollar
python3 wikipedia_rss.py --site-url http://localhost:8000   # los items del feed enlazan a la web local
python3 -m unittest discover -s tests       # tests (sin red)
python3 -m http.server 8000                 # la web local, en http://localhost:8000
```

Otras opciones (`python3 wikipedia_rss.py --help`): `--days N` (páginas diarias a leer, 7 por defecto), `--out DIR` (feed), `--data DIR` (datos de la web), `--state DIR`, `--max-items N` (items del feed RSS, 50), `--site-url URL` (URL pública de la web, ver abajo), `--retention-days N` (30, ver *Retención*), `--max-group N` (3, ver *Agrupación*). También funciona `python3 -m wikipedia_rss`.

`--site-url` es la raíz de la web (la que sirve `index.html`, sin barra final). Con ella, cada item del feed enlaza a su página en la web y el feed lleva `atom:link rel="self"`; sin ella, los items enlazan directamente al artículo de Wikipedia. El workflow la calcula solo.

El código de salida es 1 si la generación falla; en ese caso no se escribe nada.

## La página de cada noticia

Un item del feed es una **noticia**: un titular, o varios sobre el mismo artículo y el mismo día agrupados (ver *Agrupación*). Cuando se añade un titular a una noticia ya publicada, el item cambia de título pero conserva su `guid`, y muchos lectores de RSS no actualizan los títulos de items que ya tienen: ven el título "truncado", sin los últimos titulares.

Por eso el enlace de cada item del feed lleva a `story.html?id=<id>` en la web, que muestra **todos los titulares de la noticia, completos**, cada uno con sus fuentes, temas y página del portal de origen, y debajo una **tarjeta** que enlaza al artículo de Wikipedia al que apunta la noticia (con el extracto de su introducción). Si la noticia no tiene artículo propio, la tarjeta enlaza a la página del portal de ese día. El `id` es el `guid` de la noticia sin el prefijo `wikipedia:en:` y con `-` en lugar de `:` (p. ej. `2026-10-24-615ed6d6145c`), así que es estable aunque se añadan titulares.

La descripción de cada item del feed sigue llevando el texto completo, las fuentes y los enlaces, para quien lo lea sin salir del lector.

## Fechas de los items

No se usa la fecha del infobox del artículo ni la de Wikidata: las fechas de infobox son texto libre, a menudo faltan o se refieren a otra cosa (inicio de un conflicto, fecha de nacimiento...). En su lugar, la fecha de un item es la de la página diaria en la que aparece la entrada (`page_date`), a las 00:00 UTC; si el item se ve por primera vez ese mismo día, su `pub_date` es el momento en que el generador lo vio.

## Deduplicación y estado

Cada titular (una entrada del portal) tiene un `guid` estable: `wikipedia:en:<fecha>:<hash del texto>`. Si alguien edita el texto, el item se reconoce por fecha + primera URL de fuente y conserva su guid.

`state/en.json` guarda en `items` cada titular con `first_seen` y `pub_date`. Un titular ya conocido conserva su `pub_date` aunque se actualice su contenido, así los lectores no lo marcan como nuevo. El feed muestra los `--max-items` items más recientes y la web, todos los que hay en el estado. `state/`, `feeds/` y `data/` se versionan en git: el estado es lo que evita duplicados entre ejecuciones.

### Retención: las noticias de más de un mes se borran

Para que el repositorio y la web no crezcan indefinidamente, **las noticias con más de 30 días se borran**: del estado (`state/en.json`), del feed RSS y de la web (`data/news.json`). El valor está en `RETENTION_DAYS` de [`wikipedia_rss/config.py`](wikipedia_rss/config.py) y se cambia con `--retention-days`.

- La antigüedad es la `pub_date` del titular (la fecha de su página diaria), no cuándo dejó de aparecer en el portal. Una noticia de más de 30 días se borra aunque siga en el portal, y si el portal la volviera a mostrar se ignora (como el generador solo lee 7 días, en la práctica no ocurre).
- Un grupo (ver *Agrupación*) se borra entero cuando lo hace su fundador: todos sus titulares son del mismo día.
- Lo que se borra del estado no vuelve. Tras borrarla, la página de una noticia (`story.html?id=...`) muestra un aviso con un enlace al portal de Wikipedia; un enlace del feed a una noticia de más de un mes ya no abre contenido.
- La web lo indica al pie de cada página ("Las noticias con más de 30 días se eliminan de este sitio").

### Agrupación por artículo

Varios titulares **del mismo día** sobre el mismo artículo principal (mismo `pageid`; o mismo título si el artículo no existe) se publican como **un solo item**. Las entradas sin artículo principal (enlazan a la página diaria) no se agrupan nunca.

- **Día**: el día (UTC) de la `pub_date` del titular, es decir, la fecha de su página diaria. El día de un grupo es el de su fundador (el titular más antiguo, cuya `pub_date` guarda el grupo), y un titular nuevo se compara siempre con él.
- **Desarrollos posteriores**: un titular de un día posterior al del grupo no se une a él, sino que abre un **item nuevo** (con su propio guid y pubDate), que a su vez agrupa a los titulares de ese día. Así una historia que se desarrolla vuelve a aparecer como nueva en el lector. P. ej. *2026 West Bank lockdown* el 23 y el 24 de octubre son dos items.
- **Título**: los titulares unidos con ` / ` del más antiguo al más reciente, en lo posible: el orden **inverso** al del portal. Se toma la página diaria más antigua primero y, dentro de una página, de abajo arriba del documento. Se invierte porque el portal pone las páginas más recientes arriba y a veces el seguimiento de una noticia encima de la principal. Dentro de una misma página diaria el documento no es estrictamente cronológico (se ordena por temas y a menudo el seguimiento va debajo), así que esto es una aproximación.
- **Descripción**: cada titular con sus fuentes, en el orden del título; después los temas una sola vez, y una línea de atribución por cada página del portal usada. **Categorías**: unión sin duplicados, en el orden del título.
- **guid y pubDate** son los del fundador y no cambian al añadirse titulares: el item cambia de contenido, pero los lectores no lo ven como nuevo. El fundador no depende del orden de visualización: es el primero según (`pub_date`, `first_seen`, posición en el portal); entre titulares nuevos de una misma página, el primero del documento (que en el título sale el último). Se guardan en `groups` del estado: `{guid del grupo: {members: [guids de titulares], first_seen, pub_date}}`. Las asignaciones no se revisan nunca, lo que mantiene los guids estables; un titular agrupado sigue en `items` (no reaparece como item suelto).
- **Ventana**: un titular nuevo solo se une a un item que siga *vigente*, es decir, con algún titular presente en el portal en esta ejecución.
- **Tope**: como mucho `--max-group` titulares por item (3). Al llenarse, el siguiente titular del mismo día empieza otro item (que a su vez agrupa a los siguientes). No se descarta ningún titular. `--max-group 1` desactiva la agrupación.

**Migración**:

- Un estado sin la clave `groups` (de versiones anteriores a la agrupación) se reagrupa en la primera ejecución: los titulares presentes en el portal se agrupan con las reglas anteriores (mismo artículo y mismo día), cada grupo reutiliza el guid y la pubDate del miembro más antiguo (así no aparece como item nuevo) y los guids absorbidos desaparecen del feed, aunque siguen en `items` para no volver a salir sueltos.
- Los grupos creados por la versión que agrupaba entre días se deshacen en cada ejecución (es idempotente): los miembros cuyo día no es el del grupo vuelven a ser items propios con su guid de titular (`wikipedia:en:<fecha>:<hash>`), con su `pub_date` y `first_seen` de siempre; no se reagrupan entre sí. El grupo conserva su guid, su pubDate y los miembros de su día; si solo le queda el fundador, desaparece el registro del grupo y el fundador sigue publicándose con el mismo guid. Ningún titular se pierde ni cambia de guid.
- Las marcas `gone_since` y `last_seen` de versiones anteriores se eliminan del estado (la retención ya no depende de ellas).

### Salida estable

Una ejecución sin cambios reales deja `feeds/`, `data/` y `state/` idénticos byte a byte (y no reescribe los archivos). Cambio real es un item nuevo, uno que se borra por retención, un titular que se une a un grupo (o sale de él por la migración), o un cambio en el contenido de un item (título, descripción, enlaces, categoría, fecha, extracto del artículo). Que un titular desaparezca del portal no es un cambio: se queda hasta que lo borra la retención. Para ello no se guardan marcas de tiempo por ejecución:

- `updated` en el estado es el momento del último cambio real, y es también el `lastBuildDate` del feed y el "última actualización" de la web.

Las claves de los JSON van ordenadas y los items en orden estable (`pub_date`, `first_seen`, posición en el portal).

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
