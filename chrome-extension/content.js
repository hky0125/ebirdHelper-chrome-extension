/**
 * eBird Helper Content Script
 * Handled features: 
 * - Appending Chinese common names
 * - Highlighting unseen species / country endemics
 * - Pinyin quick search with `@` prefix
 */

'use strict';

const STORAGE_KEY = 'ebirdSpeciesList';
const ENABLE_PARTIAL_MATCH = true;

// State Cache
let settings = {};
let seenBirds = new Set();
let birdMap = null;
let endemicMap = null;
let rubyPinyinMap = null;
let pinyinMap = null;
let birdNamePattern = null;
let markedSet = new WeakSet();
let observer = null;

// Default Configuration values
const DEFAULTS = {
  enableTranslation: true,
  enableRubyPinyin: true,
  enableHighlight: true,
  highlightEndemic: true,
  enablePinyin: true,
  colorHighlight: '#a35f00',
  colorEndemic: '#c0262e'
};

// Pinyin Matcher State Variables
let NAME2ENTRY = new Map();
let VISIBLE_ITEMS = [];
let overrideOn = false;
const LOG_PREFIX = '[eBird@Pinyin]';
const log = (...a) => console.log(LOG_PREFIX, ...a);

/* ==========================================================================
   Helper & Normalization Functions
   ========================================================================== */

function escapeRegExp(text = '') {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBirdNamePatternFromMap(map = {}) {
  const birdNames = Object.keys(map)
    .filter(name => name && name.length > 0)
    .sort((a, b) => b.length - a.length); // Longest first to avoid partial matches

  if (birdNames.length === 0) return null;
  return new RegExp(`\\b(${birdNames.map(escapeRegExp).join('|')})\\b`, 'g');
}

function extractCleanName(text) {
  return text
    .replace(/\s*\([^)]*\)/g, '')  // Remove (...) blocks (Traditional/Simplified/Scientific)
    .replace(/\s*\[[^\]]*\]/g, '') // Remove [...] blocks (bracketed names)
    .replace(/\*/g, '')            // Remove star markers
    .replace(/\s+[A-Z][a-z]+(?:\s+[a-z\-]+){1,2}\s*$/, '') // Remove trailing Latin name (Genus species)
    .trim();
}

function ensureHighlightCSS() {
  if (document.getElementById('ebird-highlights')) return;

  const style = document.createElement('style');
  style.id = 'ebird-highlights';
  style.textContent = `
[data-ebird-unseen],
[data-ebird-unseen] *,
[data-ebird-unseen] a,
[data-ebird-unseen] a:link,
[data-ebird-unseen] a:visited {
  color: var(--ebird-highlight, #ff2d55) !important;
  -webkit-text-fill-color: var(--ebird-highlight, #ff2d55) !important;
}

[data-ebird-unseen] svg text,
[data-ebird-unseen] svg tspan {
  fill: var(--ebird-highlight, #ff2d55) !important;
}
`;
  (document.head || document.documentElement).appendChild(style);
}

function clearHighlights() {
  document.querySelectorAll('[data-ebird-unseen]').forEach(el => {
    el.removeAttribute('data-ebird-unseen');
    el.removeAttribute('data-ebird-endemic');
    el.style.removeProperty('--ebird-highlight');
    // Remove appended trailing '*'
    if (el.lastChild && el.lastChild.nodeType === Node.TEXT_NODE && el.lastChild.nodeValue === '*') {
      el.removeChild(el.lastChild);
    }
  });
  markedSet = new WeakSet();
}

/* ==========================================================================
   Highlighting Core Logic
   ========================================================================== */

function getRelevantElements() {
  const url = location.href;

  if (url.includes('/checklist/')) {
    return document.querySelectorAll('.Observation-species .Heading-main');
  } else if (url.includes('/tripreport/')) {
    return document.querySelectorAll('.Species-common');
  } else if (url.includes('/hotspot/') || url.includes('/region/')) {
    return document.querySelectorAll('.Species-common');
  } else if (url.includes('/targets')) {
    return document.querySelectorAll('.SpecimenHeader-joined');
  } else if (url.includes('/printableList')) {
    return document.querySelectorAll('.subitem');
  } else if (url.includes('/barchart')) {
    return document.querySelectorAll('.SpeciesName');
  } else if (url.includes('/alert')) {
    return document.querySelectorAll('.Observation-species .Heading-main');
  }

  return [];
}

