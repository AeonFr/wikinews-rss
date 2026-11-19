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
    aboutLabel: "About the article",
    portalLabel: "From the Current events portal →",
    sourcesHeading: "From the sources",
    retention: "News older than {period} is removed from this site. Last updated {date}.",
    storyTitle: "Story",
    brand: "Wikipedia News",
    relatedTitle: "More on {title} in the last {period}",
    notFound: "This story is not on the site (anymore). News older than {period} is removed;" +
      "you can still find it in the <a href=\"{portal}\">Current events portal</a> on Wikipedia.",
    noteMany: "{n} headlines were added to this story, oldest first.",
    sourcesLabel: "Sources",
    topicsLabel: "Topics",
    fromPage: "From {page} ({history})",
    history: "history",
    cardLabel: "On Wikipedia",
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

  // The front page lists only the most recent days; the full history in data/news.json
  // is kept for the "More on …" lists on story pages.
  var HOME_DAYS = 30;

  function sizeOf(n) {
    return n <= SHORT_MAX ? "short" : n >= LONG_MIN ? "long" : "flex";
  }

  function slug(s) {
    var box = el("div", "slug");
    if (s.article) box.appendChild(el("p", "subhead", s.article.title));
    var by = byline(s);
    if (by) box.appendChild(el("p", "byline", by));
    return box;
  }

  function textLink(s, text) {
    var p = el("p", "excerpt");
    p.appendChild(link(storyHref(s), text));
    return p;
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
      li.appendChild(slug(s));
      texts.forEach(function (text) { li.appendChild(textLink(s, text)); });
    } else if (texts.length > 1) {
      kind = "feature";
      li.className = "feature";
      if (s.article) {
        var h3 = el("h3");
        h3.appendChild(link(storyHref(s), s.article.title));
        li.appendChild(h3);
      }
      var by = byline(s);
      if (by) li.appendChild(el("p", "byline", by));
      var box = el("div", "excerpts");
      texts.forEach(function (text) { box.appendChild(textLink(s, text)); });
      // Two entries fill two of the three columns; the article's own summary takes the third.
      if (texts.length === 2 && s.article && s.article.extract) {
        var about = el("p", "about");
        about.appendChild(el("span", "about-label", t("aboutLabel")));
        about.appendChild(document.createTextNode(s.article.extract));
        box.appendChild(about);
      }
      li.appendChild(box);
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
  //  - in a row with tiles of different widths, the wider one comes first.
  function layoutTiles(tiles, cols) {
    var rows = [];
    tiles.forEach(function (tile) {
      var need = tile.kind === "feature" ? cols : tile.kind === "long" ? Math.min(2, cols) : 1;
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
        if (row.tiles[i].kind === "flex") { row.tiles[i].span = 2; row.used++; break; }
      }
      if (row.used < cols) {
        var longest = row.tiles[0];
        row.tiles.forEach(function (tile) { if (tile.length > longest.length) longest = tile; });
        longest.span += cols - row.used;
        row.used = cols;
      }
      // Array.prototype.sort is stable: tiles of equal width keep their order.
      row.tiles.sort(function (x, y) { return y.span - x.span; });
    });

    var list = tiles[0] && tiles[0].li.parentNode;
    rows.forEach(function (row, rowIndex) {
      var col = 1;
      row.tiles.forEach(function (tile) {
        if (list) list.appendChild(tile.li);  // reading order follows the visual order
        tile.li.style.gridRow = cols > 1 ? String(rowIndex + 1) : "";
        tile.li.style.gridColumn = cols > 1 ? col + " / span " + tile.span : "";
        col += tile.span;
      });
    });
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

    var day = null, g = null;
    recent.forEach(function (s) {
      var d = s.pub_date.slice(0, 10);
      if (d !== day) {
        day = d;
        var section = el("section", "day");
        var h2 = el("h2");
        var time = el("time", null, formatDay(d));
        time.setAttribute("datetime", d);
        h2.appendChild(time);
        section.appendChild(h2);
        g = { tiles: [], portal: [], section: section, list: el("ol", "stories"), portalList: el("div", "portal-list") };
        grids.push(g);
        days.appendChild(section);
      }
      var tile = storyTile(s);
      var portal = tile.portal;
      (portal ? g.portal : g.tiles).push(tile);
      (portal ? g.portalList : g.list).appendChild(tile.li);
      if (portal && g.portal.length === 1) g.firstPortal = s;
    });
    grids.forEach(function (day) {
      if (day.portal.length) {
        var box = el("div", "portal");
        var label = el("p", "portal-label");
        label.appendChild(link(day.firstPortal.headlines[0].page.url, t("portalLabel")));
        box.appendChild(label);
        box.appendChild(day.portalList);
        day.section.appendChild(box);
      }
      if (day.tiles.length) day.section.appendChild(day.list);
    });
    layoutAll();
  }

  // --- Story page ------------------------------------------------------------------

  var storyId = params.get("id");

  function sourcesLine(h) {
    var p = el("p", "headline-meta");
    p.appendChild(document.createTextNode(t("sourcesLabel") + ": "));
    h.sources.forEach(function (s, i) {
      if (i) p.appendChild(document.createTextNode(", "));
      p.appendChild(/^https?:\/\//i.test(s.url) ? link(s.url, s.name || s.url) : document.createTextNode(s.name || s.url));
    });
    return p;
  }

  function topicsLine(h) {
    var p = el("p", "headline-meta");
    p.appendChild(document.createTextNode(t("topicsLabel") + ": "));
    h.topics.forEach(function (topic, i) {
      if (i) p.appendChild(document.createTextNode(" › "));
      p.appendChild(topic.url ? link(topic.url, topic.label) : document.createTextNode(topic.label));
    });
    return p;
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

  function renderSourceCards(story) {
    var box = $("source-cards");
    clear(box);
    var seen = {}, cards = [];
    story.headlines.forEach(function (h) {
      h.sources.forEach(function (src) {
        if (seen[src.url]) return;
        seen[src.url] = true;
        var preview = previews[src.url];
        if (preview && preview.title && /^https?:\/\//i.test(src.url)) cards.push(sourceCard(src, preview));
      });
    });
    if (!cards.length) return;
    box.appendChild(el("h2", null, t("sourcesHeading")));
    var grid = el("div", "source-grid");
    cards.forEach(function (c) { grid.appendChild(c); });
    box.appendChild(grid);
  }

  // Other stories about the same Wikipedia article, from other days.
  function renderRelated(story) {
    var box = $("related");
    clear(box);
    if (!story.article) return;
    var others = data.stories.filter(function (s) {
      return s.id !== story.id && s.article && s.article.url === story.article.url;
    });
    if (!others.length) return;
    box.appendChild(el("h2", null, fill(T.relatedTitle, { title: story.article.title, period: retentionPeriod() })));
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

    var short = story.title.length > 80 ? story.title.slice(0, 80).replace(/\s+\S*$/, "") + "…" : story.title;
    document.title = short + " · " + t("brand");

    var kicker = $("kicker");
    clear(kicker);
    var time = el("time", null, formatDay(story.pub_date));
    time.setAttribute("datetime", story.pub_date.slice(0, 10));
    kicker.appendChild(time);
    story.categories.forEach(function (c) { kicker.appendChild(el("span", "chip", c)); });

    var h1 = $("story-title");
    h1.textContent = story.article ? story.article.title : formatDay(story.pub_date, "long");

    $("story-note").textContent = story.headlines.length > 1 ? t("noteMany", { n: story.headlines.length }) : "";
    $("story-note").hidden = story.headlines.length < 2;

    var list = $("headlines");
    clear(list);
    story.headlines.forEach(function (h) {
      var li = el("li");
      var text = el("p", "headline-text");
      appendInline(text, h.html);
      li.appendChild(text);
      if (h.sources.length) li.appendChild(sourcesLine(h));
      if (h.topics.length) li.appendChild(topicsLine(h));
      li.appendChild(pageLine(h));
      list.appendChild(li);
    });

    var cardBox = $("card");
    clear(cardBox);
    cardBox.appendChild(card(story));
    renderSourceCards(story);
    renderRelated(story);
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
