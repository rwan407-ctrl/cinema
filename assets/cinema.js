/* 明日放映 · 共用页面逻辑
 *
 * index.html（奥克兰 Event Queen Street）和 china.html（中国影院）共用这一份。
 * 每个页面只交给 CinemaApp.start() 一份「站点配置」：时区、数据文件、怎么把原始数据换成下面的统一格式。
 *
 *   movie   { id, title, titleTag{text,tip}?, sub, poster, posterSmall?, cert{text,cls,tip}?, runtime, genres[], place,
 *             countries[]?, languages[]?, region?, regionHint?,
 *             releaseText?, scores[{name, value? count? | text?}], sortScore, directors, actors, note, intro, introSrc,
 *             introMachine?, introEn?, policy?, year, release, rerun?, rerunWhy?, chinese?, special?, trailer{video,poster?,name?}?,
 *             stills[]?, links[{text,url}], idText }
 *   session { id, movieId, start:'YYYY-MM-DDTHH:MM'（影院当地时间）, hall, hallFull?, fmt{text,cls,short?,label?,rank?}?,
 *             tags[], seats?, booking?, advance?, is3d?, note? }
 *
 * 地区（region）：优先用 movie.region（人工指定）；否则看出品国家（第一个认得的算数）；
 * 没有国家信息时看 regionHint（站点自己猜的），再看语言；都没有就归「其他」。
 */