function highlightUnseenSpecies(force = false) {
  if (!settings.enableHighlight) return;

  let targets = [];
  if (ENABLE_PARTIAL_MATCH) {
    targets = getRelevantElements();
  }

  targets.forEach(el => {
    if (!force && markedSet.has(el)) return;

    const rawText = el.textContent.trim();
    const cleanName = extractCleanName(rawText);

    // Skip groups, hybrids, slash entries
    if (cleanName.endsWith(' sp.') || cleanName.includes(' x ') || cleanName.includes(' X ') || cleanName.includes('/')) {
      markedSet.add(el);
      return;
    }

    if (!seenBirds.has(cleanName)) {
      ensureHighlightCSS();

      const countryCode = endemicMap ? endemicMap[cleanName] : null;
      const isEndemic = !!countryCode;

      el.setAttribute('data-ebird-unseen', '1');
      el.setAttribute('data-ebird-endemic', isEndemic ? '1' : '0');

      if (isEndemic && settings.highlightEndemic) {
        el.style.setProperty('--ebird-highlight', settings.colorEndemic);
        if (!el.title) {
          el.title = `Endemic (${countryCode})`;
        } else if (!/Endemic \([A-Z]{2}\)/.test(el.title)) {
          el.title += ` | Endemic (${countryCode})`;
        }
      } else {
        el.style.setProperty('--ebird-highlight', settings.colorHighlight);
      }

      if (!rawText.includes('*')) {
        el.appendChild(document.createTextNode('*'));
      }
    } else {
      if (force) {
        el.removeAttribute('data-ebird-unseen');
        el.removeAttribute('data-ebird-endemic');
        el.style.removeProperty('--ebird-highlight');
        if (el.lastChild && el.lastChild.nodeType === Node.TEXT_NODE && el.lastChild.nodeValue === '*') {
          el.removeChild(el.lastChild);
        }
      }
    }

    markedSet.add(el);
  });
}

/* ==========================================================================
   Name Replacement (Translation) Core Logic
   ========================================================================== */

function injectRubyCSS() {
  if (document.getElementById('ebh-ruby-css')) return;
  const css = `
  ruby {
    ruby-position: over;
    ruby-align: center;
  }
  rt {
    font-size: 1 em;
    color: #3f6b87;
    user-select: none;
    pointer-events: none;
    font-weight: normal;
    display: ruby-text;
  }`; 
  const s = document.createElement('style');
  s.id = 'ebh-ruby-css';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}

function rubyfyChineseText(text) {
  if (!rubyPinyinMap) return text;
  let html = '';
  for (const char of text) {
    if (rubyPinyinMap[char]) {
      html += `<ruby>${char}<rt>${rubyPinyinMap[char]}</rt></ruby>`;
    } else {
      html += char;
    }
  }
  return html;
}

function walkAndReplace(node) {
  if (!settings.enableTranslation || !birdNamePattern) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
  const nodesToReplace = [];

  let n;
  while ((n = walker.nextNode())) {
    const parent = n.parentNode;
    if (
      !parent ||
      parent.dataset.replaced === '1' ||
      parent.closest('script, style, input, textarea')
    ) continue;

    birdNamePattern.lastIndex = 0;
    if (birdNamePattern.test(n.nodeValue)) {
      nodesToReplace.push(n);
    }
  }

  for (const textNode of nodesToReplace) {
    const parent = textNode.parentNode;
    if (!parent) continue;

    const span = document.createElement('span');
    span.dataset.replaced = '1';

    birdNamePattern.lastIndex = 0;
    span.innerHTML = textNode.nodeValue.replace(birdNamePattern, match => {
      const translated = birdMap[match];
      if (!translated) return match;

      if (settings.enableRubyPinyin && rubyPinyinMap) {
        const bracketMatch = /\[([^\[\]]+)\]\s*$/.exec(translated);
        if (bracketMatch) {
          const cn = bracketMatch[1];
          const rubied = rubyfyChineseText(cn);
          return translated.replace(`[${cn}]`, `[${rubied}]`);
        }
      }
      return translated;
    });

    parent.replaceChild(span, textNode);
  }
}

/* ==========================================================================
   Lifelist Extraction
   ========================================================================== */

