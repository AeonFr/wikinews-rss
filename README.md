# wikipedia-noticias

Genera feeds RSS 2.0 a partir de los portales de actualidad de Wikipedia:

- **es**: [Plantilla:Portada:Actualidad](https://es.wikipedia.org/wiki/Plantilla:Portada:Actualidad) (los temas de actualidad de la portada), un item por tema, con el extracto del artículo.
- **en**: [Portal:Current events](https://en.wikipedia.org/wiki/Portal:Current_events), un item por cada entrada de las páginas diarias de los últimos 7 días.

Python 3.9+ y solo biblioteca estándar. Salida: `feeds/es.xml`, `feeds/en.xml` y el estado en `state/*.json`.

## Uso local

```sh
python3 wikipedia_rss.py                    # todos los idiomas -> feeds/ y state/
python3 wikipedia_rss.py --lang es --dry-run -v   # no escribe nada, muestra los 10 primeros items
python3 wikipedia_rss.py --cache .cache     # caché HTTP en disco (30 min), útil al desarrollar
python3 -m unittest discover -s tests       # tests (sin red)
```

Otras opciones (`python3 wikipedia_rss.py --help`): `--days N` (páginas diarias a leer en en, 7 por defecto), `--out DIR`, `--state DIR`, `--max-items N` (50), `--base-url URL` (URL pública del directorio de los feeds, para `atom:link rel="self"`), `--retention-days N` (90), `--article-dates`. También funciona `python3 -m wikipedia_rss`.

El código de salida es 1 si algún idioma falla; los demás se generan igualmente.

## Fechas de los items

No se usa la fecha del infobox del artículo ni la de Wikidata: las fechas de infobox son texto libre, cambian de formato entre wikis (y entre plantillas), a menudo faltan o se refieren a otra cosa (inicio de un conflicto, fecha de nacimiento...). Wikidata tampoco tiene una propiedad fiable para "cuándo fue noticia". En su lugar:

1. **en**: la fecha de la página diaria en la que aparece la entrada (`page_date`).
2. **es**: el prefijo del bullet cuando lo hay, p. ej. `23 de octubre: ...` (`text_date`).
3. Si no hay ninguna, el momento en que el generador vio el item por primera vez (`first_seen`).

Con `--article-dates`, un item sin fecha cuyo artículo se creó hace pocos días toma la fecha de creación del artículo (una petición extra por item nuevo).

## Deduplicación y estado

Cada item tiene un `guid` estable:

- es: `wikipedia:es:<pageid>` del artículo principal (sigue redirecciones, así que renombrar el artículo no duplica el item).
- en: `wikipedia:en:<fecha>:<hash del texto>`. Si alguien edita el texto, el item se reconoce por fecha + primera URL de fuente y conserva su guid.

`state/<idioma>.json` guarda cada item con `first_seen` y `pub_date`. Un item ya conocido conserva su `pub_date` aunque se actualice su contenido, así los lectores no lo marcan como nuevo. Cuando un item desaparece del portal se le añade `gone_since` (y se le quita si vuelve); se queda en el estado hasta que `gone_since` tiene más de `--retention-days` días (90). El feed muestra los `--max-items` más recientes. `state/` y `feeds/` se versionan en git: el estado es lo que evita duplicados entre ejecuciones.

### Salida estable

Una ejecución sin cambios reales deja `feeds/` y `state/` idénticos byte a byte (y no reescribe los archivos). Cambio real es un item nuevo, uno que desaparece del portal o se elimina por retención, o un cambio en el contenido de un item (título, descripción, enlaces, categoría, fecha). Para ello no se guardan marcas de tiempo por ejecución:

- `updated` en el estado es el momento del último cambio real, y es también el `lastBuildDate` del feed.
- No hay `last_seen` por item; la retención usa `gone_since`, que solo se escribe cuando el item desaparece.

Las claves del JSON van ordenadas y los items del feed en orden estable (`pub_date`, `first_seen`, posición en el portal).

## Despliegue con GitHub Actions + Pages

El workflow [`.github/workflows/update-feeds.yml`](.github/workflows/update-feeds.yml) se ejecuta una vez al día (06:17 UTC) y a mano (`workflow_dispatch`): pasa los tests, genera los feeds y hace commit de `state/` y `feeds/` solo si hubo cambios reales (ver *Salida estable*); si Wikipedia no cambió, no hay commit. En en se leen las páginas diarias de los últimos 7 días (`--days`), lo que cubre de sobra el día entre ejecuciones, las ediciones tardías de las páginas de días anteriores y alguna ejecución que GitHub se salte. Pages sirve la rama `main` tal cual (`index.html` en la raíz, `.nojekyll` para saltarse Jekyll).

1. Crea un repositorio en GitHub y sube el código a la rama `main`.
2. **Settings > Actions > General > Workflow permissions**: marca *Read and write permissions* (el workflow necesita hacer push). Comprueba también que Actions está permitido en el repositorio.
3. **Settings > Pages**: *Source: Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. Opcional, en **Settings > Secrets and variables > Actions > Variables**:
   - `WIKIPEDIA_RSS_USER_AGENT`: tu User-Agent con contacto (ver abajo).
   - `FEEDS_BASE_URL`: si usas dominio propio, la URL del directorio de los feeds (p. ej. `https://noticias.example.org/feeds`). Por defecto se usa `https://<usuario>.github.io/<repo>/feeds`.
5. **Actions > Actualizar feeds > Run workflow** para la primera ejecución. Los feeds quedan en `https://<usuario>.github.io/<repo>/feeds/es.xml` y `.../en.xml`.

Si un idioma falla y el otro no, se hace commit de lo generado y el job termina en rojo para que lo veas. El push reintenta con `git pull --rebase` si alguien ha empujado a la vez; `concurrency` impide dos ejecuciones simultáneas. El cron de GitHub no es puntual: con carga, las ejecuciones pueden retrasarse o saltarse alguna.

### Desactivación por inactividad

GitHub desactiva los workflows programados de repositorios públicos tras 60 días sin actividad en el repo. Los commits que hace el propio workflow cuentan como actividad, pero ahora solo se hacen cuando hay cambios reales (en la práctica casi todos los días: el portal en añade entradas a diario). Por si Wikipedia no cambiara durante mucho tiempo, el paso *Keepalive* escribe la fecha en `state/.keepalive` si el último commit tiene 45 días o más, lo que fuerza un commit antes de llegar a los 60 días.

No está documentado con precisión qué cuenta como "actividad" ni si los commits del bot bastan siempre, así que **conviene mirar la pestaña Actions de vez en cuando**. Si el workflow aparece desactivado, se reactiva con *Enable workflow*.

## Alternativas de ejecución

**launchd en macOS**: [`deploy/launchd/org.example.wikipedia-noticias.plist`](deploy/launchd/org.example.wikipedia-noticias.plist) es un agente de ejemplo comentado que ejecuta el script cada hora (`StartInterval`; puedes subirlo a 86400 para igualar el workflow diario). Como las ejecuciones sin cambios no tocan los archivos, ejecutarlo más a menudo no genera ruido. Sustituye las rutas `/RUTA/AL/REPO` y sigue las instrucciones del comentario. Solo genera los archivos; publicarlos (push, rsync...) corre de tu cuenta.

**Cloudflare Workers** (posible migración futura): con un Cron Trigger se evitaría depender de Actions, pero requeriría portar el código a JavaScript/TypeScript (el parser HTML y el de wikitext incluidos) y guardar el estado en KV o D1 en lugar de en git.

## Añadir un idioma

Añade una entrada a `LANGUAGES` en [`wikipedia_rss/config.py`](wikipedia_rss/config.py):

- `mode="daily_pages"` si la wiki tiene una página por día (define `daily_title` con `{year}`, `{month}`, `{day}` y `month_names`), o `mode="single_list"` si hay una lista de bullets editada a mano (define `list_page`; se lee como wikitext con secciones `;Encabezado`).
- `skip_sections`, `ignore_namespaces` (espacios de nombres de imágenes y categorías en ese idioma), `use_extracts` y los textos de `strings`.

Después ejecuta `python3 wikipedia_rss.py --lang <código> --dry-run -v`, añade un fixture y un test en `tests/`, y un enlace en `index.html` (la página es bilingüe: añádelo en el HTML, que está en inglés, y en el diccionario `es` del script). El workflow genera todos los idiomas de `LANGUAGES` automáticamente.

## Licencia, atribución y User-Agent

El texto de los feeds procede de colaboradores de Wikipedia y está bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es). Cada feed lo indica en `<copyright>` y cada item enlaza al artículo y al historial de la página de origen; si redistribuyes los feeds, mantén esa atribución y la misma licencia.

La [política de User-Agent de Wikimedia](https://meta.wikimedia.org/wiki/User-Agent_policy) pide un User-Agent identificable con forma de contacto. Se configura con la variable de entorno `WIKIPEDIA_RSS_USER_AGENT` (por defecto, el de `DEFAULT_USER_AGENT` en `config.py`):

```sh
WIKIPEDIA_RSS_USER_AGENT="wikipedia-noticias-rss/0.1 (https://github.com/<usuario>/<repo>; tu@email)" python3 wikipedia_rss.py
```

El generador hace pocas peticiones por ejecución (las imprime en el log) y de forma secuencial.
