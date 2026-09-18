function splitValues(value) {
  return String(value || '')
    .split(/[|,\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTableRows(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

function equalWidths(columnCount) {
  if (!columnCount) return [];
  const width = 100 / columnCount;
  const widths = Array.from({ length: columnCount }, () => width);
  widths[widths.length - 1] += 100 - widths.reduce((sum, item) => sum + item, 0);
  return widths;
}

function normalizedWidths(values, columnCount) {
  if (!columnCount) return [];
  const parsed = values.map(Number);
  if (parsed.length !== columnCount || parsed.some((item) => !Number.isFinite(item) || item <= 0)) {
    return equalWidths(columnCount);
  }
  const total = parsed.reduce((sum, item) => sum + item, 0);
  const normalized = parsed.map((item) => item / total * 100);
  return normalized.some((item) => item < 5) ? equalWidths(columnCount) : normalized;
}

function rebalanceWidths(widths, changedIndex, requestedWidth) {
  if (widths.length <= 1) return [100];
  const maxWidth = 100 - (widths.length - 1) * 5;
  const changedWidth = Math.min(maxWidth, Math.max(5, Number(requestedWidth) || 5));
  const result = [...widths];
  result[changedIndex] = changedWidth;
  let remaining = 100 - changedWidth;
  let candidates = widths.map((_, index) => index).filter((index) => index !== changedIndex);
  const sourceWeights = new Map(candidates.map((index) => [index, Math.max(widths[index], 0.0001)]));

  while (candidates.length) {
    const totalWeight = candidates.reduce((sum, index) => sum + sourceWeights.get(index), 0);
    const tooSmall = candidates.filter((index) => remaining * sourceWeights.get(index) / totalWeight < 5);
    if (!tooSmall.length) {
      for (const index of candidates) result[index] = remaining * sourceWeights.get(index) / totalWeight;
      break;
    }
    for (const index of tooSmall) {
      result[index] = 5;
      remaining -= 5;
    }
    candidates = candidates.filter((index) => !tooSmall.includes(index));
  }
  const difference = 100 - result.reduce((sum, item) => sum + item, 0);
  const adjustmentIndex = result.findIndex((_, index) => index !== changedIndex);
  if (adjustmentIndex >= 0) result[adjustmentIndex] += difference;
  return result;
}

function parseMerges(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [row, column, span] = line.split(/[,:|]+/).map(Number);
      return { row, column, span };
    });
}

function initTableDesigner(form, designer) {
  const rowsInput = form.querySelector('textarea[name="tableRows"]');
  const widthsInput = form.querySelector('input[name="columnWidths"]');
  const alignmentsInput = form.querySelector('input[name="columnAlignments"]');
  const mergesInput = form.querySelector('textarea[name="tableMerges"]');
  const headerInput = form.querySelector('input[name="tableHeaderRow"][type="checkbox"]');
  const columnControls = designer.querySelector('[data-column-controls]');
  const mergeControls = designer.querySelector('[data-merge-controls]');
  const addMergeButton = designer.querySelector('[data-add-merge]');
  const preview = designer.querySelector('[data-table-preview]');
  let rows = parseTableRows(rowsInput.value);
  let columnCount = rows.length ? Math.max(...rows.map((row) => row.length), 1) : 0;
  let widths = normalizedWidths(splitValues(widthsInput.value), columnCount);
  let alignments = splitValues(alignmentsInput.value);
  let merges = parseMerges(mergesInput.value);

  const labels = {
    column: designer.dataset.columnLabel,
    width: designer.dataset.widthLabel,
    alignment: designer.dataset.alignmentLabel,
    row: designer.dataset.rowLabel,
    startColumn: designer.dataset.startColumnLabel,
    span: designer.dataset.spanLabel,
    remove: designer.dataset.removeLabel,
    alignments: {
      left: designer.dataset.alignLeft,
      center: designer.dataset.alignCenter,
      right: designer.dataset.alignRight
    }
  };

  function ensureShape() {
    rows = parseTableRows(rowsInput.value);
    const nextColumnCount = rows.length ? Math.max(...rows.map((row) => row.length), 1) : 0;
    if (nextColumnCount !== columnCount) {
      columnCount = nextColumnCount;
      widths = equalWidths(columnCount);
      alignments = Array.from({ length: columnCount }, (_, index) => alignments[index] || 'left');
      merges = merges.filter((merge) => (
        merge.row >= 1 && merge.row <= rows.length
        && merge.column >= 1 && merge.span >= 2
        && merge.column + merge.span - 1 <= columnCount
      ));
    }
    if (alignments.length !== columnCount) {
      alignments = Array.from({ length: columnCount }, (_, index) => alignments[index] || 'left');
    }
  }

  function syncHiddenFields() {
    widthsInput.value = widths.map((value) => value.toFixed(4)).join(' | ');
    alignmentsInput.value = alignments.join(' | ');
    mergesInput.value = merges.map((merge) => `${merge.row},${merge.column},${merge.span}`).join('\n');
  }

  function renderColumnControls() {
    columnControls.replaceChildren();
    widths.forEach((width, index) => {
      const row = document.createElement('div');
      row.className = 'column-layout-row';
      const title = document.createElement('strong');
      title.textContent = `${labels.column} ${index + 1}`;
      const widthLabel = document.createElement('label');
      const widthText = document.createElement('span');
      widthText.textContent = `${labels.width}: ${width.toFixed(1)}%`;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '5';
      range.max = String(Math.max(5, 100 - (columnCount - 1) * 5));
      range.step = '1';
      range.value = String(width);
      range.disabled = columnCount === 1;
      range.addEventListener('input', () => {
        widths = rebalanceWidths(widths, index, range.value);
        syncHiddenFields();
        renderColumnControls();
        renderPreview();
      });
      widthLabel.append(widthText, range);
      const alignmentLabel = document.createElement('label');
      const alignmentText = document.createElement('span');
      alignmentText.textContent = labels.alignment;
      const select = document.createElement('select');
      for (const value of ['left', 'center', 'right']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = labels.alignments[value] || value;
        option.selected = alignments[index] === value;
        select.append(option);
      }
      select.addEventListener('change', () => {
        alignments[index] = select.value;
        syncHiddenFields();
        renderPreview();
      });
      alignmentLabel.append(alignmentText, select);
      row.append(title, widthLabel, alignmentLabel);
      columnControls.append(row);
    });
  }

  function renderMergeControls() {
    mergeControls.replaceChildren();
    addMergeButton.disabled = columnCount < 2 || !rows.length;
    merges.forEach((merge, index) => {
      const row = document.createElement('div');
      row.className = 'merge-layout-row';
      const fields = [
        { key: 'row', label: labels.row, min: 1, max: Math.max(1, rows.length) },
        { key: 'column', label: labels.startColumn, min: 1, max: Math.max(1, columnCount - 1) },
        { key: 'span', label: labels.span, min: 2, max: Math.max(2, columnCount) }
      ];
      for (const field of fields) {
        const label = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = field.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(field.min);
        input.max = String(field.max);
        input.value = String(merge[field.key]);
        input.addEventListener('input', () => {
          merge[field.key] = Number(input.value);
          syncHiddenFields();
          renderPreview();
        });
        label.append(span, input);
        row.append(label);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button-link';
      remove.textContent = labels.remove;
      remove.addEventListener('click', () => {
        merges.splice(index, 1);
        syncHiddenFields();
        renderMergeControls();
        renderPreview();
      });
      row.append(remove);
      mergeControls.append(row);
    });
  }

  function renderPreview() {
    preview.replaceChildren();
    if (!rows.length || !columnCount) return;
    const table = document.createElement('table');
    const colgroup = document.createElement('colgroup');
    widths.forEach((width) => {
      const col = document.createElement('col');
      col.style.width = `${width}%`;
      colgroup.append(col);
    });
    table.append(colgroup);
    const body = document.createElement('tbody');
    const mergeStarts = new Map();
    const covered = new Set();
    for (const merge of merges) {
      if (!Number.isInteger(merge.row) || !Number.isInteger(merge.column) || !Number.isInteger(merge.span)
          || merge.row < 1 || merge.row > rows.length || merge.column < 1 || merge.span < 2
          || merge.column + merge.span - 1 > columnCount) continue;
      mergeStarts.set(`${merge.row}:${merge.column}`, merge.span);
      for (let column = merge.column + 1; column < merge.column + merge.span; column += 1) {
        covered.add(`${merge.row}:${column}`);
      }
    }
    rows.forEach((values, rowIndex) => {
      const tr = document.createElement('tr');
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const key = `${rowIndex + 1}:${columnIndex + 1}`;
        if (covered.has(key)) continue;
        const cell = document.createElement(headerInput.checked && rowIndex === 0 ? 'th' : 'td');
        const span = mergeStarts.get(key) || 1;
        if (span > 1) cell.colSpan = span;
        cell.textContent = values[columnIndex] || '—';
        cell.style.textAlign = alignments[columnIndex] || 'left';
        tr.append(cell);
      }
      body.append(tr);
    });
    table.append(body);
    preview.append(table);
  }

  function renderAll() {
    ensureShape();
    syncHiddenFields();
    renderColumnControls();
    renderMergeControls();
    renderPreview();
  }

  rowsInput.addEventListener('input', renderAll);
  headerInput.addEventListener('change', renderPreview);
  addMergeButton.addEventListener('click', () => {
    if (columnCount < 2 || !rows.length) return;
    merges.push({ row: 1, column: 1, span: 2 });
    syncHiddenFields();
    renderMergeControls();
    renderPreview();
  });
  renderAll();
}

document.querySelectorAll('[data-template-section-form]').forEach((form) => {
  const designer = form.querySelector('[data-table-layout-designer]');
  if (designer) initTableDesigner(form, designer);
  const imageWidth = form.querySelector('input[name="imageWidthPercent"]');
  const imageWidthOutput = form.querySelector('[data-image-width-output]');
  if (imageWidth && imageWidthOutput) {
    imageWidth.addEventListener('input', () => { imageWidthOutput.textContent = `${imageWidth.value}%`; });
  }
});
