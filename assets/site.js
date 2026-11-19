/* Wikipedia News: the browse page (index.html) and the story page (story.html).
 * Both read data/news.json, written by the generator (wikipedia_rss/site.py).
 * The interface is bilingual (en/es); the news themselves are always English. */
(function () {
  "use strict";

  var DATA_URL = "data/news.json";
  var page = document.body.getAttribute("data-page");

  // --- Interface language --------------------------------------------------------

  // The English interface text is the static markup (data-i18n) plus these strings;
  // T.en is completed from the markup below.
  var T = {
    en: {
      loading: "Loading…",
      error: "Couldn’t load the news. Try again later.",
      empty: "There are no news yet.",
      noMatches: "No stories match your search.",
      searchPlaceholder: "Search news",
      searchLabel: "Search news",
      categoryLabel: "Category",
      allCategories: "All categories",
      count: "{n} stories",
      countOne: "1 story",
      countOf: "{n} of {total} stories",
      updates: "{n} updates",
      sources: "{n} sources",
      sourcesOne: "1 source",
      retention: "News older than {days} days is removed from this site. Last updated {date}.",
      storyTitle: "Story",
      notFound: "This story is not on the site (anymore). News older than {days} days is removed; " +
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
    },
    es: {
      title: "Noticias de Wikipedia",
      description: "Explora las noticias del portal de actualidad de Wikipedia en inglés, día a día, o síguelas con un feed RSS.",
      brand: "Noticias de Wikipedia",
      rss: "Feed RSS",
      h1: "Noticias de Wikipedia",
      intro: "Explora las noticias del portal <a href=\"https://en.wikipedia.org/wiki/Portal:Current_events\">Current events</a> " +
        "de Wikipedia, día a día. ¿Prefieres un lector? Suscríbete al <a href=\"feeds/en.xml\">feed RSS</a>.",
      back: "← Todas las noticias",
      license: "Proyecto no oficial, sin relación con la Fundación Wikimedia. " +
        "El texto procede de colaboradores de Wikipedia y se distribuye bajo licencia " +
        "<a href=\"https://creativecommons.org/licenses/by-sa/4.0/deed.es\">CC BY-SA 4.0</a>; " +
        "cada entrada enlaza al artículo y al historial de la página de origen.",
      loading: "Cargando…",
      error: "No se han podido cargar las noticias. Inténtalo más tarde.",
      empty: "Todavía no hay noticias.",
      noMatches: "Ninguna noticia coincide con la búsqueda.",
      searchPlaceholder: "Buscar noticias",
      searchLabel: "Buscar noticias",
      categoryLabel: "Categoría",
      allCategories: "Todas las categorías",
      count: "{n} noticias",
      countOne: "1 noticia",
      countOf: "{n} de {total} noticias",
      updates: "{n} actualizaciones",
      sources: "{n} fuentes",
      sourcesOne: "1 fuente",
      retention: "Las noticias con más de {days} días se eliminan de este sitio. Última actualización: {date}.",
      storyTitle: "Noticia",
      notFound: "Esta noticia no está (ya) en el sitio. Las noticias con más de {days} días se eliminan; " +
        "puedes seguir encontrándola en el <a href=\"{portal}\">portal Current events</a> de Wikipedia.",
      noteMany: "Se añadieron {n} titulares a esta noticia, del más antiguo al más reciente.",
      sourcesLabel: "Fuentes",
      topicsLabel: "Temas",
      fromPage: "De {page} ({history})",
      history: "historial",
      cardLabel: "En Wikipedia",
      cardCta: "Leer el artículo en Wikipedia →",
      cardPortalLabel: "En Wikipedia",
      cardPortalText: "Esta noticia no trata de un artículo concreto. Mira todo lo que pasó ese día.",
      cardPortalCta: "Ver el día en Wikipedia →"
    }
  };

  var i18nNodes = document.querySelectorAll("[data-i18n]");
  var metaDesc = document.querySelector('meta[name="description"]');
  T.en.title = document.title;
  T.en.description = metaDesc.getAttribute("content");
  for (var i = 0; i < i18nNodes.length; i++) {
    T.en[i18nNodes[i].getAttribute("data-i18n")] = i18nNodes[i].innerHTML;
  }

  function norm(code) {
    code = String(code || "").toLowerCase();
    if (code.indexOf("es") === 0) return "es";
    if (code.indexOf("en") === 0) return "en";
    return null;
  }
  function storageGet() {
    try { return localStorage.getItem("lang"); } catch (e) { return null; }
  }
  function storageSet(v) {
    try { localStorage.setItem("lang", v); } catch (e) {}
  }

  var params = new URLSearchParams(location.search);
  var browserLangs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  var lang = norm(params.get("lang")) || norm(storageGet());
  for (var b = 0; !lang && b < browserLangs.length; b++) lang = norm(browserLangs[b]);
  lang = lang || "en";

  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? vars[k] : m;
    });
  }
  function t(key, vars) {
    var s = T[lang][key];
    return fill(s != null ? s : T.en[key], vars);
  }
  // "1 story" / "{n} stories": key + "One" holds the singular.
  function plural(key, n, vars) {
    return t(n === 1 && T.en[key + "One"] ? key + "One" : key, Object.assign({ n: n }, vars));
  }

  // --- Helpers -------------------------------------------------------------------

  var data = null;     // data/news.json once loaded
  var loadError = false;

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
      return new Intl.DateTimeFormat(lang, { dateStyle: style || "full", timeZone: "UTC" })
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

  function setRetention() {
    var node = $("retention");
    node.textContent = data ? t("retention", {
      days: data.retention_days,
      date: formatDay(data.updated, "long")
    }) : "";
  }

  // --- Browse page -----------------------------------------------------------------

  var home = {};

  function prepareHome() {
    home.q = $("q");
    home.category = $("category");
    home.controls = $("controls");
    home.days = $("days");
    home.count = $("count");
    home.q.value = params.get("q") || "";
    home.categoryValue = params.get("category") || "";
    home.search = null;

    var syncing = function () {
      home.categoryValue = home.category.value;
      syncUrl();
      renderStories();
    };
    home.q.addEventListener("input", syncing);
    home.category.addEventListener("change", syncing);
  }

  function syncUrl() {
    try {
      var u = new URL(location.href);
      var q = home.q.value.trim();
      if (q) u.searchParams.set("q", q); else u.searchParams.delete("q");
      if (home.categoryValue) u.searchParams.set("category", home.categoryValue); else u.searchParams.delete("category");
      history.replaceState(null, "", u);
    } catch (e) {}
  }

  function buildSearchIndex() {
    home.search = data.stories.map(function (s) {
      var text = [s.title, (s.article && s.article.title) || ""].concat(s.categories);
      s.headlines.forEach(function (h) { text.push(plainText(h.html)); });
      return text.join("\n").toLowerCase();
    });
  }

  function renderCategories() {
    var seen = {};
    data.stories.forEach(function (s) { s.categories.forEach(function (c) { seen[c] = true; }); });
    var names = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, "en"); });
    clear(home.category);
    var all = el("option", null, t("allCategories"));
    all.value = "";
    home.category.appendChild(all);
    names.forEach(function (c) {
      var o = el("option", null, c);
      o.value = c;
      home.category.appendChild(o);
    });
    if (seen[home.categoryValue]) home.category.value = home.categoryValue; else home.categoryValue = "";
  }

  function storyItem(s) {
    var li = el("li");
    var a = link("story.html?id=" + encodeURIComponent(s.id) + (params.get("lang") ? "&lang=" + lang : ""), s.title);
    a.setAttribute("lang", "en");
    li.appendChild(a);
    var meta = el("div", "meta");
    s.categories.slice(0, 2).forEach(function (c) { meta.appendChild(el("span", "chip", c)); });
    if (s.headlines.length > 1) meta.appendChild(el("span", null, plural("updates", s.headlines.length)));
    var sources = s.headlines.reduce(function (n, h) { return n + h.sources.length; }, 0);
    if (sources) meta.appendChild(el("span", null, plural("sources", sources)));
    li.appendChild(meta);
    return li;
  }

  function renderStories() {
    var status = $("status");
    clear(home.days);
    if (loadError) { home.count.textContent = ""; status.textContent = t("error"); return; }
    if (!data) { status.textContent = t("loading"); return; }
    var total = data.stories.length;
    if (!total) { home.count.textContent = ""; status.textContent = t("empty"); return; }

    var terms = home.q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var shown = data.stories.filter(function (s, i) {
      if (home.categoryValue && s.categories.indexOf(home.categoryValue) < 0) return false;
      return terms.every(function (term) { return home.search[i].indexOf(term) >= 0; });
    });
    home.count.textContent = shown.length === total ? plural("count", total) : t("countOf", { n: shown.length, total: total });
    status.textContent = shown.length ? "" : t("noMatches");

    var section = null, list = null, day = null, n = 0;
    function closeDay() { if (section) section.querySelector(".n").textContent = n; }
    shown.forEach(function (s) {
      var d = s.pub_date.slice(0, 10);
      if (d !== day) {
        closeDay();
        day = d; n = 0;
        section = el("section", "day");
        var h2 = el("h2");
        var time = el("time", null, formatDay(d));
        time.setAttribute("datetime", d);
        h2.appendChild(time);
        h2.appendChild(el("span", "n"));
        section.appendChild(h2);
        list = el("ol", "stories");
        section.appendChild(list);
        home.days.appendChild(section);
      }
      list.appendChild(storyItem(s));
      n++;
    });
    closeDay();
  }

  function renderHome() {
    home.q.setAttribute("placeholder", t("searchPlaceholder"));
    home.q.setAttribute("aria-label", t("searchLabel"));
    home.category.setAttribute("aria-label", t("categoryLabel"));
    if (data) renderCategories();
    renderStories();
    setRetention();
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
    title.setAttribute("lang", "en");
    node.appendChild(title);
    var text = a ? a.extract : t("cardPortalText");
    if (text) {
      var p = el("p", "card-text", text);
      if (a) p.setAttribute("lang", "en");
      node.appendChild(p);
    }
    node.appendChild(el("p", "card-cta", t(a ? "cardCta" : "cardPortalCta")));
    return node;
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
      appendInline(status, t("notFound", { days: data.retention_days, portal: data.portal.url }));
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
    h1.setAttribute("lang", story.article ? "en" : lang);

    $("story-note").textContent = story.headlines.length > 1 ? t("noteMany", { n: story.headlines.length }) : "";
    $("story-note").hidden = story.headlines.length < 2;

    var list = $("headlines");
    clear(list);
    story.headlines.forEach(function (h) {
      var li = el("li");
      var text = el("p", "headline-text");
      text.setAttribute("lang", "en");
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
    setRetention();
  }

  // --- Start -----------------------------------------------------------------------

  function apply(newLang) {
    lang = newLang;
    document.documentElement.lang = lang;
    if (page === "home") {
      metaDesc.setAttribute("content", t("description"));
      document.title = t("title");
    }
    for (var i = 0; i < i18nNodes.length; i++) {
      i18nNodes[i].innerHTML = t(i18nNodes[i].getAttribute("data-i18n"));
    }
    var buttons = document.querySelectorAll(".lang-switch button");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute("aria-pressed", String(buttons[j].getAttribute("data-lang") === lang));
    }
    if (page === "home") renderHome(); else renderStory();
  }

  var switchButtons = document.querySelectorAll(".lang-switch button");
  for (var k = 0; k < switchButtons.length; k++) {
    switchButtons[k].addEventListener("click", function () {
      var next = this.getAttribute("data-lang");
      if (next === lang) return;
      storageSet(next);
      // Keep an explicit ?lang= in sync so a reload shows the same choice.
      try {
        var u = new URL(location.href);
        if (u.searchParams.has("lang")) {
          u.searchParams.set("lang", next);
          history.replaceState(null, "", u);
        }
        params = u.searchParams;
      } catch (e) {}
      apply(next);
    });
  }

  if (page === "home") prepareHome();
  apply(lang);
  document.querySelector(".lang-switch").hidden = false;
  if (page === "home") $("controls").hidden = false;

  loadData().then(function (d) {
    data = d;
    if (page === "home") buildSearchIndex();
    apply(lang);
  }, function () {
    loadError = true;
    apply(lang);
  });
})();
