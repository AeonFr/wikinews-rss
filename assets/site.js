/* Wikipedia News: the front page (index.html) and the story page (story.html).
 * Both read data/news.json, written by the generator (wikipedia_rss/site.py). */
(function () {
  "use strict";

  var DATA_URL = "data/news.json";
  var PREVIEWS_URL = "data/sources.json";
  var VERSION_URL = "data/version.json";
  var page = document.body.getAttribute("data-page");
  var params = new URLSearchParams(location.search);

  var T = {
    loading: "Loading…",
    error: "Couldn’t load the news. Try again later.",
    empty: "There are no news yet.",
    imageFrom: "Image: {source}",
    sourcesHeading: "From the sources",
    retention: "News older than {period} is removed from this site. Last updated {date}.",
    storyTitle: "Story",
    brand: "Wikipedia News",
    relatedTitle: "More on {title} in the last {period}",
    relatedOn: "Related articles on {day}",
    notFound: "This story is not on the site (anymore). News older than {period} is removed;" +
      "you can still find it in the <a href=\"{portal}\">Current events portal</a> on Wikipedia.",
    sourcesLabel: "Sources",
    topicsLabel: "Topics",
    fromPage: "From {page} ({history})",
    history: "history",
    topicsInNews: "Topics in the news",
    addedTo: "Added on {date} to the {page} ({history}).",
    portalName: "Current events portal",
    aboutLabel: "About the article",
    moreCta: "Read on Wikipedia →",
    cardCta: "Read the article on Wikipedia →",
    cardPortalCta: "See the day on Wikipedia →"
  };

  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? vars[k] : m;
    });
  }
  function t(key, vars) {
    return fill(T[key], vars);
  }

  // --- Helpers -------------------------------------------------------------------

  var data = null;     // data/news.json once loaded
  var loadError = false;
  var previews = {};   // source URL -> {title, description, image, site}, from data/sources.json

  // The data files are cached by the browser for as long as they do not change: they are asked
  // for with ?v=<hash of the file>, from data/version.json, which is the one thing never cached.
  // Without it (or if it fails) they are asked for as they are.
  var versions = {};

  function loadVersions() {
    return fetch(VERSION_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (v) { versions = v || {}; });
  }
  function versioned(url, key) {
    return versions[key] ? url + "?v=" + encodeURIComponent(versions[key]) : url;
  }

  function loadData() {
    return loadVersions().then(function () {
      return fetch(versioned(DATA_URL, "news"));
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function link(href, text) {
    var a = el("a", null, text);
    a.setAttribute("href", href);
    return a;
  }
  function clear(node) {
    node.textContent = "";
  }
  function $(id) {
    return document.getElementById(id);
  }

  function formatDay(day, style) {
    // day: "YYYY-MM-DD" or an ISO datetime; always shown as a UTC calendar day.
    try {
      return new Intl.DateTimeFormat("en", { dateStyle: style || "full", timeZone: "UTC" })
        .format(new Date(day.slice(0, 10) + "T00:00:00Z"));
    } catch (e) {
      return day.slice(0, 10);
    }
  }

  // "Thursday, November 19" (with the weekday) or "November 19", always as a UTC calendar day.
  function formatMonthDay(day, weekday) {
    try {
      return new Intl.DateTimeFormat("en", { weekday: weekday ? "long" : undefined, month: "long", day: "numeric", timeZone: "UTC" })
        .format(new Date(day.slice(0, 10) + "T00:00:00Z"));
    } catch (e) {
      return day.slice(0, 10);
    }
  }

  // A moment as the visitor's own clock shows it ("Nov 21, 2026, 6:34 PM"): in the browser's time
  // zone, not UTC, without naming the zone.
  function formatMoment(iso) {
    try {
      return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", hour: "numeric",
                                             minute: "2-digit" }).format(new Date(iso));
    } catch (e) {
      return iso;
    }
  }

  // Headline HTML comes from our own generator (links and emphasis only), but is still
  // rebuilt node by node: other tags are flattened and only http(s) links are kept.
  var INLINE = { A: 1, I: 1, B: 1, EM: 1, STRONG: 1 };
  function copyInline(from, to) {
    for (var n = from.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        to.appendChild(document.createTextNode(n.nodeValue));
      } else if (n.nodeType === 1) {
        if (INLINE[n.tagName]) {
          var copy = document.createElement(n.tagName.toLowerCase());
          if (n.tagName === "A") {
            var href = n.getAttribute("href") || "";
            if (/^https?:\/\//i.test(href)) {
              copy.setAttribute("href", href);
              copy.setAttribute("rel", "noopener");
            }
          }
          copyInline(n, copy);
          to.appendChild(copy);
        } else {
          copyInline(n, to);
        }
      }
    }
  }
  function inlineParent(html) {
    return new DOMParser().parseFromString("<body>" + html + "</body>", "text/html").body;
  }
  function appendInline(parent, html) {
    copyInline(inlineParent(html), parent);
  }
  function plainText(html) {
    return inlineParent(html).textContent;
  }

  // How long news is kept, as text: "6 months" (183 days), or "N days" for short periods.
  function retentionPeriod() {
    var days = data.retention_days;
    if (days < 60) return days + " days";
    return Math.round(days / 30.4) + " months";
  }

  function setRetention() {
    var node = $("retention");
    node.textContent = data ? t("retention", {
      period: retentionPeriod(),
      date: formatDay(data.updated, "long")
    }) : "";
  }

  // --- Front page ------------------------------------------------------------------

  // The article page of a story: the entries about one article (see the generator's rss_items).
  function storyHref(s) {
    return "story.html?id=" + encodeURIComponent(s.id);
  }

  // Names of the outlets cited by a story, e.g. "AP, Reuters".
  function byline(s) {
    var names = [];
    s.headlines.forEach(function (h) {
      h.sources.forEach(function (src) {
        var n = src.name || "";
        if (n && names.indexOf(n) < 0) names.push(n);
      });
    });
    var text = names.slice(0, 3).join(", ");
    if (names.length > 3) text += " and others";
    return text;
  }

  // Tile sizes depend on how long the text is (in characters): short texts take one
  // column, long ones two, and in between a tile takes one column, or two when that
  // fills a gap that would otherwise stay empty. A story with several entries on the
  // same day is a feature and takes the full width.
  var SHORT_MAX = 149, LONG_MIN = 225;
  // The entries of a feature are set larger, and its columns are narrower, so its
  // thresholds are higher.
  var FEATURE_SHORT_MAX = 280, FEATURE_LONG_MIN = 500;
  // A text next to the image in a feature may be at most this long (for a typical 16:9 image): more wraps to more lines
  // than the one-column image is tall, which stretches the row and leaves a gap under it.
  var IMAGE_BESIDE_MAX = 170;

  // The front page lists only the most recent days; the full history in data/news.json
  // is kept for the "More on …" lists on story pages.
  var HOME_DAYS = 30;

  // --- Nesting of a grouped story -------------------------------------------------------
  // The portal nests entries under topic lines (topic > sub-topic > sub-sub-topic > entry).
  // A grouped story is one article of the day (the outermost topic with an article: the
  // root); each headline's `topics` lists the lines above it, outermost first. Below the root
  // at most MAX_LEVELS more levels are kept (deeper ones count as the last one).
  var MAX_LEVELS = 2;
  // A group directly inside a box shows its article's summary (as its first column) when it has at
  // least this many entries: an article with a single entry has none, a summary would outweigh
  // it. A group inside another group never has one: it is a detail of the group around it.
  var ABOUT_MIN_ENTRIES = 2;

  function hasTopicLink(topic) {
    return !!((topic.links && topic.links.length) || topic.url);
  }
  function topicLabel(topics) {
    return topics.map(function (x) { return x.label; }).join(" › ");
  }

  // The tree of the headlines of a group of the front page (see mergeStories). A node is
  // {topics (its title: one topic, or a chain when a topic holds nothing but another one),
  // entries, children, parent}; an entry is {h (the headline), index, path (its sub-topics),
  // context, node}. A sub-topic with a single entry is not a group: the entry joins the parent
  // group and keeps that sub-topic as its `context`.
  function buildTree(story) {
    var root = { topics: [], entries: [], children: [], parent: null };
    story.headlines.forEach(function (h, index) {
      var first = 0;
      while (first < h.topics.length && !hasTopicLink(h.topics[first])) first++;
      var below = h.topics.slice(first + 1, first + 1 + MAX_LEVELS);
      var node = root;
      below.forEach(function (topic) {
        var child = node.children.filter(function (c) { return c.topics[0].label === topic.label; })[0];
        if (!child) {
          child = { topics: [topic], entries: [], children: [], parent: node };
          node.children.push(child);
        }
        node = child;
      });
      node.entries.push({ h: h, index: index, path: below, context: null, node: null });
    });
    var tree = simplify(root);
    (function link(node) {
      node.children.forEach(function (child) { child.parent = node; link(child); });
      node.entries.forEach(function (e) { e.node = node; });
    })(tree);
    return tree;
  }

  function entriesIn(node) {  // the entries of a group and of the groups in it, in story order
    var all = node.entries.slice();
    node.children.forEach(function (child) { all = all.concat(entriesIn(child)); });
    return all.sort(function (a, b) { return a.index - b.index; });
  }

  function simplify(node) {
    var kept = [];
    node.children.forEach(function (child) {
      child = simplify(child);
      var inside = entriesIn(child);
      if (inside.length < 2) {
        inside.forEach(function (e) {
          e.context = e.path[e.path.length - 1];
          node.entries.push(e);
        });
      } else {
        kept.push(child);
      }
    });
    node.children = kept;
    if (node.parent !== null && !node.entries.length && node.children.length === 1) {
      var only = node.children[0];   // a topic with nothing but another topic: one title
      only.topics = node.topics.concat(only.topics);
      only.parent = node.parent;
      return only;
    }
    return node;
  }

  // Characters of an article's text on the front page, where the boxes are tight (the article page
  // shows all of it).
  var ABOUT_CHARS = 300;

  function shorten(text, limit) {
    if (text.length <= limit) return text;
    return text.slice(0, limit).replace(/\s+\S*$/, "").replace(/[,;:]+$/, "") + "…";
  }

  // The start of the Wikipedia article's text and a link to it. It has no title of its own: the
  // article's title is right above it, as the box's or the group's.
  function aboutBlock(node, article) {
    if (article.extract) node.appendChild(el("p", "about-text", shorten(article.extract, ABOUT_CHARS)));
    var read = link(article.url, t("moreCta"));
    read.className = "about-link";
    node.appendChild(read);
    return node;
  }

  function sizeOf(n, shortMax, longMin) {
    shortMax = shortMax || SHORT_MAX;
    longMin = longMin || LONG_MIN;
    return n <= shortMax ? "short" : n >= longMin ? "long" : "flex";
  }

  function slug(s) {
    var box = el("div", "slug");
    // Without an article (a first-level entry of the portal), the section it appears under.
    var head = s.article ? s.article.title : (s.categories && s.categories[0]);
    if (head) box.appendChild(el("p", "subhead", head));
    var by = byline(s);
    if (by) box.appendChild(el("p", "byline", by));
    return box;
  }

  function textLink(s, text) {
    var p = el("p", "excerpt");
    p.appendChild(link(storyHref(s), text));
    return p;
  }

  // The image of one of the story's sources (data/news.json "image"), linking to `href` (the
  // story's page by default); dropped if it does not load. null when the story has none.
  function tileImage(s, href) {
    var image = s.image;
    if (!image || !/^https?:\/\//i.test(image.url)) return null;
    var a = link(href || storyHref(s), "");
    a.className = "tile-image";
    a.setAttribute("tabindex", "-1");       // the headline is the link for keyboards and readers
    a.setAttribute("aria-hidden", "true");
    var img = document.createElement("img");
    img.setAttribute("src", image.url);
    img.setAttribute("alt", "");
    if (image.source) img.setAttribute("title", fill(T.imageFrom, { source: image.source }));
    img.setAttribute("loading", "lazy");
    img.setAttribute("referrerpolicy", "no-referrer");
    img.addEventListener("error", function () { a.remove(); });
    a.appendChild(img);
    return a;
  }

  // A text of a group of the front page: the entry's text, linking to the article page it is
  // part of (with its sub-topic above it if it was not worth a group of its own).
  function entryTile(s, entry, depth) {
    var text = plainText(entry.h.html).trim();
    var wrap = el("div", "entry depth-" + depth);
    // An article with a single entry is titled like a group of entries (see groupTile).
    if (entry.context) wrap.appendChild(el("p", "group-title", entry.context.label));
    var p = el("p", "excerpt");
    p.appendChild(link(storyHref(entry.h._story), text));
    wrap.appendChild(p);
    return { li: wrap, kind: sizeOf(text.length, FEATURE_SHORT_MAX, FEATURE_LONG_MIN), length: text.length };
  }

  // The tiles of a group, appended to `container`: its own entries, shortest first (the first
  // one ends up next to the image, and a short one is the least likely to make it grow; see
  // layoutFeature), then its sub-groups.
  function groupItems(s, node, container, depth) {
    var items = node.entries.map(function (e) { return entryTile(s, e, depth + 1); })
      .sort(function (x, y) { return x.length - y.length; });
    node.children.forEach(function (child) { items.push(groupTile(s, child, depth + 1)); });
    items.forEach(function (item) { container.appendChild(item.li); });
    return items;
  }

  // The article a group is titled with, from the story's articles (null if its page has none).
  function groupArticle(s, node) {
    var topic = node.topics[node.topics.length - 1];
    var wanted = {};
    (topic.links || []).forEach(function (l) { wanted[titleKey(l.url)] = true; });
    var articles = [s.article].concat(s.more_articles || []).filter(Boolean);
    return articles.filter(function (a) { return wanted[titleKey(a.url)]; })[0] || null;
  }

  // A group inside the box: no box of its own, only its title (once) and its own grid (see
  // layoutGroups), where its article's summary may be the first column. Whitespace and the
  // tighter gaps inside it set it apart. It has no page: its entries link to their articles.
  function groupTile(s, node, depth) {
    var box = el("div", "group depth-" + depth);
    box.appendChild(el("p", "group-title", topicLabel(node.topics)));
    var body = el("div", "group-body");
    box.appendChild(body);
    // The start of the group's article is the first column of its grid, as in the box around it.
    var article = groupArticle(s, node);
    var about = null;
    if (s.complex && depth === 2 && article && entriesIn(node).length >= ABOUT_MIN_ENTRIES) {
      about = aboutBlock(el("div", "about"), article);
      body.appendChild(about);
    }
    var items = groupItems(s, node, body, depth);
    return { li: box, kind: "feature", group: true, body: body, about: about, entries: items,
             length: items.reduce(function (n, x) { return n + x.length; }, 0) };
  }

  // The stories of a group of the front page (the entries nested under one article of the day)
  // as one: all their headlines, each remembering its story, whose page it links to.
  function mergeStories(stories) {
    var first = stories[0];
    var headlines = [], more = [], seen = {};
    stories.forEach(function (s) {
      s.headlines.forEach(function (h) { h._story = s; headlines.push(h); });
      (s.more_articles || []).forEach(function (a) {
        if (!seen[a.url]) { seen[a.url] = true; more.push(a); }
      });
    });
    var image = stories.map(function (s) { return s.image; }).filter(Boolean)[0];
    return { id: first.id, article: first.article, more_articles: more, headlines: headlines, image: image,
             categories: first.categories, pub_date: first.pub_date, stories: stories };
  }

  // A group with several entries: a box with the article's title and the entries in the
  // columns next to its summary; sub-topics with several entries are groups inside it.
  function groupedTile(s, texts) {
    var li = el("li", "feature");
    var tree = buildTree(s);
    // A box whose only content is a single sub-topic is that sub-topic: it is the box's title
    // and article, with no group inside, and the broader article above it is not shown (it
    // would only be a category for what the sub-topic says more clearly).
    var title = s.article.title, article = s.article;
    while (tree.children.length === 1 && !tree.entries.length) {
      tree = tree.children[0];
      title = tree.topics[tree.topics.length - 1].label;  // its own title, not the chain above it
      article = groupArticle(s, tree);
    }
    var h3 = el("h3");
    // The title is a link only if there is a page about this very article: the box's single
    // story, when its entries are directly under the article. Otherwise the pages are the
    // stories inside (and one would be about a different article).
    var only = s.stories.length === 1 ? s.stories[0] : null;
    if (only && article && nearestKey(only) === titleKey(article.url)) h3.appendChild(link(storyHref(only), title));
    else h3.textContent = title;
    li.appendChild(h3);
    var by = byline(s);
    if (by) li.appendChild(el("p", "byline", by));
    // The box is a grid: the article's own summary is the first column, over the full
    // height of the box, and the entries are laid out in the columns next to it (see
    // layoutFeature).
    var box = el("div", "feature-body");
    // The summary of the box's article is the first column of the box, unless the box has
    // sub-topics: then the article is a broad category, and each sub-topic with several entries
    // carries the summary of its own article (and a tall column beside all of them would leave
    // white space).
    s.complex = tree.children.length >= 1;
    var about = null;
    if (!s.complex && article) {
      about = aboutBlock(el("div", "about"), article);
      box.appendChild(about);
    }
    // The image is one more item of the grid, one column wide, before the entries.
    var pic = tileImage(s, s.stories.length > 1 && s.image ? s.image.link : null);
    var entries = [];
    if (pic) {
      box.appendChild(pic);
      entries.push({ li: pic, kind: "short", length: 0, fixed: true });
    }
    entries = entries.concat(groupItems(s, tree, box, 1));
    // A line sets a group apart from what comes before it; as the first thing in the box it
    // would only divide the box's title from its content.
    entries.forEach(function (e, i) { if (e.group && i > 0) e.li.classList.add("divided"); });
    li.appendChild(box);
    return { li: li, kind: "feature", portal: false, hasImage: !!pic, length: texts.join(" ").length,
             body: box, about: about, entries: entries };
  }

  // The tile of a group of the front page: a single entry as such, or a box.
  // A "Topic in the news" (see the generator's parse_topics_html): a highlighted story of the
  // portal's main page, not of a day. They are all in one section above every day (see renderHome),
  // each with its article's title above its text, like a single article's tile.
  function topicTile(s) {
    var text = plainText(s.headlines[0].html).trim();
    var item = el("div");
    if (s.article) item.appendChild(el("p", "subhead", s.article.title));
    item.appendChild(textLink(s, text));
    return { li: item, kind: sizeOf(text.length), portal: false, topic: true, length: text.length };
  }

  function unitTile(stories) {
    if (stories.length === 1 && (stories[0].headlines.length === 1 || !stories[0].article)) return storyTile(stories[0]);
    var merged = mergeStories(stories);
    return groupedTile(merged, merged.headlines.map(function (h) { return plainText(h.html).trim(); }));
  }

  function storyTile(s) {
    var texts = s.headlines.map(function (h) { return plainText(h.html).trim(); });
    var li = el(s.article ? "li" : "div");  // portal tiles are not list items
    var kind, portal = false;
    if (!s.article) {
      // Straight from the Current events portal, no Wikipedia article: these go in the
      // portal section of the day, sized by text length like the other tiles.
      kind = sizeOf(texts.join(" ").length);
      portal = true;
      // With an image the tile is a small grid of its own: the image takes one column and
      // the text the rest (see layoutTiles).
      var pic = tileImage(s);
      var body = pic ? el("div", "tile-text") : li;
      body.appendChild(slug(s));
      texts.forEach(function (text) { body.appendChild(textLink(s, text)); });
      if (pic) {
        li.className = "has-image";
        li.appendChild(pic);
        li.appendChild(body);
        return { li: li, kind: kind, portal: true, hasImage: true, length: texts.join(" ").length, pic: pic, body: body };
      }
    } else if (texts.length > 1) {
      return groupedTile(s, texts);
    } else {
      kind = sizeOf(texts[0].length);
      li.appendChild(slug(s));
      li.appendChild(textLink(s, texts[0]));
    }
    return { li: li, kind: kind, portal: portal, length: texts.join(" ").length };
  }

  // Places every tile in a grid of `cols` columns: its row, its column and its span.
  // Each tile goes to the first row with room for it (so short tiles fill the gaps left
  // by wider ones), then:
  //  - a flexible tile widens to two columns when its row would otherwise have a gap;
  //  - a row is never left with empty columns: the leftover goes to the row's tile with
  //    the longest text, up to the full width;
  //  - in a row with tiles of different widths, the wider one comes first (but an image is
  //    always first).
  // With `offset`, the columns start that many columns in (the first ones belong to
  // something else). Returns the number of rows.
  function layoutTiles(tiles, cols, offset) {
    offset = offset || 0;
    var explicit = cols > 1 || offset > 0;
    var rows = [];
    tiles.forEach(function (tile) {
      var need = tile.kind === "feature" ? cols : tile.kind === "long" ? Math.min(2, cols) : 1;
      if (tile.pic) need = cols;  // image: always one column, the text takes the rest
      var row = null;
      for (var i = 0; i < rows.length && !row; i++) {
        if (cols - rows[i].used >= need) row = rows[i];
      }
      if (!row) rows.push(row = { used: 0, tiles: [] });
      row.used += need;
      row.tiles.push(tile);
      tile.span = need;
    });
    // A last row with a single tile, after a row of three one-column tiles, would stretch that tile
    // across the whole width. Instead the last tile of the row before goes down to keep it company:
    // two rows of two, each with a wide tile and a narrow one (see the fill below).
    var last = rows[rows.length - 1], before = rows[rows.length - 2];
    var plain = function (tile) { return tile.span === 1 && tile.kind !== "feature" && !tile.pic && !tile.fixed; };
    if (cols === 3 && before && last.tiles.length === 1 && last.used < cols && !last.tiles[0].pic &&
        last.tiles[0].kind !== "feature" && before.tiles.length === 3 && before.tiles.every(plain)) {
      last.tiles.unshift(before.tiles.pop());
      before.used--;
      last.used++;
    }
    rows.forEach(function (row) {
      for (var i = 0; i < row.tiles.length && row.used < cols; i++) {
        if (row.tiles[i].kind === "flex") { row.tiles[i].span++; row.used++; break; }
      }
      if (row.used < cols) {
        var growing = row.tiles.filter(function (tile) { return !tile.fixed; });  // not the image
        if (!growing.length) growing = row.tiles;
        var longest = growing[0];
        growing.forEach(function (tile) { if (tile.length > longest.length) longest = tile; });
        longest.span += cols - row.used;
        row.used = cols;
      }
      // The image comes first in its row; of the others the wider ones. (Array.prototype.sort is
      // stable: tiles of equal width keep their order.)
      row.tiles.sort(function (x, y) { return (y.fixed ? 1 : 0) - (x.fixed ? 1 : 0) || y.span - x.span; });
    });

    var list = tiles[0] && tiles[0].li.parentNode;
    rows.forEach(function (row, rowIndex) {
      var col = 1 + offset;
      row.tiles.forEach(function (tile) {
        if (list) list.appendChild(tile.li);  // reading order follows the visual order
        tile.li.style.gridRow = explicit ? String(rowIndex + 1) : "";
        tile.li.style.gridColumn = explicit ? col + " / span " + tile.span : "";
        if (tile.pic) {
          // The tile's own columns are the page's: the image is the first, the text the rest.
          var n = cols > 1 ? tile.span : 1;
          tile.li.style.setProperty("--n", String(n));
          tile.body.style.gridColumn = n > 1 ? "2 / -1" : "";
        }
        col += tile.span;
      });
    });
    return rows.length;
  }

  // The grids of the groups inside a box: as many columns as the box has for its entries; a
  // group with a summary gives it the first one, over the whole height, like a box does.
  function layoutGroups(tiles, cols) {
    tiles.forEach(function (tile) {
      if (!tile.group) return;
      tile.body.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      var offset = tile.about && cols > 1 ? 1 : 0;
      var inner = cols - offset;
      var rows = layoutTiles(tile.entries, inner, offset);
      if (tile.about) {
        tile.about.style.gridColumn = offset ? "1" : "";
        tile.about.style.gridRow = offset ? "1 / span " + rows : "";
      }
      layoutGroups(tile.entries, inner);
    });
  }

  // Inside a feature (a grid of `cols` columns like the page's): the article's summary is
  // the first column over the whole height, and the entries use the columns next to it
  // by the same rules as the page's tiles, with the feature's thresholds.
  function layoutFeature(tile, cols) {
    var image = tile.entries.filter(function (e) { return e.fixed; })[0];
    if (image) { image.kind = "short"; image.li.style.display = ""; }
    if (cols === 1) {  // one column: the summary (if any), then the entries
      if (tile.about) tile.about.style.gridRow = tile.about.style.gridColumn = "";
      layoutTiles(tile.entries, 1);
      layoutGroups(tile.entries, 1);
      // Stacked, the image is the first thing under the title, above the article's summary.
      if (image && tile.about) tile.body.insertBefore(image.li, tile.about);
      return;
    }
    var offset = tile.about ? 1 : 0;      // the summary is the first column, if there is one
    var entryCols = cols - offset;
    var items = tile.entries;             // the image is one column, next to the entries...
    var rows = layoutTiles(items, entryCols, offset);
    if (image && entryCols > 1) {
      // ...unless a long text ended up in its row: then the image takes the whole width of
      // the entries, on a row of its own, and the texts go below it.
      var row = image.li.style.gridRow;
      var crowded = items.some(function (e) {
        return e !== image && e.li.style.gridRow === row && e.length > IMAGE_BESIDE_MAX;
      });
      if (crowded) {
        image.kind = "feature";
        rows = layoutTiles(items, entryCols, offset);
      }
    }
    // An image never takes the whole width of the box (three columns of three): wider than two
    // columns it would be a banner. If there is no room for it otherwise, it is left out.
    if (image && image.span > Math.min(2, cols - 1)) {
      image.kind = "short";
      image.li.style.display = "none";
      image.li.style.gridRow = image.li.style.gridColumn = "";
      items = tile.entries.filter(function (e) { return e !== image; });
      rows = layoutTiles(items, entryCols, offset);
    }
    layoutGroups(tile.entries, entryCols);
    if (tile.about) {
      tile.about.style.gridColumn = "1";
      tile.about.style.gridRow = "1 / span " + rows;
    }
  }

  var grids = [];  // one { tiles: [...], portal: [...] } per day on the page
  var homeTopics = { tiles: [] };   // the "Topics in the news" section above the days
  var mediaQueries = [window.matchMedia("(min-width: 40rem)"), window.matchMedia("(min-width: 62rem)")];

  function columnCount() {
    return mediaQueries[1].matches ? 3 : mediaQueries[0].matches ? 2 : 1;
  }
  function layoutAll() {
    var cols = columnCount();
    layoutTiles(homeTopics.tiles, cols);
    grids.forEach(function (g) {
      layoutTiles(g.tiles, cols);
      layoutTiles(g.portal, cols);
      layoutTiles(g.features, cols);
      g.features.forEach(function (tile) { layoutFeature(tile, cols); });
    });
  }

  function renderHome() {
    var status = $("status"), days = $("days");
    clear(days);
    grids = [];
    var updated = $("updated");   // the line under the disclaimer: "Loading…", then "Last updated …"
    if (loadError) { updated.hidden = true; status.textContent = t("error"); return; }
    if (!data) return;
    // "Last updated <moment>", in the visitor's time zone, where "Loading…" was.
    clear(updated);
    updated.appendChild(document.createTextNode("Last updated "));
    var moment = el("time", null, formatMoment(data.updated));
    moment.setAttribute("datetime", data.updated);
    updated.appendChild(moment);
    updated.appendChild(document.createTextNode("."));
    var cutoff = new Date(data.updated.slice(0, 10) + "T00:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - HOME_DAYS);
    var cutoffDay = cutoff.toISOString().slice(0, 10);
    // The topics are not part of any day: the ones the portal still highlights go above all the days.
    var topics = data.stories.filter(function (s) { return s.kind === "topic" && !s.retired; });
    var recent = data.stories.filter(function (s) { return s.kind !== "topic" && s.pub_date.slice(0, 10) > cutoffDay; });
    if (!recent.length && !topics.length) { status.textContent = t("empty"); return; }
    status.textContent = "";

    var today = $("today");
    today.textContent = formatDay(data.updated);
    today.setAttribute("datetime", data.updated.slice(0, 10));

    homeTopics = { tiles: [] };
    if (topics.length) {
      var topicsBox = el("div", "topics");
      var topicList = el("div", "topics-list");
      topicsBox.appendChild(el("h2", "topics-label", t("topicsInNews")));
      topicsBox.appendChild(topicList);
      topics.forEach(function (s) {
        var tile = topicTile(s);
        homeTopics.tiles.push(tile);
        topicList.appendChild(tile.li);
      });
      days.appendChild(topicsBox);
    }

    // The stories with the same group are one tile of the front page.
    var units = [], unitIndex = {};
    recent.forEach(function (s) {
      var key = s.group || s.id;
      if (unitIndex[key] == null) { unitIndex[key] = units.length; units.push([]); }
      units[unitIndex[key]].push(s);
    });

    var day = null, g = null;
    units.forEach(function (stories) {
      var d = stories[0].pub_date.slice(0, 10);
      if (d !== day) {
        day = d;
        var section = el("section", "day");
        var h2 = el("h2");
        var time = el("time", null, formatDay(d));
        time.setAttribute("datetime", d);
        h2.appendChild(time);
        section.appendChild(h2);
        g = { tiles: [], features: [], portal: [], section: section, h2: h2, list: el("ol", "stories"),
              featureList: el("ol", "stories features"), portalList: el("div", "portal-list") };
        grids.push(g);
        days.appendChild(section);
      }
      var tile = unitTile(stories);
      // A day reads: the portal entries, then the featured (grouped) ones, then the single articles.
      var kind = tile.portal ? "portal" : tile.kind === "feature" ? "features" : "tiles";
      var parent = { portal: g.portalList, features: g.featureList, tiles: g.list }[kind];
      g[kind].push(tile);
      parent.appendChild(tile.li);
    });
    grids.forEach(function (day) {
      if (day.portal.length) {
        var box = el("div", "portal");
        box.appendChild(day.portalList);
        day.section.appendChild(box);
      }
      if (day.features.length) day.section.appendChild(day.featureList);
      if (day.tiles.length) day.section.appendChild(day.list);
    });
    // Within the portal entries and within the grouped boxes, those with an image come first.
    grids.forEach(function (day) {
      [day.portal, day.features].forEach(function (list) {
        list.sort(function (a, b) { return (b.hasImage ? 1 : 0) - (a.hasImage ? 1 : 0); });
      });
    });
    layoutAll();
  }

  // --- Article page -----------------------------------------------------------------------
  // The page of one article of a day: the entries about it (one, or several, or none about an
  // article: an entry straight from the portal), where it sits among the other articles of the
  // day, and what Wikipedia and the sources say. There is no page for a bigger group: the
  // front page is where the groups are browsed.

  var storyId = params.get("id");

  // The sources of a group of headlines: each outlet once, with a numbered link per page
  // when the headlines cite several pages of it ("Al Jazeera (1, 2, 3)").
  function sourcesLine(group) {
    var p = el("p", "headline-meta");
    p.appendChild(document.createTextNode(t("sourcesLabel") + ": "));
    var names = [], urls = {};
    group.forEach(function (h) {
      h.sources.forEach(function (s) {
        var name = s.name || s.url;
        if (!urls[name]) { urls[name] = []; names.push(name); }
        if (urls[name].indexOf(s.url) < 0) urls[name].push(s.url);
      });
    });
    names.forEach(function (name, i) {
      if (i) p.appendChild(document.createTextNode(", "));
      var list = urls[name].filter(function (u) { return /^https?:\/\//i.test(u); });
      if (urls[name].length === 1) {
        p.appendChild(list.length ? link(list[0], name) : document.createTextNode(name));
        return;
      }
      p.appendChild(document.createTextNode(name + " ("));
      list.forEach(function (u, j) {
        if (j) p.appendChild(document.createTextNode(", "));
        p.appendChild(link(u, String(j + 1)));
      });
      p.appendChild(document.createTextNode(")"));
    });
    return p;
  }

  function topicUrl(topic) {
    return (topic.links && topic.links[0] && topic.links[0].url) || topic.url || null;
  }

  // The topic line closest to a headline that links an article (what its entry is about), with
  // its index among the headline's topic lines; null for an entry under no topic.
  function nearestTopic(h) {
    for (var i = h.topics.length - 1; i >= 0; i--) {
      if (hasTopicLink(h.topics[i])) return { topic: h.topics[i], index: i };
    }
    return null;
  }

  // Entries that cite the same outlets are shown together, once, with their sources.
  function groupHeadlines(headlines) {
    var groups = [], index = {};
    headlines.forEach(function (h) {
      var key = JSON.stringify(h.sources.map(function (x) { return x.name || x.url; }).sort());
      if (index[key] == null) { index[key] = groups.length; groups.push([]); }
      groups[index[key]].push(h);
    });
    return groups;
  }

  function pageLine(h) {
    var p = el("p", "headline-meta");
    var parts = t("fromPage", { page: "\0p", history: "\0h" }).split(/\0([ph])/);
    parts.forEach(function (part, i) {
      if (i % 2) p.appendChild(part === "p" ? link(h.page.url, h.page.title) : link(h.page.history_url, t("history")));
      else if (part) p.appendChild(document.createTextNode(part));
    });
    return p;
  }

  // Where the headlines come from: once per portal page, not once per headline.
  // A "Topic in the news" says when it was added to the portal's main page, not what day it is from.
  function topicLine(h, story) {
    var p = el("p", "headline-meta");
    var parts = t("addedTo", { date: formatMoment(story.pub_date), page: "\0p", history: "\0h" }).split(/\0([ph])/);
    parts.forEach(function (part, i) {
      if (i % 2) p.appendChild(part === "p" ? link(h.page.url, t("portalName")) : link(h.page.history_url, t("history")));
      else if (part) p.appendChild(document.createTextNode(part));
    });
    return p;
  }

  // Where the headlines come from: once per portal page, not once per headline.
  function renderPages(headlines, story) {
    var box = $("from-pages");
    clear(box);
    if (story && story.kind === "topic") { box.appendChild(topicLine(headlines[0], story)); return; }
    var seen = {};
    headlines.forEach(function (h) {
      if (seen[h.page.url]) return;
      seen[h.page.url] = true;
      box.appendChild(pageLine(h));
    });
  }

  // A card per cited source whose page gave a preview (data/sources.json); sources
  // without one are left out.
  function sourceCard(src, preview) {
    var a = link(src.url, "");
    a.className = "source-card";
    a.setAttribute("rel", "noopener");
    if (preview.image && /^https?:\/\//i.test(preview.image)) {
      var img = document.createElement("img");
      img.setAttribute("src", preview.image);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      img.setAttribute("referrerpolicy", "no-referrer");
      img.addEventListener("error", function () { img.remove(); });
      a.appendChild(img);
    }
    var body = el("div", "source-body");
    var host = src.url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0];
    body.appendChild(el("p", "source-site", preview.site || src.name || host));
    body.appendChild(el("p", "source-title", preview.title));
    if (preview.description) body.appendChild(el("p", "source-desc", preview.description));
    a.appendChild(body);
    return a;
  }

  function renderSourceCards(headlines) {
    var box = $("source-cards");
    clear(box);
    // Different links can lead to the same page (a live blog's ?update=… links, say): one
    // card per distinct preview.
    var seen = {}, cards = [];
    headlines.forEach(function (h) {
      h.sources.forEach(function (src) {
        var preview = previews[src.url];
        if (!preview || !preview.title || !/^https?:\/\//i.test(src.url)) return;
        var key = (preview.site || "") + "\n" + preview.title + "\n" + (preview.image || "");
        if (seen[src.url] || seen[key]) return;
        seen[src.url] = seen[key] = true;
        cards.push(sourceCard(src, preview));
      });
    });
    if (!cards.length) return;
    box.appendChild(el("h2", null, t("sourcesHeading")));
    var grid = el("div", "source-grid");
    cards.forEach(function (c) { grid.appendChild(c); });
    box.appendChild(grid);
  }

  function titleKey(url) {  // compare Wikipedia links whatever their encoding
    var title = String(url).split("/wiki/")[1] || url;
    try { title = decodeURIComponent(title); } catch (e) {}
    return title.replace(/_/g, " ").toLowerCase();
  }

  // The Wikipedia article the entries are about: the one their nearest topic names, else the
  // story's first. null for an entry straight from the portal.
  function mainArticle(story, near) {
    var articles = [story.article].concat(story.more_articles || []).filter(Boolean);
    if (!articles.length) return null;
    var wanted = near ? titleKey(topicUrl(near.topic)) : null;
    return articles.filter(function (a) { return titleKey(a.url) === wanted; })[0] || articles[0];
  }

  // The start of that article's text, titled "About the article" (its own title is the page's),
  // and below it the link to the article on Wikipedia (to the day's portal page for an entry
  // without an article, which has no text).
  function renderAbout(story, near) {
    var box = $("about");
    clear(box);
    var article = mainArticle(story, near);
    if (article && article.extract) {
      box.appendChild(el("p", "about-label", t("aboutLabel")));
      box.appendChild(el("p", "about-text", article.extract));
    }
    var read = article ? link(article.url, t("cardCta")) : link(story.headlines[0].page.url, t("cardPortalCta"));
    read.className = "about-link";
    box.appendChild(read);
  }

  // "Related articles on <day>": first the articles that are not in any group (those directly
  // under the broadest article, such as a story of its own), then the articles this one is nested
  // under (deepest first), each followed by the other news of the day that is under it, so no
  // title is shown twice. Each of those news goes under the deepest article it shares with this
  // one; a label says where it is below that article (the day is in the section title).
  // Entries link to their article pages.
  function renderRelatedEntries(story, near, siblings) {
    var box = $("related-entries");
    clear(box);
    var h0 = story.headlines[0];
    var chain = function (h) { return h.topics.filter(hasTopicLink); };
    var above = near ? h0.topics.slice(0, near.index).filter(hasTopicLink) : [];   // outermost first
    var keys = above.map(function (topic) { return titleKey(topicUrl(topic)); });
    var articles = [story.article].concat(story.more_articles || []).filter(Boolean);

    // The deepest article above this one that a sibling is also under (-1: none).
    var blocks = above.map(function () { return []; });
    var loose = [];
    siblings.forEach(function (sib) {
      var theirs = chain(sib.headlines[0]);
      var shared = 0;
      while (shared < keys.length && shared < theirs.length && titleKey(topicUrl(theirs[shared])) === keys[shared]) shared++;
      var below = theirs.slice(shared).map(function (x) { return x.label; }).join(" › ");
      var item = { story: sib, below: below, depth: theirs.length - shared };
      if (shared > 0) blocks[shared - 1].push(item); else loose.push(item);
    });
    // An article directly under the broadest one, with nothing of its own around it, is not in
    // any group: it goes first, so that what is listed under each group below really is in it.
    var top = loose;
    if (blocks.length) {
      blocks[0] = blocks[0].filter(function (item) {
        if (item.depth !== 1) return true;
        top.push(item);
        return false;
      });
    }

    function entries(parent, items) {
      items.forEach(function (item) {
        if (item.below) parent.appendChild(el("p", "also-label", item.below));
        item.story.headlines.forEach(function (h) {
          var p = el("p", "related-entry");
          p.appendChild(link(storyHref(item.story), plainText(h.html).trim()));
          parent.appendChild(p);
        });
      });
    }
    if (above.length || top.length) {
      box.appendChild(el("h2", null, fill(T.relatedOn, { day: formatMonthDay(story.pub_date, true) })));
    }
    if (top.length) {
      var first = el("section", "related-block");
      entries(first, top);
      box.appendChild(first);
    }
    for (var i = above.length - 1; i >= 0; i--) {   // deepest first
      var topic = above[i];
      var info = articles.filter(function (a) { return titleKey(a.url) === keys[i]; })[0];
      var block = el("section", "related-block");
      var title = el("h3");
      var url = (info && info.url) || topicUrl(topic);
      if (url) title.appendChild(link(url, (info && info.title) || topic.label));
      else title.textContent = topic.label;
      block.appendChild(title);
      if (info && info.extract) block.appendChild(el("p", "compact-desc", info.extract));
      entries(block, blocks[i]);
      box.appendChild(block);
    }
  }

  function nearestKey(s) {  // which article a story is about, to find it on other days
    var near = nearestTopic(s.headlines[0]);
    return near ? titleKey(topicUrl(near.topic)) : null;
  }

  // The same article on other days.
  function renderRelated(story, near) {
    var box = $("related");
    clear(box);
    var key = nearestKey(story);
    if (!key) return;
    var others = data.stories.filter(function (s) { return s.id !== story.id && nearestKey(s) === key; });
    if (!others.length) return;
    box.appendChild(el("h2", null, fill(T.relatedTitle, { title: near.topic.label, period: retentionPeriod() })));
    var list = el("ul", "related-list");
    others.forEach(function (s) {
      var li = el("li");
      var time = el("time", null, formatDay(s.pub_date, "long"));
      time.setAttribute("datetime", s.pub_date.slice(0, 10));
      li.appendChild(time);
      s.headlines.forEach(function (h) {
        var p = el("p");
        p.appendChild(link(storyHref(s), plainText(h.html).trim()));
        li.appendChild(p);
      });
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderStory() {
    var status = $("status"), article = $("story");
    article.hidden = true;
    if (loadError) { status.textContent = t("error"); return; }
    if (!data) { status.textContent = t("loading"); return; }
    var story = null;
    data.stories.forEach(function (s) { if (s.id === storyId) story = s; });
    if (!story) {
      clear(status);
      appendInline(status, t("notFound", { period: retentionPeriod(), portal: data.portal.url }));
      document.title = t("storyTitle") + " · " + t("brand");
      setRetention();
      return;
    }
    status.textContent = "";
    article.hidden = false;

    var h0 = story.headlines[0];
    var near = nearestTopic(h0);
    var siblings = story.group ? data.stories.filter(function (s) { return s.group === story.group && s.id !== story.id; }) : [];
    var title = near ? near.topic.label : story.article ? story.article.title : (story.categories[0] || formatDay(story.pub_date, "long"));
    var short = title.length > 80 ? title.slice(0, 80).replace(/\s+\S*$/, "") + "…" : title;
    document.title = short + " · " + t("brand");

    var kicker = $("kicker");
    clear(kicker);
    var time = el("time", null, formatDay(story.pub_date));
    time.setAttribute("datetime", story.pub_date.slice(0, 10));
    kicker.appendChild(time);
    // Where it sits: the bigger articles it is nested under (a link where one of them has a page
    // of its own that day). Without any, its categories.
    var above = near ? h0.topics.slice(0, near.index).filter(hasTopicLink) : [];
    if (above.length) {
      var crumbs = el("span", "crumbs");
      above.forEach(function (topic, i) {
        if (i) crumbs.appendChild(document.createTextNode(" › "));
        var page = siblings.filter(function (s) { return nearestKey(s) === titleKey(topicUrl(topic)); })[0];
        if (page) crumbs.appendChild(link(storyHref(page), topic.label));
        else crumbs.appendChild(document.createTextNode(topic.label));
      });
      kicker.appendChild(crumbs);
    } else if (story.article) {
      // Without an article, the category is the title (below), so it is not repeated here.
      story.categories.forEach(function (c) { kicker.appendChild(el("span", "chip", c)); });
    }

    $("story-title").textContent = title;

    var list = $("headlines");
    clear(list);
    groupHeadlines(story.headlines).forEach(function (group) {
      var li = el("li");
      group.forEach(function (h) {
        var text = el("p", "headline-text");
        appendInline(text, h.html);
        li.appendChild(text);
      });
      if (group.some(function (h) { return h.sources.length; })) li.appendChild(sourcesLine(group));
      list.appendChild(li);
    });
    renderPages(story.headlines, story);

    // The article's text, the sources, then every link to other articles: the articles this one
    // is nested under with the other news of the day under each, and the same article on other days.
    renderSourceCards(story.headlines);
    renderAbout(story, near);
    renderRelatedEntries(story, near, siblings);
    renderRelated(story, near);
    setRetention();
  }

  // --- Start -----------------------------------------------------------------------

  function render() {
    if (page === "home") renderHome(); else renderStory();
    setRetention();
    // The footer stays hidden until there is something above it (the news, or the error that
    // replaces them), so it does not flash at the top of an empty page and jump down.
    if (data || loadError) document.body.classList.add("ready");
  }

  mediaQueries.forEach(function (mq) {
    if (mq.addEventListener) mq.addEventListener("change", layoutAll);
    else if (mq.addListener) mq.addListener(layoutAll);
  });
  render();
  loadData().then(function (d) {
    data = d;
    render();
    if (page === "story") {
      // Optional extra: without the file (or without a preview for a source) nothing is shown.
      fetch(versioned(PREVIEWS_URL, "sources")).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
        if (p && p.sources) { previews = p.sources; render(); }
      }).catch(function () {});
    }
  }, function () {
    loadError = true;
    render();
  });
})();