function isLifelistPage() {
  return location.href.startsWith('https://ebird.org/lifelist?time=life&r=world');
}

function updateSpeciesFromLifelistPage() {
  const scope = document.querySelector('section#nativeNatProv');
  if (!scope) {
    console.warn('[eBird Helper] Lifelist section #nativeNatProv not found, skipping sync.');
    return;
  }

  chrome.storage.local.get(['ebirdSpeciesList'], (res) => {
    const existing = res.ebirdSpeciesList || [];
    const existingSet = new Set(existing.map(s => s.commonName));

    const pageMap = new Map();
    scope.querySelectorAll('.Observation').forEach(obs => {
      const commonNameEl = obs.querySelector('.Heading-main');
      const latinNameEl = obs.querySelector('.Heading-sub--sci');
      if (!commonNameEl) return;

      const commonNameRaw = commonNameEl.textContent.trim();
      const commonName = extractCleanName(commonNameRaw);
      const latinName = (latinNameEl?.textContent.trim() || '');

      if (!pageMap.has(commonName)) {
        pageMap.set(commonName, latinName);
      }
    });

    const pageSet = new Set(pageMap.keys());
    let added = 0, removed = 0;

    for (const name of pageSet) {
      if (!existingSet.has(name)) added++;
    }
    for (const name of existingSet) {
      if (!pageSet.has(name)) removed++;
    }

    const updatedList = Array.from(pageMap, ([commonName, latinName]) => ({ commonName, latinName }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));

    chrome.storage.local.set({ [STORAGE_KEY]: updatedList }, () => {
      if (added > 0 || removed > 0) {
        const parts = [];
        if (added) parts.push(`Added ${added}`);
        if (removed) parts.push(`Removed ${removed}`);
        alert(`eBird Helper: Lifelist synced! (${parts.join(', ')} species). Total: ${updatedList.length}`);
      } else {
        alert(`eBird Helper: Lifelist already up to date. (${updatedList.length} species)`);
      }
    });
  });
}

/* ==========================================================================
   @Pinyin Checklist Quick Search Utility
   ========================================================================== */

function injectPinyinCSS() {
  if (document.getElementById('ebh-pinyin-css')) return;
  const css = `
  .Suggest-dropdown.__pinyin-active .Suggest-empty {
    display: none !important;
  }`;
  const s = document.createElement('style');
  s.id = 'ebh-pinyin-css';
  s.textContent = css;
  document.documentElement.appendChild(s);
}

function makeInitials(pinyin) {
  return String(pinyin || '')
    .replace(/[^a-zA-Z]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => (w ? w[0] : ''))
    .join('')
    .toLowerCase();
}

function buildNameMap(rawObj) {
  const map = new Map();
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) return;
  for (const key in rawObj) {
    if (!Object.prototype.hasOwnProperty.call(rawObj, key)) continue;
    const v = rawObj[key] || {};
    const p = String(v.pinyin || '').toLowerCase();
    const i = String(v.initials || makeInitials(p)).toLowerCase();
    const code = v.code ? String(v.code).trim() : '';

    const engName = v.name ? String(v.name).trim() : key;
    const latin = v.latin ? String(v.latin).trim() : (v.latin_name ? String(v.latin_name).trim() : '');

    if (!p && !i) continue;
    map.set(String(key).toLowerCase(), {
      commonName: key,
      code: code,
      pinyinLower: p,
      initialsLower: i,
      engName: engName,
      latinName: latin
    });
  }
  NAME2ENTRY = map;
}

function findSpeciesInput() {
  return (
    document.querySelector('#jumpToSpp') ||
    document.querySelector('input.Suggest-input')
  );
}

function getDom() {
  const input = findSpeciesInput();
  if (!input) return { input: null, dropdown: null, list: null, emptyTpl: null };

  const dropdownId = input.getAttribute('aria-controls') || 'Suggest-dropdown-jumpToSpp';
  let dropdown = document.getElementById(dropdownId);

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = dropdownId;
    dropdown.className = 'Suggest-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.style.display = 'none';

    if (input.parentNode) {
      input.parentNode.appendChild(dropdown);
    } else {
      document.body.appendChild(dropdown);
    }
  }

  let list = dropdown.querySelector('.Suggest-suggestions');
  if (!list) {
    list = document.createElement('div');
    list.className = 'Suggest-suggestions';
    dropdown.appendChild(list);
  }

  const emptyTpl = dropdown.querySelector('.Suggest-empty');

  return { input, dropdown, list, emptyTpl };
}

