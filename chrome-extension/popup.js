// eBird Helper Popup JavaScript

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const toggleTranslation = document.getElementById('toggle-translation');
  const toggleRubyPinyin = document.getElementById('toggle-ruby-pinyin');
  const toggleHighlightGroup = document.getElementById('toggle-highlight-group');
  const toggleHighlight = document.getElementById('toggle-highlight');
  const toggleEndemic = document.getElementById('toggle-endemic');
  const togglePinyin = document.getElementById('toggle-pinyin');

  const colorHighlight = document.getElementById('color-highlight');
  const colorHighlightVal = document.getElementById('color-highlight-val');
  const colorEndemic = document.getElementById('color-endemic');
  const colorEndemicVal = document.getElementById('color-endemic-val');

  const speciesCount = document.getElementById('species-count');
  const btnClearCache = document.getElementById('btn-clear-cache');

  // Default values
  const DEFAULTS = {
    enableTranslation: true,
    enableRubyPinyin: true,
    enableHighlight: true,
    highlightEndemic: true,
    enablePinyin: true,
    colorHighlight: '#ff8d28',
    colorEndemic: '#ff2d55'
  };

  // Helper to handle dependencies
  function updateRubyPinyinUIState() {
    const isTranslationOn = toggleTranslation.checked;
    toggleRubyPinyin.disabled = !isTranslationOn;
    const subSettingEl = document.querySelector('.sub-setting');
    if (subSettingEl) {
      subSettingEl.style.opacity = isTranslationOn ? '1' : '0.5';
      subSettingEl.style.pointerEvents = isTranslationOn ? 'auto' : 'none';
    }
  }

  function updateHighlightGroupUIState() {
    const isGroupOn = toggleHighlightGroup.checked;
    toggleHighlight.disabled = !isGroupOn;
    toggleEndemic.disabled = !isGroupOn;

    document.querySelectorAll('.highlight-child').forEach((el) => {
      el.style.opacity = isGroupOn ? '1' : '0.5';
      el.style.pointerEvents = isGroupOn ? 'auto' : 'none';
    });
  }

  // Load Settings from chrome.storage.sync
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    // Populate Toggles
    toggleTranslation.checked = settings.enableTranslation;
    toggleRubyPinyin.checked = settings.enableRubyPinyin;
    toggleHighlight.checked = settings.enableHighlight;
    toggleEndemic.checked = settings.highlightEndemic;
    togglePinyin.checked = settings.enablePinyin;

    toggleHighlightGroup.checked = settings.enableHighlight || settings.highlightEndemic;

    // Populate Color Pickers
    colorHighlight.value = settings.colorHighlight; //colorHighlightVal.textContent = settings.colorHighlight;
    colorEndemic.value = settings.colorEndemic; //colorEndemicVal.textContent = settings.colorEndemic;

    // Update UI dependency state
    updateRubyPinyinUIState();
    updateHighlightGroupUIState();
  });

  // Load Lifelist Count from chrome.storage.local
  function updateSpeciesCountDisplay() {
    chrome.storage.local.get(['ebirdSpeciesList'], (res) => {
      const list = res.ebirdSpeciesList || [];
      speciesCount.textContent = list.length;
    });
  }
  updateSpeciesCountDisplay();


  
  // Save Switch Settings
  const saveToggleSetting = (key, checkbox) => {
    chrome.storage.sync.set({ [key]: checkbox.checked });
  };

  toggleTranslation.addEventListener('change', () => {
    saveToggleSetting('enableTranslation', toggleTranslation);
    updateRubyPinyinUIState();
  });
  toggleRubyPinyin.addEventListener('change', () => saveToggleSetting('enableRubyPinyin', toggleRubyPinyin));

  toggleHighlightGroup.addEventListener('change', () => {
    const checked = toggleHighlightGroup.checked;
    toggleHighlight.checked = checked;
    toggleEndemic.checked = checked;
    saveToggleSetting('enableHighlight', toggleHighlight);
    saveToggleSetting('highlightEndemic', toggleEndemic);
    updateHighlightGroupUIState();
  });

  toggleHighlight.addEventListener('change', () => {
    saveToggleSetting('enableHighlight', toggleHighlight);
    toggleHighlightGroup.checked = toggleHighlight.checked || toggleEndemic.checked;
    updateHighlightGroupUIState();
  });

  toggleEndemic.addEventListener('change', () => {
    saveToggleSetting('highlightEndemic', toggleEndemic);
    toggleHighlightGroup.checked = toggleHighlight.checked || toggleEndemic.checked;
    updateHighlightGroupUIState();
  });

  togglePinyin.addEventListener('change', () => saveToggleSetting('enablePinyin', togglePinyin));



  // Save Color Picker Settings
  const saveColorSetting = (colorKey, valEl, colorInput) => {
    const value = colorInput.value;
    valEl.textContent = value;
    chrome.storage.sync.set({ [colorKey]: value });
  };

  colorHighlight.addEventListener('input', () => saveColorSetting('colorHighlight', colorHighlightVal, colorHighlight));
  colorEndemic.addEventListener('input', () => saveColorSetting('colorEndemic', colorEndemicVal, colorEndemic));

  // Clear Cache Action
  btnClearCache.addEventListener('click', () => {
    if (confirm('确认清空已缓存的生涯清单鸟种数据吗？\n清空后将无法高亮未见鸟种，直到您再次访问 eBird 的生涯清单页面。')) {
      chrome.storage.local.set({ ebirdSpeciesList: [] }, () => {
        updateSpeciesCountDisplay();
        alert('生涯清单数据已清空。');
      });
    }
  });
});