(function () {
  'use strict';

  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  var WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  // late = 过了午夜、算前一天营业日的场次，归到「晚上」
  var PERIODS = [
    { id: 'all', label: '全部' },
    { id: 'am', label: '上午', test: function (s) { return !s.late && s.time < '12:00'; } },
    { id: 'pm', label: '下午', test: function (s) { return !s.late && s.time >= '12:00' && s.time < '18:00'; } },
    { id: 'eve', label: '晚上', test: function (s) { return s.late || s.time >= '18:00'; } }
  ];
  var SORTS = [['time', '按最早场次'], ['rating', '按评分'], ['count', '按场次多少'], ['name', '按片名']];
  var VIEWS = [['grid', '海报墙'], ['board', '时间表']];
  var CARD_TIMES = 6;   // 海报卡上最多列几个场次，多的写「+N」
  var PCARD_TIMES = 5;  // 按国家分列时的小海报卡（两行以内）

  // ───────── 地区分类 ─────────
  // en 印在邮票上（要短），enLong 用在海报墙的分区标题；颜色在 cinema.css 的 .r-xxx 里
  var REGIONS = [
    { id: 'cn', name: '中国', seal: '中', en: 'CHINA', enLong: 'CHINESE CINEMA', tip: '中国大陆、香港、台湾、澳门出品' },
    { id: 'west', name: '欧美', seal: '欧', en: 'WEST', enLong: 'EUROPE & AMERICA', tip: '美国、加拿大、英国和欧洲各国，以及澳大利亚、新西兰' },
    { id: 'in', name: '印度', seal: '印', en: 'INDIA', enLong: 'INDIA & SOUTH ASIA', tip: '印度，以及尼泊尔、巴基斯坦、孟加拉、斯里兰卡等南亚国家' },
    { id: 'jp', name: '日本', seal: '日', en: 'JAPAN', enLong: 'JAPAN', tip: '日本出品' },
    { id: 'kr', name: '韩国', seal: '韩', en: 'KOREA', enLong: 'KOREA', tip: '韩国出品' },
    { id: 'sea', name: '东南亚', seal: '东', en: 'SE ASIA', enLong: 'SOUTHEAST ASIA', tip: '泰国、越南、菲律宾、印尼、马来西亚、新加坡等' },
    { id: 'other', name: '其他', seal: '他', en: 'WORLD', enLong: 'WORLD CINEMA', tip: '其他国家和地区（拉美、中东、非洲等），或者暂时不知道产地' }
  ];
  var REGION_ALL = { id: 'all', name: '全部', seal: '全', en: 'ALL FILMS', tip: '所有地区' };
  // 重映（以前上映过的老片）：不进各国的列，单独一列放在最右边；海报褪色、小一号，不抢新片的眼
  var RERUN_LANE = { id: 'rerun', name: '重映', seal: '重', en: 'RE-RUN', enLong: 'RE-RELEASES · 老片',
    tip: '以前上映过的老片（重映、修复版、周年纪念，或者出品比这次上映早两年以上）：放在最右边、变淡' };
  var REGION_BY_ID = {};
  REGIONS.forEach(function (r) { REGION_BY_ID[r.id] = r; });
  var COUNTRY_REGION = {};   // 豆瓣、猫眼用的国家/地区名 → 分类
  [['cn', '中国 中国大陆 大陆 内地 中国内地 中国香港 香港 中国台湾 台湾 中国澳门 澳门'],
   ['west', '美国 加拿大 英国 爱尔兰 法国 德国 西德 东德 意大利 西班牙 葡萄牙 荷兰 比利时 卢森堡 瑞士 奥地利 瑞典 挪威 丹麦 芬兰 冰岛 ' +
     '波兰 捷克 斯洛伐克 捷克斯洛伐克 匈牙利 罗马尼亚 保加利亚 希腊 塞尔维亚 克罗地亚 斯洛文尼亚 波黑 黑山 北马其顿 马其顿 阿尔巴尼亚 ' +
     '南斯拉夫 立陶宛 拉脱维亚 爱沙尼亚 乌克兰 白俄罗斯 俄罗斯 苏联 摩纳哥 马耳他 塞浦路斯 列支敦士登 安道尔 圣马力诺 澳大利亚 新西兰'],
   ['in', '印度 尼泊尔 巴基斯坦 孟加拉 孟加拉国 斯里兰卡 不丹 马尔代夫'],
   ['jp', '日本'],
   ['kr', '韩国 南韩 大韩民国'],
   ['sea', '泰国 越南 菲律宾 印度尼西亚 印尼 马来西亚 新加坡 柬埔寨 缅甸 老挝 文莱 东帝汶']
  ].forEach(function (x) { x[1].split(' ').forEach(function (c) { COUNTRY_REGION[c] = x[0]; }); });
  var LANG_REGION = [   // 没有国家信息时按语言猜（按片子的第一语言）
    ['cn', /汉语|普通话|国语|粤语|闽南|沪语|中文|华语|Mandarin|Cantonese|Chinese/i],
    ['jp', /日语|Japanese/i],
    ['kr', /韩语|朝鲜语|Korean/i],
    ['in', /印地|泰卢固|泰米尔|马拉雅拉姆|卡纳达|旁遮普|孟加拉|马拉地|古吉拉特|尼泊尔|乌尔都|僧伽罗|Hindi|Telugu|Tamil|Malayalam|Kannada|Punjabi|Bengali|Marathi|Gujarati|Nepali|Urdu/i],
    ['sea', /泰语|越南|菲律宾|他加禄|印尼|印度尼西亚|马来语|高棉|缅甸|老挝|Thai|Vietnamese|Filipino|Tagalog|Indonesian|Malay|Khmer/i],
    ['west', /英语|法语|德语|意大利|西班牙|葡萄牙|俄语|荷兰|瑞典|挪威|丹麦|芬兰|波兰|捷克|希腊|English|French|German|Italian|Spanish|Russian/i]
  ];
  function langRegion(s) {
    for (var i = 0; i < LANG_REGION.length; i++) if (LANG_REGION[i][1].test(s)) return LANG_REGION[i][0];
    return null;
  }
  function regionOf(m) {
    if (m.region && REGION_BY_ID[m.region]) return m.region;
    var cs = m.countries;
    if (!cs && m.place) cs = String(m.place).split(' · ')[0].split(/[、,，\/]/);   // 老数据只有 place 一行字
    cs = (cs || []).map(function (c) { return String(c == null ? '' : c).trim(); }).filter(Boolean);
    for (var i = 0; i < cs.length; i++) {
      var r = COUNTRY_REGION[cs[i]] || COUNTRY_REGION[cs[i].replace(/[（(].*$/, '')];
      if (r) return r;
    }
    if (cs.length && !cs.every(function (c) { return langRegion(c); })) return 'other';   // 有国家、只是不在上面几类里
    if (m.regionHint && REGION_BY_ID[m.regionHint]) return m.regionHint;
    var ls = (m.languages || []).concat(cs);
    for (var j = 0; j < ls.length; j++) { var lr = langRegion(String(ls[j])); if (lr) return lr; }
    return 'other';
  }

  // ───────── 类型（genre） ─────────
  var GENRE_EN = {
    'action': '动作', 'adventure': '冒险', 'animation': '动画', 'anime': '动画', 'comedy': '喜剧', 'crime': '犯罪',
    'documentary': '纪录片', 'drama': '剧情', 'family': '家庭', 'fantasy': '奇幻', 'horror': '恐怖', 'music': '音乐',
    'musical': '歌舞', 'mystery': '悬疑', 'romance': '爱情', 'sci-fi': '科幻', 'science fiction': '科幻', 'thriller': '惊悚',
    'war': '战争', 'western': '西部', 'biography': '传记', 'history': '历史', 'sport': '运动', 'sports': '运动', 'kids': '儿童',
    'concert': '演唱会'
  };
  var GENRE_ALIAS = {
    '恐怖片': '恐怖', '动画片': '动画', '纪录': '纪录片', '记录': '纪录片', '记录片': '纪录片', '喜剧片': '喜剧', '爱情片': '爱情',
    '动作片': '动作', '科幻片': '科幻', '音乐剧': '歌舞', '传记片': '传记', '历史片': '历史', '战争片': '战争', '犯罪片': '犯罪',
    '悬疑片': '悬疑', '惊悚片': '惊悚', '奇幻片': '奇幻', '冒险片': '冒险', '家庭片': '家庭', '儿童片': '儿童', '灾难片': '灾难'
  };
  var GENRE_DROP = { '外语片': 1, '宝莱坞': 1, '其他': 1, '其它': 1 };   // 不算类型
  var GENRE_ORDER = ['剧情', '喜剧', '动作', '爱情', '科幻', '动画', '悬疑', '惊悚', '恐怖', '犯罪', '奇幻', '冒险', '家庭', '儿童',
    '战争', '历史', '传记', '音乐', '歌舞', '演唱会', '纪录片', '灾难', '武侠', '古装', '运动', '西部', '神话'];
  // 霓虹灯管的颜色：每种类型一种
  var GENRE_NEON = {
    '剧情': '#ffcf8a', '喜剧': '#ffe45c', '动作': '#ff8f3d', '爱情': '#ff79b4', '科幻': '#55e6ff', '动画': '#b6ff5a',
    '悬疑': '#a98bff', '惊悚': '#d46bff', '恐怖': '#ff4747', '犯罪': '#6fa8ff', '奇幻': '#e08cff', '冒险': '#3ff0b0',
    '家庭': '#9cf27a', '儿童': '#9cf27a', '战争': '#d9c46a', '历史': '#e8b86a', '传记': '#f0c58c', '音乐': '#ff5ce1',
    '歌舞': '#ff5ce1', '演唱会': '#ff5ce1', '纪录片': '#66f0dc', '灾难': '#ff6a3d', '武侠': '#ff9966', '古装': '#ffab70',
    '运动': '#5cf0a8', '西部': '#e0a25c', '神话': '#ffc45c', '短片': '#c8c8ff', '同性': '#ff8ad8', '黑色电影': '#c0c0c0',
    '戏曲': '#ff8a6a', '特别活动': '#f6dc8f'
  };
  function neonOf(g) { return GENRE_NEON[g] || '#f6dc8f'; }
  function genreRank(g) { var i = GENRE_ORDER.indexOf(g); return i < 0 ? 99 : i; }
  function normGenres(list) {
    var out = [];
    (Array.isArray(list) ? list : String(list || '').split(/[,，、\/]/)).forEach(function (g) {
      g = String(g == null ? '' : g).trim();
      if (!g) return;
      g = GENRE_EN[g.toLowerCase()] || g;
      g = GENRE_ALIAS[g] || g;
      if (!GENRE_DROP[g] && out.indexOf(g) < 0) out.push(g);
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* 浏览器不让存：功能照常，只是记不住设置 */ }
    return null;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function utc(iso) { var a = iso.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]); }
  function addDays(iso, k) { return new Date(utc(iso) + k * 86400000).toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function weekday(iso) { return new Date(utc(iso)).getUTCDay(); }
  function md(iso) { var a = iso.split('-'); return (+a[1]) + '月' + (+a[2]) + '日'; }
  function slash(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function addMin(hhmm, mins) {
    var a = hhmm.split(':'), t = (+a[0]) * 60 + (+a[1]) + mins;
    t = ((t % 1440) + 1440) % 1440;
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (!(ms >= 0)) return '';
    var m = Math.round(ms / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 48) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }
  var stampFmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function fmtStamp(iso) { var d = new Date(iso); return isNaN(d) ? (iso || '') : stampFmt.format(d); }   // 按本机（电脑 / 手机）的时间

  // 在哪儿打开的：本机文件（file://，桌面图标）还是网上（手机网页版，GitHub Pages）
  var WEB = location.protocol !== 'file:';
  function localDir() {   // 本机打开时页面所在的文件夹（Windows 路径），提示「双击哪个文件刷新」用；网页源码里不写死路径
    if (WEB) return '';
    var p = decodeURIComponent(location.pathname).replace(/\/[^\/]*$/, '');
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1).replace(/\//g, '\\') : p;
  }
  function starsHtml(score) {
    var pct = Math.max(0, Math.min(100, score * 10));
    return '<span class="stars" aria-hidden="true">★★★★★<i style="width:' + pct + '%">★★★★★</i></span>';
  }

  function start(S) {
    var $ = function (id) { return document.getElementById(id); };
    var K = S.key;
    var dlg = $('detail');
    var state = {
      date: null, userPicked: false, period: 'all', region: 'all', genre: 'all',
      sort: store(K + '-sort') || S.defaultSort || 'time',
      view: store(K + '-view') === 'board' ? 'board' : 'grid',
      showEn: store(K + '-en') === '1',
      stamp: null, order: [], open: null, ping: null, lastFocus: null, anim: true, sig: '',
      venue: null, raw: null
    };
    if (!SORTS.some(function (x) { return x[0] === state.sort; })) state.sort = 'time';
    var V = null;   // 统一格式后的数据 { raw, movies:{id:movie}, days:[{date, ok, stale, staleFrom, sessions[]}] }

    // ───────── 一个页面切换几家影院（国内页面：五角场万达 / 博纳中原…）：地址里的 ?c=编号 > 上次选的 > 第一家 ─────────
    var urlVenue = null;
    if (S.venues) {
      try { urlVenue = new URLSearchParams(location.search).get('c'); } catch (e) { urlVenue = null; }
      state.venue = urlVenue || store(K + '-venue') || null;
    }
    function venueList(all) {
      if (!S.venues || !all) return [];
      try { return (S.venues(all) || []).filter(function (v) { return v && v.id != null; }); } catch (e) { return []; }
    }

    function val(x) { return typeof x === 'function' ? x(V ? V.raw : state.raw) : x; }
    function refreshPath() { return (S.rootDir || localDir()) + '\\' + S.refreshCmd; }

    // 网页版：「添加到主屏幕」用的清单。本机 file:// 下浏览器读不了清单（还会报错），所以只在网上加
    if (WEB && S.manifest && !document.querySelector('link[rel="manifest"]')) {
      var mf = document.createElement('link');
      mf.rel = 'manifest';
      mf.href = S.manifest;
      document.head.appendChild(mf);
    }

    // ───────── 时间：一律按影院当地时间 ─────────
    var partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: S.tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    function now() {
      var p = {};
      partsFmt.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
    }
    function nowKey() { var n = now(); return n.date + 'T' + n.time; }
    var foreign = (function () {   // 这台电脑不在影院的时区（比如人在新西兰看上海的排片）
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone !== S.tz; } catch (e) { return false; }
    })();
    function relWord(iso) {
      var d = diffDays(now().date, iso);
      return ({ '-1': '昨天', '0': '今天', '1': '明天', '2': '后天', '3': '大后天' })[d] || md(iso);
    }

    // ───────── 查看次数（右上角 ADMIT ONE 票根） ─────────
    if (S.counter) (function () {
      var c = S.counter, n = parseInt(store(c.key) || String(c.base), 10);
      if (!(n >= c.base)) n = c.base;
      n += 1;
      store(c.key, String(n));
      $('admitNo').textContent = 'No. ' + String(n).padStart(6, '0');
      $('admitTxt').textContent = '第 ' + n + ' 次查看排片';
      if (c.tip) $('admit').title = c.tip;
    })();

    // ───────── 数据：原始格式 → 统一格式 ─────────
    function build(r) {
      var movies = {};
      Object.keys(r.movies || {}).forEach(function (id) {
        try {
          var m = S.movie(r.movies[id], r);
          if (m) {
            m.id = String(m.id);
            m.genres = normGenres(m.genres);
            m.region = regionOf(m);
            m.rerun = m.rerun != null ? !!m.rerun : !!m.classic;   // 老数据里叫 classic
            movies[m.id] = m;
          }
        } catch (e) { if (window.console) console.error('影片数据有问题', id, e); }
      });
      var days = (r.days || []).map(function (d) {
        var list = [];
        (d.sessions || []).forEach(function (s0) {
          var s;
          try { s = S.session(s0, r); } catch (e) { if (window.console) console.error('场次数据有问题', s0, e); return; }
          if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.start || '') || !movies[String(s.movieId)]) return;
          s.id = String(s.id);
          s.movieId = String(s.movieId);
          s.start = s.start.slice(0, 16);
          s.time = s.start.slice(11, 16);
          s.late = s.start.slice(0, 10) > d.date;
          list.push(s);
        });
        list.sort(function (a, b) { return cmp(a.start, b.start) || cmp(a.movieId, b.movieId); });
        return { date: d.date, ok: d.ok !== false, stale: !!d.stale, staleFrom: d.staleFrom || null, sessions: list };
      }).sort(function (a, b) { return cmp(a.date, b.date); });
      return { raw: r, movies: movies, days: days };
    }
    function dayObj(date) {
      if (!V) return null;
      for (var i = 0; i < V.days.length; i++) if (V.days[i].date === date) return V.days[i];
      return null;
    }
    function isPast(s) { return s.start <= nowKey(); }
    function defaultDate() {
      if (!V || !V.days.length) return null;
      var want = addDays(now().date, 1);
      if (dayObj(want)) return want;
      var later = V.days.filter(function (x) { return x.date >= want; });
      return (later[0] || V.days[V.days.length - 1]).date;
    }

    // 某天某时段的电影，排好序：[{ m, list }]
    function items(day, periodId, sortKey) {
      var p = PERIODS.filter(function (x) { return x.id === periodId; })[0] || PERIODS[0];
      var by = {}, ids = [];
      day.sessions.forEach(function (s) {
        if (p.test && !p.test(s)) return;
        if (!by[s.movieId]) { by[s.movieId] = []; ids.push(s.movieId); }
        by[s.movieId].push(s);
      });
      var key = nowKey();
      var out = ids.map(function (id) {
        var list = by[id], next = list.filter(function (s) { return s.start > key; })[0];
        return { m: V.movies[id], list: list, next: next ? next.start : '~' + list[0].start };   // 已全部开场的排到最后
      });
      var coll = new Intl.Collator('zh-Hans-CN-u-co-pinyin');
      out.sort(function (a, b) {
        var old = (a.m.rerun ? 1 : 0) - (b.m.rerun ? 1 : 0);   // 重映的老片不管怎么排，都在新片后面
        if (old) return old;
        if (sortKey === 'rating') return (b.m.sortScore || -1) - (a.m.sortScore || -1) || cmp(a.next, b.next);
        if (sortKey === 'count') return b.list.length - a.list.length || cmp(a.next, b.next);
        if (sortKey === 'name') return coll.compare(a.m.title, b.m.title);
        return cmp(a.next, b.next);
      });
      return out;
    }

    // 地区 / 类型筛选
    function passRegion(m) { return state.region === 'all' || m.region === state.region; }
    function passGenre(m) { return state.genre === 'all' || m.genres.indexOf(state.genre) >= 0; }
    function passCats(m) { return passRegion(m) && passGenre(m); }
    function filtering() { return state.region !== 'all' || state.genre !== 'all'; }
    function catWords() {
      var w = [];
      if (state.region !== 'all' && REGION_BY_ID[state.region]) w.push(REGION_BY_ID[state.region].name);
      if (state.genre !== 'all') w.push(state.genre);
      return w.join(' · ');
    }
    // 按地区分段：[{ r, list }]，按 REGIONS 的先后
    function byRegion(list) {
      var g = {};
      list.forEach(function (x) { (g[x.m.region] = g[x.m.region] || []).push(x); });
      return REGIONS.filter(function (r) { return g[r.id]; }).map(function (r) { return { r: r, list: g[r.id] }; });
    }

    // ───────── 小部件 ─────────
    function posterImg(m, small) {
      var src = (small && m.posterSmall) || m.poster;
      if (!src) return '<div class="ph">' + esc(m.title) + '</div>';
      // 小图（约 360 宽）配普通屏刚好；手机、高清屏（2 倍、3 倍像素）自动换大图，海报才清楚
      var hi = small && m.posterSmall && m.poster && m.poster !== m.posterSmall && !/[\s,]/.test(m.posterSmall + m.poster);
      return '<img src="' + esc(src) + '"' + (hi ? ' srcset="' + esc(m.posterSmall) + ' 1x, ' + esc(m.poster) + ' 2x"' : '') +
        ' alt="' + esc(m.title) + ' 海报" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
    }
    function tagHtml(m) {
      var t = m.titleTag;
      return t ? '<span class="tag"' + (t.tip ? ' title="' + esc(t.tip) + '"' : '') + '>' + esc(t.text) + '</span>' : '';
    }
    function certHtml(m) {
      var c = m.cert;
      return c ? '<span class="cls ' + esc(c.cls || 'n') + '" title="' + esc(c.tip || '') + '">' + esc(c.text) + '</span>' : '';
    }
    // 卡片上的小标签：[文字, 样式, 鼠标提示]；第一个也印在分列海报的右上角
    function ribbons(m, list, date) {
      var r = [], seen = {};
      function add(text, cls, tip) { if (text && !seen[text]) { seen[text] = 1; r.push([text, cls || '', tip || '']); } }
      if (m.rerun) {   // 重映排第一个、不用红色；也不再标「首映日」「提前场」
        var y = parseInt(m.year, 10);
        add(y && y < +String(date || '').slice(0, 4) ? '重映 · ' + y : '重映', 'rerun', m.rerunWhy || '以前上映过的老片');
      } else if (m.release && m.release === date) add('首映日', 'hot');
      else if ((m.release && m.release > date) || list.some(function (s) { return s.advance; })) add(S.advanceLabel || '提前场', 'hot');
      list.forEach(function (s) { if (s.note) add(s.note, 'hot'); });
      list.filter(function (s) { return s.fmt; }).map(function (s) { return s.fmt; })
        .sort(function (a, b) { return (a.rank == null ? 99 : a.rank) - (b.rank == null ? 99 : b.rank); })
        .forEach(function (f) { add(f.label || f.text, f.cls); });
      if (list.some(function (s) { return s.is3d; })) add('3D');
      if (m.chinese) add('华语');
      if (m.special) add(m.special === true ? '演出 / 特别活动' : m.special);
      return r;
    }
    function ribHtml(x) { return '<span class="rb ' + esc(x[1]) + '"' + (x[2] ? ' title="' + esc(x[2]) + '"' : '') + '>' + esc(x[0]) + '</span>'; }
    function scoreLine(m) {
      var out = [];
      (m.scores || []).forEach(function (s) {
        if (s.value && out.length < 2) out.push('<span>' + esc(s.name) + '<b>' + Number(s.value).toFixed(1) + '</b></span>');
      });
      if (!out.length) {
        (m.scores || []).some(function (s) {
          if (s.text) out.push('<span>' + esc(s.name) + ' ' + esc(s.text) + '</span>');
          return !!s.text;
        });
      }
      return out.join('');
    }
    function timeLabel(s) { return (s.late ? '次日' : '') + s.time; }

    // ───────── 页面各块 ─────────
    function render() {
      if (!V || !V.days.length) { renderNoData(); return; }
      if (!state.date || !dayObj(state.date) || (!state.userPicked && state.date !== defaultDate())) state.date = defaultDate();
      var day = dayObj(state.date);
      renderHero(day);
      renderDays();
      renderVenues();
      renderBanner(day);
      renderToolbar();
      renderCats(day);
      if (state.view === 'board') renderBoard(day); else renderGrid(day);
      renderFooter();
      state.anim = false;
      state.sig = tickSig();
    }

    function renderNoData() {
      paintKicker();
      $('headline').textContent = '暂无排片';
      $('dateline').textContent = '还没有读到排片数据';
      $('stats').innerHTML = '';
      $('days').innerHTML = '';
      renderVenues();
      toolbarBox().hidden = true;            // 没排片时海报墙 / 时段 / 排序都没意义，整条收起来
      catsBox().hidden = true;
      var box = $('show');
      box.className = 'grid';
      var other = state.raw && venueList(window[S.dataVar]).length > 1;   // 几家影院里这一家没排片：提示换一家
      box.innerHTML = '<div class="empty">' + (other
        ? '这家影院暂时没有排片数据（' + esc(S.sourceName || '') + '上还没放出场次，或者这次没抓到）。点上面的影院名字换一家看看。'
        : WEB
        ? '还没有排片数据：云端每 3 小时更新一次，过一会儿再刷新本页。'
        : '找不到排片数据：请双击 <b>' + esc(refreshPath()) + '</b> 抓一次，然后刷新本页。') + '</div>';
      document.title = '暂无排片 · ' + val(S.docTitle);
      renderBanner(null);
      renderFooter();
    }

    function paintKicker() {   // 灯箱最上面一行：影院名字
      var kicker = val(S.kicker);
      if (kicker) { $('kicker').textContent = kicker; $('kicker').classList.toggle('zh', /[\u3400-\u9fff]/.test(kicker)); }
    }

    function renderHero(day) {
      var date = day.date, diff = diffDays(now().date, date), a = date.split('-'), wd = weekday(date);
      var word = ({ '0': '今日', '1': '明日', '2': '后日' })[diff];
      var head = word ? word + '放映' : md(date) + '放映';
      paintKicker();
      $('headline').textContent = head;
      var place = val(S.placeEn);
      $('dateline').innerHTML = esc(a[0] + ' 年 ' + (+a[1]) + ' 月 ' + (+a[2]) + ' 日 · 星期' + WEEK[wd]) +
        '<small>' + esc(WEEK_EN[wd] + ' · ' + (+a[2]) + ' ' + MONTH_EN[+a[1] - 1] + ' ' + a[0] + (place ? ' · ' + place : '')) + '</small>';
      var ss = day.sessions, films = {};
      ss.forEach(function (s) { films[s.movieId] = 1; });
      var parts = ['<span><b>' + Object.keys(films).length + '</b>部影片</span>', '<span><b>' + ss.length + '</b>场</span>'];
      if (ss.length) {
        parts.push('<span>首场 <b>' + esc(timeLabel(ss[0])) + '</b></span>');
        parts.push('<span>末场 <b>' + esc(timeLabel(ss[ss.length - 1])) + '</b></span>');
      }
      if (foreign) parts.push('<span>' + esc(val(S.placeZh) || '当地') + '现在 <b id="clock">' + now().time + '</b></span>');
      $('stats').innerHTML = parts.join('');
      document.title = head + ' · ' + val(S.docTitle);
    }

    function renderDays() {
      var today = now().date;
      $('days').innerHTML = V.days.filter(function (x) { return x.date >= today; }).map(function (x) {
        var n = x.sessions.length, left = x.sessions.filter(function (s) { return !isPast(s); }).length;
        var cnt = x.date === today ? (left ? '还剩 ' + left + ' 场' : '已散场') : (n ? n + ' 场' : '暂无场次');
        return '<button class="day" data-date="' + x.date + '" aria-pressed="' + (x.date === state.date) + '" title="' + esc(cnt) + '">' +
          '<span class="d1">' + esc(relWord(x.date)) + '</span><span class="d2">' + esc(slash(x.date) + ' 周' + WEEK[weekday(x.date)]) +
          '<span class="cnt"> · ' + esc(cnt) + '</span></span></button>';
      }).join('');
      var row = $('days'), cur = row.querySelector('[aria-pressed="true"]');   // 手机上一行放不下时，把选中的那天滚到中间
      if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = cur.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2;
    }

    // 换影院：灯箱下面一排铜牌，一家一块；亮灯的是正在看的，牌子上写选中那天这家有几部、几场
    function renderVenues() {
      var box = $('venues');
      if (!box) return;
      var all = window[S.dataVar], vs = venueList(all);
      if (vs.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
      var today = now().date, key = nowKey(), date = state.date || addDays(today, 1);   // 正在看的这家没排片时，牌子上写明天的
      box.innerHTML = '<p class="vcap">选影院<small>SELECT CINEMA</small></p>' + vs.map(function (v) {
        var id = String(v.id), on = id === state.venue, r = null, cnt = '';
        try { r = S.pick(all, id); } catch (e) { r = null; }
        var days = (r && r.days) || [], d = null;
        for (var i = 0; i < days.length; i++) if (days[i] && days[i].date === date) d = days[i];
        var ss = [], films = {};
        ((d && d.sessions) || []).forEach(function (s0) {
          var s = null;
          try { s = S.session(s0, r); } catch (e) { s = null; }
          if (s && s.movieId != null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.start || '')) { ss.push(s); films[s.movieId] = 1; }
        });
        if (!days.some(function (x) { return x && x.date >= today && (x.sessions || []).length; })) cnt = '暂无排片';
        else if (!date) cnt = '';
        else if (!ss.length) cnt = esc(relWord(date)) + ' · 暂无场次';
        else if (date === today) {
          var left = ss.filter(function (s) { return s.start.slice(0, 16) > key; }).length;
          cnt = '今天 · ' + (left ? '还剩 <b>' + left + '</b> 场' : '已散场');
        } else cnt = esc(relWord(date)) + ' · <b>' + Object.keys(films).length + '</b> 部 <b>' + ss.length + '</b> 场';
        return '<button class="venue" data-venue="' + esc(id) + '" aria-pressed="' + on + '" title="' +
          esc((v.tip || v.name || id) + (on ? '（正在看这家）' : ' · 点一下换到这家')) + '">' +
          '<span class="vb">' + esc(v.brand || '') + '</span><span class="vn">' + esc(v.name || id) + '</span>' +
          (cnt ? '<span class="vc">' + cnt + '</span>' : '') + '</button>';
      }).join('');
      box.hidden = false;
    }
    function switchVenue(id) {
      state.venue = String(id);
      store(K + '-venue', state.venue);
      try {   // 地址栏带上 ?c=编号：刷新、收藏、发给别人都还是这家
        var u = new URL(location.href);
        u.searchParams.set('c', state.venue);
        history.replaceState(history.state, '', u.href);
      } catch (e) { /* 个别浏览器不许 file:// 改地址：只是地址栏不变，选择照样记住 */ }
      state.stamp = null;
      ingest();
      // 原来选的地区 / 类型在这家没有片：取消，免得一换影院就是空的
      var day = state.date ? dayObj(state.date) : null;
      if (day) {
        var list = items(day, state.period, state.sort);
        if (state.region !== 'all' && !list.some(function (x) { return x.m.region === state.region; })) state.region = 'all';
        if (state.genre !== 'all' && !list.some(function (x) { return passCats(x.m); })) state.genre = 'all';
      }
    }

    function renderBanner(day) {
      var msgs = [], r = V ? V.raw : state.raw, st = window[S.statusVar];
      var vst = r && r.status && r.status.ok === false ? r.status : null;   // 几家影院时：这一家这次自己没抓到
      if (!r) {
        msgs.push('还没有排片数据。');
      } else {
        var age = r.generatedAt ? (Date.now() - new Date(r.generatedAt).getTime()) / 3600000 : 0;
        var hint = WEB ? (S.staleHintWeb || '（排片由云端每 3 小时自动更新一次）') : (S.staleHint || '（电脑睡眠或断网时不会自动更新）');
        if (age > 12) msgs.push('排片数据是 ' + ago(r.generatedAt) + '抓的，可能不是最新' + hint + '。');
        if (day && day.stale) msgs.push(relWord(day.date) + '的场次这次没抓到，显示的是 ' + fmtStamp(day.staleFrom) + ' 的旧数据。');
        var tomorrow = addDays(now().date, 1), td = dayObj(tomorrow);
        if (V && V.days.length) {   // 这家完全没排片时，下面的空白提示已经说了
          if (!td) msgs.push('数据里还没有明天（' + md(tomorrow) + '）的场次。');
          else if (state.date === tomorrow && !td.sessions.length) msgs.push(S.sourceName + '暂时还没有公布明天的场次。');
        }
      }
      if (vst) {
        msgs.push('最近一次自动更新没抓到这家影院（' + fmtStamp(vst.lastAttempt) + '）：' + vst.message);
      } else if (st && st.ok === false && (!r || !r.generatedAt || new Date(st.lastAttempt) > new Date(r.generatedAt))) {
        msgs.push('最近一次自动更新失败（' + fmtStamp(st.lastAttempt) + '）：' + st.message);
      }
      var el = $('banner');
      if (msgs.length) {
        var how = !WEB ? '想马上更新：双击 ' + esc(refreshPath()) + '，然后刷新本页。'
          : S.repo ? '想马上更新：在 <a href="' + esc(S.repo) + '/actions/workflows/update.yml" target="_blank" rel="noopener noreferrer">GitHub Actions</a>' +
            ' 里点 Run workflow，两三分钟后刷新本页。'
          : '云端会自动重试，过一会儿再刷新本页。';
        el.innerHTML = '⚠ ' + msgs.map(esc).join('<br>⚠ ') + '<br><small>' + how + '</small>';
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    }

    function toolbarBox() { return $('views').closest('.toolbar') || $('views'); }
    function renderToolbar() {
      toolbarBox().hidden = false;
      $('views').innerHTML = VIEWS.map(function (v) {
        return '<button data-view="' + v[0] + '" aria-pressed="' + (state.view === v[0]) + '">' + v[1] + '</button>';
      }).join('');
      $('periods').innerHTML = PERIODS.map(function (p) {
        return '<button class="pill" data-period="' + p.id + '" aria-pressed="' + (state.period === p.id) + '">' + esc(p.label) + '</button>';
      }).join('');
      var sel = $('sort');
      if (!sel.options.length) sel.innerHTML = SORTS.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('');
      sel.value = state.sort;
      $('sorter').hidden = state.view === 'board';   // 时间表本来就按时间排
    }

    // ───────── 分类条：地区 = 邮票（票面数字是部数），类型 = 霓虹灯牌 ─────────
    function catsBox() {
      var box = $('cats');
      if (!box) {   // 老页面没写这个格子：自己补一个
        box = document.createElement('div');
        box.id = 'cats';
        box.className = 'cats';
        $('show').parentNode.insertBefore(box, $('show'));
      }
      return box;
    }
    function stampHtml(r, n) {
      var on = state.region === r.id;
      return '<button class="stamp r-' + r.id + '" data-region="' + r.id + '" aria-pressed="' + on + '"' + (!n && !on ? ' disabled' : '') +
        ' title="' + esc(r.name + '：' + r.tip + ' · ' + n + ' 部' + (on && r.id !== 'all' ? '（再点一下取消）' : '')) + '">' +
        '<span class="si"><b class="sv">' + n + '</b><span class="sn">' + esc(r.name) + '</span><span class="se">' + esc(r.en) + '</span></span></button>';
    }
    function neonHtml(id, label, n) {
      var on = state.genre === id;
      return '<button class="neon" data-genre="' + esc(id) + '" style="--neon:' + neonOf(id) + '" aria-pressed="' + on + '"' +
        (!n && !on ? ' disabled' : '') + (on && id !== 'all' ? ' title="再点一下取消"' : '') + '>' +
        esc(label) + '<sup>' + n + '</sup></button>';
    }
    function renderCats(day) {
      var box = catsBox();
      var base = items(day, state.period, state.sort);   // 这一天、这个时段的全部电影
      // 计数互相联动：地区的数字按当前类型算，类型的数字按当前地区算
      var rHas = {}, rN = {}, rAll = 0, gHas = {}, gBase = {}, gN = {}, gAll = 0;
      base.forEach(function (x) {
        var m = x.m, okG = passGenre(m), okR = passRegion(m);
        rHas[m.region] = 1;
        if (okG) { rN[m.region] = (rN[m.region] || 0) + 1; rAll++; }
        if (okR) gAll++;
        m.genres.forEach(function (g) {
          gHas[g] = 1;
          gBase[g] = (gBase[g] || 0) + 1;
          if (okR) gN[g] = (gN[g] || 0) + 1;
        });
      });
      if (state.region !== 'all') rHas[state.region] = 1;
      if (state.genre !== 'all') gHas[state.genre] = 1;
      var stamps = [stampHtml(REGION_ALL, rAll)].concat(REGIONS.filter(function (r) { return rHas[r.id]; }).map(function (r) {
        return stampHtml(r, rN[r.id] || 0);
      }));
      var gens = Object.keys(gHas).sort(function (a, b) {   // 按这一天的总数排，筛选时顺序不跳
        return (gBase[b] || 0) - (gBase[a] || 0) || genreRank(a) - genreRank(b) || cmp(a, b);
      });
      var neons = [neonHtml('all', '全部类型', gAll)].concat(gens.map(function (g) { return neonHtml(g, g, gN[g] || 0); }));
      // 手机上这两行是横着滑的：重画以后保持原来滑到的位置
      var keep = Array.prototype.map.call(box.querySelectorAll('.cat-list'), function (el) { return el.scrollLeft; });
      box.innerHTML =
        '<div class="cat-row" role="group" aria-label="按地区筛选"><span class="cat-lab">地区<small>REGION</small></span>' +
          '<div class="cat-list stamps">' + stamps.join('') + '</div></div>' +
        (gens.length ? '<div class="cat-row" role="group" aria-label="按类型筛选"><span class="cat-lab">类型<small>GENRE</small></span>' +
          '<div class="cat-list neons">' + neons.join('') + '</div></div>' : '');
      box.querySelectorAll('.cat-list').forEach(function (el, i) { if (keep[i]) el.scrollLeft = keep[i]; });
      box.hidden = !base.length && !filtering();
    }

    function emptyHtml(day, base, cls) {
      var msg;
      if (!day.sessions.length) msg = '这一天暂无场次';
      else if (!base.length) msg = '这个时段没有场次';
      else {
        return '<div class="' + cls + '">' + esc(relWord(day.date) + (state.period !== 'all' ? '这个时段' : '') + '没有「' + catWords() + '」的电影') +
          '<br><button class="pill" data-act="clear-filter">看全部影片</button></div>';
      }
      return '<div class="' + cls + '">' + esc(msg) + '</div>';
    }

    function renderGrid(day) {
      var box = $('show');
      var keepLane = laneAtStart();          // 重画前看到的是哪一列：重画后接着停在那儿
      var base = items(day, state.period, state.sort);
      var list = base.filter(function (x) { return passCats(x.m); });
      // 重映的老片不进各国的列：新片按国家分列，老片单独一列放最右边
      var fresh = list.filter(function (x) { return !x.m.rerun; }), old = list.filter(function (x) { return x.m.rerun; });
      var groups = state.region === 'all' ? byRegion(fresh) : [];
      if (groups.length > 1) {
        if (old.length) groups.push({ r: RERUN_LANE, list: old, rerun: true });
        renderLanes(box, groups, list.length, day, keepLane);
        return;
      }
      box.className = 'grid' + (state.anim ? ' anim' : '');
      if (!list.length) {
        state.order = [];
        box.innerHTML = emptyHtml(day, base, 'empty');
        return;
      }
      // 只有一个地区（或者选了某个地区）：一行两部的大卡片，带简介；重映的排在最后，前面隔一道线
      state.order = fresh.concat(old).map(function (x) { return x.m.id; });
      var j = 0;
      box.innerHTML = fresh.map(function (x) { return cardHtml(x, j, j++, day); }).join('') +
        (old.length ? '<div class="rerun-sep" role="separator" title="' + esc(RERUN_LANE.tip) + '"><span>重映 · 以前上映过的老片 <b>' + old.length + '</b> 部</span></div>' +
          old.map(function (x) { return cardHtml(x, j, j++, day); }).join('') : '');
    }

    // ───────── 按国家 / 地区分列（看板）─────────
    // 「全部地区」时一个国家一竖列，片子多的在最左边，列里海报两张并排；列有多长，一眼就看出这个国家有几部。
    // 电脑一屏三列、平板两列、手机一列（每屏露出下一列的一角），国家多了左右滑，或者点上面的箭头 / 印章
    // 重映那一列（rerun）不管几部都排最后
    function renderLanes(box, groups, total, day, keepLane) {
      groups.sort(function (a, b) {
        return (a.rerun ? 1 : 0) - (b.rerun ? 1 : 0) || b.list.length - a.list.length || REGIONS.indexOf(a.r) - REGIONS.indexOf(b.r);
      });
      state.order = [];
      groups.forEach(function (g) { g.list.forEach(function (x) { state.order.push(x.m.id); }); });
      var re = groups.filter(function (g) { return g.rerun; })[0], nOld = re ? re.list.length : 0;
      var k = 0;
      box.className = 'lanes-host' + (state.anim ? ' anim' : '');
      box.innerHTML = '<div class="lanes-bar">' +
          '<span class="lcap"><b>' + (groups.length - (re ? 1 : 0)) + '</b> 个地区 · <b>' + (total - nOld) + '</b> 部' +
            (re ? '<span class="lre"> · 重映 <b>' + nOld + '</b> 部<span class="lre-at">在最右边</span></span>' : '') +
            '<span class="lhint"> · 左右滑动看全部</span></span>' +
          '<span class="lnav"><span class="ldots">' + groups.map(function (g) {
            return '<button type="button" class="ldot r-' + g.r.id + '" data-act="lane-go" data-lane="' + g.r.id + '" title="' +
              esc(g.r.name + ' ' + g.list.length + ' 部') + '" aria-label="' + esc('看' + g.r.name + '（' + g.list.length + ' 部）') + '">' + esc(g.r.seal) + '</button>';
          }).join('') + '</span>' +
          '<button type="button" class="larr" data-act="lane-prev" aria-label="往左看上一个地区">‹</button>' +
          '<button type="button" class="larr" data-act="lane-next" aria-label="往右看下一个地区">›</button></span>' +
        '</div>' +
        '<div class="lanes" tabindex="0" style="--n:' + groups.length + '" aria-label="按国家和地区分列，可以左右滚动">' +
          groups.map(function (g) {
            var r = g.r, n = g.list.length, shows = 0;
            g.list.forEach(function (x) { shows += x.list.length; });
            var html = '<section class="lane' + (g.rerun ? ' rerun' : '') + '" data-lane="' + r.id + '" aria-label="' + esc(r.name + ' ' + n + ' 部') + '">' +
              '<header class="lane-head r-' + r.id + '" title="' + esc(r.tip) + '">' +
                '<span class="seal" aria-hidden="true">' + esc(r.seal) + '</span>' +
                '<span class="ln"><b>' + esc(r.name) + '</b><small>' + esc(r.enLong) + '</small></span>' +
                '<span class="lc"><span><b>' + n + '</b>部</span><small>' + shows + ' 场</small></span>' +
                '<span class="lmeter" aria-hidden="true"><i style="width:' + Math.max(3, Math.round(n / total * 100)) + '%"></i></span>' +
              '</header>' +
              '<div class="lane-grid">' + g.list.map(function (x, j) { return pcardHtml(x, j, k++, day); }).join('') + '</div></section>';
            return html;
          }).join('') +
        '</div>';
      var sc = lanesEl();
      if (keepLane) {
        var el = sc.querySelector('.lane[data-lane="' + cssEsc(keepLane) + '"]');
        if (el) sc.scrollLeft = laneX(sc, el);
      }
      sc.addEventListener('scroll', function () {
        if (sc.rafPending) return;
        sc.rafPending = true;
        requestAnimationFrame(function () { sc.rafPending = false; lanesUpdate(sc); });
      }, { passive: true });
      lanesUpdate(sc);
    }
    function lanesEl() { return document.querySelector('#show .lanes'); }
    function lanesOf(sc) { return [].slice.call(sc.querySelectorAll('.lane')); }
    function laneX(sc, el) { return el.offsetLeft - (parseFloat(getComputedStyle(sc).paddingLeft) || 0); }
    function laneAtStart() {
      var sc = lanesEl();
      if (!sc) return null;
      var hit = lanesOf(sc).filter(function (l) { return l.offsetLeft + l.offsetWidth / 2 > sc.scrollLeft; })[0];
      return hit ? hit.getAttribute('data-lane') : null;
    }
    // 箭头能不能点、右边要不要淡出、哪几个印章亮（看得到一半以上的列）
    function lanesUpdate(sc) {
      if (!sc || !sc.isConnected) return;
      var max = sc.scrollWidth - sc.clientWidth, over = max > 2;
      var atL = sc.scrollLeft <= 2, atR = sc.scrollLeft >= max - 2;
      sc.classList.toggle('fade-r', over && !atR);
      var bar = sc.previousElementSibling;
      if (!bar) return;
      bar.classList.toggle('over', over);
      var prev = bar.querySelector('[data-act="lane-prev"]'), next = bar.querySelector('[data-act="lane-next"]');
      if (prev) prev.disabled = !over || atL;
      if (next) next.disabled = !over || atR;
      lanesOf(sc).forEach(function (l) {
        var x0 = l.offsetLeft - sc.scrollLeft, x1 = x0 + l.offsetWidth;
        var seen = Math.max(0, Math.min(x1, sc.clientWidth) - Math.max(x0, 0)) / l.offsetWidth;
        var dot = bar.querySelector('.ldot[data-lane="' + cssEsc(l.getAttribute('data-lane')) + '"]');
        if (dot) dot.setAttribute('aria-current', seen > 0.5 ? 'true' : 'false');
      });
    }
    function scrollLanes(dir, laneId) {
      var sc = lanesEl();
      if (!sc) return;
      var xs = lanesOf(sc).map(function (l) { return { id: l.getAttribute('data-lane'), x: laneX(sc, l) }; });
      var cur = sc.scrollLeft, to = null;
      if (laneId) xs.forEach(function (p) { if (p.id === laneId) to = p.x; });
      else if (dir > 0) to = (xs.filter(function (p) { return p.x > cur + 4; })[0] || { x: sc.scrollWidth }).x;
      else to = (xs.filter(function (p) { return p.x < cur - 4; }).pop() || { x: 0 }).x;
      if (to == null) return;
      var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      sc.scrollTo({ left: to, behavior: calm ? 'auto' : 'smooth' });
    }

    function cardHtml(x, rank, i, day) {
      var m = x.m, list = x.list;
      var left = day.date === now().date ? list.filter(function (s) { return !isPast(s); }) : list;
      var times = left.slice(0, CARD_TIMES).map(function (s) {
        return '<span class="ct' + (s.fmt ? ' ' + esc(s.fmt.cls || '') : '') + '"' +
          (s.fmt ? ' title="' + esc(s.fmt.label || s.fmt.text) + '"' : '') + '>' + esc(timeLabel(s)) + '</span>';
      });
      if (left.length > CARD_TIMES) times.push('<span class="ct more">+' + (left.length - CARD_TIMES) + '</span>');
      if (!left.length) times.push('<span class="ct done">今天的场次都已开场</span>');
      var meta = [];
      if (m.cert) meta.push(certHtml(m));
      if (m.runtime) meta.push('<span>' + m.runtime + ' 分钟</span>');
      if (m.genres && m.genres.length) meta.push('<span>' + esc(m.genres.slice(0, 2).join(' / ')) + '</span>');
      var rib = ribbons(m, list, day.date).slice(0, 3), sc = scoreLine(m);
      var count = left.length < list.length ? '还剩 ' + left.length + ' 场 / 共 ' + list.length + ' 场' : '共 ' + list.length + ' 场';
      return '<a class="card deco' + (left.length ? '' : ' dim') + (m.rerun ? ' rerun' : '') + '" href="#m=' + encodeURIComponent(m.id) + '" data-id="' + esc(m.id) + '" data-region="' + esc(m.region) +
        '" style="--i:' + i + '" aria-label="' + esc(m.title + '，' + count + '，查看详情') + '">' +
        '<div class="poster"><span class="rank">' + pad2(rank + 1) + '</span>' + posterImg(m, true) + '</div>' +
        '<div class="cinfo">' +
          (rib.length ? '<div class="ribbons">' + rib.map(ribHtml).join('') + '</div>' : '') +
          '<h3 class="ctitle">' + esc(m.title) + tagHtml(m) + '</h3>' +
          (m.sub ? '<p class="csub">' + esc(m.sub) + '</p>' : '') +
          (meta.length ? '<p class="cmeta">' + meta.join('<span class="dot">·</span>') + '</p>' : '') +
          (sc ? '<p class="cscore">' + sc + '</p>' : '') +
          (m.intro ? '<p class="chook">' + esc(m.intro) + '</p>' : '') +
          '<div class="ctimes">' + times.join('') + '</div>' +
          '<div class="cgo"><span class="n">' + esc(count) + '</span><span class="go">详情 ›</span></div>' +
        '</div></a>';
    }

    // 分列里的海报卡：海报为主（不压字，看得清），下面片名、分级片长、评分、场次
    function pcardHtml(x, rank, i, day) {
      var m = x.m, list = x.list;
      var left = day.date === now().date ? list.filter(function (s) { return !isPast(s); }) : list;
      var times = left.slice(0, PCARD_TIMES).map(function (s) {
        return '<span class="ct' + (s.fmt ? ' ' + esc(s.fmt.cls || '') : '') + '"' +
          (s.fmt ? ' title="' + esc(s.fmt.label || s.fmt.text) + '"' : '') + '>' + esc(timeLabel(s)) + '</span>';
      });
      if (left.length > PCARD_TIMES) times.push('<span class="ct more" title="' + esc('还有 ' + (left.length - PCARD_TIMES) + ' 场，点开看全部') + '">+' + (left.length - PCARD_TIMES) + '</span>');
      if (!left.length) times.push('<span class="ct done">今天都已开场</span>');
      var meta = [];
      if (m.cert) meta.push(certHtml(m));
      if (m.runtime) meta.push('<span>' + m.runtime + ' 分钟</span>');
      if (m.genres && m.genres.length) meta.push('<span>' + esc(m.genres.slice(0, 2).join('/')) + '</span>');
      var rib = ribbons(m, list, day.date)[0], sc = scoreLine(m);
      var count = left.length < list.length ? '还剩 ' + left.length + ' 场 / 共 ' + list.length + ' 场' : '共 ' + list.length + ' 场';
      return '<a class="pcard' + (left.length ? '' : ' dim') + (m.rerun ? ' rerun' : '') + '" href="#m=' + encodeURIComponent(m.id) + '" data-id="' + esc(m.id) +
        '" style="--i:' + i + '" title="' + esc(m.title + (m.sub ? ' · ' + m.sub : '')) + '" aria-label="' + esc(m.title + '，' + count + '，查看详情') + '">' +
        '<div class="poster"><span class="rank">' + pad2(rank + 1) + '</span>' +
          (rib ? '<span class="pbadge ' + esc(rib[1]) + '"' + (rib[2] ? ' title="' + esc(rib[2]) + '"' : '') + '>' + esc(rib[0]) + '</span>' : '') + posterImg(m, true) + '</div>' +
        '<h3 class="ptitle">' + esc(m.title) + tagHtml(m) + '</h3>' +
        (meta.length ? '<p class="pmeta">' + meta.join('<span class="dot">·</span>') + '</p>' : '') +
        (sc ? '<p class="pscore">' + sc + '</p>' : '') +
        '<div class="ptimes">' + times.join('') + '</div>' +
        '</a>';
    }

    function renderBoard(day) {
      var box = $('show');
      box.className = 'board';
      state.order = items(day, 'all', 'time').filter(function (x) { return passCats(x.m); }).map(function (x) { return x.m.id; });
      var shown = function (s) { return passCats(V.movies[s.movieId]); };
      var groups = PERIODS.slice(1).filter(function (g) { return state.period === 'all' || g.id === state.period; }).map(function (g) {
        return { g: g, list: day.sessions.filter(function (s) { return g.test(s) && shown(s); }) };
      }).filter(function (x) { return x.list.length; });
      if (!groups.length) { box.innerHTML = emptyHtml(day, items(day, state.period, 'time'), 'board-empty'); return; }
      box.innerHTML = '<div class="board-cols">' + groups.map(function (x) {
        return '<div class="period"><h3>' + esc(x.g.label) + ' · ' + x.list.length + ' 场</h3></div>' + x.list.map(function (s) {
          var m = V.movies[s.movieId], sx = s.fmt ? (s.fmt.short || s.fmt.text) : '';
          return '<button class="slot' + (isPast(s) ? ' past' : '') + (m.rerun ? ' rerun' : '') + '" data-movie="' + esc(s.movieId) + '" data-session="' + esc(s.id) + '" ' +
            'title="' + esc(m.title + (m.sub ? ' · ' + m.sub : '') + (m.rerun ? ' · 重映' : '') + (s.hall ? ' · ' + s.hall : '') + ' · 点开看详情') + '">' +
            '<span class="st">' + esc(timeLabel(s)) + '</span><span class="sn">' + esc(m.title) + '</span>' +
            (m.rerun ? '<span class="sx re">重映</span>' : '') + (sx ? '<span class="sx">' + esc(sx) + '</span>' : '') + '</button>';
        }).join('');
      }).join('') + '</div>';
    }

    function renderFooter() {
      $('footer').innerHTML = webLinkHtml() + S.footer(V ? V.raw : state.raw, { esc: esc, fmtStamp: fmtStamp, ago: ago,
        status: window[S.statusVar], web: WEB, dir: S.rootDir || localDir() });
    }
    // 本机打开时，页脚放手机网页版的二维码和网址（已经在网页版里就不用放了）
    function webLinkHtml() {
      if (WEB || !S.webUrl) return '';
      var short = S.webUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return '<div class="weblink">' +
        (S.qr ? '<img src="' + esc(S.qr) + '" width="112" height="112" alt="手机网页版的二维码">' : '') +
        '<div><b>手机上看</b>：用手机相机扫左边的二维码，或者打开<br><a href="' + esc(S.webUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(short) + '</a><br><small>和这里是同一份排片，云端每 3 小时更新。在手机浏览器里选「添加到主屏幕」，以后像 App 一样点开。</small></div></div>';
    }

    // ───────── 详情弹窗 ─────────
    function orderFor(id) {
      if (state.order.indexOf(id) >= 0) return state.order;
      var day = dayObj(state.date);
      var all = day ? items(day, 'all', state.view === 'board' ? 'time' : state.sort).map(function (x) { return x.m.id; }) : [];
      return all.indexOf(id) >= 0 ? all : [id];
    }

    function ticketHtml(s, m) {
      var past = isPast(s), bits = [];
      if (s.hall) bits.push(esc(s.hall));
      if (s.seats != null) bits.push(s.seats <= 20 ? '<span class="low">仅剩 ' + s.seats + ' 座</span>' : '余 ' + s.seats + ' 座');
      var end = m.runtime ? addMin(s.time, (S.adsMin || 0) + m.runtime) : '';
      var tip = m.title + ' ' + (s.late ? '次日 ' : '') + s.time + ' 开场' +
        (end ? '，约 ' + end + ' 散场（片长 ' + m.runtime + ' 分钟' + (S.adsMin ? ' + 约 ' + S.adsMin + ' 分钟映前广告' : '') + '）' : '') +
        (s.hallFull && s.hallFull !== s.hall ? '；' + s.hallFull : '') +
        (s.seats != null ? '；更新时余 ' + s.seats + ' 座' : '') +
        (past ? '（已开场）' : (s.booking ? '；点击去' + S.bookName + '选座购票' : ''));
      var inner = '<span class="t">' + (s.late ? '<small>次日</small>' : '') + esc(s.time) + '</span>' +
        (bits.length ? '<span class="s">' + bits.join(' · ') + '</span>' : '') +
        ((s.tags || []).length ? '<span class="a">' + esc(s.tags.join(' · ')) + '</span>' : '') +
        (s.fmt ? '<span class="x ' + esc(s.fmt.cls || '') + '">' + esc(s.fmt.text) + '</span>' : '');
      var attrs = 'class="tk' + (past ? ' past' : '') + (state.ping === s.id ? ' ping' : '') + '" data-sid="' + esc(s.id) + '" title="' + esc(tip) + '"';
      return past || !s.booking ? '<span ' + attrs + '>' + inner + '</span>'
        : '<a ' + attrs + ' href="' + esc(s.booking) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>';
    }

    function detailHtml(id) {
      var m = V.movies[id], date = state.date, day = dayObj(date);
      var list = day ? day.sessions.filter(function (s) { return s.movieId === id; }) : [];
      var ord = orderFor(id), i = ord.indexOf(id);

      var meta = [];
      if (m.cert) meta.push(certHtml(m));
      if (m.runtime) meta.push('<span>' + m.runtime + ' 分钟</span>');
      if (m.genres && m.genres.length) {
        meta.push('<span class="gtags">' + m.genres.slice(0, 4).map(function (g) {
          return '<button class="gt" data-genre="' + esc(g) + '" style="--neon:' + neonOf(g) + '" title="看看还有哪些' + esc(g) + '片">' + esc(g) + '</button>';
        }).join('<span class="sl">/</span>') + '</span>');
      }
      var reg = REGION_BY_ID[m.region];
      if (m.place || reg) {
        meta.push('<span class="mplace">' + (reg ? '<button class="mseal r-' + reg.id + '" data-region="' + reg.id + '" title="地区：' +
          esc(reg.name) + '（点一下只看' + esc(reg.name) + '片）">' + esc(reg.seal) + '</button>' : '') + esc(m.place || reg.name) + '</span>');
      }
      if (m.releaseText) meta.push('<span>' + esc(m.releaseText) + '</span>');
      if (m.rerun) meta.push('<span class="mre">重映：' + esc(m.rerunWhy || '以前上映过的老片') + '</span>');
      var scores = (m.scores || []).map(function (s) {
        if (s.value) {
          return '<span class="sc">' + esc(s.name) + ' <span class="v">' + Number(s.value).toFixed(1) + '</span>' + starsHtml(s.value) +
            (s.count ? '<small>' + Number(s.count).toLocaleString('zh-CN') + ' 人评</small>' : '') + '</span>';
        }
        return s.text ? '<span class="sc muted">' + esc(s.name) + ' ' + esc(s.text) + '</span>' : '';
      }).join('');
      var people = [];
      if (m.directors) people.push('导演 <b>' + esc(m.directors) + '</b>');
      if (m.actors) people.push('主演 <b>' + esc(m.actors) + '</b>');
      var rib = ribbons(m, list, date);

      var enBtn = m.introEn ? '<button class="linkbtn" data-act="en">' + (state.showEn ? '收起英文原文 ▴' : '看英文原文 ▾') + '</button>' : '';
      var plot = '<div class="blk"><h4>剧情简介<span>STORY</span></h4><div class="plot"><p>' + esc(m.intro || '暂无简介') + '</p>' +
        (m.introSrc || enBtn ? '<div class="src' + (m.introMachine ? ' mt' : '') + '"><span>' + esc(m.introSrc || '') + '</span>' + enBtn + '</div>' : '') +
        (m.introEn && state.showEn ? '<p class="plot-en">' + esc(m.introEn) + '</p>' : '') + '</div>' +
        (m.policy ? '<p class="policy">分级提示：' + esc(m.policy) + '</p>' : '') + '</div>';

      var today = now().date;
      var others = V.days.filter(function (d) { return d.date >= today; }).map(function (d) {
        var n = d.sessions.filter(function (s) { return s.movieId === id; }).length;
        return n ? '<button class="pill" data-date="' + d.date + '" aria-pressed="' + (d.date === date) + '">' +
          esc(relWord(d.date) + ' ' + slash(d.date) + ' · ' + n + ' 场') + '</button>' : '';
      }).join('');
      var sess = '<div class="blk"><h4>场次<span>SESSIONS</span><em>' +
        esc(md(date) + ' 周' + WEEK[weekday(date)] + '（' + relWord(date) + '）' + (list.length ? ' · ' + list.length + ' 场' : '') +
          (list.length && S.bookName ? ' · 点票根去' + S.bookName + '购票' : '')) + '</em></h4>' +
        (list.length ? '<div class="tix">' + list.map(function (s) { return ticketHtml(s, m); }).join('') + '</div>'
          : '<p class="nodays">' + esc(relWord(date)) + '没有这部电影的场次。</p>') +
        (others ? '<div class="otherdays">换一天：' + others + '</div>' : '') + '</div>';

      var trailer = m.trailer && m.trailer.video
        ? '<div class="blk trailer"><h4>预告片<span>TRAILER</span>' + (m.trailer.name ? '<em>' + esc(m.trailer.name) + '</em>' : '') + '</h4>' +
          '<button class="playbtn" data-act="play">▶ 播放预告片</button></div>' : '';
      var stills = m.stills && m.stills.length
        ? '<div class="blk"><h4>剧照<span>STILLS</span></h4><div class="stills">' + m.stills.map(function (u) {
          return '<img src="' + esc(u) + '" alt="' + esc(m.title) + ' 剧照" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
        }).join('') + '</div></div>' : '';
      var links = (m.links || []).map(function (l) {
        return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.text) + '</a>';
      });
      if (m.idText) links.push('<span class="id">' + esc(m.idText) + '</span>');

      return '<div class="dlg" tabindex="-1">' +
        '<div class="dlg-bar">' +
          '<button class="ib" data-act="prev" aria-label="上一部" title="上一部（← 键）"' + (i > 0 ? '' : ' disabled') + '>‹</button>' +
          '<span class="pos">' + (ord.length > 1 && i >= 0 ? (i + 1) + ' / ' + ord.length : '') + '</span>' +
          '<button class="ib" data-act="next" aria-label="下一部" title="下一部（→ 键）"' + (i >= 0 && i < ord.length - 1 ? '' : ' disabled') + '>›</button>' +
          '<span class="crumb">' + esc(m.title) + '</span>' +
          '<button class="ib x" data-act="close" aria-label="关闭" title="关闭（Esc）">×</button>' +
        '</div>' +
        '<div class="dlg-hero"' + (m.poster ? ' style="--hero:url(&quot;' + esc(m.poster) + '&quot;)"' : '') + '>' +
          '<div class="poster">' + posterImg(m, false) + '</div>' +
          '<div class="hhead">' +
            (rib.length ? '<div class="ribbons">' + rib.map(ribHtml).join('') + '</div>' : '') +
            '<h2 class="dtitle" id="dtitle">' + esc(m.title) + tagHtml(m) + '</h2>' +
            (m.sub ? '<p class="dsub">' + esc(m.sub) + '</p>' : '') +
            (meta.length ? '<div class="meta">' + meta.join('<span class="dot">·</span>') + '</div>' : '') +
            (scores ? '<div class="scores">' + scores + '</div>' : '') +
          '</div>' +
          '<div class="hmore">' +
            (people.length ? '<p class="people">' + people.join('　') + '</p>' : '') +
            (m.note ? '<p class="note">' + esc(m.note) + '</p>' : '') +
          '</div>' +
        '</div>' +
        '<div class="dlg-body">' + plot + sess + trailer + stills +
          (links.length ? '<div class="links">' + links.join('') + '</div>' : '') +
          '<p class="hint">← → 键或左右滑动切换影片 · Esc 或点空白处关闭</p>' +
        '</div></div>';
    }

    function playing() {
      var v = dlg.querySelector('video');
      return !!(v && !v.paused && !v.ended);
    }
    function stopVideo() { dlg.querySelectorAll('video').forEach(function (v) { try { v.pause(); } catch (e) { /* 忽略 */ } }); }

    function paintDetail(o) {
      if (!state.open || !V || !V.movies[state.open]) return;
      var old = dlg.querySelector('.dlg'), top = old ? old.scrollTop : 0;
      dlg.innerHTML = detailHtml(state.open);
      dlg.setAttribute('aria-labelledby', 'dtitle');
      var box = dlg.querySelector('.dlg');
      if (o.dir) box.classList.add(o.dir > 0 ? 'from-r' : 'from-l');
      else if (!o.first) box.style.animation = 'none';    // 原地刷新：不要再弹一次
      if (!o.reset) box.scrollTop = top;
      var mark = function () { box.classList.toggle('scrolled', box.scrollTop > 140); };
      mark();
      box.addEventListener('scroll', mark, { passive: true });
      if (o.focus !== false) box.focus({ preventScroll: true });
    }

    function hashId() {
      var m = /^#m=(.+)$/.exec(location.hash || '');
      if (!m) return null;
      try { return decodeURIComponent(m[1]); } catch (e) { return null; }
    }
    function setHash(mode, id, root) {
      try {
        if (mode === 'push') history.pushState({ detail: id }, '', '#m=' + encodeURIComponent(id));
        else if (mode === 'replace') {
          history.replaceState({ detail: id, root: !!(root || (history.state && history.state.root)) }, '', '#m=' + encodeURIComponent(id));
        } else history.replaceState(null, '', location.href.split('#')[0]);
      } catch (e) { /* 个别浏览器不许 file:// 改历史记录：只是「返回键关弹窗」用不了 */ }
    }

    function openDetail(id, opt) {
      opt = opt || {};
      id = String(id);
      if (!V || !V.movies[id]) return;
      var wasOpen = dlg.open;
      if (!wasOpen) state.lastFocus = document.activeElement;
      stopVideo();
      state.open = id;
      state.ping = opt.ping ? String(opt.ping) : null;
      if (opt.history === 'push') setHash(wasOpen && history.state && history.state.detail ? 'replace' : 'push', id);
      else if (opt.history === 'replace') setHash('replace', id, opt.root);
      paintDetail({ reset: true, first: !wasOpen });
      if (!wasOpen) {
        try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
        var box = dlg.querySelector('.dlg');
        if (box) box.focus({ preventScroll: true });
      }
      if (state.ping) {
        var tk = dlg.querySelector('.tk[data-sid="' + cssEsc(state.ping) + '"]');
        if (tk) setTimeout(function () { tk.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60);
      }
    }

    function closeDetail(fromPop) {
      if (!state.open && !dlg.open) return;
      if (!fromPop && history.state && history.state.detail && !history.state.root) { history.back(); return; }   // popstate 会再叫回来
      var id = state.open;
      state.open = null;
      state.ping = null;
      stopVideo();
      if (dlg.open) dlg.close();
      dlg.innerHTML = '';
      if (!fromPop && location.hash) setHash('clear');
      var card = id ? document.querySelector('#show a[data-id="' + cssEsc(id) + '"]') : null;
      var back = card || state.lastFocus;
      if (back && back.focus) {
        back.focus({ preventScroll: true });
        if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // 分列时可能要横着滚到那一列
      }
    }

    function step(k) {
      if (!state.open) return;
      var ord = orderFor(state.open), i = ord.indexOf(state.open), j = i + k;
      if (i < 0 || j < 0 || j >= ord.length) return;
      stopVideo();
      state.open = ord[j];
      state.ping = null;
      setHash('replace', state.open);
      paintDetail({ reset: true, dir: k });
    }

    function playTrailer(btn) {
      var m = V && V.movies[state.open];
      if (!m || !m.trailer || !m.trailer.video) return;
      var v = document.createElement('video');
      v.controls = true;
      v.playsInline = true;
      v.preload = 'auto';
      if (m.trailer.poster) v.poster = m.trailer.poster;
      v.src = m.trailer.video;
      v.addEventListener('error', function () {
        var p = document.createElement('p');
        p.className = 'nodays';
        p.textContent = '预告片暂时放不了（可能是网络或视频链接过期），可以到下面的链接里看。';
        v.replaceWith(p);
      });
      btn.replaceWith(v);
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () { /* 浏览器拦了自动播放：点一下播放键就行 */ });
    }

    // ───────── 交互 ─────────
    document.addEventListener('click', function (e) {
      if (dlg.contains(e.target)) return;
      var card = e.target.closest('a.card, a.pcard');
      if (card) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;   // 新标签页打开：带 #m= 也能直接看详情
        e.preventDefault();
        openDetail(card.getAttribute('data-id'), { history: 'push' });
        return;
      }
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      var keep = null;   // 重画以后把键盘焦点放回同一个按钮
      if (b.classList.contains('day')) {
        state.date = b.getAttribute('data-date');
        state.userPicked = true;
        keep = '.day[data-date="' + cssEsc(state.date) + '"]';
      } else if (b.hasAttribute('data-view')) {
        state.view = b.getAttribute('data-view');
        store(K + '-view', state.view);
        keep = '[data-view="' + cssEsc(state.view) + '"]';
      } else if (b.hasAttribute('data-period')) {
        state.period = b.getAttribute('data-period');
        keep = '[data-period="' + cssEsc(state.period) + '"]';
      } else if (b.hasAttribute('data-region')) {
        var r = b.getAttribute('data-region');
        state.region = r === state.region && r !== 'all' ? 'all' : r;   // 再点一次 = 取消
        keep = '.stamp[data-region="' + cssEsc(r) + '"]';
      } else if (b.hasAttribute('data-genre')) {
        var g = b.getAttribute('data-genre');
        state.genre = g === state.genre && g !== 'all' ? 'all' : g;
        keep = '.neon[data-genre="' + cssEsc(g) + '"]';
      } else if (b.getAttribute('data-act') === 'clear-filter') {
        state.region = 'all';
        state.genre = 'all';
        keep = '.stamp[data-region="all"]';
      } else if (b.hasAttribute('data-venue')) {   // 换影院：数据已经都在手上，马上换，不用重新打开页面
        var vid = b.getAttribute('data-venue');
        if (vid === state.venue) return;
        switchVenue(vid);
        keep = '.venue[data-venue="' + cssEsc(vid) + '"]';
      } else if (b.classList.contains('slot')) {
        openDetail(b.getAttribute('data-movie'), { history: 'push', ping: b.getAttribute('data-session') });
        return;
      } else if (/^lane-/.test(b.getAttribute('data-act') || '')) {   // 分列：左右箭头、跳到某个地区
        var act = b.getAttribute('data-act');
        scrollLanes(act === 'lane-next' ? 1 : -1, act === 'lane-go' ? b.getAttribute('data-lane') : null);
        return;
      } else {
        return;
      }
      state.anim = true;
      render();
      var nb = document.querySelector(keep);
      if (nb && !b.isConnected) nb.focus({ preventScroll: true });
    });
    $('sort').addEventListener('change', function (e) {
      state.sort = e.target.value;
      store(K + '-sort', state.sort);
      state.anim = true;
      render();
    });

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) { closeDetail(); return; }   // 点了弹窗外面的空白
      var b = e.target.closest('button');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'close') closeDetail();
      else if (act === 'prev') step(-1);
      else if (act === 'next') step(1);
      else if (act === 'play') playTrailer(b);
      else if (act === 'en') {
        state.showEn = !state.showEn;
        store(K + '-en', state.showEn ? '1' : '0');
        paintDetail({ reset: false });
      } else if (b.hasAttribute('data-genre') || b.hasAttribute('data-region')) {
        // 详情里点类型 / 地区：关掉弹窗，海报墙只留这一类
        if (b.hasAttribute('data-genre')) { state.genre = b.getAttribute('data-genre'); state.region = 'all'; }
        else { state.region = b.getAttribute('data-region'); state.genre = 'all'; }
        state.anim = true;
        closeDetail();
        render();
      } else if (b.hasAttribute('data-date')) {
        state.date = b.getAttribute('data-date');
        state.userPicked = true;
        render();
        paintDetail({ reset: false });
      }
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeDetail(); });
    dlg.addEventListener('close', function () { if (state.open) closeDetail(); });   // 浏览器自己关掉时也把状态收好
    dlg.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.target.closest && e.target.closest('video, select, input, textarea'))) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
    var touch = null;
    dlg.addEventListener('touchstart', function (e) {
      touch = e.touches.length === 1 && !e.target.closest('.stills, video, .tix')
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    }, { passive: true });
    dlg.addEventListener('touchend', function (e) {
      if (!touch) return;
      var p = e.changedTouches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y, dt = Date.now() - touch.t;
      touch = null;
      if (dt < 700 && Math.abs(dx) > 60 && Math.abs(dx) > 1.8 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    window.addEventListener('popstate', function () {
      var id = hashId();
      if (id && V && V.movies[id]) openDetail(id, {});
      else if (state.open || dlg.open) closeDetail(true);
    });
    document.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      if (img.closest('.poster')) {
        var ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = img.alt.replace(/ 海报$/, '');
        img.replaceWith(ph);
      } else if (img.closest('.stills')) {
        img.remove();
      }
    }, true);

    // ───────── 读数据：<script> 读本地 js（file:// 下 fetch 读不了），之后定时重读 ─────────
    function loadData(cb) {
      var files = S.files, left = files.length;
      files.forEach(function (src) {
        var old = document.querySelector('script[data-src="' + src + '"]');
        if (old) old.remove();
        var s = document.createElement('script');
        s.src = src + '?t=' + Date.now();
        s.charset = 'utf-8';
        s.setAttribute('data-src', src);
        s.onload = s.onerror = function () { if (--left === 0) cb(); };
        document.head.appendChild(s);
      });
    }
    function ingest() {
      var all = window[S.dataVar] || null, r = all;
      if (S.venues) {   // 几家影院在一个数据文件里：挑出正在看的那家（编号不在了就看第一家）
        var vs = venueList(all);
        if (vs.length && !vs.some(function (v) { return String(v.id) === state.venue; })) state.venue = String(vs[0].id);
        try { r = S.pick(all, state.venue) || null; } catch (e) { if (window.console) console.error('挑影院出错', e); r = null; }
      }
      var stamp = all ? all.generatedAt + '|' + (state.venue || '') : null;
      if (V && stamp === state.stamp) return false;
      state.stamp = stamp;
      state.raw = r;
      try {
        V = r && r.days ? build(r) : null;
      } catch (e) {
        if (window.console) console.error('排片数据读不懂', e);
        V = null;
      }
      return true;
    }
    function refresh() {
      loadData(function () {
        if (!ingest()) { renderBanner(dayObj(state.date)); renderFooter(); return; }
        render();
        if (state.open) {
          if (V && V.movies[state.open]) { if (!playing()) paintDetail({ reset: false, focus: false }); }
          else closeDetail();
        }
      });
    }
    // 有场次开场了、或者过了午夜：页面要变（变灰 / 「明天」顺延）
    function tickSig() {
      var n = now(), k = nowKey(), c = 0;
      if (V) V.days.forEach(function (d) { d.sessions.forEach(function (s) { if (s.start <= k) c++; }); });
      return n.date + '|' + c;
    }

    loadData(function () {
      ingest();
      if (urlVenue && urlVenue === state.venue) store(K + '-venue', urlVenue);   // 从带 ?c= 的链接打开：以后也先看这家
      render();
      var id = hashId();
      if (id && V && V.movies[id]) openDetail(id, { history: 'replace', root: true });
      else if (location.hash) setHash('clear');
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    window.addEventListener('resize', function () { lanesUpdate(lanesEl()); });
    setInterval(refresh, 5 * 60 * 1000);
    setInterval(function () {
      if (document.hidden || !V) return;
      var clock = $('clock');
      if (clock) clock.textContent = now().time;
      if (tickSig() === state.sig) return;
      render();
      if (state.open && !playing()) paintDetail({ reset: false, focus: false });
    }, 20 * 1000);
  }

  window.CinemaApp = { start: start, esc: esc, web: WEB, localDir: localDir };
})();