function extractCommonName(span) {
  if (!span) return '';
  let txt = '';
  span.childNodes.forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) txt += n.textContent || '';
  });
  txt = txt.trim();
  return extractCleanName(txt);
}

function findCountInputByCode(code) {
  if (!code) return null;
  let el = document.getElementById(code);
  if (el) return el;
  el = document.querySelector('input.sc[name^="sp[\'' + code + '\']"]');
  if (el) return el;
  el = document.querySelector('input.sc[name*="' + code + '"]');
  return el;
}

function jumpToItem(item) {
  let input = null;
  let row = null;

  if (item.code) {
    input = findCountInputByCode(item.code);
    if (input) {
      row =
        input.closest('[data-observation-id]') ||
        input.closest('.SubmitChecklist-species-name') ||
        input.closest('tr') ||
        input;
    }
  }

  if (!row) {
    const spans = document.querySelectorAll('.SubmitChecklist-species-name[id^="name_"] span');
    const target = item.commonName.toLowerCase();
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const cn = extractCommonName(s).toLowerCase();
      if (cn === target) {
        row = s.closest('.SubmitChecklist-species-name');
        if (row) {
          const tr = row.closest('tr') || row;
          input = tr.querySelector('input.sc') || tr.querySelector('input');
        }
        break;
      }
    }
  }

  if (!row || !input) return false;

  try {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    row.scrollIntoView();
  }
  input.focus();
  try {
    if (typeof input.select === 'function') input.select();
  } catch (e2) { }
  return true;
}

function collectVisibleItems() {
  const arr = [];
  const seen = new Set();
  const divs = document.querySelectorAll('.SubmitChecklist-species-name[id^="name_"]');

  for (let i = 0; i < divs.length; i++) {
    const div = divs[i];
    const span = div.querySelector('span');
    if (!span) continue;

    const cn = extractCommonName(span);
    const lower = cn.toLowerCase();
    if (seen.has(lower)) continue;
    const entry = NAME2ENTRY.get(lower);
    if (!entry) continue;

    const code = (div.id || '').replace(/^name_/, '').trim();
    seen.add(lower);
    arr.push({
      commonName: entry.commonName,
      code: code,
      pinyinLower: entry.pinyinLower,
      initialsLower: entry.initialsLower,
      engName: entry.engName || entry.commonName,
      latinName: entry.latinName || ''
    });
  }

  VISIBLE_ITEMS = arr;
  log('Visible species checklist items collected:', arr.length);
}

let debounceTimer = null;
function debouncedCollect() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(collectVisibleItems, 150);
}

function filterByTerm(arr, term) {
  const t = (term || '').toLowerCase().trim();
  if (!t) return [];

  const exact = [];
  const starts = [];
  const contains = [];

  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    const p = it.pinyinLower || '';
    const ini = it.initialsLower || '';

    if (p === t || ini === t) {
      exact.push(it);
    } else if (p.indexOf(t) === 0 || ini.indexOf(t) === 0) {
      starts.push(it);
    }
  }

  if (t.length <= 2) {
    const total = exact.length + starts.length + contains.length;
    if (total > 5) return exact;
  }
  return exact.concat(starts, contains);
}

function clearPinyinSuggestions(list) {
  if (!list) return;
  const nodes = list.querySelectorAll('.__pinyin-item');
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].remove();
  }
}

