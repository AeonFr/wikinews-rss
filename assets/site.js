/* Wikipedia News: the front page (index.html) and the story page (story.html).
 * Both read data/news.json, written by the generator (wikipedia_rss/site.py). */
(function () {
  "use strict";

  var DATA_URL = "data/news.json";
  var PREVIEWS_URL = "data/sources.json";
  var page = document.body.getAttribute("data-page");
  var params = new URLSearchParams(location.search);

  var T = {
    loading: "Loading…",
    error: "Couldn’t load the news. Try again later.",
    empty: "There are no news yet.",
    imageFrom: "Image: {source}",
    prevDay: "Prev",
    nextDay: "Next",
    sourcesHeading: "From the sources",
    retention: "News older than {period} is removed from this site. Last updated {date}.",
    storyTitle: "Story",
    brand: "Wikipedia News",
    relatedTitle: "More on {title} in the last {period}",
    moreOn: "More on",
    onDay: "on {day}",
    alsoOn: "Also on {day}",
    notFound: "This story is not on the site (anymore). News older than {period} is removed;" +
      "you can still find it in the <a href=\"{portal}\">Current events portal</a> on Wikipedia.",
    noteMany: "{n} headlines were added to this story, oldest first.",
    sourcesLabel: "Sources",
    topicsLabel: "Topics",
    fromPage: "From {page} ({history})",
    history: "history",
    cardLabel: "On Wikipedia",
    moreLabel: "Related article",
    moreCta: "Read on Wikipedia →",
    cardCta: "Read the article on Wikipedia →",
    cardPortalLabel: "On Wikipedia",
    cardPortalText: "This story is not about a particular article. See everything that happened that day.",
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

  function loadData() {
    return fetch(DATA_URL).then(function (r) {
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
  // A group inside a box shows its article's summary (as its first column) when it has at least
  // this many entries: an article with a single entry has none, a summary would outweigh it.
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

  // The start of the Wikipedia article's text and a link to it. It has no title of its own: the
  // article's title is right above it, as the box's or the group's.
  function aboutBlock(node, article) {
    if (article.extract) node.appendChild(el("p", "about-text", article.extract));
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
    if (s.complex && article && entriesIn(node).length >= ABOUT_MIN_ENTRIES) {
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
  var mediaQueries = [window.matchMedia("(min-width: 40rem)"), window.matchMedia("(min-width: 62rem)")];

  function columnCount() {
    return mediaQueries[1].matches ? 3 : mediaQueries[0].matches ? 2 : 1;
  }
  function layoutAll() {
    var cols = columnCount();
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
    if (loadError) { status.textContent = t("error"); return; }
    if (!data) { status.textContent = t("loading"); return; }
    var cutoff = new Date(data.updated.slice(0, 10) + "T00:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - HOME_DAYS);
    var cutoffDay = cutoff.toISOString().slice(0, 10);
    var recent = data.stories.filter(function (s) { return s.pub_date.slice(0, 10) > cutoffDay; });
    if (!recent.length) { status.textContent = t("empty"); return; }
    status.textContent = "";

    var today = $("today");
    today.textContent = formatDay(data.updated);
    today.setAttribute("datetime", data.updated.slice(0, 10));

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
        section.id = "day-" + d;
        var h2 = el("h2");
        var time = el("time", null, formatDay(d));
        time.setAttribute("datetime", d);
        h2.appendChild(time);
        section.appendChild(h2);
        g = { tiles: [], features: [], portal: [], section: section, h2: h2, list: el("ol", "stories"),
              featureList: el("ol", "stories"), portalList: el("div", "portal-list") };
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
    grids.forEach(function (day, i) {
      // Links to the days before and after this one on the page (none past either end).
      var nav = el("span", "day-nav");
      if (i > 0) nav.appendChild(link("#" + grids[i - 1].section.id, t("prevDay")));
      if (i > 0 && i < grids.length - 1) nav.appendChild(el("span", "day-nav-sep", "/"));
      if (i < grids.length - 1) nav.appendChild(link("#" + grids[i + 1].section.id, t("nextDay")));
      if (nav.firstChild) day.h2.appendChild(nav);
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
  // Where the headlines come from: once per portal page, not once per headline.
  function renderPages(headlines) {
    var box = $("from-pages");
    clear(box);
    var seen = {};
    headlines.forEach(function (h) {
      if (seen[h.page.url]) return;
      seen[h.page.url] = true;
      box.appendChild(pageLine(h));
    });
  }

  // A card for a Wikipedia article: title and the start of its text, linking to it.
  function articleCard(a, size) {
    var node = el("a", "card" + (size ? " " + size : ""));
    node.setAttribute("href", a.url);
    node.appendChild(el("p", "card-label", t(size ? "moreLabel" : "cardLabel")));
    node.appendChild(el("p", "card-title", a.title));
    if (a.extract) node.appendChild(el("p", "card-text", a.extract));
    node.appendChild(el("p", "card-cta", t(size ? "moreCta" : "cardCta")));
    return node;
  }

  function card(story) {
    var a = story.article;
    var first = story.headlines[0];
    var node = el("a", "card");
    node.setAttribute("href", a ? a.url : first.page.url);
    node.appendChild(el("p", "card-label", t(a ? "cardLabel" : "cardPortalLabel")));
    var title = el("p", "card-title", a ? a.title : first.page.title);
    node.appendChild(title);
    var text = a ? a.extract : t("cardPortalText");
    if (text) {
      var p = el("p", "card-text", text);
      node.appendChild(p);
    }
    node.appendChild(el("p", "card-cta", t(a ? "cardCta" : "cardPortalCta")));
    return node;
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

  // The Wikipedia cards: the article the entries are about first, then the other articles of
  // their topic lines (the bigger ones it is nested under).
  function renderCards(story, near) {
    var cardBox = $("card");
    clear(cardBox);
    var articles = [story.article].concat(story.more_articles || []).filter(Boolean);
    if (!articles.length) { cardBox.appendChild(card(story)); return; }  // straight from the portal
    var wanted = near ? titleKey(topicUrl(near.topic)) : null;
    var main = articles.filter(function (a) { return titleKey(a.url) === wanted; })[0] || articles[0];
    cardBox.appendChild(articleCard(main));
    var rest = articles.filter(function (a) { return a !== main; });
    if (rest.length) {
      var more = el("div", "card-grid");
      rest.forEach(function (a) { more.appendChild(articleCard(a, "small")); });
      cardBox.appendChild(more);
    }
  }

  // The other articles of the same day nested under the same top-level article, in blocks that
  // say so: "More on <the article> on <day>" for the entries directly under it, "Also on <day>
  // › <where>" for the others. Their entries link to their article pages.
  function renderRelatedEntries(story, siblings) {
    var box = $("related-entries");
    clear(box);
    siblings.forEach(function (sib) {
      var h0 = sib.headlines[0];
      var first = 0;
      while (first < h0.topics.length && !hasTopicLink(h0.topics[first])) first++;
      var path = h0.topics.slice(first + 1).map(function (x) { return x.label; }).join(" › ");
      var block = el("section", "related-block");
      block.appendChild(el("h2", null, path
        ? fill(T.alsoOn, { day: formatMonthDay(story.pub_date, true) }) + " › " + path
        : t("moreOn") + " " + story.article.title + " " + fill(T.onDay, { day: formatMonthDay(story.pub_date) })));
      sib.headlines.forEach(function (h) {
        var p = el("p", "related-entry");
        p.appendChild(link(storyHref(sib), plainText(h.html).trim()));
        block.appendChild(p);
      });
      box.appendChild(block);
    });
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
    $("story-note").textContent = story.headlines.length > 1 ? t("noteMany", { n: story.headlines.length }) : "";
    $("story-note").hidden = story.headlines.length < 2;

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
    renderPages(story.headlines);

    renderCards(story, near);
    renderSourceCards(story.headlines);
    renderRelatedEntries(story, siblings);
    renderRelated(story, near);
    setRetention();
  }

  // --- Start -----------------------------------------------------------------------

  function render() {
    if (page === "home") renderHome(); else renderStory();
    setRetention();
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
      fetch(PREVIEWS_URL).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
        if (p && p.sources) { previews = p.sources; render(); }
      }).catch(function () {});
    }
  }, function () {
    loadError = true;
    render();
  });
})();
