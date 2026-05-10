(function () {
  var samplePath = "/sample.csv";
  var sampleCsvFallback =
    "sku,img1,img2\n" +
    "889214485489-LGP,https://images.sellbrite.com/production/234668/889214485489-LGP/fe63cfed-780d-5072-a151-aeac59a2be14.jpg,https://images.sellbrite.com/production/234668/889214485489-LGP/c53e847d-dae3-5205-9350-4f32da5d4e52.jpg\n";
  var csvState = {
    headers: [],
    rows: []
  };

  function findCsvInput() {
    return document.querySelector('input[type="file"][accept*="csv"]');
  }

  function isUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = "";
    var quoted = false;

    for (var index = 0; index < text.length; index += 1) {
      var char = text[index];
      var next = text[index + 1];

      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (char === "\n") {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
      } else if (char !== "\r") {
        cell += char;
      }
    }

    row.push(cell.trim());
    rows.push(row);

    var headers = (rows.shift() || []).map(function (header) {
      return header.replace(/^\uFEFF/, "").trim();
    });

    return {
      headers: headers,
      rows: rows
        .filter(function (cells) {
          return cells.some(Boolean);
        })
        .map(function (cells) {
          return headers.reduce(function (record, header, index) {
            record[header] = (cells[index] || "").trim();
            return record;
          }, {});
        })
    };
  }

  async function readSelectedCsv() {
    var input = findCsvInput();
    var file = input && input.files && input.files[0];

    if (!file) {
      csvState = { headers: [], rows: [] };
      updateColumnPreviews();
      return;
    }

    try {
      csvState = parseCsv(await file.text());
    } catch (error) {
      console.error(error);
      csvState = { headers: [], rows: [] };
    }

    updateColumnPreviews();
  }

  function findColumnSelects() {
    return {
      front: document.getElementById("front-column"),
      angled: document.getElementById("angled-column")
    };
  }

  function findPreviewUrl(column) {
    if (!column) return "";

    for (var index = 0; index < csvState.rows.length; index += 1) {
      var value = csvState.rows[index][column];
      if (value && isUrl(value)) return value;
    }

    return "";
  }

  function ensurePreview(select, label) {
    if (!select) return null;

    var wrapper = select.closest(".space-y-2") || select.parentElement;
    if (!wrapper) return null;

    var preview = wrapper.querySelector(".column-image-preview");
    if (preview) return preview;

    preview = document.createElement("div");
    preview.className = "column-image-preview";
    preview.innerHTML =
      '<div class="column-image-preview-frame">' +
      '<img alt="">' +
      "</div>" +
      '<div class="column-image-preview-copy">' +
      '<span class="column-image-preview-label"></span>' +
      '<span class="column-image-preview-url"></span>' +
      "</div>";

    preview.querySelector(".column-image-preview-label").textContent = label;
    wrapper.appendChild(preview);
    return preview;
  }

  function updatePreview(select, label) {
    var preview = ensurePreview(select, label);
    if (!preview) return;

    var img = preview.querySelector("img");
    var urlText = preview.querySelector(".column-image-preview-url");
    var url = findPreviewUrl(select.value);

    if (!url) {
      preview.classList.add("is-empty");
      img.removeAttribute("src");
      img.alt = "";
      urlText.textContent = select.value ? "No image URL found in this column" : "Choose a column to preview";
      return;
    }

    preview.classList.remove("is-empty");
    img.src = url;
    img.alt = label + " sample image";
    urlText.textContent = url;
  }

  function updateColumnPreviews() {
    var selects = findColumnSelects();
    updatePreview(selects.front, "Front sample");
    updatePreview(selects.angled, "Angled sample");
  }

  function bindColumnPreviewEvents() {
    var input = findCsvInput();
    var selects = findColumnSelects();

    if (input && !input.dataset.previewBound) {
      input.dataset.previewBound = "true";
      input.addEventListener("change", readSelectedCsv);
    }

    [selects.front, selects.angled].forEach(function (select) {
      if (select && !select.dataset.previewBound) {
        select.dataset.previewBound = "true";
        select.addEventListener("change", updateColumnPreviews);
      }
    });

    if (selects.front || selects.angled) updateColumnPreviews();
  }

  function makeButton(label, kind) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "sample-action sample-action-" + kind;
    button.textContent = label;
    return button;
  }

  async function loadSampleCsv(button) {
    var input = findCsvInput();
    if (!input) return;

    button.disabled = true;
    button.textContent = "Loading sample...";

    try {
      var blob = new Blob([sampleCsvFallback], { type: "text/csv" });
      var file = new File([blob], "sample.csv", { type: "text/csv" });
      var transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      csvState = parseCsv(sampleCsvFallback);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      window.setTimeout(updateColumnPreviews, 0);
    } catch (error) {
      console.error(error);
      button.textContent = "Sample unavailable";
      return;
    } finally {
      window.setTimeout(function () {
        button.disabled = false;
        button.textContent = "Load sample CSV";
      }, 900);
    }
  }

  function mountActions() {
    if (document.querySelector(".sample-actions")) return;

    var input = findCsvInput();
    if (!input) return;

    var target = input.closest(".space-y-2") || input.parentElement;
    if (!target) return;

    var actions = document.createElement("div");
    actions.className = "sample-actions";

    var loadButton = makeButton("Load sample CSV", "primary");
    loadButton.addEventListener("click", function () {
      loadSampleCsv(loadButton);
    });

    var downloadLink = document.createElement("a");
    downloadLink.className = "sample-action sample-action-secondary";
    downloadLink.href = samplePath;
    downloadLink.download = "sample.csv";
    downloadLink.textContent = "Download sample";

    actions.append(loadButton, downloadLink);
    target.appendChild(actions);
  }

  function mountEnhancements() {
    mountActions();
    bindColumnPreviewEvents();
  }

  var observer = new MutationObserver(mountEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountEnhancements);
  } else {
    mountEnhancements();
  }
})();