function makeItemNode(item, onPick) {
  const ctx = getDom();
  const dropdown = ctx.dropdown;
  const proto = dropdown ? dropdown.querySelector('.Suggest-suggestion') : null;
  let wrap;

  if (proto) {
    wrap = proto.cloneNode(true);
    wrap.classList.remove('is-active');
    while (wrap.firstChild) {
      wrap.removeChild(wrap.firstChild);
    }
    wrap.removeAttribute('id');
  } else {
    wrap = document.createElement('div');
    wrap.className = 'Suggest-suggestion';
    wrap.setAttribute('role', 'option');
  }

  wrap.classList.add('__pinyin-item');

  const container = document.createElement('span');
  container.className = 'Suggestion-text';

  const em = document.createElement('em');
  em.setAttribute('data-replaced', '1');

  const engName = item.engName || item.commonName || '';
  let cnName = '';
  if (birdMap && birdMap[engName]) {
    // Extract Chinese from birdMap value "English [Chinese]"
    const m = /\[([^\[\]]+)\]\s*$/.exec(birdMap[engName]);
    if (m) cnName = m[1];
  }
  em.textContent = cnName ? (engName + '(' + cnName + ')') : engName;

  container.appendChild(em);

  if (item.latinName) {
    container.appendChild(document.createTextNode(' '));
    const sci = document.createElement('span');
    sci.className = 'SciName';
    sci.textContent = item.latinName;
    container.appendChild(sci);
  }

  wrap.appendChild(container);

  wrap.addEventListener('mousedown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    onPick(item);
  });

  return wrap;
}

function renderResults(term, results) {
  const ctx = getDom();
  const dropdown = ctx.dropdown;
  const list = ctx.list;
  if (!dropdown || !list) return;

  clearPinyinSuggestions(list);

  if (!results.length) {
    dropdown.classList.remove('__pinyin-active');
    dropdown.style.display = ''; // Fallback to native
    return;
  }

  dropdown.classList.add('__pinyin-active');
  dropdown.style.display = 'block';
  for (let i = 0; i < results.length; i++) {
    list.appendChild(makeItemNode(results[i], pickItem));
  }
}

