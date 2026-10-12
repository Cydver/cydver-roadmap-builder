(() => {
  function ensureTierDescriptionField() {
    const form = document.getElementById("tierForm");
    if (!form || form.elements.description) return;

    const colorField = form.querySelector('input[name="color"]')?.closest(".field");
    if (!colorField) return;

    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = '<label>Description</label><textarea name="description" rows="4" placeholder="Explain what this pull tier means…"></textarea>';
    colorField.before(field);

    const hint = form.querySelector(".hint");
    if (hint) {
      hint.textContent = "These labels, descriptions, and colors define the pull-priority row headers. They do not change any unit data.";
    }
  }

  function addDefaultDescriptionFields() {
    for (const tier of DEFAULT_TIERS || []) {
      if (!("description" in tier)) tier.description = "";
    }
    for (const tier of DEFAULT_ROADMAP?.tiers || []) {
      if (!("description" in tier)) tier.description = "";
    }
  }

  function tierDescriptionsFrom(source) {
    if (!source || Array.isArray(source) || !Array.isArray(source.tiers)) return new Map();
    return new Map(source.tiers.map(tier => [tier.id, String(tier.description ?? "").trim()]));
  }

  function applyTierDescriptions(descriptions) {
    if (!descriptions?.size) return;
    for (const tier of state.tiers || []) {
      if (descriptions.has(tier.id)) tier.description = descriptions.get(tier.id);
    }
  }

  function restoreDescriptionsFromInitialSource() {
    let source = null;
    const shareMatch = location.hash.match(/roadmap=([^&]+)/);

    if (shareMatch) {
      try {
        source = JSON.parse(base64urlDecode(shareMatch[1]));
      } catch {}
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) source = JSON.parse(saved);
      } catch {}
    }

    applyTierDescriptions(tierDescriptionsFrom(source));
  }

  ensureTierDescriptionField();
  addDefaultDescriptionFields();

  // The original normalizer predates tier descriptions and rebuilds each tier as
  // { id, label, color }. Preserve the additive description field around it.
  const originalNormalizeState = normalizeState;
  normalizeState = function (...args) {
    const descriptions = tierDescriptionsFrom({ tiers: state.tiers || [] });
    const result = originalNormalizeState.apply(this, args);
    applyTierDescriptions(descriptions);
    return result;
  };

  // app.js initializes synchronously before this add-on runs, so recover any
  // descriptions that were present in an already-saved project/share on startup.
  restoreDescriptionsFromInitialSource();

  const originalOpenTierEditor = openTierEditor;
  openTierEditor = function (tierId) {
    const result = originalOpenTierEditor.apply(this, arguments);
    const form = document.getElementById("tierForm");
    const tier = (state.tiers || []).find(item => item.id === tierId);
    if (form?.elements.description) form.elements.description.value = tier?.description || "";
    return result;
  };

  // Run before app.js's existing submit handler so its normal render/autosave
  // path automatically persists the description with the rest of the tier.
  document.getElementById("tierForm")?.addEventListener("submit", () => {
    const form = document.getElementById("tierForm");
    const tier = (state.tiers || []).find(item => item.id === form?.elements.tierId?.value);
    if (!tier || !form?.elements.description) return;
    tier.description = String(form.elements.description.value || "").trim();
  }, true);
})();