function pickItem(item) {
  const ctx = getDom();
  const input = ctx.input;
  const dropdown = ctx.dropdown;
  const list = ctx.list;
  if (!input) return;

  overrideOn = false;
  clearPinyinSuggestions(list);
  if (dropdown) {
    dropdown.classList.remove('__pinyin-active');
    dropdown.style.display = '';
  }

  const jumped = jumpToItem(item);
  if (!jumped) {
    input.value = item.commonName;
  } else {
    input.value = '';
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function onInputCapture(e) {
  const ctx = getDom();
  const input = ctx.input;
  const dropdown = ctx.dropdown;
  const list = ctx.list;
  if (!input) return;

  const v = input.value || '';

  // "@@" fallback to default native search
  if (v.indexOf('@@') === 0) {
    if (overrideOn) {
      overrideOn = false;
      clearPinyinSuggestions(list);
      if (dropdown) {
        dropdown.classList.remove('__pinyin-active');
        dropdown.style.display = '';
      }
    }
    return;
  }

  // Not starting with "@" -> native search
  if (v.indexOf('@') !== 0) {
    if (overrideOn) {
      overrideOn = false;
      clearPinyinSuggestions(list);
      if (dropdown) {
        dropdown.classList.remove('__pinyin-active');
        dropdown.style.display = '';
      }
    }
    return;
  }

  overrideOn = true;

  const term = v.slice(1).trim();
  if (!dropdown || !list) return;

  if (!term) {
    clearPinyinSuggestions(list);
    dropdown.classList.remove('__pinyin-active');
    dropdown.style.display = '';
    return;
  }

  const results = filterByTerm(VISIBLE_ITEMS, term);
  renderResults(term, results);
}

function onKeydownCapture(e) {
  if (!overrideOn) return;
  if (e.key !== 'Enter') return;

  const ctx = getDom();
  const list = ctx.list;
  if (!list) return;

  const btn = list.querySelector('.__pinyin-item');
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();
  btn.click();
}

function bindInput() {
  const input = findSpeciesInput();
  if (!input) {
    log('Species checklist entry field not found yet.');
    return;
  }
  if (input.__pinyinBound) return;
  input.__pinyinBound = true;

  input.addEventListener('input', onInputCapture, true);
  input.addEventListener('keydown', onKeydownCapture, true);

  log('Successfully bound @pinyin listener to search field.');
}

/* ==========================================================================
   Loading Map Resources & Feature Activation
   ========================================================================== */

async function loadAndApplyTranslation() {
  try {
    const res = await fetch(chrome.runtime.getURL('map/map_bird_eng2chs.json'));
    birdMap = await res.json();

    if (settings.enableRubyPinyin) {
      try {
        const rubyRes = await fetch(chrome.runtime.getURL('map/map_uncommon_char_ruby.json'));
        rubyPinyinMap = await rubyRes.json();
        injectRubyCSS();
      } catch (err) {
        console.error('[eBird Helper] Failed to load ruby pinyin map:', err);
      }
    }

    birdNamePattern = buildBirdNamePatternFromMap(birdMap);
    if (birdNamePattern) {
      walkAndReplace(document.body);
    }
  } catch (e) {
    console.error('[eBird Helper] Failed to load translation map:', e);
  }
}

async function loadAndApplyHighlight() {
  try {
    const res = await fetch(chrome.runtime.getURL('map/map_endemic.json'));
    endemicMap = await res.json();
    highlightUnseenSpecies();
  } catch (e) {
    console.error('[eBird Helper] Failed to load endemic map:', e);
  }
}

async function loadAndApplyPinyin() {
  try {
    const res = await fetch(chrome.runtime.getURL('map/map_pinyin.json'));
    const pinyinRaw = await res.json();
    buildNameMap(pinyinRaw);
    injectPinyinCSS();
    collectVisibleItems();
    bindInput();
  } catch (e) {
    console.error('[eBird Helper] Failed to load pinyin map:', e);
  }
}

function applyHighlightSettings() {
  if (!settings.enableHighlight) {
    clearHighlights();
  } else {
    if (!endemicMap) {
      loadAndApplyHighlight();
    } else {
      highlightUnseenSpecies(true);
    }
  }
}

function setupMutationObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    let hasAddedNodes = false;
    for (let m of mutations) {
      if (m.addedNodes.length > 0) {
        hasAddedNodes = true;
        if (settings.enableTranslation && birdNamePattern) {
          for (let node of m.addedNodes) {
            if (node.nodeType === 1) {
              walkAndReplace(node);
            }
          }
        }
      }
    }
    if (settings.enableHighlight && hasAddedNodes) {
      highlightUnseenSpecies();
    }
    if (settings.enablePinyin && hasAddedNodes) {
      bindInput();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* ==========================================================================
   Initialization Sequence
   ========================================================================== */

async function init() {
  // 1. Get configurations from chrome.storage.sync
  settings = await new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, resolve);
  });

  // 2. Retrieve seen lifelist from chrome.storage.local
  const localData = await new Promise(resolve => {
    chrome.storage.local.get(['ebirdSpeciesList'], resolve);
  });
  seenBirds = new Set((localData.ebirdSpeciesList || []).map(s => s.commonName));

  // 3. Register settings changes listener
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      let needsRehighlight = false;
      let needsTranslationLoad = false;
      let needsPinyinLoad = false;

      for (const [key, change] of Object.entries(changes)) {
        settings[key] = change.newValue;
        if (key === 'enableHighlight' || key === 'highlightEndemic' || key === 'colorHighlight' || key === 'colorEndemic') {
          needsRehighlight = true;
        }
        if (key === 'enableTranslation' && change.newValue === true) {
          needsTranslationLoad = true;
        }
        if (key === 'enableRubyPinyin' && change.newValue === true) {
          needsTranslationLoad = true; // Reload/trigger translation with ruby
        }
        if (key === 'enablePinyin' && change.newValue === true) {
          needsPinyinLoad = true;
        }
      }

      if (needsTranslationLoad) {
        // Reload translation if enabled
        loadAndApplyTranslation();
      }
      if (needsRehighlight) {
        applyHighlightSettings();
      }
      if (needsPinyinLoad && !pinyinMap) {
        loadAndApplyPinyin();
      }
    } else if (area === 'local') {
      if (changes.ebirdSpeciesList) {
        seenBirds = new Set((changes.ebirdSpeciesList.newValue || []).map(s => s.commonName));
        if (settings.enableHighlight) {
          highlightUnseenSpecies(true);
        }
      }
    }
  });

  // 4. Lifelist update page check
  if (isLifelistPage()) {
    window.addEventListener('load', () => {
      setTimeout(updateSpeciesFromLifelistPage, 2000);
    });
    return;
  }

  // 5. Activate features based on initial settings
  if (settings.enableTranslation) {
    await loadAndApplyTranslation();
  }
  if (settings.enableHighlight) {
    await loadAndApplyHighlight();
  }
  if (settings.enablePinyin) {
    loadAndApplyPinyin();
  }

  // 6. Setup MutationObserver for dynamic page elements
  setupMutationObserver();
}

// Start execution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
